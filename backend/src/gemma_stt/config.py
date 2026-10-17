"""Application configuration."""

from __future__ import annotations

import os
from pathlib import Path

VLLM_BASE_URL = os.getenv("GEMMA_VLLM_URL", "http://localhost:5000")
MODEL_NAME = os.getenv("GEMMA_MODEL_NAME", "gemma4")

HOST = os.getenv("GEMMA_HOST", "0.0.0.0")
PORT = int(os.getenv("GEMMA_PORT", "9000"))

# WebSocket
WS_MAX_SESSIONS = int(os.getenv("GEMMA_WS_MAX_SESSIONS", "20"))
WS_PING_INTERVAL_S = 20.0

# Audio
AUDIO_SR = 16_000
AUDIO_TYPE = 0x01

# Certificate directory
CERT_DIR = Path.home() / ".gemma-stt" / "certs"
CERT_KEY = CERT_DIR / "key.pem"
CERT_CERT = CERT_DIR / "cert.pem"

# Static files (built frontend)
STATIC_DIR = Path(__file__).resolve().parent.parent.parent.parent / "frontend" / "dist"
