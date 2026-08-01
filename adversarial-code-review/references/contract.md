# The Falsification Contract

This file is **harness-neutral**. It defines what a finding must
contain, what refuting one requires, how evidence is graded, and what
the report must disclose. Nothing here depends on Claude Code, on
subagents, or on any orchestration primitive.

`SKILL.md` and [orchestration.md](./orchestration.md) describe how
Claude Code executes this contract with parallel subagents. Another
harness that cannot fan out can still follow the contract serially, or
hand it to a single external reviewer as evaluation criteria — but it
must then say so, because serial execution loses the independence that
separate contexts provide. Claiming the same procedure with weaker
independence is the one substitution this contract forbids.

## 1. Candidate Schema

A finder emits candidates, not findings. Nothing is a finding until
adjudication.

```
{
  candidate_id,
  file,                 # repo-relative path
  line,                 # 1-indexed, inside the reviewed patch
  title,
  lens,                 # which lens produced it
  origin,               # finder | region_probe
  proposed_severity,    # critical | major | minor — a proposal, not a verdict
  confidence,           # high | medium | low
  evidence_kind,        # present_code | omission
  evidence              # shape depends on evidence_kind, below
}
```

`candidate_id`, `lens` and `origin` are assigned by the orchestrator, not
emitted by the finder — a finder reports what it found, and identity and
provenance are the harness's job to track.

`origin` matters because of the second way a candidate can be born. A
probe aimed at a *high-risk region nobody flagged* — the channel whose
whole purpose is to catch what the lenses missed — must, when it
succeeds, emit a full candidate record in exactly this shape. It then
faces the same refutation and the same adjudicator as any other.

That promotion step is load-bearing, not bookkeeping. A recall channel
that can attack code but cannot produce a candidate can never report a
finding, and is decoration.

`proposed_severity` is deliberately named. Finders propose; the
adjudicator assigns final severity. A finder cannot buy stronger
verification by inflating a label.

### Evidence kinds

Two kinds, because defects come in two shapes. A contract that only
accepts the first shape silently discards the second — and the second
is where missing authorization, absent bounds checks, swallowed errors
and forgotten cache invalidation live.

```
present_code:
  anchor              # file:line inside the patch
  quoted_code         # the actual lines, verbatim
  observed_behavior   # what this code does that is wrong

omission:
  anchor              # file:line inside the patch that creates the
                      # obligation or fails to discharge it
  obligation          # what the code is required to do, and why
                      # (cite the convention, sibling call site, spec,
                      #  or invariant the obligation comes from)
  searched_scope      # where the missing logic was looked for —
                      # files, functions, middleware, decorators
  evidence_of_absence # what that search returned, concretely
```

An omission still needs a positive anchor. Missing authorization
anchors to the newly exposed route or the sensitive operation; a
missing bounds check anchors to the changed index arithmetic; a
missing invalidation anchors to the changed mutation. A candidate that
cannot name the changed line creating the obligation is out of scope
for a diff review — say so rather than reporting it.

A candidate with neither evidence kind fully populated is invalid
output and is dropped before verification, counted in the ledger.

## 2. Severity Rubric

Severity is about impact if the defect is real, never about the
reviewer's confidence that it is real. Confidence travels in its own
field.

- **critical** — authorization or authentication bypass; data loss or
  corruption; incorrect money, quantity or balance; deadlock, unbounded
  resource growth, or crash on a reachable path; silently wrong results
  in a primary flow; a secret or PII exposed.
- **major** — wrong behavior on a reachable non-primary path; an error
  swallowed or misreported; a backward-incompatible change to a public
  interface; a race that needs realistic but not adversarial load;
  stale reads from a missing invalidation; a retry or pagination defect
  that loses or duplicates work.
- **minor** — wrong only under contrived conditions; degraded
  diagnostics or observability; a maintainability defect with a
  concrete failure story attached.

No severity without a reachability claim. "This would be bad if it ran"
is a minor until someone shows how it runs.

## 3. Refutation Burden

The verifier's charter is adversarial and unidirectional: build the
strongest grounded case that the candidate is wrong. It does **not**
assign the final state.

> Try to prove this candidate wrong. Read the implementations, callers,
> configuration and tests it depends on. Every claim you make must
> quote code you actually read, with its path and line. Attack each
> load-bearing predicate separately: does the code behave as claimed,
> is the path reachable, and is there a real obligation being violated.
> Report the strongest refutation you can support and say plainly which
> predicates you could not settle.

Two rules that keep this honest, and they cut in opposite directions:

- **A plausible alternative reading is not a refutation.** Refuting
  requires citing code that falsifies a load-bearing predicate. Being
  able to imagine an interpretation under which the code is fine does
  not kill a candidate.
- **Failure to refute is not substantiation.** Where behavior is
  under-specified, lives outside the repository, or depends on
  production configuration, a verifier will routinely fail to refute a
  candidate that is also unsupported. That outcome is `unresolved`, not
  a finding.

Author intent is **context, not a predicate**. That a change looks
deliberate can explain a candidate away in a refactor, but "the author
meant to" never establishes correctness or compatibility. It may be
cited as supporting context; it may not by itself refute anything.

## 4. Adjudication States

A separate adjudicator — never the verifier, never the finder — reads
the candidate, the refutation, and any attack result, and assigns
exactly one state:

- **`substantiated`** — behavior, reachability and the violated
  obligation are each affirmatively supported by cited evidence.
- **`refuted`** — cited evidence falsifies at least one load-bearing
  predicate.
- **`unresolved`** — evidence conflicts, or a required predicate stays
  unknown after an honest attempt. Also the mandatory state when the only
  refutation on record is weakly grounded: an attempt that could not
  ground itself has settled nothing, and treating it as settled is the
  same error as treating failure-to-refute as substantiation.

