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
    printf '%s\n' \
      "warning: creating empty session state for ${session_name} because no seed file was provided." \
      "hint: pass ./scripts/prepare-session-state.sh <session> /path/to/state.json or export AGENT_BROWSER_STATE_FILE in the current shell." \
      "hint: vars defined only in interactive zsh startup files (for example ~/.zshrc) are often unavailable to non-interactive automation shells." >&2
    printf '{"cookies":[],"origins":[]}\n' > "$session_state_file"
  fi
fi

printf '%s\n' "$session_state_file"
