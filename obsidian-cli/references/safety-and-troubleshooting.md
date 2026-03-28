# Safety And Troubleshooting

This file covers the practical constraints and risk controls that matter when using Obsidian CLI in agent workflows.

## Safety defaults

Use these defaults unless the user explicitly wants something else:

- Prefer read-only discovery before mutation.
- Prefer `path=` over `file=` for deterministic writes.
- Avoid implicit "active file" behavior in automation.
- Use Obsidian-native commands for rename/move/property updates instead of raw Markdown edits when link integrity or metadata validity matters.

## Write-risk notes

Important command behaviors:

- `delete` sends notes to trash by default. `permanent` skips trash.
- `move` and `rename` can update internal links, but that depends on the vault setting for automatic internal link updates.
- `property:set` is safer than handwritten frontmatter edits when the user wants typed properties.
- `task`, `daily:append`, `append`, and `prepend` are mutating commands even if they look lightweight.

## Commands that deserve extra caution

Use extra review before running:

- `delete permanent`
- bulk rename or bulk move patterns
- plugin install/uninstall/enable/disable
- theme changes in a shared environment
- `eval`
- developer commands that inspect or modify the live app state

For risky mutations, first inspect:

```bash
obsidian vault
obsidian file path="..."
obsidian read path="..."
obsidian help <command>
```

## Troubleshooting flow

If a command fails, check in this order:

1. Is the CLI installed and on PATH?

```bash
obsidian version
which obsidian
```

2. Is the correct vault active or explicitly targeted?

```bash
obsidian vault
obsidian vaults verbose
```

3. Does the installed build support the command?

```bash
obsidian help
obsidian help <command>
```

4. Is the command using `file=` when it should use `path=`?

5. Does the vault/app state need a reload?

```bash
obsidian reload
```

## Platform notes from the official docs

- macOS registration updates `~/.zprofile` for the standard app binary path.
- Linux registration usually creates a symlink for `obsidian`; AppImage, Snap, and Flatpak installs may need extra PATH or symlink checks.
- Windows uses an installer-provided terminal redirector so the GUI app can communicate with stdin/stdout correctly.

When platform registration appears broken, consult the official CLI help page first:

<https://obsidian.md/help/cli>

## Documentation mismatch rule

If online docs and local CLI disagree, trust the local CLI for execution and mention the mismatch in your response. The safest pattern is:

```bash
obsidian version
obsidian help
obsidian help <command>
```
