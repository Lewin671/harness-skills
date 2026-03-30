---
name: agent-browser-concurrent
description: Repo-local workflow for concurrent browser automation with agent-browser. Default to isolated sessions derived from origin, optionally seeded from AGENT_BROWSER_STATE_FILE.
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

3. For a new session, load persisted auth state when `AGENT_BROWSER_STATE_FILE` points at an existing file:

```bash
SESSION="$(./scripts/origin-session.sh https://app.example.com/dashboard)"
STATE_ARGS=()
if [ -n "${AGENT_BROWSER_STATE_FILE:-}" ] && [ -f "${AGENT_BROWSER_STATE_FILE}" ]; then
  STATE_ARGS=(--state "${AGENT_BROWSER_STATE_FILE}")
fi

agent-browser --session "${SESSION}" "${STATE_ARGS[@]}" open https://app.example.com/dashboard
```

4. Keep every later command on the same origin scoped to the same session:

```bash
agent-browser --session "${SESSION}" wait --load networkidle
agent-browser --session "${SESSION}" snapshot -i
agent-browser --session "${SESSION}" click @e2
```

5. Close the session when the task is done:

```bash
agent-browser --session "${SESSION}" close
```

6. In a single-writer refresh flow, save updated login state back explicitly:

```bash
if [ -n "${AGENT_BROWSER_STATE_FILE:-}" ]; then
  agent-browser --session "${SESSION}" state save "${AGENT_BROWSER_STATE_FILE}"
fi
```

## Why this is the default

- `--session` gives each agent an isolated browser context, so concurrent agents do not fight over tabs, cookies, or storage.
- `--state <path>` lets a new session start with saved cookies and storage, which is the simplest way to reuse login state across concurrent sessions.
- Upstream state files carry cookies plus per-origin storage entries, so one saved file can seed multiple per-origin sessions.
- Upstream `agent-browser` supports `AGENT_BROWSER_STATE`, but this repo standardizes on `AGENT_BROWSER_STATE_FILE`; always pass it through `--state` explicitly.
- Explicit `state save` avoids the hidden assumption that `--state` auto-persists changes. It does not.
- In testing, shared state files worked well as read-only seeds, but writeback should be treated as single-writer only.

## Authentication choices

Prefer them in this order:

1. `--session` plus `--state "${AGENT_BROWSER_STATE_FILE}"` for concurrent agents.
2. `--session-name <name>` for a single long-lived workflow that wants auto-save and auto-restore.
3. `--profile <path>` only when full browser profile persistence is required.

Important:

- Do not combine `--state` with `--profile`.
- Do not share one `--session` name across different origins.
- Do not reuse the same derived session for two concurrent agents on the same origin; add a suffix instead.
- Reuse a session only for commands that belong to the same origin-level task.
- Prefer one shared exported state file only when it already contains the required origins and account. Otherwise manage separate state files outside this skill.
- Do not let multiple concurrent sessions overwrite the same `AGENT_BROWSER_STATE_FILE`. Treat it as read-only during concurrent runs unless one designated session is responsible for refresh.

## Parallel pattern

Run different origins in different sessions:

```bash
SESSION_A="$(./scripts/origin-session.sh https://github.com)"
SESSION_B="$(./scripts/origin-session.sh https://vercel.com)"

agent-browser --session "${SESSION_A}" open https://github.com
agent-browser --session "${SESSION_B}" open https://vercel.com
```

If both origins should start authenticated, load state on each session's first launch:

```bash
agent-browser --session "${SESSION_A}" --state "${AGENT_BROWSER_STATE_FILE}" open https://github.com
agent-browser --session "${SESSION_B}" --state "${AGENT_BROWSER_STATE_FILE}" open https://vercel.com
```

If two agents must hit the same origin at the same time, split the sessions:

```bash
SESSION_A="$(./scripts/origin-session.sh https://app.example.com reviewer-a)"
SESSION_B="$(./scripts/origin-session.sh https://app.example.com reviewer-b)"
```

## Bootstrapping auth

Use `AGENT_BROWSER_STATE_FILE` as the reusable artifact. To create or refresh it, either log in inside one session and run `state save`, or import from an already-authenticated Chrome session:

```bash
agent-browser --auto-connect state save "${AGENT_BROWSER_STATE_FILE}"
```

## Working style

- Use `snapshot -i` and act on `@e` refs rather than brittle selectors when possible.
- Chain commands with `&&` only when you do not need to inspect intermediate output.
- Use `agent-browser session list` and `agent-browser close --all` for cleanup when a task leaves extra sessions behind.
