#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="${SCRIPT_DIR}/.venv"
if [[ ! -d "$VENV_DIR" ]]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"

if ! python -c "import gemma_stt" 2>/dev/null; then
    echo "Installing gemma-stt..."
    pip install -e "$SCRIPT_DIR"
fi

export GEMMA_HOST="${GEMMA_HOST:-0.0.0.0}"
export GEMMA_PORT="${GEMMA_PORT:-9000}"

echo "Starting Gemma Long Test App on ${GEMMA_HOST}:${GEMMA_PORT} ..."
python -m gemma_stt.main
