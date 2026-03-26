#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script_under_test="${repo_root}/shared-cdp-browser/scripts/ensure-cdp-browser"

tmp_root="$(mktemp -d)"
trap 'rm -rf "${tmp_root}"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_not_exists() {
  local path="$1"
  [ ! -e "${path}" ] || fail "expected path to be absent: ${path}"
}

assert_exists() {
  local path="$1"
  [ -e "${path}" ] || fail "expected path to exist: ${path}"
}

make_fixture() {
  local fixture_dir="$1"
  mkdir -p "${fixture_dir}/scripts" "${fixture_dir}/bin" "${fixture_dir}/state"
  cp "${script_under_test}" "${fixture_dir}/scripts/ensure-cdp-browser"
  chmod +x "${fixture_dir}/scripts/ensure-cdp-browser"

  cat >"${fixture_dir}/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

state_dir="${TEST_STATE_DIR:?}"
if [ -f "${state_dir}/cdp-ready" ]; then
  printf '{"Browser":"Chrome","webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/browser/test"}\n'
  exit 0
fi
exit 22
EOF
  chmod +x "${fixture_dir}/bin/curl"

  cat >"${fixture_dir}/bin/fake-browser" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

state_dir="${TEST_STATE_DIR:?}"
mkdir -p "${state_dir}"
printf '%s\n' "$*" >"${state_dir}/launch-args"
touch "${state_dir}/cdp-ready"
EOF
  chmod +x "${fixture_dir}/bin/fake-browser"
}

run_wrapper() {
  local fixture_dir="$1"
  PATH="${fixture_dir}/bin:${PATH}" \
  TEST_STATE_DIR="${fixture_dir}/state" \
  SHARED_CDP_BROWSER_BIN="${fixture_dir}/bin/fake-browser" \
  SHARED_CDP_BROWSER_LOCK_DIR="${fixture_dir}/browser.lock" \
  SHARED_CDP_BROWSER_LOG_FILE="${fixture_dir}/browser.log" \
  SHARED_CDP_BROWSER_USER_DATA_DIR="${fixture_dir}/profile" \
  "${fixture_dir}/scripts/ensure-cdp-browser"
}

test_stale_lock_without_pid_is_recovered() {
  local fixture_dir="${tmp_root}/stale-lock"
  make_fixture "${fixture_dir}"
  mkdir -p "${fixture_dir}/browser.lock"
  touch -t 200001010000 "${fixture_dir}/browser.lock"

  output="$(run_wrapper "${fixture_dir}")"

  [ "${output}" = "http://127.0.0.1:9222" ] || fail "unexpected cdp url: ${output}"
  assert_not_exists "${fixture_dir}/browser.lock"
  assert_exists "${fixture_dir}/state/cdp-ready"
  assert_exists "${fixture_dir}/profile"
}

test_stale_lock_without_pid_is_recovered

printf 'PASS: %s\n' "$(basename "$0")"
