# harness-skills

Small, reusable skills for local AI agents.

## What This Repo Is

This repository stores agent skills as self-contained directories.
Each skill should include its own `SKILL.md`, scripts, and any agent-facing metadata it needs.

## What Is Here

- `cdp-browser-launcher/`: a skill for launching a local Chromium-based browser with Chrome DevTools Protocol enabled.
- `link-skills-to-agents`: symlinks every local skill into an agents skill directory.

## How To Use

Link all skills into your local agents directory:

```bash
./link-skills-to-agents
```

Or choose a custom destination:

```bash
./link-skills-to-agents /path/to/agents/skills
```

## Repository Convention

- One top-level directory = one skill.
- A directory is treated as a skill only if it contains `SKILL.md`.
- Skill-specific usage belongs inside that skill directory, not in this root README.
