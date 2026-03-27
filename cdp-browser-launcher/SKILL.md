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
- The launcher waits for the CDP endpoint to become reachable before reporting success
- On macOS, it prefers installed app bundles and starts them via `open -na ... --args ...`
- On Linux, it falls back to common Chromium-family executables when available

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

- Set `CDP_BROWSER_BIN` when you need a specific browser executable. On macOS, auto-detection may choose an app bundle, but the explicit override should point to an executable.
- The current implementation targets macOS and Linux. Other platforms should use `CDP_BROWSER_BIN` explicitly or extend the script.
- The script prints the selected browser target, profile path, log path, and verified CDP endpoint after launch.
