# harness-skills

Small, reusable skills for local AI agents.

## What This Repo Is

This repository stores agent skills as self-contained directories.
Each skill should include its own `SKILL.md`, scripts, and any agent-facing metadata it needs.

## What Is Here

- `link-skills-to-agents`: symlinks every local skill into one or more external skill directories and cleans stale repo-managed links.
- `validate-skills`: checks every top-level `SKILL.md` frontmatter block for parseable YAML and required metadata.

## How To Use

Link all skills into the default local skill directories:

```bash
./link-skills-to-agents
```

By default this syncs to:

- `~/.claude/skills` — Claude Code
- `~/.agents/skills` — Codex and Command Code, which both read it

Or choose one or more custom destinations:

```bash
./link-skills-to-agents /path/to/agents/skills /path/to/other/skills
```

## Repository Convention

- One top-level directory = one skill.
- A directory is treated as a skill only if it contains `SKILL.md`.
- A skill restricted to one harness declares `harnesses: [claude-code]` (or `codex` / `command-code`) in its frontmatter; the linker then links it only where that harness reads skills and cleans it out of the others. Codex and Command Code share `~/.agents/skills`, so a skill restricted to either is visible to both.
- Skill-specific usage belongs inside that skill directory, not in this root README.
- Run `./validate-skills` after adding or editing skills.
