# Provider: agy

Google's Antigravity CLI (`agy`), run headlessly in print mode. It is the
command-line client of Google Antigravity and shares its state under
`~/.gemini`. Not the Gemini CLI (`gemini`), a separate tool. Not for use from
inside any Antigravity host, CLI or app.

## Prerequisites and binary

An `agy` that is already signed in; a signed-out one fails the run with exit
`4` and its own message in the log tail. The wrapper finds `agy` on the
absolute entries of `PATH`, or uses `AGY_BIN` (an absolute path to an
executable file), and prints `note: using agy binary: <path>` first. A
wrapper script on `PATH` (for example one that sets a proxy) is used as is. A
binary inside the repository under review is refused. If it is not found, see
running.md § Exit Codes; never hand-roll `agy -p` instead.

## Permissions

Every mode runs with `--dangerously-skip-permissions`: no one is there to
approve a tool call, so a review or consult can build, test and reach the
network like the user's own shell. `--disable-slash-commands` keeps a prompt
starting with `/` from running a command or skill. Review and consult carry
the shared note asking the peer not to modify the repository or git state.

agy has no switch for its hooks, plugins, skills, MCP servers, global rules
(`~/.gemini/GEMINI.md`) or cross-session memories, so every mode runs in the
user's normal agy setup, the repository's `AGENTS.md` included. The prompt
stays blind, but agy's own memories can carry context from earlier sessions.

A review is a prompt: agy has no review command, so the wrapper sends the
scope as prose and enforces the report with `--json-schema` (verdict,
findings with priority, path and line range, verification). The wrapper
renders `structured_output` into the `[P<n>]` shape review.md reads; an empty
findings list becomes an explicit "No findings" line. If agy returns no usable
structured output, the body is its free text and a `warning:` says so — apply
review.md's unparseable rule. The conversation a review leaves in agy's
history is not advertised for resuming.

## Model

The wrapper pins `gemini-4-hydrogen` at effort `high`. Override it for one
run with an explicit `--model M --effort L` pair, or for every run with
`PEER_AGY_MODEL` and `PEER_AGY_EFFORT` set together. Pass model flags only
when the user asked for a model. `agy models` lists the ids this login can
use; an id ending in `-low`, `-medium`, `-high` or `-xhigh` is the model plus an effort,
so pass the bare id with `--effort`. A `resume:` line carries the pair that
answered; `model:` names the model agy reported, without the effort.

When the user names `gemini-4-carbon` without an effort, pair it with
`medium`: on Artificial Analysis (Nov 2026) it scores 2 points below `high`
at lower cost, a third of the time to first token and fewer hallucinations,
while `low` costs more than `medium`. Use `high` only when asked.

An unknown model, or an effort the model lacks (Hydrogen has `low` through
`xhigh`; Carbon `low` through `high`; neither has `max`), fails before any work with exit `4` and a hint naming
where the pair came from. No fallback is attempted.

## Sessions

A follow-up passes `--conversation <id>`. For an id it does not know, agy
starts a new conversation instead of failing; the wrapper sees the different
id and exits `4` rather than pass the answer off as a follow-up.

## Failures

Only a result event with status `SUCCESS`, no `finished_reason` and a
non-empty response counts as an answer, with one exception: a consult or task
whose last finished step was the final message (with text of its own) but
which then ended on `Malformed function call` (an empty tool call, a known agy
glitch). That message is kept as the result, exit `0`, with a `warning:` to
check its claims and not to resume just to redo the work.

The same error mid-turn is retried by the wrapper. The error text is the retry
message agy means to send back to the model ("Please retry with a properly
formatted function call / Retries remaining: 3"), but headless agy reports it
instead of sending it. So a consult or task resends that message in the same
conversation with the same model pair, up to three times, half a second
apart so the prompt cache holds; each retry prints a `note:`. If it persists,
the run fails (exit `4`) with the usual `partial:`, `workdir:` and `resume:`
lines. Reviews are not retried.

agy's response joins every message of the turn, so a long task's starts with
a run of "running X, waiting" notes. When there are several, the result keeps
only the final message, says so in a `warning:`, and leaves the notes in the
log; a failed run's `partial:` file keeps them all.

A used-up quota (`quota reached`, `RESOURCE_EXHAUSTED`) gets a not-transient
`hint:` naming the reset time agy gave.

`agy` exits non-zero for any failure
(`3` for an agent or model API error, shown as `provider-exit: 3`), and then
prints an `AGY_ERROR: {...}` line on stderr. The wrapper adds its status,
reason, HTTP status and error id to the `error:` lines, and its `retryable`
flag as a `hint:` saying whether the failure is transient. Apart from the
mid-turn malformed call above, the wrapper never retries agy itself; the
host's rerun-at-most-once rule applies.
