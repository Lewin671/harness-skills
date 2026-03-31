#!/usr/bin/env bash
# utils.sh - Shared logic for open-browser-cdp skill

CONFIG_DIR="$HOME/.config/open-browser-cdp"
CONFIG_FILE="$CONFIG_DIR/config.env"

# Load persistent config if it exists
if [ -f "$CONFIG_FILE" ]; then
    # shellcheck source=/dev/null
    source "$CONFIG_FILE"
fi

# Set default values if not configured
export BROWSER_DATA_DIR=${BROWSER_DATA_DIR:-"$HOME/.agent-browser-data"}
export BROWSER_PORT=${BROWSER_PORT:-9222}

# Detect browser binary path
if [ -z "${BROWSER_BIN:-}" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # Check Chrome first, then Brave, then Edge
        if [ -d "/Applications/Google Chrome.app" ]; then
            export BROWSER_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        elif [ -d "/Applications/Brave Browser.app" ]; then
            export BROWSER_BIN="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
        elif [ -d "/Applications/Microsoft Edge.app" ]; then
            export BROWSER_BIN="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
        fi
    else
        # Linux detection
        export BROWSER_BIN=$(which google-chrome || which google-chrome-stable || which brave-browser || which microsoft-edge)
    fi
fi

# Ensure data directory exists
mkdir -p "$BROWSER_DATA_DIR"
