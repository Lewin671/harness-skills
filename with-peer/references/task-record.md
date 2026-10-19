# Task Record

A short durable record for one with-peer task, kept **outside** the
reviewed repository, with its path given in the conversation. Update it
after each decision, peer call and fix, and copy each successful peer
report beside it before its temporary file disappears.

```markdown
# <task>
Requirements: <user's words> · Base: <sha> · Paths: <task paths, new files included>
Initial position: <approach · reason · uncertainty>
Design: <chosen approach> · Open objections: <none | list>
Budgets: review <used>/<limit> · design follow-ups <used>/2

## Calls
| # | Mode | Scope | Label | Exit | Outcome | Report | Reviewed state |

## Findings
| ID | Pri | Location | Disposition + evidence | Fix | Verified by |
```

- **Outcome:** succeeded, failed or cancelled.
- **Reviewed state:** the commit SHA when the reviewed change was
  committed and the task paths were clean; otherwise "uncommitted" plus
  the wrapper's `snapshot:` or `identity:` value when printed.
- Finding IDs (F1, F2, …) stay stable across rounds.

## Recovery

After an interruption, read the record and compare the task code with the
last reviewed state. Keep spent budgets and completed dispositions; do not
repeat completed calls. Any change since then needs verification at its
impact scope — if coverage cannot be established, mark it unverified.
