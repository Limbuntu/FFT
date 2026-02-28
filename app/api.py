from __future__ import annotations

import base64
import logging
import os
from pathlib import Path

import json

import platform
import subprocess

logger = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse as FastFileResponse
from pydantic import BaseModel

from . import benchmark as bench_mod
from . import hardware as hw_mod
from . import presets as preset_mod
from . import transcoder
from . import watchfolders as wf_mod
from .models import (
    FileBrowseResponse,
    FileEntry,
    Preset,
    TranscodeRequest,
)

router = APIRouter(prefix="/api")

VIDEO_EXTS = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".ts", ".m4v", ".mpg", ".mpeg"}


class AddWatchFolderReq(BaseModel):
    path: str
    label: str = ""
    output_dest: str = "beside"
    output_dir: str = ""


class UpdateWatchFolderReq(BaseModel):
    output_dest: str | None = None
    output_dir: str | None = None


# ── Watch folders ────────────────────────────────────────────────────

@router.get("/watchfolders")
async def list_watchfolders():
    return wf_mod.scan_all()


@router.post("/watchfolders")
async def add_watchfolder(req: AddWatchFolderReq):
    p = Path(req.path).resolve()
    if not p.is_dir():
        raise HTTPException(400, "Path is not a directory")
    entry = wf_mod.add_folder(str(p), req.label, req.output_dest, req.output_dir)
    return entry


@router.patch("/watchfolders/{path_b64}")
async def update_watchfolder(path_b64: str, req: UpdateWatchFolderReq):
    try:
        padded = path_b64 + "=" * (-len(path_b64) % 4)
        folder_path = base64.urlsafe_b64decode(padded).decode("utf-8")
    except Exception:
        raise HTTPException(400, "Invalid base64 path")
    result = wf_mod.update_folder(folder_path, req.output_dest, req.output_dir)
    if not result:
        raise HTTPException(404, "Watch folder not found")
    return result


@router.delete("/watchfolders/{path_b64}")
async def remove_watchfolder(path_b64: str):
    try:
        padded = path_b64 + "=" * (-len(path_b64) % 4)
        folder_path = base64.urlsafe_b64decode(padded).decode("utf-8")
    except Exception:
        raise HTTPException(400, "Invalid base64 path")
    ok = wf_mod.remove_folder(folder_path)
    if not ok:
        raise HTTPException(404, "Watch folder not found")
    return {"status": "deleted"}


@router.post("/watchfolders/scan")
async def rescan_watchfolders():
    return wf_mod.scan_all()


# ── File browser ──────────────────────────────────────────────────────

@router.get("/files")
async def browse_files(path: str = "/") -> FileBrowseResponse:
    p = Path(path).resolve()
    if not p.exists() or not p.is_dir():
        raise HTTPException(404, "Directory not found")

    entries: list[FileEntry] = []
    try:
        for item in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            if item.name.startswith("."):
                continue
            if item.is_dir():
                entries.append(FileEntry(name=item.name, path=str(item), is_dir=True))
            elif item.suffix.lower() in VIDEO_EXTS:
                try:
                    size = item.stat().st_size
                except OSError:
                    size = 0
                entries.append(FileEntry(name=item.name, path=str(item), is_dir=False, size=size))
    except PermissionError:
        raise HTTPException(403, "Permission denied")

    parent = str(p.parent) if p != p.parent else None
    return FileBrowseResponse(current=str(p), parent=parent, entries=entries)


# ── Hardware ──────────────────────────────────────────────────────────

@router.get("/hardware")
async def hardware_info(refresh: bool = False):
    return await hw_mod.detect_hardware(use_cache=not refresh)


# ── Transcode ─────────────────────────────────────────────────────────

@router.post("/transcode")
async def start_transcode(req: TranscodeRequest):
    if not req.files:
        raise HTTPException(400, "No files specified")
    for f in req.files:
        if not os.path.isfile(f):
            raise HTTPException(400, f"File not found: {f}")
    task = await transcoder.start_transcode(req)
    return {"task_id": task.task_id}


@router.delete("/transcode/{task_id}")
async def cancel_transcode(task_id: str):
    ok = await transcoder.cancel_task(task_id)
    if not ok:
        raise HTTPException(404, "Task not found or not cancellable")
    return {"status": "cancelled"}


@router.get("/tasks")
async def list_tasks():
    tasks = transcoder.get_tasks()
    return [t.model_dump() for t in tasks]


# ── System Info ───────────────────────────────────────────────────────

