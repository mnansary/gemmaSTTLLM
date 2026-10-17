#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_FILE="$SCRIPT_DIR/deploy/gemma-stt.service"
TUNNEL_SERVICE_FILE="$SCRIPT_DIR/deploy/gemma-stt-tunnel.service"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

usage() {
    echo "Gemma Long Test App Manager"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Quick Start:"
    echo "  start-all     Start everything (vLLM + backend + tunnel)"
    echo "  stop-all      Stop everything"
    echo ""
    echo "Individual Services:"
    echo "  vllm-up       Start vLLM Docker container (Gemma 4)"
    echo "  vllm-down     Stop vLLM Docker container"
    echo "  vllm-logs     Tail vLLM container logs"
    echo "  start         Start backend service (foreground)"
    echo "  stop          Stop backend service"
    echo "  status        Show service status"
    echo "  logs          Tail backend logs"
    echo ""
    echo "Systemd (persistent, auto-restart):"
    echo "  install-svc   Install systemd services"
    echo "  svc-start     Start backend + tunnel via systemctl"
    echo "  svc-stop      Stop via systemctl"
    echo "  svc-status    Show systemd status"
    echo "  svc-logs      Tail systemd logs"
    echo ""
    echo "Cloudflared Tunnel:"
    echo "  tunnel-setup  Run one-time cloudflared tunnel setup"
    echo "  tunnel-start  Start cloudflared tunnel (background)"
    echo "  tunnel-stop   Stop cloudflared tunnel"
    echo "  tunnel-logs   Tail cloudflared tunnel logs"
    echo ""
    echo "Development:"
    echo "  install       Install Python deps and build frontend"
    echo "  build         Build production frontend"
    echo "  dev           Run frontend dev server"
    echo ""
    echo "Sudo required?"
    echo "  install-svc   → YES if you want system-wide (sudo)"
    echo "  install-svc   → NO if you want user-level (no sudo)"
    echo "  svc-start     → auto-detected (uses sudo only if needed)"
    echo ""
}

cmd_start_all() {
    bash "$SCRIPT_DIR/start-all.sh"
}

cmd_stop_all() {
    bash "$SCRIPT_DIR/stop-all.sh"
}

cmd_install() {
    echo "=== Installing backend ==="
    cd "$BACKEND_DIR"
    if [[ ! -d .venv ]]; then
        python3 -m venv .venv
    fi
    source .venv/bin/activate
    pip install -e "$BACKEND_DIR"

    echo "=== Building frontend ==="
    cd "$FRONTEND_DIR"
    if ! command -v npm &>/dev/null; then
        echo "ERROR: npm not found. Install Node.js first."
        exit 1
    fi
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && nvm use 20 2>/dev/null || true
    npm install
    npm run build

    echo ""
    echo "=== Installation complete ==="
    echo "Start with: $0 start-all"
}

cmd_build() {
    cd "$FRONTEND_DIR"
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && nvm use 20 2>/dev/null || true
    npm install
    npm run build
}

cmd_start() {
    echo "Starting Gemma Long Test App on port 9000 ..."
    cd "$BACKEND_DIR"
    source .venv/bin/activate
    export GEMMA_HOST="${GEMMA_HOST:-0.0.0.0}"
    export GEMMA_PORT="${GEMMA_PORT:-9000}"
    python -m gemma_stt.main
}

cmd_stop() {
    pkill -f "gemma_stt.main" 2>/dev/null || true
    echo "Gemma Long Test App stopped."
}

cmd_status() {
    echo "=== Backend ==="
    if pgrep -f "gemma_stt.main" >/dev/null 2>&1; then
        echo "  RUNNING  — PID $(pgrep -f gemma_stt.main | head -1)"
    else
        echo "  STOPPED"
    fi
    echo "=== vLLM Docker ==="
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "NAMES|gemma-stt-vllm" || echo "  STOPPED"
    echo "=== Tunnel ==="
    if pgrep -f "cloudflared.*gemma-stt.yml" >/dev/null 2>&1; then
        echo "  RUNNING"
    else
        echo "  STOPPED"
    fi
}

cmd_logs() {
    journalctl -u gemma-stt -f 2>/dev/null || tail -f "$SCRIPT_DIR/backend.log" 2>/dev/null || echo "No logs found."
}

cmd_vllm_up() {
    bash "$SCRIPT_DIR/docker/run.sh" up
}

cmd_vllm_down() {
    bash "$SCRIPT_DIR/docker/run.sh" down
}

cmd_vllm_logs() {
    bash "$SCRIPT_DIR/docker/run.sh" logs
}

cmd_tunnel_setup() {
    bash "$SCRIPT_DIR/deploy/setup-cloudflared.sh"
}