The adjudicator also assigns final severity per the rubric above,
overriding the finder's proposal, and states in one line what evidence
decided it.

Only `substantiated` candidates are reported as findings. This is the
whole point of the three states: the old two-state model had to route
every unresolvable candidate either into the findings list (inflating
"verified") or into the bin (hiding it).

## 5. Attack Grades

An attack tries to construct a concrete counterexample — an input, call
sequence, or interleaving that makes the changed code misbehave. It
runs in two stages, because the two halves have very different costs:

- **Probe** (cheap, no execution) — construct the counterexample:
  exact input, step-by-step trace through the changed code, expected
  versus actual. Outcome is `counterexample_constructed` or
  `no_counterexample_constructed`.
- **Execution** (expensive) — bind the reviewed patch in a throwaway
  worktree, preflight, run a control, apply the patch, rerun.

Execution is selective by design: it is bought for targets where
terminal evidence changes a decision, not sprayed across every target.
What that buys is spelled out in the orchestration layer; what it means
is fixed here.

A target is graded on what was actually achieved, never on how
convincing it sounds:

- **`reproduced`** — an executed test fails, *and* the failure matches
  the predicted signature, *and* one of these holds: a control run
  shows the same test passing without the reviewed patch applied, or a
  cited specification establishes the expected result. Attach the test
  source, the exact command, and the failure output.
- **`plausible`** — a concrete counterexample exists but was not
  executed. Must record why, as `execution_status`:
  `unavailable` (the environment could not run it) ·
  `deferred_by_profile` (the profile does not buy execution here) ·
  `deferred_by_budget` (capacity ran out). The last two are choices,
  not facts about the code, and the ledger says which.
- **`held`** — execution happened, the attack ran, and the code did not
  break. Name the vectors attempted. Evidence of robustness, reported
  and never dropped. **`held` is execution-only.** A probe that failed
  to imagine a counterexample has not shown the code is robust.
- **`blocked`** — a required stage could not proceed for environmental
  or infrastructure reasons. Says nothing about the code. Record why.
- **`inconclusive`** — a probe ran, constructed no counterexample, and no
  execution was bought. A statement about how hard the code was to break.
- **`not_attempted`** — nothing was aimed at this target at all. It is not
  a grade an attacker returns; the orchestrator derives it, and it must not
  be collapsed into `inconclusive`. "We tried and found nothing" and "we
  never looked" are different facts, and only one of them is about the code.

The `held` / `blocked` / `inconclusive` split is load-bearing. Collapse
them and an environment failure or an unfunded target reads as a clean
bill of health.

A controlled `reproduced` result is terminal evidence: it substantiates
the candidate regardless of any refutation on the same code. An
uncontrolled failing test is not — it is downgraded to `plausible`,
because a test can fail from a missing dependency, a pre-existing
breakage, or flakiness just as easily as from the defect.

## 6. Report Ledger

Four sections, always all four, including on a review that found
nothing. Every section may be empty; none may be absent.

1. **Verified Findings** — `substantiated` only. Each entry: final
   severity, `file:line`, title, one paragraph of explanation, how it
   was verified (reproduced with the test attached / substantiated on
   cited evidence), and a one-sentence direction for the fix. Never a
   patch. `reproduced` entries sort first, then by severity.
2. **Unresolved Candidates** — `unresolved`. Each entry: anchor, the
   claim, and precisely which predicate could not be settled. These are
   the ones a human most needs to look at, because no amount of further
   model reasoning will close them.
3. **Rejected Candidates** — `refuted`. Each entry: anchor, the
   original claim, the refuting evidence, and who refuted it. A one-line
   mention is not enough — a wrong rejection has to be recoverable by
   reading this section alone.
4. **Coverage and Residual Risk** — lenses considered but not run;
   high-risk regions not probed or not executed, and why; every attack
   graded `held`, `blocked` or `inconclusive`, with reasons; every
   `plausible` with its `execution_status`; candidates dropped for
   invalid evidence; anything skipped for budget, with its anchor and
   the budget reason; the test-capability verdict per executed target;
   and any **self-reported coverage risk** — a role that said it was
   unsure of its own output. A triage that doubts its lens selection is
   the clearest case: nothing downstream can recover a lens that was
   never chosen, so its doubt belongs in the report rather than in a
   log.

No silent caps anywhere. If something was not done, it is named here.

### The achieved tradeoff

Coverage, accuracy and cost trade against each other in every run, and
the user can only calibrate the next run if the report says what this
one actually bought. Three lines, above the four sections — the
*achieved* numbers, never the intended ones:

```text
Tradeoff:          balanced; 42.1/48 weighted units; 11.8k output tokens
Search breadth:    5/7 eligible lenses; 4/5 high-risk regions probed; 1 supplemental lens skipped
Verification depth: 9/12 candidates adjudicated; 2 executed, 4 probe-only, 3 unverified by budget
```

Plus one frontier sentence naming what the next increment of budget
would buy first — for example, "next budget would execute C7, then add
the recommended security lens."

Never report a defect-coverage percentage. The denominator is the set
of defects that exist, which is unknown; a percentage against it is
fabricated. Report procedural breadth and verification depth, which are
things that were actually counted.

## 7. Claims This Contract Does Not License

Stated plainly so the report cannot overreach:

- Not "the change is safe". The contract bounds what was examined, not
  what exists.
- Not "verified" for anything short of `substantiated`.
- Not "reproduced" for an uncontrolled failing test.
- Not "attacked and held" for an attack that never executed.
- Not "robust" for a probe that merely failed to imagine a
  counterexample.
- Not "complete" for any run that hit its budget.
- Not a coverage percentage, ever.
