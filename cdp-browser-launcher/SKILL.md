---
name: cdp-browser-launcher
description: Launch a local Chromium-based browser with Chrome DevTools Protocol enabled. Use this skill when the task requires starting a CDP browser, especially when the profile should default to $HOME/agent-browser-data and the remote debugging port should default to 9222.
---

# CDP Browser Launcher

Use this skill when you need to start a local browser instance for CDP-based automation.

## Default behavior

- Profile directory defaults to `$HOME/agent-browser-data`
- Remote debugging port defaults to `9222`
- Remote debugging address defaults to `127.0.0.1`
- The launcher creates the profile directory if needed
- The launcher prefers `Google Chrome`, then falls back to other Chromium-based browsers if available
- On macOS, it starts the browser via `open -na ... --args ...` to reliably create a fresh app instance

## Run

From this skill directory, run:

```bash
./scripts/start-cdp-browser.sh
```

If you need to override the defaults:

```bash
CDP_BROWSER_PROFILE=/custom/profile \
CDP_REMOTE_DEBUGGING_PORT=9333 \
./scripts/start-cdp-browser.sh
```

## Notes

- The requested default profile path `/Users/qingyingliu/agent-browser-data` is satisfied on this machine through `$HOME/agent-browser-data`.
- If a specific browser executable is required, set `CDP_BROWSER_BIN` to its executable path before running the script.
- The script prints the chosen browser binary, profile path, and debugging endpoint after launch.
