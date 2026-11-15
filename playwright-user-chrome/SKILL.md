---
name: playwright-user-chrome
description: >-
  Claude Code ONLY — read before driving the user's own Chrome with
  playwright-cli through the Playwright browser extension (extension mode),
  i.e. any browsing, scraping, form filling or web checking in their real,
  signed-in browser. Covers connecting, one named session per task, keeping
  window-focus steals rare, background-tab pitfalls, a visible on-page cursor,
  and cleanup. Complements the playwright-cli skill, which documents the
  commands themselves.
harnesses: [claude-code]
---

# Driving the user's Chrome with playwright-cli

The `playwright-cli` skill lists the commands. This skill covers what changes when the
browser is the user's own Chrome, attached through the Playwright extension: the user is
working in the same browser, so every focus change, stray tab or hung command lands on them.

Observations below were made with playwright-cli 0.1.21–0.1.24 and extension 0.4.0. When the
CLI or extension changes, treat them as likely rather than certain, and re-check one before
building a long run on it.

## Connect

- If `PLAYWRIGHT_MCP_BROWSER` is set in the environment from an older setup, `unset` it first.
- One named session per task, on every command: `-s=<task-name>` (e.g. `-s=trip-hotel`).
  Run `playwright-cli list` first and pick a name not already in use. Subagents working on
  the same task share its session; unrelated parallel tasks each use their own.
- Connect once per task: `playwright-cli -s=<task> attach --extension=chrome`, or
  `open [url]` when the environment sets `PLAYWRIGHT_MCP_EXTENSION`. Each connect activates
  the tab and focuses the window, so do not reconnect within a task.
- Several sessions can attach to the same Chrome at once. Each sees only its own tabs, and
  the extension groups each session's tabs under its own coloured tab group.

## Show a visible cursor

Right after connecting, run `playwright-cli -s=<task> video-show-actions`. No recording is
needed: the page gets an overlay cursor that glides to each action point, with a brief
callout naming the action, so the user can follow what the agent does.

- `mousemove x y` moves it too; between actions it stays at the last point, across navigations.
- Add `--point-style="width:20px;height:20px;border-radius:50%;background:rgba(255,0,0,.7)"`
  to mark click points. Each action is paced by `--duration` (default 500 ms).
- The overlay is `pointer-events: none`, so it does not block clicks, but it is an injected
  `<x-pw-glass>` element in the page. **Leave it off on sites with bot detection** (shops,
  travel booking, social networks, logged-in platforms), where extra DOM is a signal.
- `video-hide-actions` turns it off. It draws inside the page only, not on browser chrome.

## Keep focus steals rare

Only `tab-select` (brings the page to front) and `tab-new` (Chrome creates and activates the
tab in the user's current window) steal focus; other commands do not.

| Situation | Do |
|---|---|
| Ordinary browsing | Keep one working tab; navigate with `goto` |
| `target=_blank` link | Read its `href` with `eval`, then `goto` it |
| Several pages needed | Open them all at the start, in one burst |
| Act on another tab | Not `tab-select`; use `run-code` on `page.context().pages()[i]` |
| Tab in the background | DOM-level actions only (see below) |
| Screenshot or mouse input required | Tell the user first, bring the tab forward, finish quickly |

## Background-tab pitfalls

Whether a controlled tab reports `visible` or `hidden` is unpredictable in extension mode: it
has stayed `visible` after losing focus, and stayed `hidden` after `goto`, `tab-select` and
`reload`. Check `document.visibilityState` instead of assuming.

When the tab is hidden or in the background:

- Mouse input (`mousewheel`, likely `hover` and `screenshot` too) can hang: 5 s timeouts, once
  close to 3 minutes. Scroll with `eval` (`scrollBy`), click with `eval "el => el.click()"`.
- `click` may wait forever for the element to become stable; use the `eval` click above.
- `type` drops ASCII characters (key events) but keeps CJK text (insertText). Focus the field
  in the page, clear it with a DOM Range selection plus Backspace, then in `run-code` call
  `page.keyboard.insertText(text)`.
- `setInputFiles` times out; build a `File` with `DataTransfer` inside the page, assign it to
  the input's `files`, and dispatch `change`.
- Pages that pause work when hidden (lazy loading, security prompts, rendering) can be nudged by
  overriding `document.visibilityState`/`hidden` and dispatching `visibilitychange` and
  `pageshow`; redo it after every reload, and report that it was forced. Some infinite
  scrolls ignore this; prefer a search or list URL whose first screen holds what you need.
- The `run-code` sandbox has no `setTimeout`; wait with `page.waitForTimeout(ms)`.
- Extension mode refuses `newCDPSession` (`Target.attachToBrowserTarget: Not allowed`).

## Clean up

`close` in extension mode only disconnects; the tabs stay open in the user's Chrome. So:

1. `tab-list`, then `tab-close` each of this session's tabs from the highest index down.
2. `playwright-cli -s=<task> close`. Closing the last tab already ends the session, so a
   "not open" reply here is fine.
3. Never `close-all` or `kill-all`: they also end other tasks' sessions.
