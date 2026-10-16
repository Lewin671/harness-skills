# Task Record

The durable record with-peer keeps for one task. Keep it in a
task-owned location **outside** the reviewed repository, give its path
in the conversation, and update it after each decision, invocation and
fix.

## Fields

- Original requirements, task scope, design decision and unresolved
  objections.
- Each peer call's provider, mode, scope, model, independence label, result/log
  paths, code identity (review calls), outcome, and the exact consult `resume:`
  command when available.
- Stable finding IDs, priority, location, evidence, disposition, fix
  identity and verification status.
- Review attempts used/limit (default five), design follow-up attempts
  used/limit (two), and remaining blockers.

Preserve full successful answers and reports beside the record before
their original temporary files disappear.

## Code identity

Record the base commit (`HEAD` before the task's first change) at the
start, and keep the task's path list current, new files included.
Fingerprint the task's changes against the base (untracked files
included, real index untouched) from the repository root — if git
prints an error, the hash is invalid:

```bash
idx=$(mktemp); cp "$(git rev-parse --git-path index)" "$idx"
GIT_INDEX_FILE=$idx git add -A &&
  GIT_INDEX_FILE=$idx git diff --cached --binary <base> -- <task paths> | shasum -a 256
rm -f "$idx"
```

Take it right before each review call and once at the end.

The wrapper's `identity:` and `snapshot:` values are computed differently;
never compare them with this one.

## Template

```markdown
# <task>
Requirements: <user's words> · Base: <sha> · Paths: <list>
Design: <chosen approach> · Open objections: <none | list>
Budgets: review <used>/<limit> · design follow-ups <used>/2

## Calls
| # | Mode | Scope | Model | Label | Exit | Result | Code identity |
|---|---|---|---|---|---|---|---|

## Findings
| ID | Pri | Location | Disposition + evidence | Fix identity | Verified by |
|---|---|---|---|---|---|
```

The host assigns finding IDs (F1, F2, …) and keeps them across rounds.

## Recovery

On recovery, read the record and compare current task code with the
last verified identity. Retain spent attempts and invalidate
verification for any new changes; do not silently restart the budget
or repeat completed calls.
