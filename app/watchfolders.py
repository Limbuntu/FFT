from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from .models import FileEntry, WatchFolder, WatchFolderScanResult

logger = logging.getLogger(__name__)

from .paths import get_data_dir
DATA_FILE = get_data_dir() / "watchfolders.json"

VIDEO_EXTS = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".ts", ".m4v", ".mpg", ".mpeg"}

# Patterns that indicate a file is already a transcoded output
_TRANSCODED_SUFFIXES = re.compile(r"_av1$|_AV1$|_hevc$|_HEVC$|_x265$|_x264$", re.IGNORECASE)
_OUTPUT_DIR_NAMES = {"av1", "AV1"}


def _load() -> list[dict]:
    if not DATA_FILE.exists():
        return []
    try:
        return json.loads(DATA_FILE.read_text("utf-8"))
    except Exception:
        logger.warning("Failed to load watch folders")
        return []


def _save(folders: list[dict]) -> None:
    DATA_FILE.write_text(
        json.dumps(folders, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_folders() -> list[dict]:
    return _load()


def add_folder(path: str, label: str = "", output_dest: str = "beside", output_dir: str = "") -> dict:
    p = Path(path).resolve()
    path_str = str(p)
    folders = _load()
    for f in folders:
        if f["path"] == path_str:
            return f
    entry = {"path": path_str, "label": label or p.name, "output_dest": output_dest, "output_dir": output_dir}
    folders.append(entry)
    _save(folders)
    return entry


def update_folder(path: str, output_dest: str | None = None, output_dir: str | None = None) -> dict | None:
    folders = _load()
    for f in folders:
        if f["path"] == path:
            if output_dest is not None:
                f["output_dest"] = output_dest
            if output_dir is not None:
                f["output_dir"] = output_dir
            _save(folders)
            return f
    return None


def remove_folder(path: str) -> bool:
    folders = _load()
    filtered = [f for f in folders if f["path"] != path]
    if len(filtered) == len(folders):
        return False
    _save(filtered)
    return True


def _is_transcoded_output(item: Path) -> bool:
    """Check if a file looks like a transcoded output."""
    # Skip files inside av1/ output subdirectories
    if any(part in _OUTPUT_DIR_NAMES for part in item.parts):
        return True
    # Skip files whose stem ends with a known transcode suffix
    stem = item.stem
    if _TRANSCODED_SUFFIXES.search(stem):
        return True
    return False


def scan_folder(path: str) -> list[FileEntry]:
    p = Path(path)
    if not p.is_dir():
        return []
    files: list[FileEntry] = []
    try:
        for item in sorted(p.rglob("*"), key=lambda x: x.name.lower()):
            if item.is_file() and item.suffix.lower() in VIDEO_EXTS and not item.name.startswith("."):
                if _is_transcoded_output(item):
                    continue
                try:
                    size = item.stat().st_size
                except OSError:
                    size = 0
                files.append(FileEntry(name=item.name, path=str(item), is_dir=False, size=size))
    except PermissionError:
        logger.warning("Permission denied scanning %s", path)
    return files


def scan_all() -> list[WatchFolderScanResult]:
    results: list[WatchFolderScanResult] = []
    for f in _load():
        files = scan_folder(f["path"])
        folder = WatchFolder(
            path=f["path"],
            label=f.get("label", ""),
            file_count=len(files),
            total_size=sum(x.size for x in files),
            output_dest=f.get("output_dest", "beside"),
            output_dir=f.get("output_dir", ""),
        )
        results.append(WatchFolderScanResult(folder=folder, files=files))
    return results
