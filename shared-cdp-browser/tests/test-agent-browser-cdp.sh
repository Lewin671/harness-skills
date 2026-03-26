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

lease_file_path() {
  local fixture_dir="$1"
  printf '%s/state-dir/leases/%s.lease\n' "${fixture_dir}" "$(printf 'test-session' | base64 | tr -d '\r\n' | tr '/+=' '_-.')"
}

make_fixture() {
  local fixture_dir="$1"
  mkdir -p "${fixture_dir}/scripts" "${fixture_dir}/bin" "${fixture_dir}/state" "${fixture_dir}/state-dir" "${fixture_dir}/socket-dir"
  cp "${script_under_test}" "${fixture_dir}/scripts/agent-browser-cdp"
  chmod +x "${fixture_dir}/scripts/agent-browser-cdp"

  cat >"${fixture_dir}/socket-dir/test-session.pid" <<EOF
$$
EOF

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
next_id_file="${state_dir}/next-id"
mkdir -p "${state_dir}"
touch "${tabs_file}"
[ -f "${current_file}" ] || printf '0\n' >"${current_file}"
[ -f "${next_id_file}" ] || printf '0\n' >"${next_id_file}"

argv=("$@")
json_mode=0
while [ "${#argv[@]}" -gt 0 ]; do
  case "${argv[0]}" in
    --cdp|--session)
      argv=("${argv[@]:2}")
      ;;
    --json)
      json_mode=1
      argv=("${argv[@]:1}")
      ;;
    *)
      break
      ;;
  esac
done

[ "${#argv[@]}" -gt 0 ] || exit 1

current_tab() {
  cat "${current_file}"
}

set_current_tab() {
  printf '%s\n' "$1" >"${current_file}"
}

next_target_id() {
  local next_id
  next_id="$(cat "${next_id_file}")"
  printf '%s\n' "$((next_id + 1))" >"${next_id_file}"
  printf 'target-%s' "${next_id}"
}

tab_count() {
  if [ -s "${tabs_file}" ]; then
    wc -l <"${tabs_file}" | tr -d ' '
  else
    printf '0'
  fi
}

append_tab() {
  local target_id="$1"
  local url="${2:-about:blank}"
  local title="${3:-}"
  printf '%s\t%s\t%s\n' "${target_id}" "${url}" "${title}" >>"${tabs_file}"
}

remove_tab_by_index() {
  local target_index="$1"
  local tmp_file
  local idx=0
  tmp_file="$(mktemp)"
  while IFS=$'\t' read -r target_id url title || [ -n "${target_id:-}" ]; do
    if [ "${idx}" -ne "${target_index}" ]; then
      printf '%s\t%s\t%s\n' "${target_id}" "${url}" "${title}" >>"${tmp_file}"
    fi
    idx=$((idx + 1))
  done <"${tabs_file}"
  mv "${tmp_file}" "${tabs_file}"
}

tab_target_by_index() {
  local wanted_index="$1"
  awk -F '\t' -v wanted_index="${wanted_index}" 'NR - 1 == wanted_index { print $1; exit }' "${tabs_file}"
}

case "${argv[0]}" in
  tab)
    case "${argv[1]:-list}" in
      list)
        if [ "${json_mode}" -eq 1 ]; then
          printf '{"data":{"tabs":['
          first=1
          idx=0
          active="$(current_tab)"
          while IFS=$'\t' read -r target_id url title || [ -n "${target_id:-}" ]; do
            [ -n "${target_id}" ] || continue
            [ "${first}" -eq 1 ] || printf ','
            first=0
            if [ "${idx}" -eq "${active}" ]; then
              active_json=true
            else
              active_json=false
            fi
            printf '{"index":%s,"url":"%s","title":"%s","active":%s}' "${idx}" "${url}" "${title}" "${active_json}"
            idx=$((idx + 1))
          done <"${tabs_file}"
          printf '],"active":%s}}\n' "${active}"
        else
          idx=0
          active="$(current_tab)"
          while IFS=$'\t' read -r target_id _ _ || [ -n "${target_id:-}" ]; do
            [ -n "${target_id}" ] || continue
            if [ "${idx}" -eq "${active}" ]; then
              printf '→ [%s]\n' "${idx}"
            else
              printf '[%s]\n' "${idx}"
            fi
            idx=$((idx + 1))
          done <"${tabs_file}"
        fi
        ;;
      new)
        if [ -f "${state_dir}/fail-tab-new" ]; then
          exit 23
        fi
        target_id="$(next_target_id)"
        append_tab "${target_id}" "${2:-about:blank}" ""
        new_index=$(( $(tab_count) - 1 ))
        set_current_tab "${new_index}"
        printf '[%s]\n' "${new_index}"
        ;;
      close)
        if [ "${#argv[@]}" -ge 3 ]; then
          close_index="${argv[2]}"
        else
          close_index="$(current_tab)"
        fi
        remove_tab_by_index "${close_index}"
        remaining="$(tab_count)"
        if [ "${remaining}" -le 0 ]; then
          printf '0\n' >"${current_file}"
        elif [ "$(current_tab)" -ge "${remaining}" ]; then
          printf '%s\n' "$((remaining - 1))" >"${current_file}"
        fi
        ;;
      *)
        set_current_tab "${argv[1]}"
        ;;
    esac
    ;;
  eval)
    fail "wrapper unexpectedly called eval: ${argv[*]:1}"
    ;;
  *)
    exit 1
    ;;
