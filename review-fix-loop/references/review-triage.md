# Review Triage

Use this reference when review outputs overlap, conflict, or generate
too much noise.

## Accept Only Anchored Findings

Accept a finding only when the main agent can verify one concrete
anchor, such as:

- spec mismatch;
- failing command or check;
- reproducible manual behavior;
- direct code-path evidence;
- broken rendered or produced artifact;
- prompt, config, or skill behavior failure.

For docs, prompts, configs, and skills, treat these as concrete anchors
too:

- contradictory instructions;
- a missing decision rule that forces guessing;
- an impossible or unverifiable step;
- a stop condition that cannot actually be checked.

Do not accept a finding because it sounds plausible or because multiple
reviewers repeated it without an anchor.

## Merge By Underlying Defect

Count findings as one issue when they describe the same underlying
defect, even if they cite different lines or use different wording.

Do not merge findings only because they touch the same file. Distinct
defects stay separate.

Merge missing-test comments into the underlying behavior defect when
they describe the same failure mode.

## Severity Rules

Promote even a singleton finding when it is concrete and high impact:

1. Broken main-flow behavior.
2. Data loss, destructive behavior, or persistence mistakes.
3. Security, permission, or privacy mistakes.
4. Failing checks tied to the change.
5. Docs, prompts, configs, or skills that would mislead the operator or
   break expected use.

Use severity labels this way:

- `blocking`: must be fixed, disproved, or downgraded before closing.
- `major`: should enter the next fix loop unless explicitly downgraded.
- `minor`: keep as a note unless it is nearly free and clearly safe.

## Singleton Promotion Rule

A singleton candidate is a concrete finding reported by only one
reviewer.

Promote it into an accepted `blocking` or `major` issue group when the
severity rules above apply. Before closeout, every concrete singleton
`blocking` or `major` candidate must be accepted, disproved, or
downgraded; it cannot disappear just because no second reviewer repeated
it.

## Disposition Rules

Use these dispositions:

- `open`: accepted and still needs work.
- `fixed`: closure evidence plus rerun verification support the fix.
- `disproved`: the claim was investigated and the evidence does not
  hold.
- `downgraded`: the issue is real but no longer blocks completion; keep
  the rationale and residual risk explicit.

Do not mark an issue `fixed` just because a patch exists.
Do not mark an issue `disproved` just because a reviewer stopped
mentioning it.

## Output Shape

Summarize review output in three buckets:

1. Accepted blocking issues.
2. Accepted major issues.
3. Non-blocking notes.

For each accepted issue group, record:

- stable issue id such as `IG-001`;
- owner or primary boundary;
- severity;
- disposition;
- evidence;
- closure evidence when applicable;
- required verification.

Reuse the same issue id across loops unless it is genuinely a different
defect.

## Loop Checklist

For each iteration:

1. Freeze the accepted issue list for that loop.
2. Send narrowed fix briefs instead of raw reviewer output.
3. Confirm the delegated fix or review pass satisfied its required
   output contract before counting it as complete.
4. Re-run verification for the changed boundary.
5. Refresh independent review on the updated result.
6. Apply the triage rules above to any new findings before re-baselining
   issue ids.
7. Re-baseline issue ids by disposition before deciding on another
   loop.
8. If a delegated pass exits early, times out, or omits an explicit
   completion statement for the declared scope, mark it incomplete,
   retry up to two more times (three total attempts), then replace
   with a fresh subagent (prefer a different model). Do not count
   any attempt toward closure until a complete pass is recorded.
9. Treat the loop as stalled when the same accepted issue survives two
   loops.
10. If verification reports conflict, rerun the main-agent check or keep
   the issue open until resolved.
11. If independent delegated review cannot be maintained, stop and
   report that this skill is not applicable.
12. If delegated repair still leaves a `blocking` or `major` issue open,
   stop and report the work as blocked.
