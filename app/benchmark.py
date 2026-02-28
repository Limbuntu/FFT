from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import time

import re

from .hardware import detect_hardware
from .models import BenchmarkResult

logger = logging.getLogger(__name__)

ROUNDS = 3
BENCH_DURATION = 10  # seconds of test video
BENCH_FPS = 30
BENCH_TOTAL_FRAMES = BENCH_DURATION * BENCH_FPS
BENCH_TIMEOUT = 120  # seconds per round

from .paths import get_data_dir, get_bundle_dir
_HISTORY_FILE = str(get_data_dir() / "bench_history.json")

_running = False
_cancelled = False
_current_proc = None

# Callback to push arbitrary dicts to frontend via WebSocket
_ws_broadcast = None


def set_ws_broadcast(cb):
    global _ws_broadcast
    _ws_broadcast = cb


def load_history() -> dict | None:
    """Load last benchmark results from disk."""
    try:
        if os.path.exists(_HISTORY_FILE):
            with open(_HISTORY_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        logger.warning("Failed to load benchmark history: %s", e)
        pass


def _save_history(results: list[BenchmarkResult]):
    """Merge new results into history, keeping latest per encoder."""
    from datetime import datetime
    # Load existing history
    existing = {}
    old = load_history()
    if old and old.get("results"):
        for r in old["results"]:
            existing[r["encoder"]] = r
    # Overwrite with new results
    for r in results:
        existing[r.encoder] = r.model_dump()
    data = {
        "timestamp": datetime.now().isoformat(),
        "results": list(existing.values()),
    }
    try:
        with open(_HISTORY_FILE, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning("Failed to save benchmark history: %s", e)


def reset():
    global _running
    _running = False


def cancel():
    global _cancelled, _current_proc
    _cancelled = True
    if _current_proc:
        try:
            _current_proc.kill()
        except Exception:
            pass


def is_running() -> bool:
    return _running


async def run_benchmark(encoders: list[str] | None = None) -> dict:
    """Start benchmark in background, return immediately."""
    global _running, _cancelled
    if _running:
        return {"status": "already_running"}

    _running = True
    _cancelled = False
    task = asyncio.create_task(_run_benchmark_bg(encoders))
    task.add_done_callback(_on_benchmark_done)
    return {"status": "started"}


def _on_benchmark_done(task):
    global _running
    _running = False
    if task.exception():
        logger.error("Benchmark task crashed: %s", task.exception())


async def _run_benchmark_bg(encoders: list[str] | None = None):
    """Run selected (or all) encoder benchmarks, pushing each result via WebSocket."""
    global _running
    try:
        hw = await detect_hardware()
        available = [e for e in hw.encoders if e.available]

        # Filter to selected encoders if specified
        if encoders:
            available = [e for e in available if e.name in encoders]

        if not available:
            logger.warning("No available encoders for benchmark")
            if _ws_broadcast:
                await _ws_broadcast({
                    "type": "bench_done",
                    "results": [],
                    "message": "没有可用的编码器",
                })
            return

        results = []
        for enc in available:
            if _cancelled:
                logger.info("Benchmark cancelled")
                break
            result = await _bench_encoder(enc.name, enc.label)
            if _cancelled:
                break
            results.append(result)
            # Push partial result to frontend
            if _ws_broadcast:
                try:
                    await _ws_broadcast({
                        "type": "bench_result",
                        "result": result.model_dump(),
                    })
                except Exception:
                    pass

        # Save results to disk
        _save_history(results)

        # Signal completion
        if _ws_broadcast:
            try:
                await _ws_broadcast({
                    "type": "bench_done",
                    "results": [r.model_dump() for r in results],
                })
            except Exception:
                pass
    finally:
        _running = False


async def _bench_encoder(encoder: str, label: str) -> BenchmarkResult:
    """Benchmark a single encoder 3 rounds, return median result."""
    results = []
    for i in range(ROUNDS):
        if _cancelled:
            return BenchmarkResult(encoder=encoder, label=label, error="已取消")
        logger.info("Benchmarking %s round %d/%d ...", encoder, i + 1, ROUNDS)
        r = await _bench_encoder_once(encoder, label)
        if _cancelled:
            return BenchmarkResult(encoder=encoder, label=label, error="已取消")
        if r.error:
            return r  # fail fast on error
        results.append(r)
        if _ws_broadcast:
            try:
                await _ws_broadcast({
                    "type": "bench_round",
                    "encoder": encoder,
                    "round": i + 1,
                    "total_rounds": ROUNDS,
                    "fps": r.fps,
                })
            except Exception:
                pass

    # Pick median by fps
    results.sort(key=lambda r: r.fps)
    median = results[len(results) // 2]
    logger.info("Benchmark %s median: %.1f fps (from %s)",
                encoder, median.fps, [r.fps for r in results])
    return median


def _parse_time(ts: str) -> float:
    """Parse HH:MM:SS.xx to seconds."""
    parts = ts.split(":")
    return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])


async def _bench_encoder_once(encoder: str, label: str) -> BenchmarkResult:
    """Run a single benchmark pass for one encoder with real-time progress."""
    tmpdir = tempfile.mkdtemp(prefix="fft_bench_")
    outfile = os.path.join(tmpdir, f"bench_{encoder}.mkv")

    cmd = [
        "ffmpeg", "-hide_banner", "-y",
        "-f", "lavfi", "-i",
        f"testsrc2=size=1920x1080:rate={BENCH_FPS}:duration={BENCH_DURATION}",
        "-c:v", encoder,
    ]

    # Encoder-specific params
    if encoder == "libsvtav1":
        cmd += ["-crf", "28", "-preset", "8"]
    elif encoder == "libaom-av1":
        cmd += ["-crf", "28", "-cpu-used", "6"]
    elif encoder == "librav1e":
        cmd += ["-qp", "28", "-speed", "6"]
    elif encoder == "av1_nvenc":
        cmd += ["-cq", "28", "-preset", "p5"]
    elif encoder == "av1_qsv":
        cmd += ["-global_quality", "28", "-preset", "medium"]
    elif encoder == "av1_amf":
        cmd += ["-quality", "28", "-usage", "transcoding"]

    cmd.append(outfile)

    logger.info("Benchmark cmd: %s", " ".join(cmd))

    t0 = time.monotonic()
    proc = None
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        global _current_proc
        _current_proc = proc

        # Read stderr in real-time for progress
        assert proc.stderr is not None
        buf = b""
        last_progress = 0.0

        async def read_progress():
            nonlocal buf, last_progress
            while True:
                chunk = await asyncio.wait_for(
                    proc.stderr.read(512), timeout=BENCH_TIMEOUT
                )
                if not chunk:
                    break
                buf += chunk
                while b"\r" in buf or b"\n" in buf:
                    idx_r = buf.find(b"\r")
                    idx_n = buf.find(b"\n")
                    if idx_r == -1:
                        idx_r = len(buf)
                    if idx_n == -1:
                        idx_n = len(buf)
                    split_at = min(idx_r, idx_n)
                    line_bytes = buf[:split_at]
                    buf = buf[split_at + 1:]

                    text = line_bytes.decode("utf-8", errors="replace")
                    logger.debug("[bench ffmpeg %s] %s", encoder, text.strip() if text.strip() else "(empty)")
                    time_match = re.search(r"time=(\d+:\d+:\d+\.\d+)", text)
                    speed_match = re.search(r"speed=\s*([\d.]+x)", text)

                    if time_match:
                        current = _parse_time(time_match.group(1))
                        progress = min(current / BENCH_DURATION, 1.0)
                        if _ws_broadcast and progress - last_progress >= 0.05:
                            last_progress = progress
                            msg = {
                                "type": "bench_progress",
                                "encoder": encoder,
                                "progress": round(progress * 100, 1),
                            }
                            if speed_match:
                                msg["speed"] = speed_match.group(1)
                            try:
                                await _ws_broadcast(msg)
                            except Exception:
                                pass

        await read_progress()
        await proc.wait()
        elapsed = time.monotonic() - t0

        if proc.returncode != 0:
            err_text = buf.decode("utf-8", errors="replace")[-300:]
            logger.warning("Benchmark %s failed: %s", encoder, err_text)
            return BenchmarkResult(
                encoder=encoder, label=label,
                elapsed=round(elapsed, 2),
                error=err_text,
            )

        fps = BENCH_TOTAL_FRAMES / elapsed if elapsed > 0 else 0
        size = os.path.getsize(outfile) if os.path.exists(outfile) else 0

        logger.info("Benchmark %s: %.1f fps, %.2fs", encoder, fps, elapsed)
        return BenchmarkResult(
            encoder=encoder, label=label,
            fps=round(fps, 1),
            elapsed=round(elapsed, 2),
            output_size=size,
            score=round(fps * 100, 0),
        )
    except (asyncio.TimeoutError, TimeoutError):
        logger.warning("Benchmark %s timed out (>%ds)", encoder, BENCH_TIMEOUT)
        if proc:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
        return BenchmarkResult(
            encoder=encoder, label=label,
            elapsed=float(BENCH_TIMEOUT),
            error=f"超时 (>{BENCH_TIMEOUT}s)",
        )
    except Exception as e:
        logger.error("Benchmark %s error: %s", encoder, e)
        return BenchmarkResult(encoder=encoder, label=label, error=str(e))
    finally:
        try:
            if os.path.exists(outfile):
                os.remove(outfile)
            os.rmdir(tmpdir)
        except OSError:
            pass
