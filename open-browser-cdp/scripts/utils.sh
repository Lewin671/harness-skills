#!/usr/bin/env bash
# utils.sh - Shared logic with boundary condition handling

CONFIG_DIR="$HOME/.config/open-browser-cdp"
CONFIG_FILE="$CONFIG_DIR/config.env"

# Ensure config directory exists
mkdir -p "$CONFIG_DIR"

# Load persistent config if it exists
if [ -f "$CONFIG_FILE" ]; then
    # shellcheck source=/dev/null
    source "$CONFIG_FILE"
fi

# 1. Handle BROWSER_DATA_DIR (Default + Tilde Expansion)
export BROWSER_DATA_DIR=${BROWSER_DATA_DIR:-"$HOME/.agent-browser-data"}
# Expand ~ if present in the string
export BROWSER_DATA_DIR="${BROWSER_DATA_DIR/#\~/$HOME}"

# 2. Handle BROWSER_PORT
export BROWSER_PORT=${BROWSER_PORT:-9222}

# 3. Handle BROWSER_BIN detection
if [ -z "${BROWSER_BIN:-}" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        BRAVE_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
        EDGE_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"

        if [ -x "$CHROME_PATH" ]; then
            export BROWSER_BIN="$CHROME_PATH"
        elif [ -x "$BRAVE_PATH" ]; then
            export BROWSER_BIN="$BRAVE_PATH"
        elif [ -x "$EDGE_PATH" ]; then
            export BROWSER_BIN="$EDGE_PATH"
        fi
    else
        export BROWSER_BIN=$(which google-chrome || which google-chrome-stable || which brave-browser || which microsoft-edge)
    fi
fi

# Final Check
if [ -z "$BROWSER_BIN" ]; then
    echo "Error: Could not find a supported browser binary. Please set BROWSER_BIN in $CONFIG_FILE" >&2
    exit 1
fi

# Shared path for the browser PID file
export PID_FILE="$CONFIG_DIR/browser.pid"
