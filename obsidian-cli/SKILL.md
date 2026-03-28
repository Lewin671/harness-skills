---
name: obsidian-cli
description: Use this skill when a task should read, search, create, update, organize, or inspect an Obsidian vault through the official Obsidian CLI instead of editing Markdown files directly. This skill is especially relevant for daily notes, templates, properties, tasks, backlinks, vault search, plugin/theme management, and Obsidian developer commands.
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
- Avoid relying on the active file in scripts unless that is explicitly intended.
- When the current working directory is not the vault root, pass `vault=<name>` as the first argument.

## Which reference to read

- For installation state, vault targeting, parameter rules, and command discovery, read [`references/setup-and-discovery.md`](references/setup-and-discovery.md).
- For common note operations, search/reporting, metadata, tasks, templates, and automation patterns, read [`references/core-workflows.md`](references/core-workflows.md).
- For risky commands, write safety, link-update behavior, and platform troubleshooting, read [`references/safety-and-troubleshooting.md`](references/safety-and-troubleshooting.md).
- For Obsidian Canvas work, read both [`references/core-workflows.md`](references/core-workflows.md) and [`references/safety-and-troubleshooting.md`](references/safety-and-troubleshooting.md) before writing.

## Working style

- Use the CLI for Obsidian-aware operations before falling back to direct file edits.
- Keep commands explicit and composable so the user can rerun them outside the agent if needed.
- For `.canvas` writes, prefer a minimal valid JSON Canvas structure first, then reopen and inspect before declaring success.
- For volatile command areas such as developer commands, plugin management, or newer workspace/base features, re-check `obsidian help` immediately before use.
