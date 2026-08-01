# Claude Code Orchestration

How Claude Code executes [contract.md](./contract.md). Everything here
is harness-specific: subagents, model tiers, worktree isolation, the
cost model, and the bundled Workflow script.

Three quantities trade against each other in every run — **coverage**
(defects seen at all), **accuracy** (claims that survive scrutiny), and
**token cost**. This file is mostly about how that trade is made
explicit, budgeted, and disclosed.

## 1. Phase 0 — Capture the review artifact

The Workflow script cannot run shell commands, so scope resolution and
patch capture happen **before** it is invoked, in the main agent.

Resolve the target in this priority order and state the choice:

1. A range, PR, or paths the user named explicitly.
2. Uncommitted changes (staged + unstaged) if any exist.
3. Current branch versus `merge-base` with the default branch.

Then bind it. This is not bookkeeping — a git worktree is a clean
checkout of a commit, so without an explicit patch to carry, the attack
phase reads different code than the review phase.

```bash
tmp="$(mktemp -d "${TMPDIR:-/tmp}/acr-XXXXXX")"

# (2) uncommitted — the common case
base_sha="$(git rev-parse HEAD)"
git diff HEAD > "${tmp}/patch.diff"
# tracked changes only; add untracked files without touching the index
git ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do
  git diff --no-index --binary /dev/null "${f}" >> "${tmp}/patch.diff" || true
done

# (3) branch vs merge-base
base_sha="$(git merge-base origin/HEAD HEAD)"
git diff "${base_sha}" HEAD > "${tmp}/patch.diff"

patch_sha256="$(shasum -a 256 "${tmp}/patch.diff" | cut -d' ' -f1)"
```

Never use `git add -N` to surface untracked files: it writes the index,
which this skill promises not to do. `git diff --no-index` is read-only.

These are the unfiltered forms. Run the filtered versions below instead
whenever anything is excluded — the hash must cover the patch the agents
actually receive.

If the patch is empty, stop and ask — do not review an empty diff.

Record the pre-run tree state for the write-safety check in §7. Status
alone is **not** enough, and this matters more than it looks: a tracked
file that is already modified reports ` M path` before and after an
agent overwrites it, and a file that is already untracked reports `??`
either way. Both snapshots would be byte-identical while the contents
changed underneath. Hash the contents:

```bash
acr_snapshot() {
  git rev-parse HEAD
  git status --porcelain=v1
  { git ls-files -z; git ls-files --others --exclude-standard -z; } |
    xargs -0 shasum -a 256 2>/dev/null | sort | shasum -a 256
}
acr_snapshot > "${tmp}/tree-before"
```

Even this does not cover gitignored paths — build output, `node_modules`,
local caches. Say that in the report rather than implying total coverage;
"changes to tracked and untracked-but-visible files are detected" is true,
"changes to the parent tree are detected" is not.

### Exclusions and partitioning

Exclusions must be applied to the captured patch, not merely declared.
A report that lists `excluded_paths` while every agent reviewed them —
and the attack applied them — is exactly the kind of false disclosure
this skill exists to prevent. Use pathspecs at capture time and hash
the *filtered* patch:

```bash
# Exclusions are pathspec arguments to the same capture commands.
excludes=(':(exclude)*.lock' ':(exclude)package-lock.json'
          ':(exclude)vendor/**' ':(exclude)**/node_modules/**'
          ':(exclude)**/__snapshots__/**' ':(exclude)*.min.js')

git diff HEAD -- . "${excludes[@]}" > "${tmp}/patch.diff"

# The SAME pathspecs must filter untracked files. `git check-ignore` only
# knows about .gitignore, so it will happily let an untracked vendor/ path or
# lockfile through the exclusion list.
git ls-files --others --exclude-standard -z -- . "${excludes[@]}" |
  while IFS= read -r -d '' f; do
    git diff --no-index --binary /dev/null "${f}" >> "${tmp}/patch.diff" || true
  done

patch_sha256="$(shasum -a 256 "${tmp}/patch.diff" | cut -d' ' -f1)"

# Both manifests, from the same pathspecs that produced the patch.
included="$( { git diff --name-only HEAD -- . "${excludes[@]}"
               git ls-files --others --exclude-standard -- . "${excludes[@]}"; } | sort -u)"
everything="$( { git diff --name-only HEAD
                 git ls-files --others --exclude-standard; } | sort -u)"
excluded="$(comm -23 <(printf '%s\n' "${everything}") <(printf '%s\n' "${included}"))"
```

