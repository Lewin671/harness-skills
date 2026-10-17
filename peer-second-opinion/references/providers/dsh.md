# Provider: dsh

DeepSeek Harness, `dsh`, run through its `headless` profile. Not for use from
inside dsh itself. Its conclusions depend on the DeepSeek model and can be
wrong: check its claims, including "I ran it and it returned X" — the `log:`
file holds every event, tool results included.

## Prerequisites and binary

An installed `dsh` whose `headless` profile can reach the DeepSeek API (it
reads `DEEPSEEK_API_KEY` from the environment or `$DSH_HOME/.env`). The wrapper
finds `dsh` on the absolute entries of `PATH`, or uses `DSH_BIN` (an absolute
path to an executable file), and prints `note: using dsh binary: <path>` first.
A binary inside the repository under review is refused.

## Permissions

dsh has a real sandbox, chosen per run through `DSH_PERMISSION_MODE`:

- Review and consult run `read-only`: a write fails, and every escalation is
  refused because a headless run has no approval channel. A prompt note tells
  the model so, to save turns. The live tree is still fingerprinted.
- A task runs `danger-full-access` with approvals off, like the user's own
  unrestricted dsh.

The repository's `AGENTS.md`, dsh's own skills and the profile's other plugins
load into every run.

## Model

Without flags the run uses `deepseek-flash` at reasoning effort `max`.
`deepseek-flash` is the official API's alias for the newest DeepSeek V4.1
Flash snapshot (DeepSeek-V4.1-Flash-1017 since 2026-10-17), so it moves when
DeepSeek ships a new one. The `model:` line repeats the requested id; dsh's
stream does not name the snapshot that answered.

`--model` and `--effort` override either default independently (`deepseek-v4-pro`
is the other official model; efforts are `low`, `high`, `max`). They reach dsh
as a `--patch` overlay on the `agent-default-model` entry with route
`deepseek-official` — the headless profile has no model flags — so the
profile's own default model is not touched. Both travel in the `resume:` line.

## Sessions

dsh names sessions `session-<uuid>`; the wrapper prints the bare UUID and adds
the prefix back on resume. A session is tied to the directory it ran in: the
`resume:` line carries that `--repo`, and resuming from anywhere else fails. A
review resumes as a consult.

## Cost

A toy consult takes seconds and under 10k input tokens. Reviewing a real
change has taken ninety tool calls and about 7M input tokens, almost all cache
reads. The `usage:` line sums input, output and cache-read tokens over every
step and counts tool calls. There is no turn cap; `--timeout` bounds the run.

## provider-exit

dsh exits `1` for every failure; the wrapper exits `4` and relays dsh's own
reason as an `error:` line, with a `hint:` where one applies:

| Reason | Remedy |
|---|---|
| `INVALID_REQUEST: The supported API model names are …` | Pass one of the listed names with `--model`. |
| `UNSUPPORTED_REASONING_EFFORT` | Use `low`, `high` or `max`. |
| HTTP 401/403 | Set `DEEPSEEK_API_KEY`. |
| HTTP 429 / 5xx | Wait and rerun / rerun unchanged. |
| `session … was recorded in …` | Resume with `--repo` set to the recorded directory. |
| `session … does not exist` | Start a fresh run and restate the context. |
