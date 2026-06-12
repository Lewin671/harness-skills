# AGENTS.md

## Repo

- This repo stores local agent skills at the top level.
- A top-level directory counts as a skill only when it contains `SKILL.md`.
- Keep `SKILL.md` focused and reasonably short. It should usually stay within `2,000` words. If it gets longer, split it into layered docs and keep only the essential workflow in `SKILL.md`.
- Keep shared skills portable. In `SKILL.md` and related skill docs, do not hardcode machine-specific absolute paths; prefer repo-relative paths, script-relative paths, or documented environment variables.
- Harness-specific skills must declare their scope in frontmatter, e.g. `harnesses: [claude-code]` (known ids: `claude-code`, `codex`, `kiro`). `./link-skills-to-agents` links such skills only into matching harness directories and removes mismatched links; skills without `harnesses:` are shared everywhere. A "X ONLY" description must be backed by a matching `harnesses:` key — `./validate-skills` enforces this.
- Skill bodies must not contain `$1`-style dollar-number tokens; Claude Code substitutes them with invocation arguments at render time. Write costs as `5 USD`, not `$5`.
- `./link-skills-to-agents` links those skill directories into an external agents skills directory.
- Root docs should stay brief; detailed behavior belongs in the relevant skill directory.

## Default Flow

- After changing a skill, run `./validate-skills` and a brief self-review.
- If the result looks correct, commit and push directly without waiting for confirmation.

## Concurrent Work

- Multiple agents may run in this repo at the same time.
- Each commit should include only the files related to the current task.
- Do not include unrelated changes made by other agents in the same commit.