`allow_execution` is **required** too, with no default. Running the
artifact's own test command with this session's privileges is a trust
decision, and a decision nobody made is not one.

`included_paths` is **required** — the script refuses to start without a
non-empty one. It is the only thing that keeps a finding inside the
artifact the review claims to be about; absent, a finder can nominate
any file in the repository and, if the verifier and adjudicator agree,
that becomes a "verified finding" about code nobody reviewed.

Better still, pass `changed_ranges` too — file-level binding still lets a
candidate cite an untouched line in a reviewed file. Build it from the
same filtered pathspecs, and cover all three shapes of change:

```bash
# tracked hunks; a deletion-only hunk has new-side length 0, so anchor it at
# the line the deletion sits against rather than dropping it
git diff --unified=0 HEAD -- . "${excludes[@]}" |
  awk '/^\+\+\+ b\//{f=substr($0,7)}
       /^@@/{split($3,a,","); s=substr(a[1],2)+0; n=(a[2]==""?1:a[2])+0;
             if(n>0) print f, s, s+n-1; else print f, s, s}'

# untracked files are changed in their entirety
git ls-files --others --exclude-standard -z -- . "${excludes[@]}" |
  while IFS= read -r -d '' f; do printf '%s 1 %s\n' "$f" "$(awk 'END{print NR}' "$f")"; done
# awk, not `wc -l`: a file with no trailing newline counts 0 lines under wc,
# which produces the range 1..0 and silently rejects every candidate in it.
```

A file the map does not mention falls back to file-level binding rather
than having all its candidates rejected. That is deliberate: an
incomplete map is the likely case — new files, deletion-only hunks, a
caller who built it from tracked changes alone — and rejecting on absence
would silently discard findings about exactly the code most likely to be
new. Only an explicit range list can rule a line out.

Both manifests are returned in `run`, so the report states what was
actually reviewed rather than what was intended.
A generated-code diff inflates cost estimates and floods the finders
with noise — but exclusion is a judgement, not a reflex: when the
dependency bump *is* the change under review, a lockfile is the review
target and must stay in.

If the remaining patch still exceeds roughly 1,500 changed lines or
spans more than about eight top-level modules, partition it by module
and review one partition per run, or ask the user to narrow the scope.
One pass over a very large diff produces context pressure, duplicate
candidates, and a report whose ledger is longer than its findings.

## 2. Profiles and budget

Two independent controls. **Profile** decides where the money goes;
**budget** decides how much there is. Changed-line count chooses
neither — it feeds cost estimation and partitioning only. Volume is not
value: a ten-line authorization change and a two-thousand-line
generated-client update sit at opposite ends of value per token.

| Profile | Buys | Use when |
|---------|------|----------|
| `balanced` *(default)* | Broad lens coverage, verification of every candidate, probes on the top 2 high-risk regions, execution for critical targets | Most reviews |
| `recall-first` | Every relevant lens plus one supplemental lens, probes on **all** high-risk regions; execution only where a probe already built a counterexample | "What did we miss?" — pre-release sweeps, unfamiliar code |
| `precision-first` | Minimum coverage floor, then depth: execution for criticals *and* majors that have a counterexample | A contested finding, or a report that must not contain false alarms |

Announce the profile, the budget, and the estimated launch count before
invoking the script. A run near the default budget typically lands
around 16–19 subagent launches, which is above this
session's default workflow-size guideline — say so, since the user can
raise "Dynamic workflow size" in `/config` and should not discover the
fan-out afterwards.

### Two floors that are not negotiable

- **Coverage floor** — triage plus every lens triage selected. Without
  it the review has no breadth and its silence means nothing.
- **Accuracy floor** — a verifier for every surviving candidate, plus
  reserved adjudication capacity. Without it breadth produces
  candidates that can never become findings.

If the budget cannot fund the **coverage** floor, do not run: a review
without breadth has nothing to say and its silence means nothing.

