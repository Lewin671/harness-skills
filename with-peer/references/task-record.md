# Task Record

The durable record with-peer keeps for one task. Keep it in a
task-owned location **outside** the reviewed repository, give its path
in the conversation, and update it after each decision, invocation and
fix.

## Fields

- Original requirements, task scope, design decision and unresolved
  objections.
- Each peer call's provider, mode, scope, model, independence label, result/log
  paths, code identity, outcome, and the exact consult `resume:`
  command when available.
- Stable finding IDs, priority, location, evidence, disposition, fix
  identity and verification status.
- Review attempts used/limit (default five), design follow-up attempts
  used/limit (two), and remaining blockers.

Preserve full successful answers and reports beside the record before
their original temporary files disappear. Keep the record and the
design discussion out of independent review prompts.

## Code identity

Scope names alone do not identify reviewed bytes. Record the base commit
(`HEAD` before the task's first change) and the task's paths at the start.
Use commit IDs for committed code; otherwise fingerprint the task's
committed, staged and working changes, untracked files included, the same
way every time. The working stream stages the tree into a throwaway index,
so git itself records untracked files, symlinks and deletions; the real
index is untouched. Run it from the repository root; if any git command
prints an error, the fingerprint is invalid:

```bash
{ echo committed; git diff --binary <base> HEAD -- <task paths>
  echo index;     git diff --cached --binary <base> -- <task paths>
  echo working;   idx=$(mktemp); cp "$(git rev-parse --git-path index)" "$idx"
  GIT_INDEX_FILE=$idx git add -A &&
    GIT_INDEX_FILE=$idx git diff --cached --binary <base> -- <task paths>
  rm -f "$idx"
} | shasum -a 256
```

Equal fingerprints mean the task code, as git sees it, is unchanged since
the identity was taken. Like the reviews, it ignores ignored files, and it
sees content after git's own normalization and filters and honours
`assume-unchanged`/`skip-worktree` bits. The wrapper's `identity:` and
`snapshot:` values are computed differently; never compare them with this
one.

## Template

```markdown
# <task>
Requirements: <user's words> · Base: <sha> · Paths: <list>
Design: <chosen approach> · Open objections: <none | list>
Budgets: review <used>/<limit> · design follow-ups <used>/2

## Calls
| # | Mode | Scope | Model | Label | Exit | Result | Code identity |

## Findings
| ID | Pri | Location | Disposition + evidence | Fix identity | Verified by |
```

The host assigns finding IDs (F1, F2, …) and keeps them across rounds.

## Recovery

On recovery, read the record and compare current task code with the
last verified identity. Retain spent attempts and invalidate
verification for any new changes; do not silently restart the budget
or repeat completed calls.
