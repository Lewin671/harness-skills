---
name: agent-browser-concurrent
description: Repo-local workflow for concurrent browser automation with agent-browser. Default to isolated sessions derived from origin.
---

# agent-browser-concurrent

Use this skill when browser work must stay safe under concurrency.

This is a repo-local workflow layer on top of the upstream `agent-browser` CLI, not a replacement for the upstream generic skill docs.

## Default workflow

1. Use `agent-browser` directly. Do not introduce a separate CDP launcher step unless the task explicitly requires attaching to an existing browser.
2. Derive the session from the target origin. Add a suffix when more than one agent may touch the same origin concurrently:

```bash
SESSION="$(./scripts/origin-session.sh https://app.example.com/dashboard)"
# Same-origin concurrency:
# SESSION="$(./scripts/origin-session.sh https://app.example.com/dashboard reviewer-a)"
```

3. Prepare the session-specific state-file path. This skill stores one state file per session under `~/.agent-browser-concurrent/session-states/` by default:

```bash
SESSION="$(./scripts/origin-session.sh https://app.example.com/dashboard)"
SESSION_STATE_FILE="$(./scripts/prepare-session-state.sh "${SESSION}")"
```

`prepare-session-state.sh` copies the default state file from `~/.agent-browser-concurrent/agent-browser-state.json` into that per-session path the first time the session is used. After that, the session keeps writing to its own file instead of the shared seed.

For automation, prefer passing the seed file explicitly when you have one:

```bash
SESSION="$(./scripts/origin-session.sh https://app.example.com/dashboard)"
SESSION_STATE_FILE="$(./scripts/prepare-session-state.sh "${SESSION}" "/path/to/state.json")"
```

4. Start the session with a clean state loading sequence for proper authentication:

```bash
# For authenticated sessions (recommended):
agent-browser --session "${SESSION}" --state "${SESSION_STATE_FILE}" open about:blank
agent-browser --session "${SESSION}" state load "${SESSION_STATE_FILE}"
agent-browser --session "${SESSION}" open https://app.example.com/dashboard

# For unauthenticated sessions (simpler):
agent-browser --session "${SESSION}" --state "${SESSION_STATE_FILE}" open https://app.example.com/dashboard
```

**Important**: Always use the `about:blank → state load → navigate` sequence for authenticated sessions to ensure login state is properly applied.

5. Keep every later command on the same origin scoped to the same session:

```bash
agent-browser --session "${SESSION}" wait --load networkidle
agent-browser --session "${SESSION}" snapshot -i
agent-browser --session "${SESSION}" click @e2
```

6. Close the session when the task is done:

```bash
agent-browser --session "${SESSION}" close
```

7. Save the session back to its own state file:

```bash
agent-browser --session "${SESSION}" state save "${SESSION_STATE_FILE}"
```

## Why this is the default

- `--session` gives each agent an isolated browser context, so concurrent agents do not fight over tabs, cookies, or storage.
- `--state <path>` lets a new session start with saved cookies and storage, but requires proper loading sequence for authentication state to take effect.
- Upstream state files carry cookies plus per-origin storage entries, so one seed file can initialize many private per-session copies.
- This repo uses a fixed state file path at `~/.agent-browser-concurrent/agent-browser-state.json`; always pass it through `--state` explicitly.
- Explicit `state save` avoids the hidden assumption that `--state` auto-persists changes. It does not.
- Session-private files remove concurrent write races on the shared seed file.

## State file storage

The default shared state file is:

```bash
~/.agent-browser-concurrent/agent-browser-state.json
```

The per-session state directory is:

```bash
~/.agent-browser-concurrent/session-states/
```

That path is:

- outside the repo
- stable across reruns
- one file per session
- easy to inspect or delete manually

Override it when needed:

```bash
export AGENT_BROWSER_CONCURRENT_STATE_DIR=/custom/path/session-states
```

## Authentication choices

### Recommended workflow for authenticated sessions

For sites requiring login state, use this three-step sequence:

