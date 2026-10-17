#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "  Gemma Long Test App — Stopping All Services"
echo "=========================================="
echo ""

echo "[1/3] Stopping Tunnel..."
pkill -f "cloudflared.*gemma-stt.yml" 2>/dev/null || true
echo "      ✅ Tunnel stopped"

echo ""
echo "[2/3] Stopping Backend..."
pkill -f "gemma_stt.main" 2>/dev/null || true
echo "      ✅ Backend stopped"

echo ""
echo "[3/3] Stopping vLLM Docker..."
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/docker"
docker compose down 2>/dev/null || true
echo "      ✅ vLLM stopped"

echo ""
echo "=========================================="
echo "  All services stopped."
echo "=========================================="
