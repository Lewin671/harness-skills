#!/usr/bin/env bash
set -euo pipefail

# concurrent-browser.sh - Unified entry point for concurrent browser automation
# Usage: ./scripts/concurrent-browser.sh <url> [suffix] [command...]

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

show_usage() {
    cat <<'EOF'
Usage: concurrent-browser.sh <url> [suffix] [command...]

Arguments:
  url      Target URL (e.g., https://app.example.com/dashboard)
  suffix   Optional suffix for concurrent sessions (e.g., reviewer-a)
  command  Optional agent-browser commands to execute

Examples:
  # Start interactive session
  ./scripts/concurrent-browser.sh https://app.example.com/dashboard
  
  # Run command directly
  ./scripts/concurrent-browser.sh https://app.example.com/dashboard snapshot -i
  
  # Concurrent session with suffix
  ./scripts/concurrent-browser.sh https://app.example.com/dashboard reviewer-a click @e2
  
  # Just prepare session (returns session name)
  SESSION="$(./scripts/concurrent-browser.sh https://app.example.com)"
EOF
}

if [ "$#" -lt 1 ] || [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_usage
    exit 0
fi

url="$1"
suffix="${2:-}"

if [ -n "$suffix" ]; then
    shift 2
else
    shift 1
fi

# Generate session name
session_name="$("${script_dir}/origin-session.sh" "$url" "$suffix")"

# Prepare session state file
session_state_file="$("${script_dir}/prepare-session-state.sh" "$session_name")"

# If no commands provided, just return session info
if [ "$#" -eq 0 ]; then
    cat <<EOF
Session: $session_name
State file: $session_state_file

Use with agent-browser:
agent-browser --session "$session_name" --state "$session_state_file" open "$url"
EOF
    exit 0
fi

# Start session with proper authentication sequence
first_command="$1"
shift

if [[ "$first_command" == "open" && "$#" -gt 0 ]]; then
    target_url="$1"
    shift
    
    # Use proper auth sequence for authenticated sessions
    if [[ -f "$session_state_file" && "$(jq -r '.cookies // empty' "$session_state_file" 2>/dev/null)" != "" ]]; then
        agent-browser --session "$session_name" --state "$session_state_file" open about:blank
        agent-browser --session "$session_name" state load "$session_state_file"
        agent-browser --session "$session_name" open "$target_url"
    else
        agent-browser --session "$session_name" --state "$session_state_file" open "$target_url"
    fi
    
    # Execute remaining commands if any
    if [ "$#" -gt 0 ]; then
        agent-browser --session "$session_name" "$@"
    fi
else
    # For non-open commands, start with blank page then load state
    agent-browser --session "$session_name" --state "$session_state_file" open about:blank
    if [[ -f "$session_state_file" && "$(jq -r '.cookies // empty' "$session_state_file" 2>/dev/null)" != "" ]]; then
        agent-browser --session "$session_name" state load "$session_state_file"
    fi
    agent-browser --session "$session_name" "$first_command" "$@"
fi
