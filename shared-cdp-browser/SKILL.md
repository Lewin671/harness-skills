---
name: shared-cdp-browser
description: Shared Chrome CDP bootstrapper for browser agents. Use when the agent needs a browser with Chrome DevTools Protocol enabled, should auto-connect to an existing CDP endpoint, should launch Chrome if the CDP port is not available, or should let multiple agents share one persistent browser profile at ~/agent-browser-data.
---

# Shared CDP Browser

## Overview

This skill ensures a shared Chrome instance is available on `http://127.0.0.1:9222` with `~/agent-browser-data` as its user data directory. If CDP is already reachable, it reuses that browser; otherwise it launches Chrome and waits for the endpoint to come up.

Use this skill when browser work should reuse a persistent profile, when agents need CDP without manual setup, or when several agents need to attach to the same Chrome process at the same time.

## Quick Start

Run browser commands through the wrapper instead of calling `agent-browser` directly:

```bash
/Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp open https://example.com
/Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp snapshot -i
```

The wrapper performs this sequence on every call:

1. Check whether `http://127.0.0.1:9222/json/version` is live.
2. If not, launch Chrome with `--remote-debugging-port=9222`.
3. Reuse `~/agent-browser-data` so cookies, login state, and extensions persist.
4. If `SHARED_CDP_BROWSER_SESSION` is set, recover that session's dedicated tab by `window.name`.
5. Forward the original arguments to `agent-browser --cdp http://127.0.0.1:9222`.

## Multiple Agents

Multiple agents can attach to the same browser process. To avoid stepping on each other's `agent-browser` session state, give each agent its own session name:

```bash
SESSION=$(/Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/new-session-name)
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp open https://example.com
```

When the same agent needs several commands in sequence, reuse the same `SHARED_CDP_BROWSER_SESSION` value for that whole workflow:

```bash
SESSION=$(/Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/new-session-name) && \
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp open https://example.com && \
SHARED_CDP_BROWSER_SESSION="$SESSION" \
  /Users/qingyingliu/Code/harness-skills/shared-cdp-browser/scripts/agent-browser-cdp snapshot -i
```

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

Preferred entry point. It calls `ensure-cdp-browser` first, then runs `agent-browser` with the shared CDP endpoint. If `SHARED_CDP_BROWSER_SESSION` is set, the wrapper binds that session to a stable tab using `window.name`, and serializes commands with a global lock so parallel agents do not race each other. If `agent-browser` is not on `PATH`, it falls back to `npx -y agent-browser`.

### `scripts/new-session-name`

Generates a unique session name for parallel agents. Use it when several agents will interact with the shared browser at once.

## Notes

- The launcher uses a filesystem lock so several agents can race to start the browser safely.
- The command wrapper also uses a global lock, so agents can share one browser safely even when they issue commands at the same time. Commands are serialized, not truly simultaneous at the browser action level.
- The browser profile is shared on purpose. Agents should assume cookies, tabs, and logged-in state may already exist.
- This skill launches a dedicated Chrome instance only when the CDP endpoint is missing. If another Chrome is already listening on port `9222`, the skill reuses it.

## Resources (optional)

### scripts/
Shell wrappers for CDP bootstrap, browser launch, and per-agent session naming.
