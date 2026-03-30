---
name: cdp-browser-launcher
description: Use this skill when the task is to launch or relaunch a local Chromium-based browser with Chrome DevTools Protocol enabled for automation, debugging, or web testing. Typical triggers include starting Chrome on port 9222, launching a browser before CDP-based automation, or bringing up a local browser with a known profile and remote debugging endpoint.
---

# CDP Browser Launcher

Use this skill when you need to start a local browser instance for CDP-based automation.

## Default behavior

- Profile directory defaults to `$HOME/agent-browser-data`
- Remote debugging port defaults to `9222`
- Remote debugging address defaults to `127.0.0.1`
- The launcher creates the profile directory if needed
- The launcher waits for the CDP endpoint to become reachable before reporting success
- On macOS, it uses the Google Chrome internal executable (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`) directly
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