cmd_tunnel_start() {
    local cf
    cf="$(command -v cloudflared 2>/dev/null || echo "$HOME/.local/bin/cloudflared")"
    if [[ -f "$HOME/.cloudflared/gemma-stt.yml" ]]; then
        nohup "$cf" tunnel --config "$HOME/.cloudflared/gemma-stt.yml" run > "$SCRIPT_DIR/tunnel.log" 2>&1 &
        echo "Tunnel started. Logs: tail -f $SCRIPT_DIR/tunnel.log"
    else
        echo "ERROR: Persistent tunnel config not found."
        echo "Run: $0 tunnel-setup"
        echo ""
        echo "Or start a quick temporary tunnel:"
        echo "  nohup $cf tunnel --url https://localhost:9000 > tunnel.log 2>&1 &"
        exit 1
    fi
}

cmd_tunnel_stop() {
    pkill -f "cloudflared.*gemma-stt" 2>/dev/null || true
    echo "Tunnel stopped."
}

cmd_tunnel_logs() {
    tail -f "$SCRIPT_DIR/tunnel.log" 2>/dev/null || journalctl -u gemma-stt-tunnel -f 2>/dev/null || echo "No logs found."
}

cmd_install_svc() {
    bash "$SCRIPT_DIR/deploy/install-services.sh"
}

_detect_systemd_scope() {
    if [[ -f "$HOME/.config/systemd/user/gemma-stt.target" ]]; then
        echo "user"
    elif [[ -f "/etc/systemd/system/gemma-stt.target" ]]; then
        echo "system"
    else
        echo "none"
    fi
}

cmd_svc_start() {
    local scope
    scope=$(_detect_systemd_scope)
    if [[ "$scope" == "none" ]]; then
        echo "ERROR: Services not installed. Run: $0 install-svc"
        echo ""
        echo "Choose ONE of these methods:"
        echo ""
        echo "  A) User-level (NO sudo needed, survives login only):"
        echo "     ./manage.sh install-svc"
        echo "     systemctl --user start gemma-stt.target"
        echo ""
        echo "  B) System-level (requires sudo, survives reboots):"
        echo "     sudo ./manage.sh install-svc"
        echo "     sudo systemctl start gemma-stt.target"
        exit 1
    fi
    if [[ "$scope" == "user" ]]; then
        systemctl --user start gemma-stt.target
        echo "✅ gemma-stt.target started (user-level, no sudo)"
    else
        sudo systemctl start gemma-stt.target
        echo "✅ gemma-stt.target started (system-level, with sudo)"
    fi
}

cmd_svc_stop() {
    local scope
    scope=$(_detect_systemd_scope)
    if [[ "$scope" == "user" ]]; then
        systemctl --user stop gemma-stt.target 2>/dev/null || true
    else
        sudo systemctl stop gemma-stt.target 2>/dev/null || true
    fi
    echo "✅ gemma-stt.target stopped"
}

cmd_svc_status() {
    local scope
    scope=$(_detect_systemd_scope)
    if [[ "$scope" == "user" ]]; then
        systemctl --user status gemma-stt gemma-stt-tunnel --no-pager
    else
        sudo systemctl status gemma-stt gemma-stt-tunnel --no-pager
    fi
}

cmd_svc_logs() {
    local scope
    scope=$(_detect_systemd_scope)
    if [[ "$scope" == "user" ]]; then
        journalctl --user -u gemma-stt -u gemma-stt-tunnel -f
    else
        sudo journalctl -u gemma-stt -u gemma-stt-tunnel -f
    fi
}

cmd_dev() {
    cd "$FRONTEND_DIR"
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && nvm use 20 2>/dev/null || true
    npm install
    npm run dev
}

# Main
case "${1:-}" in
    start-all) cmd_start_all ;;
    stop-all) cmd_stop_all ;;
    install) cmd_install ;;
    build) cmd_build ;;
    start) cmd_start ;;
    stop) cmd_stop ;;
    status) cmd_status ;;
    logs) cmd_logs ;;
    vllm-up) cmd_vllm_up ;;
    vllm-down) cmd_vllm_down ;;
    vllm-logs) cmd_vllm_logs ;;
    install-svc) cmd_install_svc ;;
    svc-start) cmd_svc_start ;;
    svc-stop) cmd_svc_stop ;;
    svc-status) cmd_svc_status ;;
    svc-logs) cmd_svc_logs ;;
    tunnel-setup) cmd_tunnel_setup ;;
    tunnel-start) cmd_tunnel_start ;;
    tunnel-stop) cmd_tunnel_stop ;;
    tunnel-logs) cmd_tunnel_logs ;;
    dev) cmd_dev ;;
    *) usage ;;
esac
