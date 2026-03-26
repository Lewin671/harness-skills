---
name: shared-cdp-browser
description: Shared Chrome CDP bootstrapper for browser agents. Use when the agent needs a browser with Chrome DevTools Protocol enabled, should auto-connect to an existing CDP endpoint, should launch Chrome if the CDP port is not available, or should let multiple agents share one persistent browser profile at ~/agent-browser-data.
---

# Shared CDP Browser

## Overview

This skill ensures a shared Chrome instance is available on `http://127.0.0.1:9222` with `~/agent-browser-data` as its user data directory. If CDP is already reachable, it reuses that browser; otherwise it launches Chrome and waits for the endpoint to come up.

Use this skill when browser work should reuse a persistent profile, when agents need CDP without manual setup, or when several agents need to attach to the same Chrome process at the same time.

## Quick Start

Run browser commands through the wrapper instead of calling `agent-browser` directly. Treat one session as one browser workspace for an agent. A workspace may contain multiple tabs; open another tab when that matches the task, and create a new session only when you need isolation from other work.

Recommended workflow:

```bash
SESSION=$(/Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/new-session-name)
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp session open
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp open https://example.com
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp snapshot -i
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp session close
```

The wrapper performs this sequence on every call:

1. Check whether `http://127.0.0.1:9222/json/version` is live.
2. If not, launch Chrome with `--remote-debugging-port=9222`.
3. Reuse `~/agent-browser-data` so cookies, login state, and extensions persist.
4. If `SHARED_CDP_BROWSER_SESSION` is set, optionally track the current tab in a lightweight lease file so explicit `session` helpers can inspect or clean it up later.
5. Forward the original arguments to `agent-browser --cdp http://127.0.0.1:9222`.

On macOS, app-bundle launches use `open -g` by default so a fresh shared browser starts in the background instead of stealing the foreground app.

## Multiple Agents

Multiple agents can attach to the same browser process. To avoid stepping on each other's `agent-browser` session state, give each agent its own session name:

```bash
SESSION=$(/Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/new-session-name)
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp session open
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp open https://example.com
```

When the same agent needs several commands in sequence, reuse the same `SHARED_CDP_BROWSER_SESSION` value for that whole workflow. Within that session, it is normal to keep several tabs open and switch between them with `tab list`, `tab new`, and `tab <index>`:

```bash
SESSION=$(/Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/new-session-name) && \
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp session open && \
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp open https://example.com && \
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp tab new && \
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp open https://example.org && \
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp tab list
```

Create a new session only when the work should be isolated, such as handing a separate browsing task to another agent, keeping unrelated login states apart, or reserving a tab set for a long-running flow.

The session wrapper supports explicit lease management with TTL. `session open` and `session close` are the intended explicit lifecycle boundaries for the workspace anchor:

```bash
SESSION=$(/Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/new-session-name)
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp session open --ttl 1800
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp session ttl
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp session renew --ttl 1800
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp session close
```

If a model forgets to close a session, the wrapper treats the last tracked tab as a lease and reclaims it after its TTL expires. Expired leased tabs are cleaned up opportunistically before later commands run.

## Scripts

### `scripts/ensure-cdp-browser`

Ensures the shared Chrome CDP endpoint exists. Override defaults only when necessary:

```bash
SHARED_CDP_BROWSER_PORT=9222
SHARED_CDP_BROWSER_HOST=127.0.0.1
SHARED_CDP_BROWSER_USER_DATA_DIR=~/agent-browser-data
SHARED_CDP_BROWSER_BIN=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
```

### `scripts/agent-browser-cdp`

Preferred entry point. It calls `ensure-cdp-browser` first, then runs `agent-browser` with the shared CDP endpoint. If `SHARED_CDP_BROWSER_SESSION` is set, the wrapper can keep a lightweight lease file for the current tab, auto-renew that lease on successful commands, and reclaim expired leased tabs before later commands run. It no longer tries to implicitly re-activate a leased tab or infer daemon ownership on normal commands; `agent-browser` remains responsible for its own session semantics. Wrapper-level session helpers remain available: `session open`, `session renew`, `session ttl`, `session close`, and `session cleanup`. Read-only helpers such as `session ttl` inspect lease metadata without changing the active tab. If `agent-browser` is not on `PATH`, it falls back to `npx -y agent-browser`.

Useful environment variables:

```bash
SHARED_CDP_BROWSER_SESSION_TTL=1800   # default lease TTL in seconds
SHARED_CDP_BROWSER_AUTO_RENEW=1       # renew leased tabs on normal commands
SHARED_CDP_BROWSER_BACKGROUND=1       # macOS app launches stay in the background by default
SHARED_CDP_BROWSER_USE_LOCK=1         # serialize wrapper calls when you really need it
```

### `scripts/new-session-name`

Generates a unique session name for parallel agents. Use it when several agents will interact with the shared browser at once.

## Notes

- The launcher uses a filesystem lock with stale-lock recovery so several agents can race to start the browser safely.
- Lock ownership records both PID and process start time, so stale-lock recovery is resilient to PID reuse.
- Wrapper command locking is now opt-in via `SHARED_CDP_BROWSER_USE_LOCK=1`. Leave it off unless you have a concrete race to suppress.
- The session lease is lightweight metadata for cleanup and visibility, not an extra control plane layered on top of `agent-browser`.
- `session close` is the explicit end-of-life path, but TTL-based cleanup is the safety net if a model forgets to close.
- The browser profile is shared on purpose. Agents should assume cookies, tabs, and logged-in state may already exist.
- This skill launches a dedicated Chrome instance only when the CDP endpoint is missing. If another Chrome is already listening on port `9222`, the skill reuses it.

## Resources (optional)

### scripts/
Shell wrappers for CDP bootstrap, browser launch, and per-agent session naming.
