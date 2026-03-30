---
name: cdp-browser-launcher
description: >-
  Prerequisite for browser automation. Use this skill first whenever the task
  involves opening a website, clicking elements, filling forms, taking
  screenshots, scraping data, or testing web pages. Call it to start a local
  browser with remote debugging before connecting Playwright, Puppeteer, or
  other CDP tools.
---

# CDP Browser Launcher

Start a local browser that other tools can control.

## When to use this skill

Call this skill **before** doing any browser work. Typical situations:

- The user asks to open a website, click elements, fill a form, take a screenshot, scrape data, or run any web automation.
- The user asks to test a web page or debug front-end behavior.
- You are about to use Playwright, Puppeteer, or any other CDP-based library and need a browser process listening on a debugging port.
- The user explicitly asks to start, restart, or relaunch a browser.

Prefer this skill over a raw shell command — the script handles browser detection, profile isolation, port-conflict checks, and startup verification automatically.

## Call order

1. **This skill first** — run the launcher to get a browser with CDP enabled.
2. **Then** use your browser automation tool (Playwright MCP, Puppeteer, etc.) to connect to the CDP endpoint printed by the launcher.

If the automation tool reports that it cannot connect to a browser, re-run this skill to confirm the browser is alive.

## Run

From this skill directory, run:

```bash
./scripts/start-cdp-browser.sh
```

Override defaults with environment variables when needed:

```bash
CDP_BROWSER_PROFILE=/custom/profile \
CDP_REMOTE_DEBUGGING_PORT=9333 \
./scripts/start-cdp-browser.sh
```

## Default behavior

- Profile directory: `$HOME/agent-browser-data`
- Remote debugging port: `9222`
- Remote debugging address: `127.0.0.1`
- Creates the profile directory if it does not exist
- Waits for the CDP endpoint to become reachable before reporting success
- On macOS, prefers installed app bundles and starts them via `open -na ... --args ...`
- On Linux, falls back to common Chromium-family executables when available

## Notes

- Set `CDP_BROWSER_BIN` to use a specific browser executable. On macOS, auto-detection may choose an app bundle; the explicit override should point to an executable.
- The script targets macOS and Linux. Other platforms should set `CDP_BROWSER_BIN` or extend the script.
- After a successful launch the script prints the browser target, profile path, log path, and verified CDP endpoint.
