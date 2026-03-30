#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  printf 'usage: %s <session> [seed-state-file]\n' "$(basename "$0")" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
session_name="$1"
default_seed_file="$HOME/.agent-browser-concurrent/agent-browser-state.json"
seed_file="${2:-$default_seed_file}"

session_state_file="$("${script_dir}/session-state-path.sh" "$session_name")"

if [ -n "$seed_file" ] && [ ! -f "$seed_file" ]; then
  printf 'seed state file not found: %s\n' "$seed_file" >&2
  exit 1
fi

if [ ! -f "$session_state_file" ]; then
  if [ -n "$seed_file" ]; then
    cp "$seed_file" "$session_state_file"
  else
    printf 'error: no seed state file found.\n' >&2
    printf 'hint: please ensure the file exists at the default path (~/.agent-browser-concurrent/agent-browser-state.json)\n' >&2
    printf 'or pass it as an argument: ./scripts/prepare-session-state.sh <session> /path/to/state.json\n' >&2
    exit 1
  fi
fi

printf '%s\n' "$session_state_file"
