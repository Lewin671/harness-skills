---
name: with-codex
description: >-
  Claude Code ONLY — requires the codex-second-opinion skill and an
  authenticated `codex` CLI. Complete a whole task jointly with Codex
  through two consensus gates: Claude pre-registers its own position,
  Codex gives a blind opinion at the design gate, Claude implements
  alone, Codex reviews at the code gate; unresolved splits go to the
  user. Trigger only on an explicit user request to do a task together
  with Codex ("和 codex 一起完成这个任务", "build this with codex",
  "run this task with-codex"). The user decides invocation — never
  self-select a task in or out by size or importance, and once invoked
  both gates always run. Invoking this skill authorizes the workflow's
  codex-second-opinion runs, the implementation, and in-scope fixes;
  gate splits still stop for user adjudication. For a standalone
  review or question, use codex-second-opinion directly instead.
harnesses: [claude-code]
---

# With Codex

Complete one task with Codex as an independent counterpart at two
gates. Claude does all the thinking first and all the writing always;
Codex contributes blind second opinions. The shape is gated rather
than collaborative on purpose: a Codex that co-authors the design
cannot independently review the result, and independent review is the
value model diversity buys.

All mechanics — commands, scopes, markers, session handling, exit
codes — live in [codex-second-opinion](../codex-second-opinion/SKILL.md)
and its references; read the mode's reference before composing each
command. This skill only says when to enter a gate, what may cross it,
and what must come back.

## Workflow

### 1. Pre-register (design)

Form a complete position before Codex enters and state it in the
conversation *before* launching any codex run: the chosen approach,
plus any materially plausible alternative and why it lost ("none" is a
valid answer). A position formed after seeing Codex's answer measures
nothing.

### 2. Design gate

Always runs — the user chose the workflow by invoking it. When the
task holds a genuine open question, that is the question; when it does
not, ask Codex to assess the approach the user prescribed — or, if the
user prescribed none, to independently propose one and identify its
assumptions and risks. Never manufacture an artificial trade-off.

The consult prompt is blind: the user's own words, user-decided
constraints, repository file references, and mechanical facts (paths,
branch names, hashes). None of Claude's phase-1 position, summaries,
or inferences.

When the answer arrives: relay it faithfully first (question, model,
Codex's position and load-bearing arguments), then give Claude's
comparison against the pre-registered position. Then:

- **Consensus** — same choice and no unresolved material objection to
  behaviour, safety, or scope → implement.
- **Split** — deliberate in the same session, at most two resumptions,
  every resumed answer labelled **deliberation**.
- **Still split** — stop; present both positions with their arguments.
  User adjudication is an explicit non-consensus exit, never averaged
  into a compromise neither model argued for.

### 3. Implement

Claude alone: write the code, run the tests, verify the change works.
No Claude analysis from this phase enters the review prompt — only the
review scope and the permitted context below; the code gate needs a
fresh, unseeded review invocation.

### 4. Pre-register (code)

Before launching the review, record Claude's own self-review in the
conversation: expected risk areas and any doubts about the change.
This is the code-gate anchor, and it stays out of the review prompt.

### 5. Code gate

Review the whole task change via review mode — pick the scope per the
review reference, isolating or committing the task change if unrelated
WIP would pollute it. The review prompt may carry original
requirements, user adjudications, and mechanical scope facts; never
Claude's design rationale, self-review, suspected defects, or the
design-gate transcript.

When the report arrives: relay Codex's overall verdict — including an
affirmative zero-finding verdict — and every finding with its
priority, plus scope and model, before any disposition or fix. Give
each finding a Claude-side trust line, then disposition it — findings
are claims, not verdicts:

- **Confirmed** (reproduced, or evident on reading) → fix it.
- **Refuted** (evidence says otherwise) → do not fix; record finding,
  refutation, and evidence. Codex need not retract for consensus.
- **Uncertain** → investigate in proportion to priority. An unresolved
  P0/P1 blocks completion; an unresolved P2/P3 is reported as open.

Each round of fixes triggers a re-review of the same whole-task
scope, now containing the fixes. The loop ends on the first round that
confirms nothing new — refuted findings and open P2/P3s do not drive
another round — or at the backstop of five review rounds total,
whichever comes first. The user may set a different backstop at
invocation — any positive finite number; more rounds can always be
approved at a stop. Every code-gate review invocation, including a
failed or unparseable attempt, consumes one backstop round; retries
and reruns happen only while rounds remain, so the loop is bounded by
construction. A convergent exit is fully Codex-reviewed. At the
backstop, fixes from the last round end the gate Codex-unreviewed —
disclose them as such — and a confirmed-or-unresolved P0/P1 stops the
workflow and goes to the user: report the state and ask whether to
spend further rounds, accept it, or rethink, rather than claiming full
code consensus. Code consensus is reached when every finding has an
evidence-backed disposition and no confirmed-or-unresolved P0/P1
remains un-fixed.

### 6. Report

One final account: gate outcomes (summarize convergence; keep full
arguments only for splits and adjudications), every finding with its
priority and disposition — P2/P3 included — which answers were
**independent** and which **deliberation**, and scope and model per
codex-second-opinion's reporting rules.

## Failure exits

The parent skill's exit-code table governs each run; at the workflow
level:

- Review exit `2` is an empty scope, not approval — fix the scope or
  report that the code gate found nothing in scope.
- A gate run — initial or re-review — exiting `3`–`5`: at most one
  retry, and only when the parent's exit-code table itself justifies
  it (e.g. a larger timeout after a genuinely progressing stall);
  otherwise, or if the retry also fails, stop and report — never
  substitute a Claude answer for the missing gate. In the code gate,
  the failed attempt and any retry each consume one backstop round.
- A failed follow-up (this takes precedence over the rule above): the
  session is contaminated — allow one fresh consult restating context,
  labelled **deliberation** and consuming one of the two follow-up
  slots; if that recovery fails, stop.
- A review with no `[P<n>]` bullets and no affirmative zero-finding
  statement is unparseable — relay it verbatim; it is not a clean
  review. One rerun, consuming one backstop round and only while
  rounds remain; still unparseable, or no round left → stop: code
  consensus was not reached.
- A task that produces no reviewable repository change cannot satisfy
  the code gate — say so rather than claiming consensus.

## Principles

1. **Independence first.** Nothing Claude-derived enters a first-pass
   prompt; once contaminated, every later answer is deliberation.
2. **Findings are claims, not verdicts.** Every finding gets an
   evidence-backed disposition; refuting one is as valid as fixing it.
3. **Single write path.** Claude writes all code and files; Codex
   output only informs decisions and reviews, and never `codex apply`.
   One inherited caveat: per the parent skill's boundary, MCP servers
   from the user's codex config stay reachable and can mutate the
   external systems they front — mention it whenever Codex's output
   shows one was used.