The **accuracy** floor is different, and it took a hostile-artifact
review to see why. Aborting when candidates outnumber the budget makes
suppression cheap — anything that inflates the candidate count, a noisy
diff or an artifact manufacturing decoys, deletes the whole review and
the real findings with it. So the candidate set is trimmed from the
least consequential end (minors, then majors, then criticals) until it
fits, and everything trimmed is reported as **found but not verified**,
with its anchor. Every *retained* candidate still gets a verifier; that
part is not negotiable. What changed is that "we found this and could
not afford to check it" is now a disclosed outcome rather than a reason
to return nothing.

## 3. Model tiers

| Role | Default | Why |
|------|---------|-----|
| Triage | `sonnet` | It picks the lenses and the high-risk regions. A lens never run and a region never flagged cannot be recovered downstream, so this is a recall gate, not clerical work. |
| Finder | `sonnet` | Breadth across lenses — the cheapest coverage available. |
| Major / minor verifier | `sonnet` | Same tier as the producer; its output is refutation evidence, not a verdict. |
| Critical verifier | `opus` | Its analysis is the main input to a final decision. |
| Reasoning probe | `sonnet` | Counterexample construction is a thinking task, not an agentic one. |
| Executable attack | `opus` | Agentic loop: bind, preflight, control, patch, rerun. |
| Adjudicator | `opus` | Assigns the final state. Verification floor: strictly above the finders. |

The tier names are rolling aliases and role *defaults*, not permanent
model identities — and the script cannot check what the live schema
declares, so **the caller resolves them in Phase 0 and passes them in**
as `args.models` (`{cheap, strong, highEffort}`). Defaults apply when
the caller says nothing. Pass only values the live Workflow schema
declares, map a missing alias to the nearest declared tier, and announce
the substitution before launching. If the finders already run at the
schema's ceiling, set `strong` to that ceiling and rely on the raised
`highEffort` for the adjudicator, then note in the report that the
verification floor was met at equal tier. The resolved roles come back
in `run.model_roles`, so the report can state what actually ran.

Escalate-once applies only where a *field* can trigger it, never to a
prose impression of weakness — the script must be able to evaluate the
condition without judging text:

| Role | Trigger field | Action |
|------|---------------|--------|
| Critical verifier | `grounding: weak` | rerun once at raised effort |
| Adjudicator | any verdict with `grounding: weak` | one rerun over those candidates only |

Triage is deliberately **not** on that list. It runs once, and a
`confidence: low` triage becomes a disclosed coverage risk instead of a
rerun. The reason is structural: a triage escalation is a purchase made
after a completed sequential agent, inside a wave whose estimate is
still open, and that shape double-charged the finished triage against
the token target — producing a false `deferred_by_budget` reason in the
one ledger whose job is to say truthfully why coverage was omitted.
Removing the purchase point removes the shape. The remedy for a triage
that doubts itself is to rerun the review with a stronger
`models.cheap`, which the report says.

Each escalation is at most one rerun, is charged to the budget, and is
disclosed. Nothing is retried at identical settings, and nothing weak
is silently accepted.

## 4. Cost model

Launch counts are **not** cost. An executable attack is an agentic loop
that binds a worktree, preflights, authors a test, runs a control and
reruns patched code; a batched minor verifier reads a few anchors once.
Treating them as one unit each bounds the wrong quantity.

The budget primitive is the **weighted unit (WU)**, where one sonnet
finder is `1.0`:

| Role | WU |
|------|-----|
| Triage (sonnet) | 0.75 |
| Finder (sonnet) | 1.00 |
| Major verifier (sonnet) | 1.25 |
| Critical verifier (opus) | 2.50 |
| Minor verifier, batched (sonnet) | 0.75 + 0.30 × n, n ≤ 4 per batch |
| Reasoning probe (sonnet) | 1.50 |
| Executable attack (opus) | 10.00 |
| Adjudicator, batched (opus) | 1.50 + 0.30 × n, n ≤ 8 per batch |

**These are scheduling priors, not measurements.** They exist to rank
purchases and reserve capacity, and they should be recalibrated from
real runs. The report says "weighted units", never "tokens", unless a
real token figure is available.

