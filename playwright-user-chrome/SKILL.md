---
name: playwright-user-chrome
description: >-
  Claude Code and Antigravity (Codex has its own Browser Use) — read before driving the user's own Chrome with
  playwright-cli through the Playwright browser extension (extension mode),
  i.e. any browsing, scraping, form filling or web checking in their real,
  signed-in browser. Covers connecting, one named session per task, keeping
  window-focus steals rare, background-tab pitfalls, a visible on-page cursor,
  and cleanup. Complements the playwright-cli skill, which documents the
  commands themselves.
harnesses: [claude-code, antigravity]
---

# Driving the user's Chrome with playwright-cli

The `playwright-cli` skill lists the commands. This skill covers what changes when the
browser is the user's own Chrome, attached through the Playwright extension: the user is
working in the same browser, so every focus change, stray tab or hung command lands on them.

Observations below were made with playwright-cli 0.1.21–0.1.24 and extension 0.4.0–0.5.0. When the
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

Required: the first command after connecting is always
`playwright-cli -s=<task> video-show-actions`, on every site and in every session, so the
user can follow what the agent does. No recording is needed: the page gets an overlay cursor
that glides to each action point, with a brief callout naming the action.

- The cursor follows real input only (`click`, `hover`, `type`, `mousemove`). `goto`, `eval`
  and `run-code` never create or move it, so a task done purely through in-page scripts
  shows no cursor at all. Before a DOM-level click or a read, glide it to the element: get
  the centre from `getBoundingClientRect()` with `eval`, then `mousemove x y`.
- Between actions it stays at the last point, across navigations.
- Add `--point-style="width:20px;height:20px;border-radius:50%;background:rgba(255,0,0,.7)"`
  to mark click points. Each action is paced by `--duration` (default 500 ms).
- The overlay is `pointer-events: none`, so it does not block clicks. It is an injected
  `<x-pw-glass>` element in the page; keep it on all the same, including on sites with bot
  detection, and turn it off with `video-hide-actions` only when the user asks.
- It draws inside the page only, not on browser chrome.

## Real input first

Real input (`click`, `hover`, `type`, `press`, `mousewheel`) reaches the page as trusted
events and moves the visible cursor. An in-page `el.click()` arrives with `isTrusted: false`
and no pointer movement before it, which a page can tell apart. So:

- Check the tab's real visibility first:
  `Object.getOwnPropertyDescriptor(Document.prototype,'visibilityState').get.call(document)`
  (this also sees through an override made earlier). `document.hasFocus()` is no test: it
  returns true even for a hidden tab.
- Visible: use real input. Vary the waits between actions instead of a fixed interval, and
  type with a per-key delay (`page.keyboard.type(ch)` in a `run-code` loop with uneven
  `waitForTimeout`s); `type` sends the whole text in one instant.
- A selector for `click`/`hover` must match exactly one element. With several matches the
  command waits and times out as if nothing matched; narrow it with `>> nth=0`.
- After a real click times out, check the page before retrying or falling back: the click may
  still land, and a second one would undo a toggle or submit twice.
- `press Meta+a` does not select all on macOS; select with a DOM Range, then `press Backspace`.
- Hidden: key presses still work and stay trusted, mouse input does not (see the
  pitfalls below), so the DOM-level substitutes are the fallback. On a site with bot
  detection, before an action that changes account state (post, like, follow, order), tell
  the user and bring the tab forward once with `tab-select`; fall back only if it stays
  hidden, and say so in the report.
- Reading content with `eval` is passive and fine in any tab.
- A locked screen does not hide the tab. With the Mac locked and the display asleep, a tab
  opened by `open` reported `visible`, kept rendering, and real wheel, hover and click all
  worked (extension 0.5.0). Hidden comes from the user's own use: another tab active in that
  window, or the window covered. On macOS,
  `ioreg -n Root -d1 | grep -c '"IOConsoleLocked" = Yes'` prints 1 when locked; then nobody
  is disturbed, so bring the tab forward freely and use real input throughout.

## Keep focus steals rare

Only `tab-select` (brings the page to front) and `tab-new` (Chrome creates and activates the
tab in the user's current window) steal focus; other commands do not.

| Situation | Do |
|---|---|
| Ordinary browsing | Keep one working tab; navigate with `goto` |
| `target=_blank` link | Read its `href` with `eval`, then `goto` it |
| Several pages needed | Open them all at the start, in one burst |
| Act on another tab | Not `tab-select`; use `run-code` on `page.context().pages()[i]` |
| Tab hidden and it cannot be shown | DOM-level fallbacks (see below) |
| Screenshot or mouse input required | Tell the user first, bring the tab forward, finish quickly |

## Background-tab pitfalls

Whether a controlled tab reports `visible` or `hidden` is unpredictable in extension mode: it
has stayed `visible` after losing focus, and stayed `hidden` after `goto`, `tab-select` and
`reload`. Check `document.visibilityState` instead of assuming.

When the tab is hidden or in the background:

- Mouse input hangs or fails: `mousewheel` ran past 30 s (once close to 3 minutes), `click`
  failed after 5 s, `mousemove` returned after about 5 s but did draw the cursor. Scroll
  with `eval` (`scrollBy`), click with `eval "el => el.click()"`.
- `press` returns at once and delivers trusted key events; `type` is the next item.
- `type` drops ASCII characters (key events) but keeps CJK text (insertText). Focus the field
  in the page, clear it with a DOM Range selection plus Backspace, then in `run-code` call
  `page.keyboard.insertText(text)`.
- `setInputFiles` times out; build a `File` with `DataTransfer` inside the page, assign it to
  the input's `files`, and dispatch `change`.
- Pages that pause work when hidden (lazy loading, security prompts, rendering) can be nudged by
  overriding `document.visibilityState`/`hidden` and dispatching `visibilitychange` and
  `pageshow`; redo it after every reload, and report that it was forced. Skip it when the tab is
  really visible: the override is an own property on `document` that a page can find. Some infinite
  scrolls ignore this; prefer a search or list URL whose first screen holds what you need.
- On sites with bot detection these DOM-level actions are still paced like a person's, and
  the visibility override is for ordinary content pages only: never on a captcha, login or
  verification page, which goes to the user.
- The `run-code` sandbox has no `setTimeout`; wait with `page.waitForTimeout(ms)`.
- Extension mode refuses `newCDPSession` (`Target.attachToBrowserTarget: Not allowed`).

## Clean up

`close` in extension mode only disconnects; the tabs stay open in the user's Chrome. So:

1. `tab-list`, then `tab-close` each of this session's tabs from the highest index down.
2. `playwright-cli -s=<task> close`. Closing the last tab already ends the session, so a
   "not open" reply here is fine.
3. Never `close-all` or `kill-all`: they also end other tasks' sessions.
