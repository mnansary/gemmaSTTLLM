"""Gemma Long Test App — FastAPI backend.

Serves:
  - WebSocket /ws/stt    (binary PCM16 audio → transcription stream)
  - Static files /       (built React SPA)
  - REST /health, /config

HTTPS is served via uvicorn with auto-generated self-signed certs.
"""

from __future__ import annotations

import logging
import os
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import CERT_CERT, CERT_KEY, HOST, PORT, STATIC_DIR, WS_MAX_SESSIONS
from .certs import ensure_self_signed_cert
from .session import TranscriptionSession
from .metrics import REGISTRY

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Gemma Long Test App", version="1.0.0")

# CORS — permissive for development; tighten in production if needed
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok", "service": "gemma-stt"})


@app.get("/config")
async def config() -> JSONResponse:
    return JSONResponse({
        "model": "gemma4",
        "languages": ["bangla", "english"],
        "audio_sample_rate": 16000,
        "audio_format": "pcm16-mono",
    })


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------

_active_sessions: set[str] = set()


@app.get("/metrics")
async def metrics() -> JSONResponse:
    return JSONResponse(REGISTRY.snapshot())


@app.websocket("/ws/stt")
async def websocket_stt(websocket: WebSocket) -> None:
    if len(_active_sessions) >= WS_MAX_SESSIONS:
        await websocket.close(code=1013, reason="Server at capacity")
        return

    await websocket.accept()
    session_id = str(uuid.uuid4())[:8]
    _active_sessions.add(session_id)
    logger.info("[%s] WebSocket connected (%d active)", session_id, len(_active_sessions))

    session = TranscriptionSession(websocket, session_id)
    try:
        await session.run()
    except WebSocketDisconnect:
        logger.info("[%s] WebSocket disconnected", session_id)
    except Exception as exc:
        logger.warning("[%s] Session error: %s", session_id, exc)
    finally:
        await session.close()
        _active_sessions.discard(session_id)
        logger.info("[%s] Session closed (%d active)", session_id, len(_active_sessions))


# ---------------------------------------------------------------------------
# Static files (React SPA) — mounted last so API routes take precedence
# ---------------------------------------------------------------------------

if STATIC_DIR.exists():
    # Mount entire dist directory; html=True falls back to index.html for SPA routing.
    # Direct API/WebSocket routes take precedence over this mount.
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
else:
    logger.warning("Static dir %s not found — frontend may not be built", STATIC_DIR)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    import uvicorn
    use_https = os.getenv("GEMMA_NO_HTTPS", "").lower() not in ("1", "true", "yes")
    if use_https:
        ensure_self_signed_cert(CERT_KEY, CERT_CERT)
        uvicorn.run(
            "gemma_stt.main:app",
            host=HOST,
            port=PORT,
            ssl_keyfile=str(CERT_KEY),
            ssl_certfile=str(CERT_CERT),
            log_level="info",
            access_log=True,
        )
    else:
        logger.warning("Running in HTTP mode (GEMMA_NO_HTTPS=1)")
        uvicorn.run(
            "gemma_stt.main:app",
            host=HOST,
            port=PORT,
            log_level="info",
            access_log=True,
        )


if __name__ == "__main__":
    main()