Default budget: **48 WU**, and the number is derived rather than
chosen. A seven-candidate balanced run spends roughly 4.75 on coverage,
3 on region probes, 9.15 on verifiers, 3.6 on adjudication, 7.1
escrowed for the two escalate-once guarantees, and 4.5 on candidate
probes — about 32 before a single execution, which costs 10 more.
Anything under about 44 means the expensive half is never reachable and
the skill quietly degenerates into a reasoning-only review, which is the
one outcome its positioning cannot survive.

Sizing down is legitimate — it just has to be *said*. A smaller budget
buys a reasoning-only review, and the report's tradeoff lines will show
`executed: 0`.

When the user has set a turn token target, the script also reads the
`budget` global (`budget.total`, `budget.spent()`, `budget.remaining()`)
and treats `budget.remaining()` as a **hard admission guard**: it will
not open a wave whose projected WU cost maps to more than the remaining
tokens. Weighted units schedule; real tokens veto. Without a user
target, the WU budget is the only bound.

It guards *admission*, not actual spend, and the difference is not a
quibble. A wave is admitted atomically and cannot be re-checked in
flight, so if the priors under-state real cost, an already-open wave
overshoots and nothing in the script can prevent it. Note also that
`tokensPerWU` is `total / budgetWU`, which makes the token check
arithmetically identical to the weighted-unit check whenever actuals
match the priors — it earns its keep only when they drift. Both facts
are why the priors are labelled estimates and why the report says
"weighted units" rather than "tokens".

### Wave scheduling

Capacity is reserved **before** each `parallel()` call, never checked
afterwards — by the time a wave is running, its cost is already
committed.

Four admission paths, and the split is deliberate:

| Path | Used for | Rule |
|------|----------|------|
| `reserve` | mandatory floors | fits in weighted units and tokens, or the run stops |
| `admitOptional(cost, protectedFloor)` | every optional purchase | the floor still owed must fit *afterwards*, in both quantities; the floor is verified, never consumed here |
| `drawOrReserve(pool, cost)` | the two escalate-once guarantees | draws the escrow set aside with the floors, still token-checked |
| `admitPrepaid(cost)` | a wave whose units were committed earlier | re-checks only the token ceiling, against real spend |

Every optional admission happens either before its wave opens or after
the previous wave was closed with `endWave()`. Nothing is bought while
a completed agent's estimate is still standing — that is the invariant
whose violation cost the triage escalation its existence.

`admitOptional` exists because the same guard was written four times at
four call sites during review and three of those versions protected
weighted units but not tokens, or the reverse. A scheduler with this
many purchase points cannot be kept correct site by site.

Centralising the *call* was not enough on its own, because weighted
units and tokens are committed at different moments: adjudication's
units are reserved with the floors, but its tokens are spent two waves
later, and `endWave()` drops it out of the per-wave projection in
between. So the obligation is tracked centrally too — `prepaidDebtWU`
holds units that are committed but whose tokens are still owed to a
later wave, and every token admission subtracts it. That is what stops
an executable attack from spending the tokens adjudication was already
promised, which no per-call-site argument reliably prevented.

The practical effect, and the priority it encodes: when tokens are
tight enough to fund adjudication but not adjudication plus an attack,
the attack is deferred and disclosed. Adjudication is what turns
candidates into findings; an execution that starves it buys evidence
for a report that can no longer be written.

| Wave | Contents | Barrier justification |
|------|----------|----------------------|
| 1 Triage | 1 agent | Selects the lenses; everything downstream depends on it |
| 2 Find | one agent per lens, plus the supplemental lens | — |
| 3 Probe | reasoning probes over high-risk regions | Runs **before** verification so a counterexample against an unflagged region becomes a candidate in time to be verified and adjudicated like any other |
| 4 Verify | a verifier per candidate, plus candidate probes | Needs the full candidate set, emergent ones included |
| 5 Execute | executable attacks for eligible targets | Eligibility depends on *which* probes built a counterexample, and capacity must be recomputed from actual spend |
| 6 Adjudicate | one batched agent per 8 candidates | Needs every candidate's refutation and attack evidence together |

These are real barriers, and they are the deliberate price of
deterministic, disclosable spending: a per-candidate pipeline would race
on the budget and could commit an expensive attack the ledger has
already promised away.

