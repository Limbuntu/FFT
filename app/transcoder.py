from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from datetime import datetime
from typing import Callable, Awaitable

from .models import TaskInfo, TaskStatus, TranscodeRequest, TaskProgress

logger = logging.getLogger(__name__)

# Global task registry
_tasks: dict[str, TaskInfo] = {}
_processes: dict[str, asyncio.subprocess.Process] = {}
_partial_outputs: dict[str, str] = {}  # task_id -> current output file path
_durations: dict[str, float] = {}  # filepath -> duration in seconds

ProgressCallback = Callable[[TaskProgress], Awaitable[None]]
_progress_callback: ProgressCallback | None = None

# Generic JSON broadcast callback (for toast messages etc.)
_json_broadcast: Callable[[dict], Awaitable[None]] | None = None


def set_progress_callback(cb: ProgressCallback) -> None:
    global _progress_callback
    _progress_callback = cb


def set_json_broadcast(cb: Callable[[dict], Awaitable[None]]) -> None:
    global _json_broadcast
    _json_broadcast = cb


def get_tasks() -> list[TaskInfo]:
    return list(_tasks.values())


def get_task(task_id: str) -> TaskInfo | None:
    return _tasks.get(task_id)


async def _notify(task: TaskInfo) -> None:
    if _progress_callback:
        await _progress_callback(TaskProgress(
            task_id=task.task_id,
            status=task.status,
            progress=task.progress,
            speed=task.speed,
            eta=task.eta,
            eta_seconds=task.eta_seconds,
            current_file=task.current_file,
            current_index=task.current_index,
            total_files=task.total_files,
            message=task.message,
            output_path=task.output_path,
            created_at=task.created_at,
        ))


