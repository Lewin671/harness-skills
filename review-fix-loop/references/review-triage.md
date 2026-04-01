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
3. Re-run verification for the changed boundary.
4. Refresh independent review on the updated result.
5. Re-baseline issue ids by disposition before deciding on another
   loop.
6. Treat the loop as stalled when the same accepted issue survives two
   loops.
7. If verification reports conflict, rerun the main-agent check or keep
   the issue open until resolved.
8. If independent delegated review cannot be maintained, stop and
   report that this skill is not applicable.
9. If delegated repair still leaves a `blocking` or `major` issue open,
   stop and report the work as blocked.
