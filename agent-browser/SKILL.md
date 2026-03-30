---
name: agent-browser
description: Use this skill when the task needs real browser automation. Default to agent-browser directly, with one isolated session per origin and optional login state loaded from AGENT_BROWSER_STATE_FILE.
---

# agent-browser

Use this skill for browser automation instead of a separate browser-launch step.

## Default workflow

1. Use `agent-browser` directly. Do not introduce a separate CDP launcher step unless the task explicitly requires attaching to an existing browser.
2. Derive one stable session name per origin:

```bash
SESSION="$(./scripts/origin-session.sh https://app.example.com/dashboard)"
```

3. For a new session, load persisted auth state when `AGENT_BROWSER_STATE_FILE` is set:

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

## Why this is the default

- `--session` gives each agent an isolated browser context, so concurrent agents do not fight over tabs, cookies, or storage.
- `--state <path>` lets a new session start with saved cookies and storage, which is the simplest way to reuse login state across concurrent sessions.
- Upstream state files carry cookies plus per-origin storage entries, so one saved file can seed multiple per-origin sessions.
- Upstream `agent-browser` supports `AGENT_BROWSER_STATE`, but this repo standardizes on `AGENT_BROWSER_STATE_FILE`; always pass it through `--state` explicitly.

## Authentication choices

Prefer them in this order:

1. `--session` plus `--state "${AGENT_BROWSER_STATE_FILE}"` for concurrent agents.
2. `--session-name <name>` for a single long-lived workflow that wants auto-save and auto-restore.
3. `--profile <path>` only when full browser profile persistence is required.

Important:

- Do not combine `--state` with `--profile`.
- Do not share one `--session` name across different origins.
- Reuse a session only for commands that belong to the same origin-level task.

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

## Working style

- Use `snapshot -i` and act on `@e` refs rather than brittle selectors when possible.
- Chain commands with `&&` only when you do not need to inspect intermediate output.
- Use `agent-browser session list` and `agent-browser close --all` for cleanup when a task leaves extra sessions behind.
