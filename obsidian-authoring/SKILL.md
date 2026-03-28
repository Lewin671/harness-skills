---
name: obsidian-authoring
description: Use this skill when the task requires creating or refining Obsidian Markdown notes or Canvas files using vault-specific authoring rules, note structure conventions, and layout heuristics. Use alongside obsidian-cli when the result should be applied inside a vault through the Obsidian CLI.
---

# Obsidian Authoring

Use this skill when the user wants better content quality for Obsidian notes or canvases, not just correct file operations.

## Scope

This skill defines what to create and how it should be structured.

- Use it for Markdown note structure, frontmatter expectations, link strategy, section design, and Canvas layout choices.
- Use `obsidian-cli` for vault targeting, command discovery, safe writes, and Obsidian-aware file operations.
- Keep this skill additive. As vault-specific conventions become clearer, extend the rule set instead of replacing the core workflow wholesale.

## Default workflow

1. Identify the target artifact: Markdown note, Canvas, or both.
2. Infer the note type or board type before writing. If the type is unclear, choose the simplest structure that preserves future editing.
3. Organize content so that headings, links, metadata, and visual grouping are easy to scan.
4. Keep the first pass structured and complete rather than stylistically ornate.
5. When writing into a vault, pair this skill with `obsidian-cli`.

## Maintenance rule

This skill is expected to grow over time.

- Preserve stable global defaults in `SKILL.md`.
- Add vault-specific conventions in clearly named sections so later rules can be appended without disturbing existing behavior.
- When a new rule applies only to Markdown or only to Canvas, keep it in that format-specific section rather than mixing concerns.
- If the rule set becomes long, split examples, note-type templates, or layout patterns into reference files and keep `SKILL.md` focused on selection and workflow.

## Markdown rules

Apply these defaults unless the user gives a conflicting vault convention.

- Every Markdown note must include its required properties. Do not leave expected properties blank or omitted.
- If the vault's exact property schema is unknown, infer the minimal required set from nearby notes, templates, or user instructions before writing.
- Prefer explicit frontmatter properties over burying key metadata in body text.
- Start with a clear title and a short opening summary when the note is intended for later retrieval.
- Use headings to separate concerns cleanly. Avoid long undifferentiated blocks of text.
- Use wikilinks deliberately. Link to concepts, projects, people, and source notes that are likely to matter again.
- Keep lists concise and scannable. Convert dense raw material into sections, bullets, tables, or short paragraphs as needed.
- Preserve atomicity where possible: one note should usually have one clear purpose.

Property rule:

- Treat missing required properties as a quality failure, not a cosmetic issue.
- If a value is genuinely unknown, use the vault's known placeholder convention or mark the uncertainty explicitly instead of silently skipping the property.

## Canvas rules

Use these defaults when creating or refining Obsidian Canvas content.

- Make the board readable at a glance before making it visually rich.
- Group related ideas spatially. A board should reveal structure through proximity, alignment, and containment.
- Prefer a small number of clear node types over many decorative variations.
- Use short node text. Split overloaded nodes instead of turning one card into a paragraph dump.
- Lay out flows in a consistent direction unless there is a strong reason not to.
- Use groups to indicate boundaries such as stages, systems, themes, or decision areas.
- Use edges to show meaningful relationships, not merely visual adjacency.
- Avoid crossing lines and clutter when a simpler arrangement would communicate the structure better.

## Quality bar

Before finishing, check:

- Are all required Markdown properties filled?
- Is the note or board easy to scan?
- Does the structure match the note type or problem shape?
- Are links or relationships explicit where they should be?
- Has complexity been reduced rather than merely reformatted?
