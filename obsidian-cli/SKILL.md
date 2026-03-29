---
name: obsidian-cli
description: Use this skill when the task is to read, search, create, update, or inspect content in an Obsidian vault through the official Obsidian CLI instead of raw file edits. Typical triggers include opening or updating daily notes, searching the vault, reading or writing a note by path, managing tasks, tags, properties, backlinks, templates, or checking plugins, themes, and developer commands.
---

# Obsidian CLI

Use this skill when the user wants work done inside an Obsidian vault through the official CLI.

## Start here

1. Confirm the installed CLI and live command surface:

```bash
obsidian version
obsidian help
```

2. If the task depends on a specific command, inspect it directly:

```bash
obsidian help <command>
```

Treat local `obsidian help` output as the source of truth for the installed build. The online docs can lead or lag the local binary.

## Default workflow

- Prefer read-only discovery first: `vault`, `vaults`, `files`, `read`, `search`, `tags`, `tasks`, `properties`.
- If the task will modify vault content, confirm the target vault and target file path before writing.
- Prefer `path=<exact/path.md>` when name collisions are possible. Use `file=<name>` only when wikilink-style resolution is safe.
- Treat `.canvas` files as structured JSON Canvas data, not ordinary note text. When creating or editing a canvas, use exact `path=`, preserve valid JSON escaping, and verify the result after writing.
- Treat Excalidraw as plugin-owned content, not generic Markdown. Prefer the Excalidraw plugin API through `obsidian eval` when the user wants a drawing created or updated.
- Avoid relying on the active file in scripts unless that is explicitly intended.
- When the current working directory is not the vault root, pass `vault=<name>` as the first argument.

## Which reference to read

- For installation state, vault targeting, parameter rules, and command discovery, read [`references/setup-and-discovery.md`](references/setup-and-discovery.md).
- For common note operations, search/reporting, metadata, tasks, templates, and automation patterns, read [`references/core-workflows.md`](references/core-workflows.md).
- For risky commands, write safety, link-update behavior, and platform troubleshooting, read [`references/safety-and-troubleshooting.md`](references/safety-and-troubleshooting.md).
- For Obsidian Canvas work, read both [`references/core-workflows.md`](references/core-workflows.md) and [`references/safety-and-troubleshooting.md`](references/safety-and-troubleshooting.md) before writing.
- For Excalidraw work, inspect the live plugin surface with `obsidian plugins`, `obsidian eval`, and `app.plugins.plugins["obsidian-excalidraw-plugin"]` before attempting writes.

## Excalidraw workflow

- First confirm the plugin is installed and enabled: `obsidian plugins filter=community format=json`.
- Discover the live API instead of assuming method names. Start with:

```bash
obsidian eval code='Object.keys(app.plugins.plugins).filter(k=>k.includes("excalidraw"))'
obsidian eval code='const p=app.plugins.plugins["obsidian-excalidraw-plugin"]; Object.keys(p)'
obsidian eval code='const ea=app.plugins.plugins["obsidian-excalidraw-plugin"]?.ea; Reflect.ownKeys(Object.getPrototypeOf(ea))'
```

- Prefer plugin API methods such as `ea.reset()`, `ea.addText()`, `ea.addArrow()`, `ea.addRect()`, and `ea.create()` over hand-authoring `.excalidraw.md` internals.
- Create the drawing as a separate `.excalidraw.md` file, then embed it into the target note with a wikilink embed such as `![[diagram.excalidraw.md]]`.
- When using `ea.create()`, pass explicit `filename`, `foldername`, and `silent: true` so the path is deterministic and scripts stay non-interactive.
- Reopen the generated file with `obsidian read path=...` after writing to confirm the file was created and contains Excalidraw data.

## Working style

- Use the CLI for Obsidian-aware operations before falling back to direct file edits.
- Keep commands explicit and composable so the user can rerun them outside the agent if needed.
- For `.canvas` writes, prefer a minimal valid JSON Canvas structure first, then reopen and inspect before declaring success.
- For Excalidraw, treat `obsidian eval` plus the plugin API as the primary write path. Hand-edit the saved Markdown only as a last resort.
- For volatile command areas such as developer commands, plugin management, or newer workspace/base features, re-check `obsidian help` immediately before use.
