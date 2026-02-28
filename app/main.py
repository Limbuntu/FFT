from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .api import router
from .ws import ws_endpoint, broadcast, broadcast_json
from .transcoder import set_progress_callback, set_json_broadcast
from .benchmark import set_ws_broadcast

from .logging_config import setup_logging
setup_logging()

app = FastAPI(title="FFT - FFmpeg Transcoder", version="1.0.0")


@app.on_event("startup")
async def startup():
    from .hardware import detect_hardware
    await detect_hardware()  # warm cache on startup

# Register progress callback
set_progress_callback(broadcast)

# Register JSON broadcast for transcoder toast messages
set_json_broadcast(broadcast_json)

# Register benchmark WebSocket broadcast
set_ws_broadcast(broadcast_json)

# REST API
app.include_router(router)

# WebSocket
app.add_api_websocket_route("/ws", ws_endpoint)

# Static files
from .paths import get_bundle_dir
static_dir = get_bundle_dir() / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.get("/")
async def index():
    return FileResponse(str(static_dir / "index.html"))
