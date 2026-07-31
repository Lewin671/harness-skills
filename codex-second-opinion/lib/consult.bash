# Consult mode: ask Codex a free-form question answered with the
# repository as context, with resumable sessions. Sourced by
# run-codex-second-opinion after lib/common.bash.

run_noun="consultation"
result_noun="answer"

mode_usage() {
  cat >&2 <<'USAGE'
Usage: run-codex-second-opinion consult [OPTIONS] QUESTION

The QUESTION is one free-form argument: the decision to weigh, the plan
to critique, the trade-off to argue. Name the files or documents Codex
should read — it answers with the repository as context.

After a successful run the script prints `session: <ID>` to stderr.
Pass that id back via --continue to ask a follow-up in the same
conversation — Codex keeps everything it already read and said.
Model flags do not travel with the session: a follow-up to a run that
used --model/--effort or --inherit must repeat those same flags, or
the resumed turn switches back to the pinned defaults.

Options:
  --continue <SESSION> resume this session UUID with a follow-up
                       QUESTION instead of starting fresh
  --model <MODEL>      override the model (default: strongest tier)
  --effort <LEVEL>     low|medium|high|xhigh|max (default: xhigh). Pass
                       this whenever you pass --model — a weaker model
                       may not accept the default effort.
  --inherit            use the model and effort from your codex config
                       instead of the pinned strongest defaults
  --repo <DIR>         repository for context (default: current
                       directory)
  --timeout <SECONDS>  abort a hung run (default: 3000; 0 disables;
                       max 86400)

Defaults to the strongest available model at xhigh reasoning effort.
A second opinion is only worth the wait if it comes from the best
adviser available, so speed is deliberately not the priority here.

Environment:
  CODEX_BIN                     path to the codex binary (default: codex)
  CODEX_SECOND_OPINION_MODEL    override the pinned default model
  CODEX_SECOND_OPINION_EFFORT   override the pinned default effort
  CODEX_SECOND_OPINION_TIMEOUT  override the default timeout (seconds)
USAGE
}

question=""
question_set=0
session_id=""

# No automatic retry on a follow-up: codex may have persisted the
# question in the session before rejecting the model, so *any* resend
# into this session — scripted or manual — could record it twice and
# contaminate every later turn. The only safe recovery is a fresh
# consultation.
mode_block_retry() {
  [ -n "$session_id" ] || return 1
  echo "error: the model/effort was rejected on a follow-up; not retrying automatically." >&2
  echo "hint: treat this session as contaminated — the question may already be recorded in it." >&2
  echo "hint: start a fresh consultation (restating context), with the model flags the session was started with." >&2
  return 0
}

# Build `cmd` and the redacted `diag` for one attempt.
# Args: model ("" to inherit), effort ("" to inherit).
build_cmd() {
  if [ -n "$session_id" ]; then
    cmd=("$codex_bin" exec resume "$session_id")
  else
    cmd=("$codex_bin" exec)
  fi
  append_safety_args "$1" "$2"
  # The diagnostic is rendered before the question is appended and never
  # includes its body: see execute_codex for the marker-forging risk.
  diag="running: ${cmd[*]} -- <question: ${#question} chars>"
  # The question is a bare positional PROMPT, last, after a `--`:
  # without the terminator, questions that begin with a dash are parsed
  # as an unknown option.
  cmd+=(-- "$question")
}

