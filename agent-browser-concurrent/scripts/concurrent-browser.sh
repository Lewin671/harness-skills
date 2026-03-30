#!/usr/bin/env bash
set -euo pipefail

# concurrent-browser.sh - Simple concurrent browser automation
# Usage: ./scripts/concurrent-browser.sh <url> [suffix] [command...]

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

show_usage() {
    cat <<'EOF'
Usage: concurrent-browser.sh <url> [suffix] [command...]

Arguments:
  url      Target URL
  suffix   Optional suffix for concurrent sessions  
  command  Optional agent-browser commands to execute

Examples:
  ./scripts/concurrent-browser.sh https://app.example.com/dashboard
  ./scripts/concurrent-browser.sh https://app.example.com/dashboard snapshot -i
  ./scripts/concurrent-browser.sh https://app.example.com reviewer-a click @e2
EOF
}

if [ "$#" -lt 1 ] || [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_usage
    exit 0
fi

url="$1"
suffix="${2:-}"

# Handle cleanup command early
if { [ "$#" -ge 2 ] && [[ "$2" == "cleanup" ]]; } || { [ "$#" -ge 3 ] && [[ "$3" == "cleanup" ]]; }; then
    # Extract URL and suffix for cleanup
    if [[ "$2" == "cleanup" ]]; then
        url="$1"
        suffix=""
    else
        url="$1"
        suffix="$2"
    fi
    
    # Generate session name for cleanup
    session_name=$(python3 - "$url" "$suffix" <<'PY'
import re
import sys
from urllib.parse import urlparse

raw = sys.argv[1].strip()
suffix = sys.argv[2].strip().lower() if len(sys.argv) > 2 and sys.argv[2] else ""
candidate = raw if "://" in raw else f"https://{raw}"
parsed = urlparse(candidate)

if (
    not parsed.scheme
    or not parsed.netloc
    or parsed.hostname is None
    or any(ch.isspace() for ch in raw)
    or any(ch.isspace() for ch in parsed.hostname)
):
    raise SystemExit(f"invalid url: {raw}")

host = (parsed.hostname or "").lower()
port = parsed.port
default_port = (
    (parsed.scheme == "http" and port in (None, 80))
    or (parsed.scheme == "https" and port in (None, 443))
)
origin_key = f"{parsed.scheme}-{host}" if default_port else f"{parsed.scheme}-{host}-{port}"
session = re.sub(r"[^a-z0-9]+", "-", origin_key).strip("-")
if suffix:
    suffix = re.sub(r"[^a-z0-9]+", "-", suffix).strip("-")
    if suffix:
        session = f"{session}-{suffix}"
print(session or "default")
PY
)
    
    echo "Closing session: $session_name"
    if agent-browser --session "$session_name" close 2>/dev/null; then
        echo "Session closed successfully"
    else
        echo "Session was not running or already closed"
    fi
    exit 0
fi

# Check if second argument is a command (common agent-browser commands)
valid_commands="^snapshot$|^open$|^click$|^fill$|^get$|^find$|^wait$|^screenshot$|^navigate$|^goto$|^type$|^press$|^scroll$|^close$|^state$|^session$|^stream$"

# First check: URL + suffix + command (3+ args, middle is not a command)
if [ "$#" -gt 2 ] && ! echo "$2" | grep -qE "^\-|$valid_commands"; then
    shift 2
# Second check: URL + command (2+ args, second is command)
elif [ "$#" -gt 1 ] && echo "$2" | grep -qE "^\-|$valid_commands"; then
    suffix=""
    shift 1
# Third check: URL + suffix only (2 args, second is not command)
elif [ "$#" -eq 2 ] && ! echo "$2" | grep -qE "^\-|$valid_commands"; then
    shift 2
# Default: URL only or URL + command
else
    suffix=""
    shift 1
fi

# Generate session name from URL
session_name=$(python3 - "$url" "$suffix" <<'PY'
import re
import sys
from urllib.parse import urlparse

raw = sys.argv[1].strip()
suffix = sys.argv[2].strip().lower() if len(sys.argv) > 2 and sys.argv[2] else ""
candidate = raw if "://" in raw else f"https://{raw}"
parsed = urlparse(candidate)

if (
    not parsed.scheme
    or not parsed.netloc
    or parsed.hostname is None
    or any(ch.isspace() for ch in raw)
    or any(ch.isspace() for ch in parsed.hostname)
):
    raise SystemExit(f"invalid url: {raw}")

host = (parsed.hostname or "").lower()
port = parsed.port
default_port = (
    (parsed.scheme == "http" and port in (None, 80))
    or (parsed.scheme == "https" and port in (None, 443))
)
origin_key = f"{parsed.scheme}-{host}" if default_port else f"{parsed.scheme}-{host}-{port}"
session = re.sub(r"[^a-z0-9]+", "-", origin_key).strip("-")
if suffix:
    suffix = re.sub(r"[^a-z0-9]+", "-", suffix).strip("-")
    if suffix:
        session = f"{session}-{suffix}"
print(session or "default")
PY
)

# Setup state directory and file
state_dir="${AGENT_BROWSER_CONCURRENT_STATE_DIR:-${HOME}/.agent-browser-concurrent/session-states}"
mkdir -p "$state_dir"
session_name_clean="$(printf '%s' "$session_name" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-' | sed -E 's/^-+//; s/-+$//')"
session_state_file="${state_dir}/${session_name_clean}.json"

# Copy seed state file if session doesn't exist yet
default_seed_file="$HOME/.agent-browser-concurrent/agent-browser-state.json"
if [ ! -f "$session_state_file" ] && [ -f "$default_seed_file" ]; then
    cp "$default_seed_file" "$session_state_file"
fi

# If no commands, show session info
if [ "$#" -eq 0 ]; then
    cat <<EOF
Session: $session_name
State: $session_state_file

Use: agent-browser --session "$session_name" --state "$session_state_file" open "$url"
Cleanup: ./scripts/concurrent-browser.sh $url $suffix cleanup
EOF
    exit 0
fi

# Execute commands with proper auth handling
first_command="$1"
shift

if [[ "$first_command" == "open" && "$#" -gt 0 ]]; then
    target_url="$1"
    shift
    
    # Check if we have authentication data
    has_auth=""
    if [[ -f "$session_state_file" ]]; then
        has_auth="$(jq -r '.cookies // empty' "$session_state_file" 2>/dev/null || echo "")"
    fi
    
    if [[ -n "$has_auth" ]]; then
        agent-browser --session "$session_name" --state "$session_state_file" open about:blank
        agent-browser --session "$session_name" state load "$session_state_file"
        agent-browser --session "$session_name" open "$target_url"
    else
        agent-browser --session "$session_name" --state "$session_state_file" open "$target_url"
    fi
    
    if [ "$#" -gt 0 ]; then
        agent-browser --session "$session_name" "$@"
    fi
else
    # First navigate to the target URL, then execute the command
    agent-browser --session "$session_name" --state "$session_state_file" open about:blank
    if [[ -f "$session_state_file" ]]; then
        has_auth="$(jq -r '.cookies // empty' "$session_state_file" 2>/dev/null || echo "")"
        if [[ -n "$has_auth" ]]; then
            agent-browser --session "$session_name" state load "$session_state_file"
        fi
    fi
    agent-browser --session "$session_name" open "$url"
    agent-browser --session "$session_name" "$first_command" "$@"
fi
