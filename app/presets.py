from __future__ import annotations

import json
import logging
from pathlib import Path

from .models import Preset

logger = logging.getLogger(__name__)

from .paths import get_data_dir
PRESETS_FILE = get_data_dir() / "presets.json"

BUILTIN_PRESETS: list[Preset] = [
    Preset(name="极速", encoder="libsvtav1", crf=35, preset=12, builtin=True),
    Preset(name="均衡", encoder="libsvtav1", crf=28, preset=8, builtin=True),
    Preset(name="高质量", encoder="libsvtav1", crf=23, preset=4, builtin=True),
    Preset(name="无损", encoder="libsvtav1", crf=0, preset=4, extra_args=["-svtav1-params", "lossless=1"], builtin=True),
]


def _load_custom() -> list[Preset]:
    if not PRESETS_FILE.exists():
        return []
    try:
        data = json.loads(PRESETS_FILE.read_text("utf-8"))
        return [Preset(**p) for p in data]
    except Exception:
        logger.warning("Failed to load custom presets")
        return []


def _save_custom(presets: list[Preset]) -> None:
    PRESETS_FILE.write_text(
        json.dumps([p.model_dump() for p in presets], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_all_presets() -> list[Preset]:
    custom = _load_custom()
    custom_names = {p.name for p in custom}
    # Custom overrides builtin with same name
    result = []
    for bp in BUILTIN_PRESETS:
        if bp.name in custom_names:
            override = next(p for p in custom if p.name == bp.name)
            # Mark as builtin so UI knows it's an override
            result.append(override.model_copy(update={"builtin": True}))
        else:
            result.append(bp)
    # Add non-builtin custom presets
    for p in custom:
        if p.name not in {bp.name for bp in BUILTIN_PRESETS}:
            result.append(p)
    return result


def save_preset(preset: Preset) -> Preset:
    custom = _load_custom()
    custom = [p for p in custom if p.name != preset.name]
    # Store without builtin flag
    preset.builtin = False
    custom.append(preset)
    _save_custom(custom)
    return preset


def delete_preset(name: str) -> bool:
    custom = _load_custom()
    filtered = [p for p in custom if p.name != name]
    if len(filtered) == len(custom):
        return False
    _save_custom(filtered)
    return True


def reset_preset(name: str) -> bool:
    """Reset a builtin preset to its default values."""
    custom = _load_custom()
    filtered = [p for p in custom if p.name != name]
    if len(filtered) == len(custom):
        return False
    _save_custom(filtered)
    return True
