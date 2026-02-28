"""Centralized logging configuration for FFT."""
from __future__ import annotations

import logging
import os
import platform
import re
import shutil
import subprocess
from logging.handlers import RotatingFileHandler
from pathlib import Path

from .paths import get_data_dir


class PathSanitizingFilter(logging.Filter):
    """Sanitize file paths for privacy: replace user home + directory + filename."""

    _home_pattern = re.compile(
        r"(?:/Users/|/home/|C:\\Users\\|C:/Users/)([^/\\\s]+)"
    )
    # Match full path ending with a video extension — collapse directory + filename
    # Handles: /path/to/file.mp4, ~/path/to/file.mp4, C:\path\to\file.mp4
    _video_path_pattern = re.compile(
        r"(?:~|(?:[A-Za-z]:))?(?:[/\\][\w.@~ -]+)+[/\\]([^/\\\s]+?)(\.(?:mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|mpg|mpeg))\b",
        re.IGNORECASE,
    )

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = self._sanitize(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {
                    k: self._sanitize(v) if isinstance(v, str) else v
                    for k, v in record.args.items()
                }
            elif isinstance(record.args, tuple):
                record.args = tuple(
                    self._sanitize(a) if isinstance(a, str) else a
                    for a in record.args
                )
        return True

    def _sanitize(self, value: object) -> object:
        if not isinstance(value, str):
            return value
        # First collapse full video file paths to <file>.ext
        value = self._video_path_pattern.sub(r"<file>\2", value)
        # Then replace any remaining user home prefixes
        value = self._home_pattern.sub("~", value)
        return value


def get_log_file() -> Path:
    """Return the path to the log file."""
    log_dir = get_data_dir() / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / "fft.log"


def setup_logging() -> None:
    """Configure root logger with console (INFO) + file (DEBUG, 10MB rotating)."""
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)

    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    sanitizer = PathSanitizingFilter()

    # Console handler — INFO
    console = logging.StreamHandler()
    console.setLevel(logging.INFO)
    console.setFormatter(fmt)
    console.addFilter(sanitizer)
    root.addHandler(console)

    # File handler — DEBUG, 10MB, overwrite when full
    try:
        fh = RotatingFileHandler(
            str(get_log_file()),
            maxBytes=10 * 1024 * 1024,
            backupCount=0,
            encoding="utf-8",
        )
        fh.setLevel(logging.DEBUG)
        fh.setFormatter(fmt)
        fh.addFilter(sanitizer)
        root.addHandler(fh)
    except OSError:
        # If we can't write the log file, just use console
        root.warning("Failed to create log file, using console only")

    _log_startup_info(root)


def _log_startup_info(logger: logging.Logger) -> None:
    """Log system and ffmpeg info at startup."""
    logger.info("=" * 60)
    logger.info("FFT starting")
    logger.info("Platform: %s %s (%s)", platform.system(), platform.release(), platform.machine())
    logger.info("Python: %s", platform.python_version())

    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path:
        logger.info("ffmpeg path: %s", ffmpeg_path)
        try:
            out = subprocess.check_output(
                [ffmpeg_path, "-version"], text=True, timeout=5, stderr=subprocess.STDOUT
            )
            for line in out.strip().splitlines()[:3]:
                logger.info("ffmpeg: %s", line)
        except Exception as e:
            logger.warning("Failed to get ffmpeg version: %s", e)
    else:
        logger.warning("ffmpeg not found in PATH")

    ffprobe_path = shutil.which("ffprobe")
    if ffprobe_path:
        logger.info("ffprobe path: %s", ffprobe_path)
    else:
        logger.warning("ffprobe not found in PATH")

    logger.info("Log file: %s", get_log_file())
    logger.info("=" * 60)
