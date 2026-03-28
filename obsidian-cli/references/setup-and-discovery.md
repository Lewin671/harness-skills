# Setup And Discovery

This file covers the live-environment checks that should happen before using Obsidian CLI for real work.

## Baseline checks

Run these first:

```bash
obsidian version
obsidian help
obsidian vault
obsidian vaults verbose
```

What these checks tell you:

- `obsidian version` confirms the installed desktop/installer build.
- `obsidian help` exposes the actual command set on this machine.
- `obsidian vault` shows which vault will be targeted by default.
- `obsidian vaults verbose` shows known vaults and their paths.

## Installation model

According to the official docs, Obsidian CLI is part of the desktop installer and must be enabled from Obsidian settings. The CLI talks to the running Obsidian app rather than editing the vault as a standalone daemon.

Operational implications:

- Obsidian must be available locally.
- If Obsidian is not already open, the first CLI command may launch it.
- If the command is not found after registration, the shell PATH usually needs a refresh or manual fix.

## Command discovery rules

Do not hardcode the full command surface in your reasoning. The command list is evolving.

Use:

```bash
obsidian help
obsidian help search
obsidian help property:set
obsidian help plugin:reload
```

Use live help when:

- a command name may have changed
- a newer feature may or may not exist in the installed build
- you are about to use developer commands
- online docs and local behavior appear inconsistent

## Vault targeting

Vault targeting follows these rules from the official docs:

- If the current working directory is a vault folder, that vault is used by default.
- Otherwise, the active vault is used by default.
- `vault=<name>` or `vault=<id>` must be the first argument before the command when you want to force the target vault.

Examples:

```bash
obsidian vault="Work Vault" search query="roadmap"
obsidian vault=Notes daily
```

## File targeting

Many commands accept both `file=` and `path=`.

- `file=<name>` uses Obsidian's name resolution, similar to wikilinks.
- `path=<path>` requires the exact vault-relative path.

Prefer `path=` when:

- duplicate note names are possible
- the task must be deterministic
- automation is moving, renaming, or mutating files

## Parameter conventions

Common CLI syntax rules:

- Parameters use `name=value`.
- Boolean flags are passed without a value, for example `open`, `overwrite`, `inline`.
- Quote values with spaces: `name="Project Plan"`.
- Use `\n` for multiline content and `\t` for tabs.
- The docs state that `--copy` can be added to commands to copy output to the clipboard.

Examples:

```bash
obsidian create name="Meeting Note" content="# Agenda\n\n- topic 1" open
obsidian search query="weekly review" --copy
```

## Good first read-only probes

Use these to understand a vault safely before making changes:

```bash
obsidian files total
obsidian folders
obsidian tags counts
obsidian tasks total
obsidian properties counts
obsidian search query="TODO"
obsidian search:context query="retro"
```

## Official source

Primary reference: <https://obsidian.md/help/cli>
