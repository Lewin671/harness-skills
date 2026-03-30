#!/usr/bin/env bash
set -euo pipefail

# concurrent-browser-optimized.sh - Optimized version with better error handling and less code duplication
# Usage: ./scripts/concurrent-browser-optimized.sh <url> [suffix] [command...]

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

show_usage() {
    cat <<'EOF'
Usage: concurrent-browser-optimized.sh <url> [suffix] [command...]

Arguments:
  url      Target URL
  suffix   Optional suffix for concurrent sessions  
  command  Optional agent-browser commands to execute

Examples:
  ./scripts/concurrent-browser-optimized.sh https://app.example.com/dashboard
  ./scripts/concurrent-browser-optimized.sh https://app.example.com/dashboard snapshot -i
  ./scripts/concurrent-browser-optimized.sh https://app.example.com reviewer-a click @e2
EOF
}

# Check for jq availability
check_dependencies() {
    if ! command -v jq >/dev/null 2>&1; then
        echo "Error: jq is required but not installed. Please install jq first." >&2
        exit 1
    fi
}

# Check if state file has authentication data (cookies)
has_authentication_data() {
    local state_file="$1"
    [[ -f "$state_file" ]] && [[ -n "$(jq -r '.cookies // empty' "$state_file" 2>/dev/null || echo "")" ]]
}

# Execute the standard browser flow: about:blank -> load state -> navigate
execute_browser_flow() {
    local session_name="$1"
    local session_state_file="$2" 
    local target_url="$3"
    shift 3
    local additional_commands=("$@")
    
    if has_authentication_data "$session_state_file"; then
        echo "Loading session with authentication data..." >&2
        agent-browser --session "$session_name" open about:blank
        agent-browser --session "$session_name" state load "$session_state_file"
        agent-browser --session "$session_name" open "$target_url"
    else
        echo "No authentication data found, proceeding directly..." >&2
        agent-browser --session "$session_name" open "$target_url"
    fi
    
    # Execute any additional commands
    if [[ ${#additional_commands[@]} -gt 0 ]]; then
        agent-browser --session "$session_name" "${additional_commands[@]}"
    fi
}

if [ "$#" -lt 1 ] || [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_usage
    exit 0
fi

check_dependencies

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

    # Clean up session state
    state_dir="${AGENT_BROWSER_CONCURRENT_STATE_DIR:-${HOME}/.agent-browser-concurrent/session-states}"
    session_name_clean="$(printf '%s' "$session_name" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-' | sed -E 's/^-+//; s/-+$//')"
    session_state_file="${state_dir}/${session_name_clean}.json"
    
    echo "Cleaning up session: $session_name"
    rm -f "$session_state_file"
    agent-browser --session "$session_name" close 2>/dev/null || true
    exit 0
fi

# Check if second argument is a command (common agent-browser commands)
valid_commands="^snapshot$|^open$|^click$|^fill$|^get$|^find$|^wait$|^screenshot$|^navigate$|^goto$|^type$|^press$|^scroll$|^close$|^state$|^session$|^stream$"

# Parse arguments to extract URL, suffix, and commands
first_command=""
if [ "$#" -gt 1 ]; then
    if echo "$2" | grep -qE "^\-|$valid_commands"; then
        # URL + command
        first_command="$2"
        shift 2
    else
        # URL + suffix or URL + suffix + command
        if [ "$#" -gt 2 ] && echo "$3" | grep -qE "^\-|$valid_commands"; then
            # URL + suffix + command
            first_command="$3"
            shift 3
        else
            # URL + suffix only
            shift 2
        fi
    fi
else
    # URL only
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
if [[ -z "$first_command" ]]; then
    cat <<EOF
Session: $session_name
State: $session_state_file

Use: agent-browser --session "$session_name" open "$url"
Cleanup: ./scripts/concurrent-browser-optimized.sh $url $suffix cleanup
EOF
    exit 0
fi

# Handle different command scenarios
if [[ "$first_command" == "open" && "$#" -gt 0 ]]; then
    # Special case: open command with target URL
    target_url="$1"
    shift
    execute_browser_flow "$session_name" "$session_state_file" "$target_url" "$@"
else
    # Standard flow: navigate to original URL, then execute command
    execute_browser_flow "$session_name" "$session_state_file" "$url" "$first_command" "$@"
fi