```bash
SESSION="$(./scripts/origin-session.sh https://app.example.com)"
SESSION_STATE_FILE="$(./scripts/prepare-session-state.sh "${SESSION}")"

# 1. Start with blank page
agent-browser --session "${SESSION}" --state "${SESSION_STATE_FILE}" open about:blank

# 2. Load authentication state
agent-browser --session "${SESSION}" state load "${SESSION_STATE_FILE}"

# 3. Navigate to target page
agent-browser --session "${SESSION}" open https://app.example.com
```

### Alternative authentication methods

Prefer them in this order:

1. `--session` plus a per-session state copy derived from `~/.agent-browser-concurrent/agent-browser-state.json` (with the three-step sequence above).
2. `--session-name <name>` for a single long-lived workflow that wants auto-save and auto-restore.
3. `--profile <path>` only when full browser profile persistence is required.

Important:

- Do not combine `--state` with `--profile`.
- Do not share one `--session` name across different origins.
- Do not reuse the same derived session for two concurrent agents on the same origin; add a suffix instead.
- Reuse a session only for commands that belong to the same origin-level task.
- Treat `~/.agent-browser-concurrent/agent-browser-state.json` as the shared seed file, not the live write target for concurrent sessions.
- The first run of a session copies from the seed. Later runs of the same session reuse that session's own file unless you delete it manually.
- If you refresh the shared seed and want an existing session to pick it up, delete that session's private file first or use a new suffix.

## Parallel pattern

Run different origins in different sessions:

```bash
SESSION_A="$(./scripts/origin-session.sh https://github.com)"
SESSION_B="$(./scripts/origin-session.sh https://vercel.com)"
STATE_A="$(./scripts/prepare-session-state.sh "${SESSION_A}" "/path/to/state.json")"
STATE_B="$(./scripts/prepare-session-state.sh "${SESSION_B}" "/path/to/state.json")"

agent-browser --session "${SESSION_A}" --state "${STATE_A}" open about:blank
agent-browser --session "${SESSION_A}" state load "${STATE_A}"
agent-browser --session "${SESSION_A}" open https://github.com

agent-browser --session "${SESSION_B}" --state "${STATE_B}" open about:blank
agent-browser --session "${SESSION_B}" state load "${STATE_B}"
agent-browser --session "${SESSION_B}" open https://vercel.com
```

Both private files can be initialized from the same shared seed file at `~/.agent-browser-concurrent/agent-browser-state.json` without colliding on writeback.

If two agents must hit the same origin at the same time, split the sessions:

```bash
SESSION_A="$(./scripts/origin-session.sh https://app.example.com reviewer-a)"
SESSION_B="$(./scripts/origin-session.sh https://app.example.com reviewer-b)"
STATE_A="$(./scripts/prepare-session-state.sh "${SESSION_A}" "/path/to/state.json")"
STATE_B="$(./scripts/prepare-session-state.sh "${SESSION_B}" "/path/to/state.json")"
```

## Bootstrapping auth

Use `~/.agent-browser-concurrent/agent-browser-state.json` as the reusable artifact. To create or refresh it, either log in inside one session and run `state save`, or import from an already-authenticated Chrome session:

```bash
agent-browser --auto-connect state save "$HOME/.agent-browser-concurrent/agent-browser-state.json"
```

## Working style

- Use `snapshot -i` and act on `@e` refs rather than brittle selectors when possible.
- Chain commands with `&&` only when you do not need to inspect intermediate output.
- Use `agent-browser session list` and `agent-browser close --all` for cleanup when a task leaves extra sessions behind.
- Use `./scripts/session-state-path.sh <session>` when you need to inspect where a session's private state file lives.
- **Critical**: Always use the `about:blank → state load → navigate` sequence for authenticated sessions. Direct navigation with `--state` may not apply login state correctly.
- Delete existing session state files (`rm ~/.agent-browser-concurrent/session-states/<session>.json`) when you need to refresh from an updated seed file.