mode_main() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --model)
        shift; [ "$#" -gt 0 ] && [ -n "$1" ] || {
          echo "error: --model needs a non-empty value (use --inherit for your config's model)" >&2; exit 3; }
        model="$1"; pinned=0; shift ;;
      --effort)
        shift; [ "$#" -gt 0 ] && [ -n "$1" ] || {
          echo "error: --effort needs a non-empty value" >&2; exit 3; }
        effort="$1"; pinned=0; shift ;;
      --inherit)
        model=""; effort=""; pinned=0; shift ;;
      --continue)
        shift; [ "$#" -gt 0 ] || { echo "error: --continue needs a session id" >&2; exit 3; }
        # UUIDs only — exactly what the previous run's `session:` line
        # printed. Thread names are rejected because continuation is
        # verified afterwards by comparing the stream's thread id
        # against this value, and a name would never match that UUID.
        # The case guard runs first: grep matches per line, so a value
        # with an embedded newline could otherwise sneak a matching
        # second line past the shape check.
        case "$1" in
          ''|*[![:alnum:]-]*)
            echo "error: --continue needs the session UUID printed by the previous run" >&2
            exit 3 ;;
        esac
        if ! printf '%s' "$1" | grep -qiE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
          echo "error: --continue needs the session UUID printed by the previous run, got '$1'" >&2
          exit 3
        fi
        session_id="$1"; shift ;;
      --repo)
        shift; [ "$#" -gt 0 ] || { echo "error: --repo needs a value" >&2; exit 3; }
        repo="$1"; shift ;;
      --timeout)
        shift; [ "$#" -gt 0 ] || { echo "error: --timeout needs a value" >&2; exit 3; }
        validate_timeout "$1" "--timeout"
        timeout_secs="$validated_timeout"; shift ;;
      -h|--help) mode_usage; exit 0 ;;
      --)
        # Everything after -- is the question, even if it starts with a
        # dash (a Markdown bullet, say). The question_set guard matches
        # the ordinary positional branch: `'A' -- 'B'` must be an
        # error, not a silent replacement of A by B.
        shift
        [ "$#" -eq 1 ] || { echo "error: expected exactly one QUESTION after --" >&2; exit 3; }
        if [ "$question_set" -eq 1 ]; then
          echo "error: expected exactly one QUESTION; quote the whole question as one argument" >&2
          exit 3
        fi
        question="$1"; question_set=1; shift ;;
      -*)
        echo "error: unknown argument: $1" >&2; mode_usage; exit 3 ;;
      *)
        if [ "$question_set" -eq 1 ]; then
          echo "error: expected exactly one QUESTION; quote the whole question as one argument" >&2
          exit 3
        fi
        question="$1"; question_set=1; shift ;;
    esac
  done

  if [ "$question_set" -eq 0 ] || [ -z "$question" ]; then
    echo "error: a non-empty QUESTION is required" >&2
    mode_usage
    exit 3
  fi

  common_env_checks
  common_setup_scratch
  run_with_fallback

  # The session id enables --continue follow-ups. It comes from the
  # stream's `thread.started` event. The *last* match is authoritative:
  # the log accumulates across the stale-model fallback retry, and only
  # the final (successful) run's session can be resumed. JSON escaping
  # means agent-authored text cannot contain these raw quoted keys.
  local session_out
  session_out="$(grep '"type":"thread.started"' "$log" 2>/dev/null | tail -1 |
    grep -o '"thread_id":"[^"]*"' | head -1 | cut -d'"' -f4)" || session_out=""

  # Continuation must be verified, not assumed: given a well-formed but
  # missing or expired session id, codex 0.146.0 silently starts a
  # fresh thread and exits 0 — an answer produced without the prior
  # discussion, which is exactly what the caller asked to keep.
  # Suppress it rather than pass it off as a follow-up.
  if [ -n "$session_id" ] && [ "$session_out" != "$session_id" ]; then
    echo "error: codex did not resume session ${session_id} (stream reported '${session_out:-no thread id}')." >&2
    echo "error: the session likely expired, so the answer lacked the prior discussion and was discarded." >&2
    echo "hint: start a fresh consultation and restate the context." >&2
    tail_log
    rm -f "$out"
    exit 4
  fi

  emit_result
  # A missing id (say the event shape changed) just means no session
  # line: the answer above stands, only the follow-up affordance is
  # lost.
  if [ -n "$session_out" ]; then
    echo "session: ${session_out}" >&2
  fi
}
