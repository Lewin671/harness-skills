# Core Workflows

This file groups the most useful command families for day-to-day vault work.

## 1. Inspect and search

Use these when the task is exploratory or reporting-oriented.

```bash
obsidian read path="Inbox/Capture.md"
obsidian file path="Projects/Plan.md"
obsidian files folder="Projects"
obsidian folders total
obsidian outline path="Projects/Plan.md" format=json
obsidian search query="meeting notes"
obsidian search:context query="decision log" limit=20
obsidian backlinks path="Projects/Plan.md" counts format=json
obsidian links path="Projects/Plan.md"
obsidian unresolved counts verbose format=json
obsidian orphans total
obsidian deadends total
```

Useful pattern:

- Start with `search` or `search:context`.
- Use `read`, `outline`, `backlinks`, and `links` to understand note structure and graph context.

## 2. Create and update notes

Use these when the CLI should be the write path instead of direct Markdown edits.

```bash
obsidian create path="Inbox/New Note.md" content="# Title\n\nBody"
obsidian create name="Trip Plan" template=Travel open
obsidian append path="Inbox/Capture.md" content="- [ ] Follow up"
obsidian prepend path="Projects/Plan.md" content="## Update\n"
obsidian rename path="Projects/Old Name.md" name="New Name"
obsidian move path="Projects/Plan.md" to="Archive/Plan.md"
obsidian delete path="Scratch/Old.md"
```

Notes:

- `create` can combine `template`, `open`, and `newtab`.
- `move` and `rename` are preferable to raw file-system moves when you want Obsidian-aware behavior.
- `delete` uses trash by default unless `permanent` is passed.

## 3. Daily notes and fast capture

High-value commands for lightweight automation:

```bash
obsidian daily
obsidian daily:path
obsidian daily:read
obsidian daily:append content="- [ ] Draft proposal"
obsidian daily:prepend content="# Focus\n"
obsidian tasks daily
```

These are useful for:

- daily capture
- journaling automation
- collecting inbox tasks without manually opening the vault

## 4. Properties, tags, aliases, and tasks

Use the metadata commands when the user wants structured edits rather than raw frontmatter manipulation.

```bash
obsidian properties counts format=json
obsidian property:read name=status path="Projects/Plan.md"
obsidian property:set name=status value=active type=text path="Projects/Plan.md"
obsidian property:set name=priority value=2 type=number path="Projects/Plan.md"
obsidian property:remove name=obsolete path="Projects/Plan.md"
obsidian tags counts format=json
obsidian aliases verbose
obsidian tasks path="Projects/Plan.md" verbose format=json
obsidian task ref="Projects/Plan.md:14" done
```

Use these instead of manual YAML edits when possible.

## 5. Templates, commands, and Bases

These commands help when the user wants Obsidian-native automation.

```bash
obsidian templates
obsidian template:read name=Travel resolve title="Paris"
# Inserts into the active file only. Do not use in unattended scripts unless the active file is intentional.
obsidian template:insert name=Standup
obsidian commands filter=workspace
# Pick an actual ID from `obsidian commands ...`, then run it:
obsidian command id="workspace:new-tab"
obsidian bases
# base:views operates on the current/active base file.
obsidian base:views
obsidian base:query path="CRM.base" view="Open Deals" format=json
obsidian base:create path="CRM.base" view="Open Deals" name="Acme"
```

Guidance:

- Use `commands` first when you need to trigger an existing Obsidian command by ID.
- Treat `template:insert` and `base:views` as active-context commands unless local help shows explicit targeting parameters.
- Re-check `obsidian help` for Base and workspace-related commands because these areas are changing quickly.

## 6. Plugins, themes, snippets, and app state

Useful for environment management:

```bash
obsidian plugins filter=community versions format=json
obsidian plugins:enabled filter=core
obsidian plugin:install id=templater-obsidian enable
obsidian plugin:disable id=calendar filter=community
obsidian themes versions
obsidian theme:set name="Minimal"
obsidian snippets
obsidian snippet:enable name="wide-layout"
obsidian reload
obsidian restart
```

Prefer these commands when the user explicitly wants Obsidian configuration changes, not just file edits.

## 7. Developer workflows

Use only when the user is doing plugin/theme development or explicitly asks for developer tooling.

```bash
obsidian devtools
obsidian plugin:reload id=my-plugin
obsidian dev:screenshot path=screenshot.png
obsidian dev:errors
obsidian dev:console limit=100
obsidian dev:dom selector=".workspace-tabs" total
obsidian dev:css selector=".workspace-tabs" prop=display
obsidian eval code="app.vault.getFiles().length"
```

Developer command guidance:

- Inspect live help before use.
- Prefer low-risk inspection commands before `eval`.
- Treat `eval` as executable code, not a query language.
