from __future__ import annotations

import asyncio
import logging
import re
import shutil

from .models import EncoderInfo, HardwareReport

logger = logging.getLogger(__name__)

ENCODER_MAP: list[tuple[str, str, str]] = [
    ("av1_nvenc", "NVIDIA NVENC", "nvidia"),
    ("av1_qsv", "Intel QSV", "intel"),
    ("av1_amf", "AMD AMF", "amd"),
    ("libsvtav1", "SVT-AV1 (CPU)", "software"),
    ("libaom-av1", "libaom AV1 (CPU)", "software"),
    ("librav1e", "rav1e AV1 (CPU)", "software"),
]


async def _ffmpeg_version() -> str:
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        first_line = stdout.decode().split("\n", 1)[0]
        return first_line.strip()
    except Exception:
        return ""


async def _list_encoders() -> set[str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-encoders", "-hide_banner",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        text = stdout.decode()
        names: set[str] = set()
        for line in text.splitlines():
            m = re.match(r"\s*[A-Z.]+\s+(\S+)", line)
            if m:
                names.add(m.group(1))
        return names
    except Exception:
        return set()


async def _probe_encoder(encoder: str) -> bool:
    """Try a tiny encode to verify the encoder actually works."""
    try:
        cmd = [
            "ffmpeg", "-hide_banner", "-y",
            "-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1",
            "-c:v", encoder, "-frames:v", "1",
            "-f", "null", "-",
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
        return proc.returncode == 0
    except Exception:
        return False


_cache: HardwareReport | None = None


async def detect_hardware(use_cache: bool = True) -> HardwareReport:
    global _cache
    if use_cache and _cache is not None:
        return _cache

    if not shutil.which("ffmpeg"):
        return HardwareReport(ffmpeg_version="ffmpeg not found")

    version, listed = await asyncio.gather(_ffmpeg_version(), _list_encoders())

    encoders: list[EncoderInfo] = []
    probe_tasks = []
    for name, label, hw in ENCODER_MAP:
        if name in listed:
            probe_tasks.append((name, label, hw, _probe_encoder(name)))
        else:
            encoders.append(EncoderInfo(name=name, label=label, hw_type=hw, available=False))

    if probe_tasks:
        results = await asyncio.gather(*(t[3] for t in probe_tasks))
        for (name, label, hw, _), ok in zip(probe_tasks, results):
            encoders.append(EncoderInfo(name=name, label=label, hw_type=hw, available=ok))

    _cache = HardwareReport(encoders=encoders, ffmpeg_version=version)
    return _cache
