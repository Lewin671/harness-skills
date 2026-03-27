#!/usr/bin/env bash

set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Start a local Chromium-based browser with CDP enabled.

Environment variables:
  CDP_BROWSER_BIN               Optional browser executable path
  CDP_BROWSER_PROFILE           Profile directory (default: $HOME/agent-browser-data)
  CDP_REMOTE_DEBUGGING_PORT     Remote debugging port (default: 9222)
  CDP_REMOTE_DEBUGGING_ADDRESS  Remote debugging address (default: 127.0.0.1)
  CDP_BROWSER_START_URL         Initial URL (default: about:blank)
  CDP_BROWSER_LOG               Log file (default: /tmp/cdp-browser-launcher.log)
EOF
  exit 0
fi

profile_dir="${CDP_BROWSER_PROFILE:-$HOME/agent-browser-data}"
debug_port="${CDP_REMOTE_DEBUGGING_PORT:-9222}"
debug_addr="${CDP_REMOTE_DEBUGGING_ADDRESS:-127.0.0.1}"
start_url="${CDP_BROWSER_START_URL:-about:blank}"
log_file="${CDP_BROWSER_LOG:-/tmp/cdp-browser-launcher.log}"

find_browser() {
  local candidates=(
    "/Applications/Google Chrome.app"
    "/Applications/Chromium.app"
    "/Applications/Google Chrome Canary.app"
    "/Applications/Microsoft Edge.app"
    "/Applications/Brave Browser.app"
  )
  local candidate

  if [[ -n "${CDP_BROWSER_BIN:-}" ]]; then
    if [[ -x "${CDP_BROWSER_BIN}" ]]; then
      printf '%s\n' "${CDP_BROWSER_BIN}"
      return 0
    fi

    printf 'Configured browser binary is not executable: %s\n' "${CDP_BROWSER_BIN}" >&2
    return 1
  fi

  for candidate in "${candidates[@]}"; do
    if [[ -d "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  return 1
}

browser_target="$(find_browser)" || {
  cat >&2 <<'EOF'
Could not find a supported Chromium-based browser.
Set CDP_BROWSER_BIN to a browser executable path and retry.
EOF
  exit 1
}

mkdir -p "${profile_dir}"

if [[ -n "${CDP_BROWSER_BIN:-}" ]]; then
  nohup "${browser_target}" \
    "--user-data-dir=${profile_dir}" \
    "--remote-debugging-address=${debug_addr}" \
    "--remote-debugging-port=${debug_port}" \
    "${start_url}" \
    >"${log_file}" 2>&1 < /dev/null &
else
  nohup open -na "${browser_target}" --args \
    "--user-data-dir=${profile_dir}" \
    "--remote-debugging-address=${debug_addr}" \
    "--remote-debugging-port=${debug_port}" \
    "${start_url}" \
    >"${log_file}" 2>&1 < /dev/null &
fi

pid=$!

cat <<EOF
Started CDP browser.
PID: ${pid}
Browser: ${browser_target}
Profile: ${profile_dir}
CDP endpoint: http://${debug_addr}:${debug_port}
Log: ${log_file}
EOF