Wave 3 is the one that makes the recall channel real. A region probe
that constructs a counterexample must emit a full `emergent_candidate`,
which enters the candidate set and goes through the same refutation and
adjudication as a finder's. Without that promotion the region channel
can attack code but can never *report* anything — which is the exact
shape of defect this design was rewritten to remove.

### Spending order

Adjudication capacity is reserved before anything optional, because
without it candidates can never become findings at all.

1. **Coverage floor** — triage, every selected lens. Never trimmed.
2. **Cheap coverage** — region probes, per profile, funded only after
   the projected accuracy floor is set aside.
3. **Accuracy floor** — a verifier for every candidate, emergent ones
   included. Never trimmed.
4. **Cheap coverage, part two** — probes for critical and major
   candidates.
5. **Conditional depth** — executable attacks, in exactly this rank
   order (`review-workflow.js`, wave 5):
   1. critical candidates whose probe built a counterexample;
   2. major candidates with a counterexample — `precision-first` only;
   3. critical candidates without one — skipped when the profile sets
      `execUnprovenCriticals: false`, which `recall-first` does.

A constructed counterexample outranks a speculative critical, and that
ordering is deliberate. The counterexample is direct evidence that
execution will yield terminal evidence; an unproven critical is a hope
that it might. Spending the single affordable execution on the hope
while a ready-made counterexample goes unrun is the worse trade — a
smoke run over the bundled script showed exactly that happening under
the earlier ordering.

Within a rank, order by overlap with a high-risk region, then finder
confidence, then stable `file:line`.

Buying breadth before depth is not a universal law — reproducing an
authorization bypass can be worth more than a sixth lens. What is
universal is that the floors come first, and that the expensive half is
bought *selectively*, on evidence, rather than sprayed across every
target.

### When the plan does not fit

Only the **floors** decide whether a run is viable. Not being able to
afford every attack is the normal case, not an error: execution is
rationed by design, and the surplus targets are deferred and disclosed.

- Floors fit — run, and defer optional targets with
  `deferred_by_budget` in the ledger.
- Floors exceed the budget — `budget_too_small`. Nothing runs. Raise
  the budget or narrow the scope; do **not** produce a degraded review.
- Floors exceed twice the budget — `scope_too_large`. The candidate set
  is too big for this budget to verify at all, so narrowing the scope is
  the fix rather than a slightly larger budget.

## 5. Role prompts

Every subagent receives `base_sha`, the patch path, `scope`, and the
neutral intended behavior. None receives another agent's conclusion
except where stated.

**Triage** — told which profile is running, so its breadth guidance
matches what the profile promises. Returns `change_kind`, 3–6 `lenses`
chosen for *this* change (not the whole menu), `high_risk_regions` as
file/line ranges where a defect would be severe regardless of whether
anything was found there — **ordered most dangerous first**, because
only the first few are funded and the order it returns is the order they
are bought — `probe_candidates` (focused test commands the repo
*appears* to support — inspect config, do not execute), and its own
`confidence` plus `uncertainties`.

**Finder** — one lens each, may read any file for context. Coverage,
not filtering: report everything found including uncertain and
low-severity candidates, with `confidence` marked; downstream
adjudication does the filtering. Every candidate must satisfy the
evidence schema in contract.md §1, including the `omission` shape when
the defect is missing code. A finder may also return
`additional_high_risk_regions` and at most one
`recommended_missing_lens`. Regions it adds are deduplicated against
triage's and queue *behind* them, because triage was the role asked to
rank regions by danger and that ranking is the funding order.

**Verifier** — the refutation burden in contract.md §3. Critical
verifiers return three separately grounded analyses — `semantics`,
`reachability`, `contract_violation` — plus `strongest_refutation`,
`unsettled_predicates`, and `grounding`. They do **not** return a
verdict. Minor candidates go to one batched verifier.

**Reasoning probe** — given one candidate or one high-risk region, no
execution and no worktree: construct a concrete counterexample — exact
input, step-by-step trace through the changed code, expected versus
actual, plus the failure signature a test would show — or return
`no_counterexample_constructed`. Failing to imagine one is **not**
evidence of robustness, and the prompt says so.
A *region* probe that succeeds must additionally return a full
`emergent_candidate` satisfying the same evidence contract as a
finder's. A counterexample with no candidate attached cannot be
verified or adjudicated, so the script records that as a malformed
result rather than quietly discarding it.

