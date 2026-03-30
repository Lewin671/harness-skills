#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  printf 'usage: %s <session> [seed-state-file]\n' "$(basename "$0")" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
session_name="$1"
seed_file="${2:-${AGENT_BROWSER_STATE_FILE:-}}"
session_state_file="$("${script_dir}/session-state-path.sh" "$session_name")"

if [ -n "$seed_file" ] && [ ! -f "$seed_file" ]; then
  printf 'seed state file not found: %s\n' "$seed_file" >&2
  exit 1
fi

if [ ! -f "$session_state_file" ]; then
  if [ -n "$seed_file" ]; then
    cp "$seed_file" "$session_state_file"
  else
    printf '{"cookies":[],"origins":[]}\n' > "$session_state_file"
  fi
fi

printf '%s\n' "$session_state_file"
