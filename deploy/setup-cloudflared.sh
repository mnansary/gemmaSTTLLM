#!/usr/bin/env bash
set -euo pipefail

# One-time setup for a persistent Cloudflared tunnel.
# Run this manually once. The tunnel ID and URL persist forever.

echo "=== Gemma Long Test App Cloudflared Tunnel Setup ==="
echo ""
echo "This creates a PERMANENT tunnel that survives service restarts."
echo ""

CLOUDFLARED="${CLOUDFLARED:-$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")}"
if ! [[ -x "$CLOUDFLARED" ]]; then
    echo "cloudflared not found. Installing to ~/.local/bin..."
    mkdir -p ~/.local/bin
    curl -L -o ~/.local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
    chmod +x ~/.local/bin/cloudflared
    CLOUDFLARED="$HOME/.local/bin/cloudflared"
fi

TUNNEL_NAME="gemma-stt"
CONFIG_DIR="$HOME/.cloudflared"
CONFIG_FILE="$CONFIG_DIR/gemma-stt.yml"

mkdir -p "$CONFIG_DIR"

# Create tunnel if not exists
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "Creating tunnel '$TUNNEL_NAME' ..."
    $CLOUDFLARED tunnel create "$TUNNEL_NAME" || true
fi

TUNNEL_ID=$($CLOUDFLARED tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}' | head -n1)

if [[ -z "$TUNNEL_ID" ]]; then
    echo "ERROR: Could not find tunnel ID. Check 'cloudflared tunnel list'."
    exit 1
fi

echo "Tunnel ID: $TUNNEL_ID"

# Write config
cat > "$CONFIG_FILE" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CONFIG_DIR}/${TUNNEL_ID}.json

ingress:
  - hostname: gemma-stt-$(hostname | cut -c1-8 | tr '[:upper:]' '[:lower:]').trycloudflare.com
    service: https://localhost:9000
    originRequest:
      noTLSVerify: true
  - service: http_status:404
EOF

echo ""
echo "Config written to: $CONFIG_FILE"
echo ""

# Route DNS (optional — if you have a Cloudflare zone)
read -rp "Do you want to assign a DNS route? (y/N): " ASSIGN_DNS
if [[ "$ASSIGN_DNS" =~ ^[Yy]$ ]]; then
    read -rp "Enter your Cloudflare zone domain (e.g., yourdomain.com): " DOMAIN
    HOSTNAME="gemma-stt.${DOMAIN}"
    $CLOUDFLARED tunnel route dns "$TUNNEL_NAME" "$HOSTNAME" || true
    echo ""
    echo "Route created: https://$HOSTNAME"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start the tunnel service:"
echo "  sudo systemctl enable --now /home/vpa/gemma_quant/deploy/gemma-stt-tunnel.service"
echo ""
echo "To check tunnel status:"
echo "  $CLOUDFLARED tunnel info $TUNNEL_NAME"
echo ""
echo "Your public URL will be shown by:"
echo "  cloudflared tunnel info $TUNNEL_NAME"