**Executable attack** — §6.

**Adjudicator** — batched, reading every candidate with its refutation
evidence and any attack result. Assigns `substantiated | refuted |
unresolved`, final severity, `grounding`, and a one-line decisive
evidence note. It is the only role that assigns state.

## 6. Attack protocol

### Stage 1 — reasoning probe (sonnet, no worktree)

Cheap enough to point at every high-risk region, which is what makes
the recall channel affordable outside the most expensive profile. Its
outcome decides whether stage 2 is worth buying.

### Stage 2 — executable attack (opus, `isolation: 'worktree'`)

**`isolation: 'worktree'` is a checkout, not a sandbox.** It stops two
agents colliding on files; it does not constrain what the commands they
run can reach. This stage applies the reviewed patch and runs the
artifact's own test command, so it executes code the artifact controls
with whatever privileges the session has — network, credentials, paths
outside the worktree. "No network, no dependency installation" is an
instruction to the *agent*, not a restriction on the *code*.

So `allow_execution: false` is a first-class argument, not a
degradation. A caller reviewing code they would not run keeps triage,
every lens, verification, probes and adjudication, and every execution
is deferred with reason `disabled_by_caller` in the ledger. The report
then says what a sandboxed rerun would buy. Point stage 2 at untrusted
code only in an environment you would let that code run in.

The worktree is a clean checkout at the parent's HEAD with **no
gitignored artifacts and none of the parent's uncommitted changes** —
measured behavior, not an assumption. So every attack begins by binding
itself to the reviewed artifact:

1. **Bind.** `git rev-parse HEAD`; if it is not `base_sha`,
   `git checkout --detach <base_sha>`. Verify the patch file's sha256
   matches `patch_sha256`; abort and report `blocked` if it does not.
2. **Preflight.** Before applying the patch, run one existing focused
   test near the changed code. Budget: 120 seconds wall clock. **No
   network, no dependency installation, no full-suite runs.** Record
   `test_capability` as `ready`, `setup_required`, or `unavailable`,
   with the probe command and its output.
   This replaces any repo-wide `fast_tests` boolean: testability is per
   target, not per repository, and a test directory says nothing about
   whether a fresh worktree can run it.
3. **Control.** If `ready`, author the focused reproducer and run it
   here — still unpatched. A reproducer that already fails at
   `base_sha` is testing a pre-existing breakage, not the change.
4. **Attack.** `git apply <patch_path>`, confirm `git diff --stat` is
   non-empty, rerun the reproducer.
5. **Grade** per contract.md §5. `reproduced` requires the predicted
   failure signature *and* the control passing. Without the control,
   grade `plausible` and say why.

If `test_capability` is not `ready`, fall back to the stage-1
counterexample graded `plausible` with `execution_status: unavailable`,
or `blocked` when even that is impossible. Never install dependencies
to rescue a run: it spends minutes, reaches the network, and can mask
the very defect under test.

Total budget: 600 seconds per executed target.

Executable attacks on critical candidates are **not** gated on the
verifier's refutation. Gating execution on a model's refutation vote is
what made the old "reproduced overrides the skeptic" rule unreachable:
a candidate the verifier killed was never attacked, so the override had
nothing to override. Verification and attack run in different waves but
neither vetoes the other; the adjudicator sees both.

## 7. Write safety — what is actually guaranteed

The honest contract, and it is narrower than "never modifies":

> Triage, finder, verifier, probe and adjudicator prompts issue no
> write instructions. Executable attacks write only inside throwaway
> worktrees holding the verified review patch. The launcher snapshots
> the parent tree's HEAD, status, and a content hash of every tracked
> and untracked-but-visible file before and after the run, and reports
> any unexpected difference. Gitignored paths are outside that snapshot.

That last part is **detection, not enforcement**. Claude Code exposes no
tool-restriction knob on `agent()` — the options are `label`, `phase`,
`schema`, `model`, `effort`, `isolation` and `agentType` — and the
built-in read-only-ish agent types still carry Bash, which can write.
Shipping a custom read-only `agentType` is not possible from this repo:
agent definitions live in `.claude/agents/`, and the linker only
symlinks skill directories.

