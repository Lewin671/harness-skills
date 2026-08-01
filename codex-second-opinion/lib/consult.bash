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

After a successful run the script prints `session: <ID>` and a ready-made
`resume: --continue <ID> [model flags]` line to stderr. Model flags do
not travel with the session, so the resume line — not the bare id — is
what reproduces the same model on a follow-up.

Options:
  --continue <SESSION> resume this session UUID with a follow-up
                       QUESTION instead of starting fresh
  --model <MODEL>      override the pinned high-capability model
  --effort <LEVEL>     default: high. codex 0.146.0 takes low, medium,
                       high, xhigh, max; the value is passed through
                       rather than checked here, so a newer tier works
                       and an unknown one fails as exit 4. Must be given
                       together with --model — a weaker model may not
                       accept the pinned effort.
  --inherit            use the model and effort from your codex config
                       instead of the pinned defaults; cannot be
                       combined with --model or --effort
  --allow-mcp          keep enabled standalone MCP servers reachable
                       instead of switching them off for this run;
                       only after explicit user approval, because
                       they may mutate external systems
  --repo <DIR>         repository for context (default: current
                       directory)
  --timeout <SECONDS>  abort a hung run (default: 3000; 0 disables;
                       max 86400)

Defaults to a pinned high-capability model at the high reasoning tier.
Use an explicit override when cost, latency, a different model
perspective, or a higher tier matters.

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
        model="$1"; pinned=0; model_set=$((model_set + 1)); shift ;;
      --effort)
        shift; [ "$#" -gt 0 ] && [ -n "$1" ] || {
          echo "error: --effort needs a non-empty value" >&2; exit 3; }
        effort="$1"; pinned=0; effort_set=$((effort_set + 1)); shift ;;
      --inherit)
        model=""; effort=""; pinned=0; inherit_set=$((inherit_set + 1)); shift ;;
      --allow-mcp)
        allow_mcp=1; shift ;;
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

  common_check_model_flags
  common_env_checks
  common_setup_scratch
  run_with_fallback

  # The session id enables --continue follow-ups. It comes from the
  # stream's `thread.started` event. The *last* match is authoritative:
  # the log accumulates across the stale-model fallback retry, and only
  # the final (successful) run's session can be resumed. JSON escaping
  # means agent-authored text cannot contain these raw quoted keys.
  # Only the LAST attempt's segment. The log accumulates across the
  # stale-model fallback, and "the last thread.started in the file" is the
  # failed attempt's whenever the successful retry did not emit one — which
  # the code below otherwise treats as a valid answer with no session to
  # resume. Advertising the dead id instead is the one outcome that path
  # exists to prevent.
  local session_out
  session_out="$(awk -v m="$attempt_marker" '$0 == m { buf = "" ; next } { buf = buf $0 "\n" } END { printf "%s", buf }' "$log" 2>/dev/null |
    grep '"type":"thread.started"' | tail -1 |
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
  # A missing id (say the event shape changed) just means no session to
  # continue: the answer above stands, only the follow-up affordance is
  # lost.
  if [ -z "$session_out" ]; then
    # Emit BOTH markers, as prose that cannot be mistaken for an id or a
    # command. Callers are told to trust the *final* marker line of each
    # kind, and the answer body is model-controlled: staying silent about
    # either would leave a line invented inside that body as the last one in
    # a merged stream. The `session:` half was the one originally left
    # silent, and a forged id there is the worse of the two — it is the value
    # a caller feeds straight back into --continue.
    echo "session: unavailable — the stream carried no thread id" >&2
    echo "resume: unavailable — no session id in the stream; start a fresh consultation" >&2
  else
    echo "session: ${session_out}" >&2
    # Model settings do not travel with the session, so a bare id hands
    # the caller half a command and asks them to remember the rest —
    # and forgetting silently switches the discussion to a different
    # model mid-conversation. Hence a whole resumable descriptor, built
    # on three rules:
    #
    #  - Name the model that actually answered, not just flags the
    #    caller typed: the effective settings can come from
    #    CODEX_SECOND_OPINION_MODEL/_EFFORT, often as one-shot
    #    assignments that are gone by the time anyone replays this line.
    #    Being explicit costs nothing on a resumed session, where the
    #    stale-default retry is blocked either way.
    #  - After a stale-default fallback the answer came from the user's
    #    config, so --inherit is what reproduces it. Repeating the
    #    pinned defaults would fail a second time, with no automatic
    #    retry left to catch it.
    #  - Quote the values for the context this line is advertised in. A
    #    model name carrying a space, `;`, or `$(...)` would otherwise
    #    change the command it is offered as.
    local resume_flags=""
    if [ "$used_fallback" -eq 1 ] || [ -z "$model" ]; then
      resume_flags=" --inherit"
    else
      resume_flags=" --model $(shell_quote "$model") --effort $(shell_quote "$effort")"
    fi
    #  - Name the repository too. The descriptor is advertised as ready to
    #    run, and a follow-up typed from anywhere but this directory would
    #    otherwise default to `--repo .` and either consult the wrong tree or
    #    exit 3. The resolved path, not the caller's spelling, so it does not
    #    depend on where the replay happens.
    echo "resume: --continue ${session_out}${resume_flags} --repo $(shell_quote "$PWD")" >&2
  fi
}
