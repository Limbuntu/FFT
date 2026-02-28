from __future__ import annotations

import asyncio
import json
import logging

from fastapi import WebSocket, WebSocketDisconnect

from .models import TaskProgress

logger = logging.getLogger(__name__)

_clients: set[WebSocket] = set()


async def ws_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    _clients.add(websocket)
    logger.info("WebSocket client connected (%d total)", len(_clients))
    try:
        while True:
            # Keep connection alive; client can send pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _clients.discard(websocket)
        logger.info("WebSocket client disconnected (%d total)", len(_clients))


async def broadcast(progress: TaskProgress) -> None:
    if not _clients:
        return
    data = progress.model_dump_json()
    dead: list[WebSocket] = []
    for ws in _clients:
        try:
            await ws.send_text(data)
        except Exception:
            logger.debug("Failed to send to WebSocket client", exc_info=True)
            dead.append(ws)
    for ws in dead:
        _clients.discard(ws)


async def broadcast_json(obj: dict) -> None:
    """Broadcast an arbitrary JSON dict to all WebSocket clients."""
    if not _clients:
        return
    data = json.dumps(obj)
    dead: list[WebSocket] = []
    for ws in _clients:
        try:
            await ws.send_text(data)
        except Exception:
            logger.debug("Failed to send to WebSocket client", exc_info=True)
            dead.append(ws)
    for ws in dead:
        _clients.discard(ws)
