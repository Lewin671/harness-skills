# harness-skills

Small, reusable skills for local AI agents.

## What This Repo Is

This repository stores agent skills as self-contained directories.
Each skill should include its own `SKILL.md`, scripts, and any agent-facing metadata it needs.

## What Is Here

- `agent-browser/`: a browser automation skill that defaults to one isolated session per origin and optional login-state reuse through `AGENT_BROWSER_STATE_FILE`.
- `link-skills-to-agents`: symlinks every local skill into one or more external skill directories and cleans stale repo-managed links.

## How To Use

Link all skills into the default local skill directories:

```bash
./link-skills-to-agents
```

By default this syncs to:

- `~/.agents/skills`
- `~/.codex/skills`
- `~/.kiro/skills`

Or choose one or more custom destinations:

```bash
./link-skills-to-agents /path/to/agents/skills /path/to/other/skills
```

## Repository Convention

- One top-level directory = one skill.
- A directory is treated as a skill only if it contains `SKILL.md`.
- Skill-specific usage belongs inside that skill directory, not in this root README.
