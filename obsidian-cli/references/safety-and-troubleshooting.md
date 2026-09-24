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
- To undo a bad `create overwrite` or append, list local File Recovery versions with `history path=...`, compare with `diff path=... from=<n> to=<n>`, and restore with `history:restore path=... version=<n>`.
- `move` and `rename` can update internal links, but that depends on the vault setting for automatic internal link updates.
- `property:set` is safer than handwritten frontmatter edits when the user wants typed properties.
- `task`, `daily:append`, `append`, and `prepend` are mutating commands even if they look lightweight.
- `.canvas` files are not Markdown. They must remain valid JSON Canvas documents after every write.

Silent behaviors that change what gets written:

- `content=` always turns a literal `\n` into a newline and `\t` into a tab (`create`, `append`, `prepend`, `daily:append`, `daily:prepend`). LaTeX such as `\theta` or `\nabla`, code samples containing `\n`, and JSON-escaped canvas strings are corrupted. When content must keep literal backslashes, write it with `obsidian eval`, which does no conversion: call `app.vault.modify(app.vault.getFileByPath("path.md"), text)` with `text` as a `String.raw` template literal (a plain JS string literal would reinterpret `\t` itself), or edit the file directly.
- `create` without `overwrite` never fails on an existing file: it creates `Name 1.md` instead and prints that path. Check the printed path.
- `vault=` anywhere but first is ignored and the default vault is used. Unknown or misspelled parameters (e.g. `overwirte`) are also ignored without an error.

For `.canvas` writes, use these guardrails:

- Prefer exact `path=` and overwrite the whole file deliberately rather than attempting partial text surgery through append/prepend.
- Keep node text single-line: an escaped `\n` inside a JSON string becomes a raw newline through `content=` and invalidates the file. For multiline node text, write through `eval` instead.
- Validate the serialized file before declaring success.
- Reopen the canvas in Obsidian after writing.

Suggested verification flow:

```bash
obsidian read path="Board.canvas" | jq -e .
obsidian open path="Board.canvas"
obsidian dev:errors
```

If `jq` is unavailable, use another JSON validator or reduce the canvas to a simpler known-good structure and retry.

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

1. Is the CLI installed and on PATH, and is the app running with the vault open? `Vault not found.` on every command means no vault window is open — see `setup-and-discovery.md`.

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

6. If the target is a `.canvas`, rerun the canvas verification flow above. If it opens blank or fails, reproduce with a minimal two-node canvas and add complexity incrementally.

## Platform notes from the official docs

- macOS registration creates the symlink `/usr/local/bin/obsidian` to the CLI binary inside `Obsidian.app` (needs admin rights).
- Linux registration copies the binary to `~/.local/bin/obsidian`; make sure that directory is on PATH. AppImage, Snap, and Flatpak installs may need extra checks.
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
