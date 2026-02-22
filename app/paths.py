"""Path helpers for both development and PyInstaller-frozen builds."""
from __future__ import annotations

import os
import sys
from pathlib import Path


def get_bundle_dir() -> Path:
    """Return the directory where bundled read-only assets live.

    - Dev: repo root (parent of app/)
    - Frozen: sys._MEIPASS (PyInstaller temp dir)
    """
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).parent.parent


def get_data_dir() -> Path:
    """Return a writable directory for user data (presets, history, etc.).

    - Dev: repo root
    - Frozen: directory where the executable lives
    """
    if getattr(sys, "frozen", False):
        return Path(os.path.dirname(sys.executable))
    return Path(__file__).parent.parent