def _get_sysinfo() -> dict:
    system = platform.system()
    info = {
        "os": f"{platform.system()} {platform.release()}",
        "cpu": platform.processor() or "Unknown",
        "cores": os.cpu_count() or 0,
        "threads": os.cpu_count() or 0,
        "memory": "Unknown",
        "gpu": "Unknown",
    }
    # CPU name & core/thread count & memory
    try:
        if system == "Darwin":
            out = subprocess.check_output(
                ["sysctl", "-n", "machdep.cpu.brand_string"],
                text=True, timeout=5
            ).strip()
            if out:
                info["cpu"] = out
            cores = subprocess.check_output(
                ["sysctl", "-n", "hw.physicalcpu"], text=True, timeout=5
            ).strip()
            threads = subprocess.check_output(
                ["sysctl", "-n", "hw.logicalcpu"], text=True, timeout=5
            ).strip()
            info["cores"] = int(cores)
            info["threads"] = int(threads)
            mem = subprocess.check_output(
                ["sysctl", "-n", "hw.memsize"], text=True, timeout=5
            ).strip()
            info["memory"] = f"{round(int(mem) / (1024**3), 1)} GB"
        elif system == "Windows":
            import winreg
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                                r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            cpu_name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
            winreg.CloseKey(key)
            info["cpu"] = cpu_name.strip()
            # Core/thread count via PowerShell
            try:
                ps_cpu = subprocess.check_output(
                    ["powershell", "-NoProfile", "-Command",
                     "(Get-CimInstance Win32_Processor | Select-Object -First 1).NumberOfCores"],
                    text=True, timeout=10, creationflags=0x08000000
                ).strip()
                if ps_cpu:
                    info["cores"] = int(ps_cpu)
                ps_threads = subprocess.check_output(
                    ["powershell", "-NoProfile", "-Command",
                     "(Get-CimInstance Win32_Processor | Select-Object -First 1).NumberOfLogicalProcessors"],
                    text=True, timeout=10, creationflags=0x08000000
                ).strip()
                if ps_threads:
                    info["threads"] = int(ps_threads)
            except Exception:
                pass
            # Memory via PowerShell
            try:
                ps_mem = subprocess.check_output(
                    ["powershell", "-NoProfile", "-Command",
                     "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"],
                    text=True, timeout=10, creationflags=0x08000000
                ).strip()
                if ps_mem:
                    info["memory"] = f"{round(int(ps_mem) / (1024**3), 1)} GB"
            except Exception:
                pass
        elif system == "Linux":
            with open("/proc/cpuinfo") as f:
                phys_ids = set()
                core_ids = set()
                threads_count = 0
                for line in f:
                    if line.startswith("model name") and info["cpu"] == "Unknown":
                        info["cpu"] = line.split(":", 1)[1].strip()
                    if line.startswith("physical id"):
                        phys_ids.add(line.split(":", 1)[1].strip())
                    if line.startswith("core id"):
                        core_ids.add(line.split(":", 1)[1].strip())
                    if line.startswith("processor"):
                        threads_count += 1
                if core_ids:
                    info["cores"] = len(core_ids)
                if threads_count:
                    info["threads"] = threads_count
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemTotal"):
                        kb = int(line.split()[1])
                        info["memory"] = f"{round(kb / (1024**2), 1)} GB"
                        break
    except Exception:
        logger.debug("Failed to parse sysinfo CPU/memory", exc_info=True)
        pass
    # GPU detection
    try:
        if system == "Darwin":
            out = subprocess.check_output(
                ["system_profiler", "SPDisplaysDataType"],
                text=True, timeout=10
            )
            for line in out.splitlines():
                line = line.strip()
                if line.startswith("Chipset Model:") or line.startswith("Chip Model:"):
                    info["gpu"] = line.split(":", 1)[1].strip()
                    break
        elif system == "Windows":
            try:
                ps_gpu = subprocess.check_output(
                    ["powershell", "-NoProfile", "-Command",
                     "(Get-CimInstance Win32_VideoController).Name -join ' / '"],
                    text=True, timeout=10, creationflags=0x08000000
                ).strip()
                if ps_gpu:
                    info["gpu"] = ps_gpu
            except Exception:
                pass
        elif system == "Linux":
            out = subprocess.check_output(
                ["lspci"], text=True, timeout=5
            )
            for line in out.splitlines():
                if "VGA" in line or "3D" in line:
                    info["gpu"] = line.split(":", 2)[-1].strip()
                    break
    except Exception:
        logger.debug("Failed to detect GPU", exc_info=True)
        pass
    return info


@router.get("/sysinfo")
async def get_sysinfo():
    return _get_sysinfo()


@router.get("/benchmark/history")
async def get_benchmark_history():
    data = bench_mod.load_history()
    return data or {"results": [], "timestamp": None}


# ── Benchmark ─────────────────────────────────────────────────────────

@router.post("/benchmark")
async def run_benchmark(request: Request):
    encoders = None
    try:
        body = await request.json()
        encoders = body.get("encoders") or None
    except Exception:
        pass
    return await bench_mod.run_benchmark(encoders)


@router.post("/benchmark/reset")
async def reset_benchmark():
    bench_mod.reset()
    return {"status": "reset"}


@router.post("/benchmark/cancel")
async def cancel_benchmark():
    bench_mod.cancel()
    return {"status": "cancelled"}


@router.get("/leaderboard")
async def get_leaderboard():
    from .paths import get_bundle_dir, get_data_dir
    # Try bundle dir first (packaged), then data dir (exe directory)
    for base in [get_bundle_dir(), get_data_dir()]:
        lb_file = base / "bench_leaderboard.json"
        if lb_file.exists():
            try:
                with open(lb_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning("Failed to load leaderboard from %s: %s", lb_file, e)
    logger.warning("bench_leaderboard.json not found in bundle or data dir")
    return []


# ── Presets ────────────────────────────────────────────────────────────

@router.get("/presets")
async def list_presets():
    return preset_mod.get_all_presets()


@router.post("/presets")
async def save_preset(preset: Preset):
    return preset_mod.save_preset(preset)


@router.delete("/presets/{name}")
async def delete_preset(name: str):
    ok = preset_mod.delete_preset(name)
    if not ok:
        raise HTTPException(404, "Preset not found")


@router.post("/presets/{name}/reset")
async def reset_preset(name: str):
    ok = preset_mod.reset_preset(name)
    if not ok:
        raise HTTPException(404, "No override found")
    return {"status": "ok"}
    return {"status": "deleted"}


# ── Logs ──────────────────────────────────────────────────────────────

@router.get("/logs/download")
async def download_logs():
    from .logging_config import get_log_file
    log_file = get_log_file()
    if not log_file.exists():
        raise HTTPException(404, "Log file not found")
    return FastFileResponse(
        str(log_file),
        media_type="text/plain",
        filename="fft.log",
    )