If the after-state differs unexpectedly, stop and disclose it. Never
silently revert: the user's tree is theirs, and a "cleanup" can destroy
work the skill should never have touched.

## 8. Invoking the bundled script

Call the `Workflow` tool with `scriptPath` pointing at
`review-workflow.js` beside this file — usually
`~/.claude/skills/adversarial-code-review/review-workflow.js`. If that
path does not exist, locate the script beside `SKILL.md` rather than
reconstructing the pipeline inline. Reconstructing it from prose is the
defect this file exists to close.

```
Workflow({
  scriptPath: "<skill dir>/review-workflow.js",
  args: {
    scope: "uncommitted changes in the payments module",
    intent: "extract the retry loop; behaviour must be unchanged",
    base_sha: "<sha>",
    patch_path: "<TMPDIR>/acr-XXXX/patch.diff",
    patch_sha256: "<hash>",
    repo_root: "<abs path>",
    profile: "balanced",       // recall-first | precision-first
    budget_wu: 48,             // override only on request
    included_paths: ["src/pay.js", "src/auth.js"],   // REQUIRED, non-empty
    changed_ranges: { "src/pay.js": [[10, 14]] },     // optional, binds to hunks
    excluded_paths: ["package-lock.json", "vendor/"],
    allow_execution: true,                            // false keeps the contract,
                                                      // declines the execution half
    models: { cheap: "sonnet", strong: "opus", highEffort: "xhigh" }
  }
})
```

`models` carries the tiers resolved against the live schema in Phase 0.
Omit it only when the defaults are known to be valid.

The script owns schemas, weighted budgeting, wave reservation, and the
disclosure checklist. It does **not** rank models: `args.models` is used
as given and echoed back in `run.model_roles`, so a wrong tier is
auditable after the fact but not prevented. It never judges
prose: "weakly grounded" is a field an agent emits, never something the
script infers.

## 9. Failure handling

`agent()` returns `null` when a subagent is skipped or dies on a
terminal error. The script filters nulls; the consequences are
reported, never swallowed:

- A null **finder** means that lens was not run — Coverage ledger.
- A null **verifier** leaves its candidate `unresolved` with reason
  `verification did not complete`.
- A **weakly grounded** verifier does the same, at *every* severity. Only
  criticals buy an escalation, but a refutation that could not ground
  itself has settled nothing regardless of severity, so a candidate whose
  sole refutation is weak cannot be substantiated without a controlled
  reproduction. Cheap severities fail closed rather than relax.
  The weak record is kept for the report — its `unsettled_predicates` are
  what the Unresolved Candidates section needs — but
  `verifier_completed` means a *grounded* refutation, not merely a
  returned one. Defining the count that way is what makes the rule
  uniform; there is no separate withdrawal step.
- A target that was never probed is `not_attempted`, never `inconclusive` —
  minor candidates are not probe targets under any profile, so most runs have
  several, and grading them as "we tried and it held up" would be invention.
- A null **probe** is `blocked`, not `held` and not `inconclusive`:
  `inconclusive` means a probe ran and found nothing, which is a claim about
  the difficulty of the code. A probe that never returned says only that the
  run failed, and the ledger records it as an agent failure.
- A null **executable attack** is `blocked`, not `held`.
- A null **adjudicator batch** leaves the candidates *in that batch*
  unresolved; other batches stand. Only when every batch fails does the run
  report `adjudication_failed`. Either way no candidate is promoted on finder
  output alone.
- A **weak** verdict is withdrawn before its one permitted rerun. If the
  rerun returns nothing, returns the wrong ids, or is still weak, the
  candidate stays unresolved — the weak verdict is never restored.

## 10. Report assembly

The script returns structured data; the main agent writes the report as
terminal markdown, in the four-section order of contract.md §6, headed
by the three tradeoff lines and the frontier sentence from that same
section, plus scope, `base_sha`, short patch hash, profile, and model
roles.

That header is what makes a run reproducible, what stops "verified"
from meaning "we looked at it", and what lets the user decide whether
the next run should buy breadth or depth.

If the user then asks for fixes, that is a new task outside this skill:
re-read the code fresh rather than trusting the report's snippets.
