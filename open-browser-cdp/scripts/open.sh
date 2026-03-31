#!/usr/bin/env bash
# open.sh - Launches the browser in headed mode with CDP enabled

# Get current script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load utils for config and browser path
source "$SCRIPT_DIR/utils.sh"

echo "Starting browser in HEADED mode..."
echo "Binary: $BROWSER_BIN"
echo "Data Dir: $BROWSER_DATA_DIR"
echo "CDP Port: $BROWSER_PORT"

# Ensure data directory exists
mkdir -p "$BROWSER_DATA_DIR"

# Launch browser in background (Headed by default)
# --remote-debugging-port: Enables CDP
# --user-data-dir: Persistent profile data
# --no-first-run & --no-default-browser-check: Better for automation
"$BROWSER_BIN" \
  --remote-debugging-port="$BROWSER_PORT" \
  --user-data-dir="$BROWSER_DATA_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "$@" > /dev/null 2>&1 &

# Store PID in a temp file for later closure if needed
echo $! > "$HOME/.config/open-browser-cdp/browser.pid"

echo "Browser process started (PID: $!). Waiting for CDP to be ready..."

# Wait up to 5 seconds for CDP to respond
for i in {1..10}; do
  if "$SCRIPT_DIR/status.sh" > /dev/null 2>&1; then
    echo "CDP is ready on port $BROWSER_PORT."
    exit 0
  fi
  sleep 0.5
done

echo "Error: CDP port $BROWSER_PORT did not become ready within timeout."
exit 1
