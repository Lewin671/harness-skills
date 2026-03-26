---
name: shared-cdp-browser
description: Shared Chrome CDP bootstrapper for browser agents. Use when the agent needs a browser with Chrome DevTools Protocol enabled, should auto-connect to an existing CDP endpoint, should launch Chrome if the CDP port is not available, or should let multiple agents share one persistent browser profile at ~/agent-browser-data.
---

# Shared CDP Browser

## Use It For

Use this skill when browser work should attach to a shared Chrome CDP endpoint instead of launching an isolated browser per task.

Its responsibilities are:

1. Ensure a Chrome-compatible browser is available at `http://127.0.0.1:9222`.
2. Reuse a persistent shared profile at `~/agent-browser-data`.
3. Provide a single wrapper for `agent-browser --cdp ...`.
4. Offer lightweight session helpers for cleanup and visibility when `SHARED_CDP_BROWSER_SESSION` is set.

This skill is intentionally narrow. It does not add a second control plane on top of `agent-browser`, and it does not try to own tab-routing semantics for normal commands.

## Default Workflow

Run browser commands through the wrapper instead of calling `agent-browser` directly.

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

Treat one `SHARED_CDP_BROWSER_SESSION` value as one workspace for one agent or one coherent task. A workspace may contain multiple tabs. Create a new session only when you need isolation from other work.

## What The Wrapper Does

`scripts/agent-browser-cdp` always:

1. Calls `scripts/ensure-cdp-browser`.
2. Reuses an existing browser if CDP is already reachable.
3. Otherwise launches Chrome with remote debugging enabled.
4. Forwards the original command to `agent-browser --cdp ...`.

If `SHARED_CDP_BROWSER_SESSION` is set, the wrapper may also keep a lightweight lease file for the current tab so explicit session commands can inspect, renew, or clean up that workspace later.

## Session Helpers

When `SHARED_CDP_BROWSER_SESSION` is set, these wrapper-level helpers are available:

- `session open`
- `session ttl`
- `session renew`
- `session close`
- `session cleanup`

These commands are for lightweight lifecycle management only. Normal browsing behavior still belongs to `agent-browser`.

## Scripts

### `scripts/ensure-cdp-browser`

Ensures the shared CDP endpoint exists. Override defaults only when necessary:

```bash
SHARED_CDP_BROWSER_HOST=127.0.0.1
SHARED_CDP_BROWSER_PORT=9222
SHARED_CDP_BROWSER_USER_DATA_DIR=~/agent-browser-data
SHARED_CDP_BROWSER_BIN=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
```

### `scripts/agent-browser-cdp`

Preferred entry point. It bootstraps the shared CDP browser, then runs `agent-browser` against that endpoint. If `agent-browser` is not on `PATH`, it falls back to `npx -y agent-browser`.

Useful environment variables:

```bash
SHARED_CDP_BROWSER_SESSION_TTL=1800   # default lease TTL in seconds
SHARED_CDP_BROWSER_AUTO_RENEW=1       # renew the tracked tab lease on successful commands
SHARED_CDP_BROWSER_BACKGROUND=1       # macOS app launches stay in the background by default
SHARED_CDP_BROWSER_USE_LOCK=1         # serialize wrapper calls only when you need it
```

### `scripts/new-session-name`

Generates a unique session name for concurrent agents.

## Notes

- Browser startup is protected by a filesystem lock with stale-lock recovery.
- Wrapper command locking is opt-in. Leave it off unless you have a concrete race to suppress.
- The browser profile is shared on purpose. Assume cookies, tabs, and login state may already exist.
- If another Chrome is already listening on port `9222`, this skill reuses it.
