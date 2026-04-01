# Review Triage

Use this reference when independent review outputs overlap, conflict, or keep
generating noise across loops.

## Shared-problem heuristic

Count findings as the same issue when they describe the same underlying defect,
even if the wording or cited lines differ.

Do not accept a finding on overlap alone. Shared reviewer agreement raises
confidence, but at least one concrete anchor is still required, such as:

- a spec mismatch;
- a failing command or check;
- reproducible manual behavior;
- direct code-path evidence the main agent can confirm;
- a broken rendered artifact or prompt/config behavior the main agent can
  reproduce.

Merge duplicate missing-test comments into the underlying behavior defect when
they cover the same failure mode.

Do not merge findings only because they touch the same file. Distinct defects in
one file stay separate.

## Severity heuristic

Escalate even a single-reviewer finding when it is concrete and high impact:

1. Broken main-flow behavior.
2. Incorrect persistence, export, or destructive behavior.
3. Security, permission, or privacy mistakes.
4. Failing checks tied to the change.
5. Incorrect docs, prompts, or configs that would mislead the operator or break
   expected usage.

Use severity labels this way:

1. `blocking`: must be fixed, disproven, or downgraded before the loop can stop.
2. `major`: should enter the next fix loop unless the main agent explicitly
   downgrades it with rationale.
3. `minor`: keep as a non-blocking note unless it is nearly free and clearly
   safe to fold into another fix.

## Aggregation output

Summarize reviewer feedback in three buckets:

1. Accepted blocking issues.
2. Accepted major issues.
3. Non-blocking notes.

For each accepted issue group, record a stable issue id, owner,
secondary affected boundaries when relevant, disposition, severity,
evidence, closure evidence when applicable, and required verification.
Reuse the same issue id across loops unless the main agent decides it is
a genuinely different defect. Feed only accepted open issues back into
the next coding pass.

## Loop checklist

For each iteration:

1. Freeze the accepted issue list for that loop.
2. Send narrowed fix briefs rather than raw reviewer output.
3. Re-run the verification tied to the changed boundary.
4. Refresh independent review on the updated result.
5. Re-baseline the issue list by disposition before deciding on another
   loop.
6. Carry accepted issue ids forward so stalled-loop detection survives
   wording changes.
7. If verification reports conflict, rerun the main-agent check or treat the
   disagreement as blocking until resolved.
8. If the same accepted issue survives two loops, treat the loop as stalled and
   change topology, ownership, or verification depth before continuing.
9. If the loop used serialized self-review instead of independent
   reviewers, record that limitation in the final status.
10. If serialized repair still leaves a blocking or major issue open,
    stop and report the work as blocked.
