# AGENTS.md

## Repo

- This repo stores local agent skills at the top level.
- A top-level directory counts as a skill only when it contains `SKILL.md`.
- `./link-skills-to-agents` links those skill directories into an external agents skills directory.
- Root docs should stay brief; detailed behavior belongs in the relevant skill directory.

## Default Flow

- After changing a skill, run the relevant validation and a brief self-review.
- If the result looks correct, commit and push directly without waiting for confirmation.

## Concurrent Work

- Multiple agents may run in this repo at the same time.
- Each commit should include only the files related to the current task.
- Do not include unrelated changes made by other agents in the same commit.
