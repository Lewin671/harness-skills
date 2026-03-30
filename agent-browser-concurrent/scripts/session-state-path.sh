#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  printf 'usage: %s <session>\n' "$(basename "$0")" >&2
  exit 1
fi

session_raw="$1"
session_name="$(printf '%s' "$session_raw" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-' | sed -E 's/^-+//; s/-+$//')"

if [ -z "$session_name" ]; then
  printf 'invalid session: %s\n' "$session_raw" >&2
  exit 1
fi

state_dir="${AGENT_BROWSER_CONCURRENT_STATE_DIR:-${HOME}/.agent-browser-concurrent/session-states}"
mkdir -p "$state_dir"

printf '%s/%s.json\n' "$state_dir" "$session_name"
