---
name: agent-browser
description: Defines how agents should connect to and share a browser over CDP. Read this before starting any browser automation, especially when multiple agents may run in parallel, to avoid session collisions and authentication leakage.
---

# Agent Browser — CDP Usage Conventions

Rules for agents that use a browser via Chrome DevTools Protocol (CDP).

## One-time setup

Remove the global CDP default from `~/.agent-browser/config.json` if it is present.
Delete the `"cdp"` key (for example `"cdp": "9222"`) so the file no longer forces a fixed debugging port:

```json
{
  "cdp": "9222"
}
```

Keeping a hard-coded global CDP address causes every agent to connect to the same external browser by default. This makes any session-isolation mechanism ineffective, and parallel agents end up sharing the same browser process and colliding.

## When to share a CDP connection

| Scenario | What to do |
|---|---|
| **Single agent, reuse saved login state** | Connect to a shared CDP browser. One browser, one profile, one running session is fine. |
| **Multiple agents in parallel** | **Do not share CDP.** Each agent must start its own browser with its own profile. |
| **Multiple agents in parallel + same login state** | Export auth state to a file first, then give every agent its own browser loaded with that file. |

## How to share login state across parallel agents

1. Log in once in a shared browser and export the storage state (example using Playwright `codegen`):

   ```bash
   playwright codegen --save-storage-state=auth.json https://example.com
   ```

2. Start an independent browser for each agent (different ports and profiles):

   ```bash
   CDP_REMOTE_DEBUGGING_PORT=9223 CDP_BROWSER_PROFILE=~/.browser-agent-1 ./start-cdp-browser.sh
   CDP_REMOTE_DEBUGGING_PORT=9224 CDP_BROWSER_PROFILE=~/.browser-agent-2 ./start-cdp-browser.sh
   ```

3. Pass the auth state file when running automation in each agent:

   ```bash
   # Playwright test example
   playwright test --storage-state=auth.json
   # Or use storageState in your Playwright script / config
   ```

## Why session names don't provide isolation on a shared CDP

CDP sessions are multiplexed over a single browser process. All sessions see the same cookies and storage. Using distinct session names does not isolate authentication or local storage — it only names the protocol channel. Parallel agents that share a CDP endpoint will interfere with each other's login state.

## Summary

- **One agent → one shared CDP is fine.**
- **N agents → N independent browsers, one per agent.**
- **Shared credentials for N agents → export once, load via state file in each independent browser.**