esac
EOF
  chmod +x "${fixture_dir}/bin/agent-browser"

  cat >"${fixture_dir}/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

state_dir="${TEST_STATE_DIR:?}"
tabs_file="${state_dir}/tabs"
current_file="${state_dir}/current"
url="${*: -1}"

[ -f "${tabs_file}" ] || touch "${tabs_file}"
[ -f "${current_file}" ] || printf '0\n' >"${current_file}"

write_tabs_json() {
  printf '['
  first=1
  while IFS=$'\t' read -r target_id page_url title || [ -n "${target_id:-}" ]; do
    [ -n "${target_id}" ] || continue
    [ "${first}" -eq 1 ] || printf ','
    first=0
    printf '{"id":"%s","type":"page","title":"%s","url":"%s"}' "${target_id}" "${title}" "${page_url}"
  done <"${tabs_file}"
  printf ']\n'
}

set_current_for_target() {
  local wanted_target="$1"
  local idx=0
  while IFS=$'\t' read -r target_id _ _ || [ -n "${target_id:-}" ]; do
    if [ "${target_id}" = "${wanted_target}" ]; then
      printf '%s\n' "${idx}" >"${current_file}"
      return 0
    fi
    idx=$((idx + 1))
  done <"${tabs_file}"
  return 1
}

remove_target() {
  local wanted_target="$1"
  local tmp_file
  tmp_file="$(mktemp)"
  while IFS=$'\t' read -r target_id page_url title || [ -n "${target_id:-}" ]; do
    [ -n "${target_id}" ] || continue
    if [ "${target_id}" != "${wanted_target}" ]; then
      printf '%s\t%s\t%s\n' "${target_id}" "${page_url}" "${title}" >>"${tmp_file}"
    fi
  done <"${tabs_file}"
  mv "${tmp_file}" "${tabs_file}"
}

case "${url}" in
  http://127.0.0.1:9222/json/list)
    write_tabs_json
    ;;
  http://127.0.0.1:9222/json/activate/*)
    target_id="${url##*/}"
    if [ -f "${state_dir}/activate-count" ]; then
      count="$(cat "${state_dir}/activate-count")"
    else
      count=0
    fi
    printf '%s\n' "$((count + 1))" >"${state_dir}/activate-count"
    set_current_for_target "${target_id}"
    ;;
  http://127.0.0.1:9222/json/close/*)
    target_id="${url##*/}"
    remove_target "${target_id}"
    ;;
  *)
    exit 22
    ;;
esac
EOF
  chmod +x "${fixture_dir}/bin/curl"
}

run_wrapper() {
  local fixture_dir="$1"
  shift
  PATH="${fixture_dir}/bin:${PATH}" \
  TEST_STATE_DIR="${fixture_dir}/state" \
  AGENT_BROWSER_SOCKET_DIR="${fixture_dir}/socket-dir" \
  SHARED_CDP_BROWSER_SESSION="test-session" \
  SHARED_CDP_BROWSER_STATE_DIR="${fixture_dir}/state-dir" \
  SHARED_CDP_BROWSER_COMMAND_LOCK="${fixture_dir}/command.lock" \
  "${fixture_dir}/scripts/agent-browser-cdp" "$@"
}

run_wrapper_locked() {
  local fixture_dir="$1"
  shift
  PATH="${fixture_dir}/bin:${PATH}" \
  TEST_STATE_DIR="${fixture_dir}/state" \
  AGENT_BROWSER_SOCKET_DIR="${fixture_dir}/socket-dir" \
  SHARED_CDP_BROWSER_DISABLE_FLOCK=1 \
  SHARED_CDP_BROWSER_USE_LOCK=1 \
  SHARED_CDP_BROWSER_SESSION="test-session" \
  SHARED_CDP_BROWSER_STATE_DIR="${fixture_dir}/state-dir" \
  SHARED_CDP_BROWSER_COMMAND_LOCK="${fixture_dir}/command.lock" \
  "${fixture_dir}/scripts/agent-browser-cdp" "$@"
}

