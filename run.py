"""FFT launcher — entry point for PyInstaller builds."""
from __future__ import annotations

import os
import sys
import webbrowser
import threading
import uvicorn


def _get_base_dir() -> str:
    """Return the base directory (repo root or PyInstaller temp dir)."""
    if getattr(sys, "frozen", False):
        # Running as a PyInstaller bundle
        return sys._MEIPASS  # type: ignore[attr-defined]
    return os.path.dirname(os.path.abspath(__file__))


def main() -> None:
    # Make sure the app package can be imported when frozen
    base = _get_base_dir()
    if base not in sys.path:
        sys.path.insert(0, base)

    # Add executable directory to PATH so bundled ffmpeg/ffprobe are found
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        os.environ["PATH"] = exe_dir + os.pathsep + os.environ.get("PATH", "")

    host = "127.0.0.1"
    port = int(os.environ.get("FFT_PORT", "8166"))

    # Open browser after a short delay
    def _open_browser():
        import time
        time.sleep(1.5)
        webbrowser.open(f"http://{host}:{port}")

    threading.Thread(target=_open_browser, daemon=True).start()

    print(f"FFT starting on http://{host}:{port}")
    uvicorn.run("app.main:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
