# Review Triage

Use this reference to merge independent review outputs into issue groups.

## Shared-problem heuristic

Count findings as the same underlying problem when they overlap on the defect, not necessarily on the wording.

Typical matches:

1. Two reviewers say the same branch can throw or return the wrong value.
2. One reviewer flags missing cleanup and another flags the resulting leak or duplicate listener.
3. Two reviewers identify the same missing test coverage for the same failure mode.

Merge duplicate missing-test comments into the underlying behavior defect when they cover the same failure mode.
Do not merge findings only because they touch the same file. Distinct defects in one file stay separate.

## Severity heuristic

Escalate even a single-reviewer finding when it is concrete and high impact:

1. User-visible breakage in the main flow.
2. Incorrect persistence, export, or destructive behavior.
3. Security, permission, or privacy mistakes.
4. Failing tests tied to the change.

Leave low-confidence speculation out of the next iteration unless another reviewer independently reinforces it.

## Aggregation output

Summarize reviewer feedback in three buckets:

1. Accepted shared issues.
2. Accepted severe singleton issues.
3. Non-blocking singleton notes.

Feed only the accepted issues back into the next coding pass.

For each accepted issue group, record:

1. Owner.
2. Severity.
3. Evidence.
4. Required verification.

## Loop checklist

For each iteration:

1. Freeze the accepted issue list for that loop.
2. Send narrowed fix briefs rather than raw reviewer output.
3. Re-run the verification tied to the changed boundary.
4. Refresh independent review on the updated result.
5. Re-baseline the issue list before deciding on another loop.
6. If verification reports conflict, rerun the main-agent check or treat the disagreement as blocking until resolved.

Stop when no accepted issue groups remain, no singleton finding is severe enough to block completion, and relevant verification has passed or any unrun checks are called out explicitly.
