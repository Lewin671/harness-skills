# Review Triage

Use this reference to merge independent review outputs into issue groups.

## Shared-problem heuristic

Count findings as the same underlying problem when they overlap on the defect, not necessarily on the wording.

Do not accept a finding on overlap alone. Shared reviewer agreement raises confidence, but at least one concrete anchor is still required, such as a spec mismatch, failing verification, reproducible manual behavior, direct code-path evidence confirmed by the main agent, a broken rendered artifact, or a prompt/config behavior the main agent can verify.

Typical matches:

1. Two reviewers say the same branch can throw or return the wrong value.
2. One reviewer flags missing cleanup and another flags the resulting leak or duplicate listener.
3. Two reviewers identify the same missing test coverage for the same failure mode.
4. Two reviewers describe the same prompt or config failure with different sample inputs.

Merge duplicate missing-test comments into the underlying behavior defect when they cover the same failure mode.
Do not merge findings only because they touch the same file. Distinct defects in one file stay separate.

## Severity heuristic

Escalate even a single-reviewer finding when it is concrete and high impact:

1. User-visible breakage in the main flow.
2. Incorrect persistence, export, destructive behavior, or invalid config.
3. Security, permission, or privacy mistakes.
4. Failing checks tied to the change.
5. Prompt or operator flows that clearly fail the stated acceptance target.

Leave low-confidence speculation out of the next iteration unless another reviewer independently reinforces it.

Use severity labels this way:

1. `blocking`: must be fixed, disproven, or downgraded before the loop can stop.
2. `major`: should enter the next fix loop unless the main agent explicitly downgrades it with rationale.
3. `minor`: keep as a non-blocking note unless it is nearly free and clearly safe to fold into another fix.

## Aggregation output

Summarize reviewer feedback in three buckets:

1. Accepted blocking issues.
2. Accepted major issues.
3. Non-blocking notes.

Feed only the accepted issues back into the next coding pass.

For each accepted issue group, record:

1. Owner.
2. Severity.
3. Evidence.
4. Required verification.

## Non-convergence signs

Treat the loop as drifting if any of these happen:

1. The same accepted issue survives two iterations.
2. Reviewers keep raising new concerns because the ownership boundary is too large.
3. Verification results conflict across owners.
4. Review output becomes broad and speculative instead of anchored.

When that happens, tighten the brief, shrink the boundary, rotate the owner or reviewer, or fall back to a serialized single-owner repair for that area.

## Loop checklist

For each iteration:

1. Freeze the accepted issue list for that loop.
2. Send narrowed fix briefs rather than raw reviewer output.
3. Re-run the verification tied to the changed boundary.
4. Refresh independent review on the updated result.
5. Re-baseline the issue list before deciding on another loop.
6. If verification reports conflict, rerun the main-agent check or treat the disagreement as blocking until resolved.

Stop when no accepted `blocking` issue groups remain, no accepted `major` issue groups remain unless explicitly downgraded with rationale, no singleton finding is severe enough to promote, and required verification has passed for each changed boundary. If a planned automated check is infeasible, replace it with an explicit manual verification note for that boundary and record the limitation.
