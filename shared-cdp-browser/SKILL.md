---
name: shared-cdp-browser
description: Shared Chrome CDP bootstrapper for browser agents. Use when the agent needs a browser with Chrome DevTools Protocol enabled, should auto-connect to an existing CDP endpoint, should launch Chrome if the CDP port is not available, or should let multiple agents share one persistent browser profile at ~/agent-browser-data.
---

# Shared CDP Browser

## Overview

This skill ensures a shared Chrome instance is available on `http://127.0.0.1:9222` with `~/agent-browser-data` as its user data directory. If CDP is already reachable, it reuses that browser; otherwise it launches Chrome and waits for the endpoint to come up.

Use this skill when browser work should reuse a persistent profile, when agents need CDP without manual setup, or when several agents need to attach to the same Chrome process at the same time.

## Quick Start

Run browser commands through the wrapper instead of calling `agent-browser` directly. Recommended workflow:

```bash
SESSION=$(/Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/new-session-name)
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp session open
SHARED_CDP_BROWSER_SESSION="$SESSION" \
SHARED_CDP_BROWSER_QUIET=1 \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp open https://example.com
SHARED_CDP_BROWSER_SESSION="$SESSION" \
SHARED_CDP_BROWSER_QUIET=1 \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp snapshot -i
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp session close
```

The wrapper performs this sequence on every call:

1. Check whether `http://127.0.0.1:9222/json/version` is live.
2. If not, launch Chrome with `--remote-debugging-port=9222`.
3. Reuse `~/agent-browser-data` so cookies, login state, and extensions persist.
4. If `SHARED_CDP_BROWSER_SESSION` is set, recover that session's leased tab from wrapper-managed lease metadata keyed by the CDP target id.
5. Forward the original arguments to `agent-browser --cdp http://127.0.0.1:9222`.

On macOS, app-bundle launches use `open -g` by default so a fresh shared browser starts in the background instead of stealing the foreground app.

## Multiple Agents

Multiple agents can attach to the same browser process. To avoid stepping on each other's `agent-browser` session state, give each agent its own session name and keep normal commands in quiet mode:

```bash
SESSION=$(/Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/new-session-name)
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp session open
SHARED_CDP_BROWSER_SESSION="$SESSION" \
SHARED_CDP_BROWSER_QUIET=1 \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp open https://example.com
```

When the same agent needs several commands in sequence, reuse the same `SHARED_CDP_BROWSER_SESSION` value for that whole workflow and keep `SHARED_CDP_BROWSER_QUIET=1` on the normal commands:

```bash
SESSION=$(/Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/new-session-name) && \
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp session open && \
SHARED_CDP_BROWSER_SESSION="$SESSION" \
SHARED_CDP_BROWSER_QUIET=1 \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp open https://example.com && \
SHARED_CDP_BROWSER_SESSION="$SESSION" \
SHARED_CDP_BROWSER_QUIET=1 \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp snapshot -i && \
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp session close
```

The session wrapper supports explicit lease management with TTL. `session open` and `session close` are the intended explicit lifecycle boundaries; keep quiet mode on for the normal page actions between them:

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

If a model forgets to close a session, the wrapper treats the tab as a lease and reclaims it after its TTL expires. Expired leased tabs are cleaned up opportunistically before later commands run.

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

Preferred entry point. It calls `ensure-cdp-browser` first, then runs `agent-browser` with the shared CDP endpoint. If `SHARED_CDP_BROWSER_SESSION` is set, the wrapper binds that session to a stable tab with wrapper-managed lease files keyed by the tab's CDP target id, tracks a TTL on that lease, auto-renews it on normal commands, and reclaims expired leased tabs before later commands. Session lookup no longer depends on page-controlled fields, so normal site scripts cannot steal or erase the lease. The wrapper also records which `agent-browser` daemon currently owns the leased tab; once that daemon is already bound, later commands reuse its in-memory active page instead of re-activating the Chrome tab on every call. If you need a stricter non-intrusive mode, set `SHARED_CDP_BROWSER_QUIET=1`: normal commands will refuse implicit session recovery instead of activating or creating tabs, while explicit `session open` is still allowed. It also exposes wrapper-level session helpers: `session open`, `session renew`, `session ttl`, `session close`, and `session cleanup`. Read-only helpers such as `session ttl` inspect lease metadata without changing the active tab. If `agent-browser` is not on `PATH`, it falls back to `npx -y agent-browser`.

Useful environment variables:

```bash
SHARED_CDP_BROWSER_SESSION_TTL=1800   # default lease TTL in seconds
SHARED_CDP_BROWSER_AUTO_RENEW=1       # renew leased tabs on normal commands
SHARED_CDP_BROWSER_BACKGROUND=1       # macOS app launches stay in the background by default
SHARED_CDP_BROWSER_QUIET=1            # refuse implicit session recovery on normal commands
```

### `scripts/new-session-name`

Generates a unique session name for parallel agents. Use it when several agents will interact with the shared browser at once.

## Notes

- The launcher uses a filesystem lock with stale-lock recovery so several agents can race to start the browser safely.
- Lock ownership records both PID and process start time, so stale-lock recovery is resilient to PID reuse.
- The command wrapper also uses a per-endpoint lock, so agents can share one browser safely even when they issue commands at the same time. Commands are serialized per CDP endpoint, not truly simultaneous at the browser action level.
- Session tabs behave like leases. `session close` is the explicit end-of-life path, but TTL-based cleanup is the safety net if a model forgets to close.
- The browser profile is shared on purpose. Agents should assume cookies, tabs, and logged-in state may already exist.
- This skill launches a dedicated Chrome instance only when the CDP endpoint is missing. If another Chrome is already listening on port `9222`, the skill reuses it.
- Session recovery is quieter than before, but the very first bind after a daemon restart may still need to re-target the leased tab once.
- With `SHARED_CDP_BROWSER_QUIET=1`, that implicit re-target step is disabled; callers must use `session open` explicitly if they want to rebind a leased tab.

## Resources (optional)

### scripts/
Shell wrappers for CDP bootstrap, browser launch, and per-agent session naming.
