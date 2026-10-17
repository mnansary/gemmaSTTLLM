#!/usr/bin/env bash
set -euo pipefail

# Start Gemma Long Test App — Backend + UI + Cloudflared Tunnel
# (vLLM Docker must already be running)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================="
echo "  Gemma Long Test App — Starting All Services"
echo "=========================================="
echo ""

# 1. Check vLLM
echo "[1/3] Checking vLLM..."
if curl -s http://localhost:5000/health >/dev/null 2>&1; then
    echo "      ✅ vLLM is running on port 5000"
else
    echo "      ⚠️  vLLM not responding on port 5000"
    echo "      Start it first: ./manage.sh vllm-up"
    echo ""
    read -rp "Start vLLM now? (y/N): " START_VLLM
    if [[ "$START_VLLM" =~ ^[Yy]$ ]]; then
        "$SCRIPT_DIR/manage.sh" vllm-up
        echo "      Waiting for vLLM..."
        for i in $(seq 1 60); do
            sleep 5
            if curl -s http://localhost:5000/health >/dev/null 2>&1; then
                echo "      ✅ vLLM ready"
                break
            fi
            if [ $i -eq 60 ]; then
                echo "      ❌ vLLM failed to start"
                exit 1
            fi
        done
    else
        exit 1
    fi
fi
echo ""

# 2. Start Backend
echo "[2/3] Starting STT Backend (port 9000)..."
if pgrep -f "gemma_stt.main" >/dev/null 2>&1; then
    echo "      ✅ Backend already running"
else
    cd "$SCRIPT_DIR/backend"
    source .venv/bin/activate
    export GEMMA_HOST="${GEMMA_HOST:-0.0.0.0}"
    export GEMMA_PORT="${GEMMA_PORT:-9000}"
    nohup python -m gemma_stt.main > "$SCRIPT_DIR/backend.log" 2>&1 &
    echo "      🚀 Backend started (PID $!)"
    echo "      Logs: tail -f $SCRIPT_DIR/backend.log"
fi
echo ""

# 3. Start Tunnel
echo "[3/3] Starting Cloudflared Tunnel..."
if pgrep -f "cloudflared.*gemma-stt.yml" >/dev/null 2>&1; then
    echo "      ✅ Tunnel already running"
else
    if [[ -f "$HOME/.cloudflared/gemma-stt.yml" ]]; then
        nohup cloudflared tunnel --config "$HOME/.cloudflared/gemma-stt.yml" run > "$SCRIPT_DIR/tunnel.log" 2>&1 &
        echo "      🚀 Tunnel started (PID $!)"
        echo "      Logs: tail -f $SCRIPT_DIR/tunnel.log"
    else
        echo "      ⚠️  Tunnel config not found. Run: ./manage.sh tunnel-setup"
    fi
fi
echo ""

echo "=========================================="
echo "  All services started!"
echo "=========================================="
echo ""
echo "Local:       https://localhost:9000"
echo "API Health:  curl -k https://localhost:9000/health"
echo "vLLM:        http://localhost:5000"
echo ""
if [[ -f "$HOME/.cloudflared/gemma-stt.yml" ]]; then
    echo "Public URL:  Run 'cloudflared tunnel info gemma-stt' to see it"
fi
echo ""
echo "Stop everything: ./stop-all.sh"
echo ""
