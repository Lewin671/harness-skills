#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  printf 'usage: %s <url>\n' "$(basename "$0")" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
target_url="$1"

# 1. Generate session name
session_name="$("${script_dir}/origin-session.sh" "${target_url}")"

# 2. Prepare session state file
session_state_file="$("${script_dir}/prepare-session-state.sh" "${session_name}")"

# 3. Start session with proper authentication sequence
# Start with blank page
agent-browser --session "${session_name}" --state "${session_state_file}" open about:blank

# Load authentication state
agent-browser --session "${session_name}" state load "${session_state_file}"

# Navigate to target page
agent-browser --session "${session_name}" open "${target_url}"

# Output session name for later use
printf '%s\n' "${session_name}"
