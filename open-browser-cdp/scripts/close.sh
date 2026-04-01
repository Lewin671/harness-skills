#!/usr/bin/env bash
# close.sh - Closes ONLY the specific CDP browser instance on BROWSER_PORT.
#            Never kills other browser windows or profiles.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

# Seconds to wait for graceful exit before sending SIGKILL
GRACEFUL_TIMEOUT=5

# Find the PID of the process that is *listening* on the CDP port.
# Using -s TCP:LISTEN ensures we only match the server socket, not
# renderer/tab sub-processes that merely have a connection to it.
find_cdp_pid() {
    lsof -n -i "tcp:$BROWSER_PORT" -s TCP:LISTEN 2>/dev/null | awk 'NR==2 {print $2}'
}

# Send SIGTERM first; wait up to GRACEFUL_TIMEOUT seconds; then SIGKILL only if still alive.
graceful_kill() {
    local pid="$1"
    echo "Sending SIGTERM to PID $pid..."
    kill "$pid" 2>/dev/null
    for i in $(seq 1 "$GRACEFUL_TIMEOUT"); do
        sleep 1
        if ! ps -p "$pid" > /dev/null 2>&1; then
            echo "Browser closed."
            return 0
        fi
    done
    echo "Browser did not exit gracefully; sending SIGKILL..."
    kill -9 "$pid" 2>/dev/null
    echo "Browser force-closed."
}

close_by_pid() {
    local pid="$1"
    if ps -p "$pid" > /dev/null 2>&1; then
        graceful_kill "$pid"
        rm -f "$PID_FILE"
    else
        echo "PID $pid is no longer running."
        rm -f "$PID_FILE"
        # Still check the port in case a new process took over
        local port_pid
        port_pid=$(find_cdp_pid)
        if [ -n "$port_pid" ]; then
            echo "Found a browser process on port $BROWSER_PORT (PID: $port_pid). Closing..."
            graceful_kill "$port_pid"
        else
            echo "No browser process found on port $BROWSER_PORT."
        fi
    fi
}

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    echo "Closing browser for CDP port $BROWSER_PORT (PID: $PID)..."
    close_by_pid "$PID"
else
    # No PID file: locate the browser solely by CDP port — never by binary name.
    # This guarantees we never accidentally close other Chrome/Brave/Edge windows
    # that belong to different profiles or sessions.
    CDP_PID=$(find_cdp_pid)
    if [ -n "$CDP_PID" ]; then
        echo "No PID file found. Closing browser on port $BROWSER_PORT (PID: $CDP_PID)..."
        graceful_kill "$CDP_PID"
    else
        echo "No browser process found on port $BROWSER_PORT. Nothing to close."
    fi
fi
