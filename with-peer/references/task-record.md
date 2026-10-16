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

Scope names alone do not identify reviewed bytes. Use commit IDs for
committed code; for working changes retain a base ID and a content
fingerprint covering all task files, including untracked ones.

## Recovery

On recovery, read the record and compare current task code with the
last verified identity. Retain spent attempts and invalidate
verification for any new changes; do not silently restart the budget
or repeat completed calls.
