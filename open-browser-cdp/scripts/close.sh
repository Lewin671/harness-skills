#!/usr/bin/env bash
# close.sh - Closes the browser process and any active sessions

# Get current script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

PID_FILE="$HOME/.config/open-browser-cdp/browser.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null; then
        echo "Closing browser (PID: $PID)..."
        kill "$PID" || kill -9 "$PID"
        rm "$PID_FILE"
        echo "Browser closed."
    else
        echo "No browser process found for PID $PID."
        rm "$PID_FILE"
    fi
else
    # Fallback to finding by name if PID file is missing
    echo "PID file not found. Attempting to close by name (Caution: This may close other instances)..."
    pkill -f "$BROWSER_BIN"
fi

# Also clean up any agent-browser daemons that might be running for this CDP port
if command -v agent-browser >/dev/null 2>&1; then
    echo "Cleaning up any associated agent-browser daemons..."
    agent-browser close --all > /dev/null 2>&1 || true
fi
