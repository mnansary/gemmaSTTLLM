#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
USER="$(whoami)"

echo "=== Gemma Long Test App Systemd Service Installer ==="
echo ""
echo "This will install systemd services for:"
echo "  1. gemma-stt.service       — Backend (API + UI on port 9000)"
echo "  2. gemma-stt-tunnel.service — Cloudflared tunnel (persistent public URL)"
echo "  3. gemma-stt.target        — Starts both together"
echo ""
echo "Choose installation mode:"
echo ""

if [[ "$USER" == "root" ]]; then
    SYSTEMD_DIR="/etc/systemd/system"
    echo "  Running as ROOT → system-wide installation"
    echo "  Commands will require 'sudo'"
    echo "  Services auto-start on BOOT and survive logouts"
else
    SYSTEMD_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SYSTEMD_DIR"
    echo "  Running as USER '$USER' → user-level installation"
    echo "  Commands do NOT need 'sudo' (use --user flag)"
    echo "  Services auto-start on LOGIN, survive logout if linger is enabled"
    echo ""
    echo "  IMPORTANT: To survive logout/reboot, run:"
    echo "    sudo loginctl enable-linger $USER"
fi

echo ""
echo "Installing services to: $SYSTEMD_DIR"
cp "$SCRIPT_DIR/gemma-stt.service" "$SYSTEMD_DIR/"
cp "$SCRIPT_DIR/gemma-stt-tunnel.service" "$SYSTEMD_DIR/"
cp "$SCRIPT_DIR/gemma-stt.target" "$SYSTEMD_DIR/"

# Update paths in service files to match actual user
sed -i "s|/home/vpa/gemma_quant|$PROJECT_DIR|g" "$SYSTEMD_DIR/gemma-stt.service"
sed -i "s|/home/vpa/gemma_quant|$PROJECT_DIR|g" "$SYSTEMD_DIR/gemma-stt-tunnel.service"

if [[ "$USER" != "root" ]]; then
    # Remove User=/Group= lines for user-level systemd (not allowed)
    sed -i '/^User=/d' "$SYSTEMD_DIR/gemma-stt.service"
    sed -i '/^Group=/d' "$SYSTEMD_DIR/gemma-stt.service"
    sed -i '/^User=/d' "$SYSTEMD_DIR/gemma-stt-tunnel.service"
    sed -i '/^Group=/d' "$SYSTEMD_DIR/gemma-stt-tunnel.service"
fi

if [[ "$USER" == "root" ]]; then
    systemctl daemon-reload
    echo ""
    echo "✅ Services installed SYSTEM-WIDE. Commands:"
    echo ""
    echo "  # Start everything (backend + tunnel)"
    echo "  sudo systemctl start gemma-stt.target"
    echo ""
    echo "  # Enable auto-start on BOOT"
    echo "  sudo systemctl enable gemma-stt.target"
    echo ""
    echo "  # Check status"
    echo "  sudo systemctl status gemma-stt gemma-stt-tunnel"
    echo ""
    echo "  # View logs"
    echo "  sudo journalctl -u gemma-stt -f"
    echo "  sudo journalctl -u gemma-stt-tunnel -f"
else
    systemctl --user daemon-reload
    echo ""
    echo "✅ Services installed USER-LEVEL. Commands:"
    echo ""
    echo "  # Start everything (backend + tunnel)"
    echo "  systemctl --user start gemma-stt.target"
    echo ""
    echo "  # Enable auto-start on LOGIN"
    echo "  systemctl --user enable gemma-stt.target"
    echo ""
    echo "  # SURVIVE LOGOUT (run once as root):"
    echo "  sudo loginctl enable-linger $USER"
    echo ""
    echo "  # Check status"
    echo "  systemctl --user status gemma-stt gemma-stt-tunnel"
    echo ""
    echo "  # View logs"
    echo "  journalctl --user -u gemma-stt -f"
    echo "  journalctl --user -u gemma-stt-tunnel -f"
fi

echo ""
echo "NOTE: Make sure cloudflared tunnel is set up first:"
echo "  ./manage.sh tunnel-setup"
echo ""
