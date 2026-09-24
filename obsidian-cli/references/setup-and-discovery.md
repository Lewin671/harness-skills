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

- The Obsidian app must already be running; the CLI does not launch it. Otherwise it reports that it is unable to find Obsidian.
- The app also needs an open window for the target vault. When none is open and no vault is resolved from the working directory or `vault=`, every command — even `help` and `version` — prints `Vault not found.` Pass `vault=<name>` (which opens that vault's window) or open the vault in the app. The first command sent to a freshly opened window can fail once with `Command "..." not found.`; retry it.
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

Vault targeting follows these rules from the official docs and current local help:

- If the current working directory is a vault folder, that vault is used by default.
- Otherwise, the most recently focused open vault window is used.
- `vault=<name>` must be the first argument before the command when you want to force the target vault. Anywhere else it is silently ignored and the default vault is used.

Examples:

```bash
obsidian vault="Work Vault" search query="roadmap"
obsidian vault=Notes daily
```

`vault=` also accepts a vault ID — the keys of `vaults` in Obsidian's `obsidian.json` (`vaults verbose` does not show them). Names match the vault folder name case-insensitively.

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
- Use `\n` for multiline content and `\t` for tabs. The conversion is unconditional, so literal backslashes cannot survive `content=` — see `safety-and-troubleshooting.md`.
- `--copy` copies the command output to the clipboard. It is in the official docs, not in `obsidian help`; verified on 1.13.7.

Examples:

```bash
obsidian create name="Meeting Note" content="# Agenda\n\n- topic 1" open
obsidian daily:path --copy
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
