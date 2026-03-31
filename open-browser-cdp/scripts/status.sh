#!/usr/bin/env bash
# status.sh - Checks the status of the CDP connection

# Get current script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

echo "Checking CDP status on port $BROWSER_PORT..."

# Try to query the browser version via CDP JSON API
# curl returns non-zero if connection fails
if curl -s "http://localhost:$BROWSER_PORT/json/version" > /dev/null; then
    echo "CDP is ready."
    exit 0
else
    echo "CDP is not responding."
    exit 1
fi
