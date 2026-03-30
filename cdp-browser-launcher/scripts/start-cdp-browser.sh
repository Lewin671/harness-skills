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
  CDP_BROWSER_STARTUP_TIMEOUT   Seconds to wait for CDP readiness (default: 15)
EOF
  exit 0
fi

profile_dir="${CDP_BROWSER_PROFILE:-$HOME/agent-browser-data}"
debug_port="${CDP_REMOTE_DEBUGGING_PORT:-9222}"
debug_addr="${CDP_REMOTE_DEBUGGING_ADDRESS:-127.0.0.1}"
start_url="${CDP_BROWSER_START_URL:-about:blank}"
log_file="${CDP_BROWSER_LOG:-/tmp/cdp-browser-launcher.log}"
startup_timeout="${CDP_BROWSER_STARTUP_TIMEOUT:-15}"

check_dependencies() {
  command -v curl >/dev/null 2>&1 || {
    printf 'Missing required command: curl\n' >&2
    exit 1
  }
}

port_is_listening() {
  local host="$1"
  local port="$2"

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | grep -Fq "${host}:${port}"
    return
  fi

  if command -v nc >/dev/null 2>&1; then
    nc -z "${host}" "${port}" >/dev/null 2>&1
    return
  fi

  return 1
}

wait_for_cdp() {
  local endpoint="$1"
  local timeout="$2"
  local elapsed=0

  while ((elapsed < timeout)); do
    if curl --silent --show-error --fail "${endpoint}/json/version" >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

find_browser() {
  if [[ -n "${CDP_BROWSER_BIN:-}" ]]; then
    if [[ -x "${CDP_BROWSER_BIN}" ]]; then
      printf '%s\n' "${CDP_BROWSER_BIN}"
      return 0
    fi

    printf 'Configured browser binary is not executable: %s\n' "${CDP_BROWSER_BIN}" >&2
    return 1
  fi

  if [[ "${OSTYPE}" == darwin* ]]; then
    local chrome_bin="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if [[ -x "${chrome_bin}" ]]; then
      printf '%s\n' "${chrome_bin}"
      return 0
    fi
  fi

  local linux_candidates=(
    "google-chrome"
    "chromium"
    "chromium-browser"
    "microsoft-edge"
    "brave-browser"
  )
  local candidate

  for candidate in "${linux_candidates[@]}"; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      command -v "${candidate}"
      return 0
    fi
  done

  return 1
}

check_dependencies
browser_target="$(find_browser)" || {
  cat >&2 <<'EOF'
Could not find a supported Chromium-based browser.
Set CDP_BROWSER_BIN to a browser executable path and retry.
EOF
  exit 1
}

if port_is_listening "${debug_addr}" "${debug_port}"; then
  endpoint="http://${debug_addr}:${debug_port}"
  if curl --silent --show-error --fail "${endpoint}/json/version" >/dev/null 2>&1; then
    cat <<EOF
Reusing existing CDP browser.
CDP endpoint: ${endpoint}
EOF
    exit 0
  fi
  printf 'Port %s:%s is already in use by a non-CDP process.\n' "${debug_addr}" "${debug_port}" >&2
  exit 1
fi

mkdir -p "${profile_dir}"

nohup "${browser_target}" \
  "--user-data-dir=${profile_dir}" \
  "--remote-debugging-address=${debug_addr}" \
  "--remote-debugging-port=${debug_port}" \
  "${start_url}" \
  >"${log_file}" 2>&1 < /dev/null &

launcher_pid=$!
endpoint="http://${debug_addr}:${debug_port}"

if ! wait_for_cdp "${endpoint}" "${startup_timeout}"; then
  cat >&2 <<EOF
CDP endpoint did not become ready within ${startup_timeout}s.
Browser target: ${browser_target}
Launcher PID: ${launcher_pid}
Log: ${log_file}
EOF
  exit 1
fi

cat <<EOF
Started CDP browser.
Launcher PID: ${launcher_pid}
Browser target: ${browser_target}
Profile: ${profile_dir}
CDP endpoint: ${endpoint}
Log: ${log_file}
EOF
