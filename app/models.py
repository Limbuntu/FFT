from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ── Hardware ──────────────────────────────────────────────────────────

class EncoderInfo(BaseModel):
    name: str
    label: str
    available: bool = False
    hw_type: str = "software"  # nvidia / intel / amd / apple / software


class HardwareReport(BaseModel):
    encoders: list[EncoderInfo] = []
    ffmpeg_version: str = ""


# ── Transcode ─────────────────────────────────────────────────────────

class TaskStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TranscodeRequest(BaseModel):
    files: list[str]
    encoder: str = "libsvtav1"
    crf: int = 28
    preset: int | str = 8
    extra_args: list[str] = []
    output_dir: str = ""
    output_dest: str = "beside"  # beside / subfolder / custom
    suffix: str = "_av1"
    output_ext: str = "auto"  # .mkv / .mp4 / .webm / auto
    # Per-file output overrides: filepath -> {output_dest, output_dir}
    file_outputs: dict[str, dict[str, str]] = {}


class TaskProgress(BaseModel):
    task_id: str
    status: TaskStatus = TaskStatus.PENDING
    progress: float = 0.0
    speed: str = ""
    eta: str = ""
    eta_seconds: float = 0.0
    current_file: str = ""
    current_index: int = 0
    total_files: int = 0
    message: str = ""
    output_path: str = ""
    created_at: datetime | None = None


class TaskInfo(BaseModel):
    task_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    request: TranscodeRequest
    status: TaskStatus = TaskStatus.PENDING
    progress: float = 0.0
    speed: str = ""
    eta: str = ""
    eta_seconds: float = 0.0
    current_file: str = ""
    current_index: int = 0
    total_files: int = 0
    message: str = ""
    created_at: datetime = Field(default_factory=datetime.now)
    output_path: str = ""


# ── Benchmark ─────────────────────────────────────────────────────────

class BenchmarkResult(BaseModel):
    encoder: str
    label: str
    fps: float = 0.0
    elapsed: float = 0.0
    output_size: int = 0
    score: float = 0.0
    error: str = ""


class BenchmarkReport(BaseModel):
    results: list[BenchmarkResult] = []
    running: bool = False


# ── Presets ────────────────────────────────────────────────────────────

class Preset(BaseModel):
    name: str
    encoder: str = "libsvtav1"
    crf: int = 28
    preset: int | str = 8
    extra_args: list[str] = []
    builtin: bool = False
    output_ext: str = ".mkv"


# ── File browser ──────────────────────────────────────────────────────

class FileEntry(BaseModel):
    name: str
    path: str
    is_dir: bool
    size: int = 0


class FileBrowseResponse(BaseModel):
    current: str
    parent: str | None = None
    entries: list[FileEntry] = []


# ── Watch folders ────────────────────────────────────────────────────

class WatchFolder(BaseModel):
    path: str
    label: str = ""
    file_count: int = 0
    total_size: int = 0
    output_dest: str = "beside"  # beside / subfolder / custom
    output_dir: str = ""


class WatchFolderScanResult(BaseModel):
    folder: WatchFolder
    files: list[FileEntry] = []
