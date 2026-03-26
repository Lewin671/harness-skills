#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script_under_test="${repo_root}/shared-cdp-browser/scripts/agent-browser-cdp"

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
  cp "${script_under_test}" "${fixture_dir}/scripts/agent-browser-cdp"
  chmod +x "${fixture_dir}/scripts/agent-browser-cdp"

  cat >"${fixture_dir}/scripts/ensure-cdp-browser" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'http://127.0.0.1:9222\n'
EOF
  chmod +x "${fixture_dir}/scripts/ensure-cdp-browser"

  cat >"${fixture_dir}/bin/agent-browser" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

state_dir="${TEST_STATE_DIR:?}"
tabs_file="${state_dir}/tabs"
current_file="${state_dir}/current"
mkdir -p "${state_dir}"
touch "${tabs_file}"

argv=("$@")
while [ "${#argv[@]}" -gt 0 ]; do
  case "${argv[0]}" in
    --cdp|--session)
      argv=("${argv[@]:2}")
      ;;
    *)
      break
      ;;
  esac
done

[ "${#argv[@]}" -gt 0 ] || exit 1

current_tab() {
  if [ -f "${current_file}" ]; then
    cat "${current_file}"
  fi
}

set_current_tab() {
  printf '%s\n' "$1" >"${current_file}"
}

set_tab_name() {
  local idx="$1"
  local name="$2"
  local tmp_file
  local found=0
  tmp_file="$(mktemp)"
  while IFS=: read -r existing_idx existing_name || [ -n "${existing_idx:-}" ]; do
    if [ "${existing_idx}" = "${idx}" ]; then
      printf '%s:%s\n' "${idx}" "${name}" >>"${tmp_file}"
      found=1
    elif [ -n "${existing_idx}" ]; then
      printf '%s:%s\n' "${existing_idx}" "${existing_name}" >>"${tmp_file}"
    fi
  done <"${tabs_file}"
  if [ "${found}" -eq 0 ]; then
    printf '%s:%s\n' "${idx}" "${name}" >>"${tmp_file}"
  fi
  mv "${tmp_file}" "${tabs_file}"
}

get_tab_name() {
  local idx="$1"
  local line
  line="$(grep -E "^${idx}:" "${tabs_file}" || true)"
  printf '%s' "${line#*:}"
}

case "${argv[0]}" in
  tab)
    case "${argv[1]:-}" in
      list)
        while IFS=: read -r idx _; do
          [ -n "${idx}" ] && printf '[%s]\n' "${idx}"
        done <"${tabs_file}"
        ;;
      new)
        if [ "${TEST_FAIL_TAB_NEW:-0}" = "1" ]; then
          exit 23
        fi
        next_idx=1
        if [ -s "${tabs_file}" ]; then
          last_idx="$(cut -d: -f1 "${tabs_file}" | tail -n1)"
          next_idx=$((last_idx + 1))
        fi
        printf '%s:\n' "${next_idx}" >>"${tabs_file}"
        set_current_tab "${next_idx}"
        printf '[%s]\n' "${next_idx}"
        ;;
      *)
        set_current_tab "${argv[1]}"
        ;;
    esac
    ;;
  eval)
    expr="${argv[*]:1}"
    idx="$(current_tab)"
    [ -n "${idx}" ] || exit 1
    case "${expr}" in
      "window.name")
        printf '"%s"\n' "$(get_tab_name "${idx}")"
        ;;
      "window.name = '"*"'; window.name")
        name="${expr#window.name = \'}"
        name="${name%\'; window.name}"
        set_tab_name "${idx}" "${name}"
        printf '"%s"\n' "${name}"
        ;;
      "if (window.name === '"*"') window.name = '';")
        name="${expr#if (window.name === \'}"
        name="${name%\') window.name = \';}"
        if [ "$(get_tab_name "${idx}")" = "${name}" ]; then
          set_tab_name "${idx}" ""
        fi
        ;;
      *)
        exit 1
        ;;
    esac
    ;;
  *)
    exit 1
    ;;
esac
EOF
  chmod +x "${fixture_dir}/bin/agent-browser"
}

run_wrapper() {
  local fixture_dir="$1"
  shift
  PATH="${fixture_dir}/bin:${PATH}" \
  TEST_STATE_DIR="${fixture_dir}/state" \
  SHARED_CDP_BROWSER_DISABLE_FLOCK=1 \
  SHARED_CDP_BROWSER_SESSION="test-session" \
  SHARED_CDP_BROWSER_COMMAND_LOCK="${fixture_dir}/command.lock" \
  "${fixture_dir}/scripts/agent-browser-cdp" "$@"
}

test_tab_new_cleans_fallback_lock() {
  local fixture_dir="${tmp_root}/success"
  make_fixture "${fixture_dir}"
  run_wrapper "${fixture_dir}" tab new >/dev/null
  assert_not_exists "${fixture_dir}/command.lock.d"
}

test_tab_new_failure_cleans_fallback_lock() {
  local fixture_dir="${tmp_root}/failure"
  make_fixture "${fixture_dir}"
  if TEST_FAIL_TAB_NEW=1 run_wrapper "${fixture_dir}" tab new >/dev/null 2>&1; then
    fail "expected tab new to fail"
  fi
  assert_not_exists "${fixture_dir}/command.lock.d"
}

test_stale_lock_without_pid_is_recovered() {
  local fixture_dir="${tmp_root}/stale-lock"
  make_fixture "${fixture_dir}"
  mkdir -p "${fixture_dir}/command.lock.d"
  touch -t 200001010000 "${fixture_dir}/command.lock.d"
  run_wrapper "${fixture_dir}" tab list >/dev/null
  assert_not_exists "${fixture_dir}/command.lock.d"
  assert_exists "${fixture_dir}/state/tabs"
}

test_tab_new_cleans_fallback_lock
test_tab_new_failure_cleans_fallback_lock
test_stale_lock_without_pid_is_recovered

printf 'PASS: %s\n' "$(basename "$0")"