lease_target_id() {
  local fixture_dir="$1"
  local lease_file
  lease_file="$(lease_file_path "${fixture_dir}")"
  awk -F '=' '$1 == "target_id" { print $2; exit }' "${lease_file}"
}

test_session_ttl_does_not_switch_active_tab() {
  local fixture_dir="${tmp_root}/ttl"
  local lease_file
  make_fixture "${fixture_dir}"

  run_wrapper "${fixture_dir}" session open >/dev/null
  lease_file="$(lease_file_path "${fixture_dir}")"
  assert_exists "${lease_file}"

  printf 'target-extra\thttps://example.com\tExample\n' >>"${fixture_dir}/state/tabs"
  printf '1\n' >"${fixture_dir}/state/current"

  output="$(run_wrapper "${fixture_dir}" session ttl)"

  [ "$(cat "${fixture_dir}/state/current")" = "1" ] || fail "session ttl should not change active tab"
  printf '%s' "${output}" | grep -q '^status=active$' || fail "session ttl should report active session"
}

test_tab_new_failure_preserves_existing_lease() {
  local fixture_dir="${tmp_root}/tab-new-failure"
  local before_target after_target
  make_fixture "${fixture_dir}"

  run_wrapper "${fixture_dir}" session open >/dev/null
  before_target="$(lease_target_id "${fixture_dir}")"

  touch "${fixture_dir}/state/fail-tab-new"
  if run_wrapper "${fixture_dir}" tab new >/dev/null 2>&1; then
    fail "expected tab new to fail"
  fi
  rm -f "${fixture_dir}/state/fail-tab-new"

  after_target="$(lease_target_id "${fixture_dir}")"
  [ "${before_target}" = "${after_target}" ] || fail "failed tab new should preserve prior lease"
}

test_normal_command_preserves_leased_target_without_reactivation() {
  local fixture_dir="${tmp_root}/preserve-leased-target"
  local target_id
  make_fixture "${fixture_dir}"

  run_wrapper "${fixture_dir}" session open >/dev/null
  target_id="$(lease_target_id "${fixture_dir}")"
  printf 'target-extra\thttps://example.com\tExample\n' >>"${fixture_dir}/state/tabs"
  printf '1\n' >"${fixture_dir}/state/current"
  printf '0\n' >"${fixture_dir}/state/activate-count"

  run_wrapper "${fixture_dir}" tab list >/dev/null

  [ "$(cat "${fixture_dir}/state/activate-count")" = "0" ] || fail "normal commands should not reactivate browser tabs"
  [ "${target_id}" = "$(lease_target_id "${fixture_dir}")" ] || fail "normal commands should keep the existing leased target"
}

test_tab_switch_preserves_leased_target() {
  local fixture_dir="${tmp_root}/tab-switch-preserves-target"
  local before_target after_target
  make_fixture "${fixture_dir}"

  run_wrapper "${fixture_dir}" session open >/dev/null
  before_target="$(lease_target_id "${fixture_dir}")"

  printf 'target-extra\thttps://example.com\tExample\n' >>"${fixture_dir}/state/tabs"
  run_wrapper "${fixture_dir}" tab 1 >/dev/null

  after_target="$(lease_target_id "${fixture_dir}")"
  [ "${before_target}" = "${after_target}" ] || fail "switching tabs should not rewrite the leased target"
}

test_stale_lock_with_reused_pid_is_recovered() {
  local fixture_dir="${tmp_root}/stale-pid-lock"
  make_fixture "${fixture_dir}"
  mkdir -p "${fixture_dir}/command.lock.d"
  cat >"${fixture_dir}/command.lock.d/pid" <<EOF
pid=$$
started=Thu Jan  1 00:00:00 1970
EOF

  run_wrapper_locked "${fixture_dir}" tab list >/dev/null
  assert_not_exists "${fixture_dir}/command.lock.d"
}

test_stale_lock_without_pid_is_recovered() {
  local fixture_dir="${tmp_root}/stale-lock"
  make_fixture "${fixture_dir}"
  mkdir -p "${fixture_dir}/command.lock.d"
  touch -t 200001010000 "${fixture_dir}/command.lock.d"

  run_wrapper_locked "${fixture_dir}" tab list >/dev/null
  assert_not_exists "${fixture_dir}/command.lock.d"
}

test_session_ttl_does_not_switch_active_tab
test_tab_new_failure_preserves_existing_lease
test_normal_command_preserves_leased_target_without_reactivation
test_tab_switch_preserves_leased_target
test_stale_lock_with_reused_pid_is_recovered
test_stale_lock_without_pid_is_recovered

printf 'PASS: %s\n' "$(basename "$0")"