async def _get_duration(filepath: str) -> float:
    """Use ffprobe to get video duration in seconds."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            filepath,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        return float(stdout.decode().strip())
    except Exception as e:
        logger.debug("Failed to get duration for %s: %s", filepath, e)
        return 0.0


def _parse_time(time_str: str) -> float:
    """Parse HH:MM:SS.xx to seconds."""
    m = re.match(r"(\d+):(\d+):(\d+(?:\.\d+)?)", time_str)
    if not m:
        return 0.0
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def _build_ffmpeg_cmd(src: str, dst: str, req: TranscodeRequest) -> list[str]:
    cmd = [
        "ffmpeg", "-hide_banner", "-y",
        "-i", src,
        "-c:v", req.encoder,
    ]

    if req.encoder == "libsvtav1":
        cmd += ["-crf", str(req.crf), "-preset", str(req.preset)]
    elif req.encoder == "libaom-av1":
        cmd += ["-crf", str(req.crf), "-cpu-used", str(req.preset)]
    elif req.encoder == "librav1e":
        cmd += ["-qp", str(req.crf), "-speed", str(req.preset)]
    elif req.encoder == "av1_nvenc":
        cmd += ["-cq", str(req.crf), "-preset", "p5"]
    elif req.encoder == "av1_qsv":
        cmd += ["-global_quality", str(req.crf), "-preset", "medium"]
    elif req.encoder == "av1_amf":
        cmd += ["-quality", str(req.crf), "-usage", "transcoding"]

    cmd += ["-c:a", "copy"]

    if req.extra_args:
        cmd += req.extra_args

    cmd.append(dst)
    return cmd


async def start_transcode(req: TranscodeRequest) -> TaskInfo:
    task = TaskInfo(
        task_id=uuid.uuid4().hex[:8],
        request=req,
        total_files=len(req.files),
    )
    _tasks[task.task_id] = task
    asyncio.create_task(_run_task(task))
    return task


async def cancel_task(task_id: str) -> bool:
    task = _tasks.get(task_id)
    if not task or task.status not in (TaskStatus.PENDING, TaskStatus.RUNNING):
        return False
    task.status = TaskStatus.CANCELLED
    proc = _processes.pop(task_id, None)
    if proc and proc.returncode is None:
        proc.terminate()
    # Clean up partial output file
    partial = _partial_outputs.pop(task_id, None)
    if partial and os.path.isfile(partial):
        try:
            os.remove(partial)
            logger.info("Removed partial output: %s", partial)
        except OSError as e:
            logger.warning("Failed to remove partial output %s: %s", partial, e)
    return True


# Extensions that don't support AV1 codec
_AV1_INCOMPATIBLE_EXTS = {".mov", ".avi", ".wmv", ".flv", ".ts", ".mpg", ".mpeg"}


async def _run_task(task: TaskInfo) -> None:
    task.status = TaskStatus.RUNNING
    await _notify(task)

    for idx, filepath in enumerate(task.request.files):
        if task.status == TaskStatus.CANCELLED:
            return

        task.current_index = idx
        task.current_file = os.path.basename(filepath)

        # Build output path
        base, src_ext = os.path.splitext(filepath)
        ext = src_ext if task.request.output_ext == "auto" else task.request.output_ext

        # AV1 is not supported in certain containers — fall back to .mp4
        format_changed = False
        if ext.lower() in _AV1_INCOMPATIBLE_EXTS:
            logger.info("Container %s does not support AV1, falling back to .mp4 for %s", ext, filepath)
            format_changed = True
            original_ext = ext
            ext = ".mp4"
            if _json_broadcast:
                try:
                    await _json_broadcast({
                        "type": "toast",
                        "message": f"{os.path.basename(filepath)}: {original_ext} 不支持 AV1，已自动转为 .mp4",
                        "level": "info",
                    })
                except Exception:
                    pass

        # Per-file output override from folder settings
        fo = task.request.file_outputs.get(filepath, {})
        file_dest = fo.get("output_dest", task.request.output_dest)
        file_dir = fo.get("output_dir", task.request.output_dir)

        if file_dest == "subfolder":
            out_dir = os.path.join(os.path.dirname(filepath), "av1")
            os.makedirs(out_dir, exist_ok=True)
        elif file_dest == "custom" and file_dir:
            out_dir = file_dir
            os.makedirs(out_dir, exist_ok=True)
        else:
            out_dir = os.path.dirname(filepath)

        out_name = os.path.basename(base) + task.request.suffix + ext
        dst = os.path.join(out_dir, out_name)
        task.output_path = dst

        # Track partial output for cleanup on cancel
        _partial_outputs[task.task_id] = dst

        duration = await _get_duration(filepath)
        _durations[filepath] = duration
        cmd = _build_ffmpeg_cmd(filepath, dst, task.request)
        logger.info("Transcode cmd: %s", " ".join(cmd))

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _processes[task.task_id] = proc

            # Read stderr in chunks — ffmpeg uses \r for progress lines
            assert proc.stderr is not None
            buf = b""
            while True:
                chunk = await proc.stderr.read(512)
                if not chunk:
                    break
                buf += chunk
                # Split on \r or \n
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
                    if not text.strip():
                        continue

                    logger.debug("[ffmpeg] %s", text.strip())

                    time_match = re.search(r"time=(\d+:\d+:\d+\.\d+)", text)
                    speed_match = re.search(r"speed=\s*([\d.]+x)", text)

                    if time_match and duration > 0:
                        current = _parse_time(time_match.group(1))
                        file_progress = min(current / duration, 1.0)
                        overall = (idx + file_progress) / len(task.request.files)
                        task.progress = round(overall * 100, 1)

                        # Calculate ETA based on speed
                        if speed_match:
                            speed_str = speed_match.group(1).rstrip('x')
                            try:
                                speed_val = float(speed_str)
                                if speed_val > 0:
                                    remaining_file = (duration - current) / speed_val
                                    remaining_other = sum(
                                        _durations.get(f, 0) / speed_val
                                        for f in task.request.files[idx + 1:]
                                    )
                                    total_eta = remaining_file + remaining_other
                                    task.eta_seconds = total_eta
                                    if total_eta >= 3600:
                                        task.eta = f"{int(total_eta // 3600)}h{int((total_eta % 3600) // 60)}m"
                                    elif total_eta >= 60:
                                        task.eta = f"{int(total_eta // 60)}m{int(total_eta % 60)}s"
                                    else:
                                        task.eta = f"{int(total_eta)}s"
                            except (ValueError, ZeroDivisionError):
                                pass

                    if speed_match:
                        task.speed = speed_match.group(1)

                    await _notify(task)

            await proc.wait()
            _processes.pop(task.task_id, None)

            if task.status == TaskStatus.CANCELLED:
                return

            if proc.returncode != 0:
                stderr_tail = buf.decode("utf-8", errors="replace")[-500:]
                logger.error("Transcode failed for %s (rc=%d): %s", filepath, proc.returncode, stderr_tail)
                task.status = TaskStatus.FAILED
                task.message = f"ffmpeg exited with code {proc.returncode}"
                await _notify(task)
                return

        except Exception as e:
            logger.error("Transcode failed for %s: %s", filepath, e, exc_info=True)
            task.status = TaskStatus.FAILED
            task.message = str(e)
            await _notify(task)
            return

    task.progress = 100.0
    task.status = TaskStatus.DONE
    elapsed = (datetime.now() - task.created_at).total_seconds()
    if elapsed >= 3600:
        task.eta = f"耗时 {int(elapsed // 3600)}h{int((elapsed % 3600) // 60)}m{int(elapsed % 60)}s"
    elif elapsed >= 60:
        task.eta = f"耗时 {int(elapsed // 60)}m{int(elapsed % 60)}s"
    else:
        task.eta = f"耗时 {int(elapsed)}s"
    task.message = "All files transcoded"
    await _notify(task)
