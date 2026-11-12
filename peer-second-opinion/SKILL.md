---
name: peer-second-opinion
description: >-
  Get an independent review or second opinion from the peer, another
  coding-agent CLI (Codex by default; agy/Antigravity when the user names it).
  Only on an explicit request naming Codex, agy, Antigravity, Gemini or "the
  peer": review mode for a code change ("让 codex 审一下", "let codex review
  this"), consult mode for a design, plan, decision or how to fix something
  ("问问 codex", "让 agy 看看"). Advice only, never fixes; to hand the peer the
  work itself, use delegate-to-peer.
harnesses: [antigravity, claude-code, codex]
---

# Peer Second Opinion

A blind second look from another coding-agent CLI: a perspective that
does not share the host's blind spots. It can be wrong — weigh it, never treat it as a
verdict.

> **Loading this skill does NOT start the peer.** Run the script below. Do not
> claim the peer is running until the output shows a `running:` line.

## Running the wrapper

Before the first run, read [references/running.md](./references/running.md):
which peer to pick, where `peer.mjs` is, how to launch it from your harness,
how to read its output and what each exit code means. In short: Codex is the
default peer and agy the alternative, never the host's own product; run
`peer.mjs` as the host's background task; trust the exit code and read the
file named by the last `result:` line; relay every `warning:`; never
substitute a host-written answer for a missing result.

Neither peer runs in a sandbox: review and consult get the user's own shell,
so the peer can build, run tests and write reproductions in the real
environment. A prompt note asks it not to modify the repository or git state
and to end with a `Verification:` paragraph; nothing enforces that note. The
`identity:` check reports a tree that changed during the run. Each provider's
reference covers its model, permissions and failure remedies — read it when a
run fails or before overriding the model:
[codex](./references/providers/codex.md), [agy](./references/providers/agy.md).

## Modes

Pick one and read its reference before composing the command:

- **review** — a prioritised defect list for a code change.
  [references/review.md](./references/review.md)
- **consult** — a reasoned position on an open question: a plan, a design
  choice, "X or Y", how to fix a bug. [references/consult.md](./references/consult.md)

The script's `task` mode belongs to
[delegate-to-peer](../delegate-to-peer/SKILL.md); nothing here about review
and consult applies to it.

## Boundary

- Scope is focus, not access: the peer may read the whole repository,
  untracked secrets included. Do not point it at material that must not reach
  its model provider.
- The repository's `AGENTS.md`, the user's CLI configuration and the MCP
  servers it enables steer the run; enabling a server there is the user's
  authorization. Mention MCP use when the output shows it. Use the skill on
  repositories the user trusts: the peer runs their builds and tests.
- **Never use review or consult to apply fixes.**

## Independence Contract

What enters a first-pass prompt must come from the user's own words, the
repository, or mechanical scope facts (paths, branch names, hashes) — never from
the host's own analysis: suspected defects, inferred constraints, preferred
approaches, rankings. When in doubt, omit it. If the user explicitly wants a
host claim challenged, include it and label the run **deliberation**.

After the peer answers:

1. Relay the result faithfully, before anything else — every finding with its
   priority (review), or the position plus its load-bearing arguments
   (consult). State the model, and the scope or question.
2. Add the host's stance on each point — agree, disagree with reason, or
   needs-checking — and verify checkable claims before presenting them as fact.
   "I ran it and it returned X" is a claim too: check the `log:` file. A
   check the peer skipped, or that failed for an environment reason (missing
   dependency, service, network, credential), is unverified: run it in the
   host's environment when the conclusion depends on it.
3. Flag splits between the two models explicitly rather than averaging them
   away; a genuine split is the most useful thing this skill produces.
4. Label an answer **independent** only when its prompt held no host-derived
   analysis and, for a review, the reviewing model did not write the change
   (a fresh session with the authoring model is **self-review**). Once the
   host's position has entered the session — or a fresh session that
   restates it — every answer is **deliberation**.
5. Then stop. Continue the session only if the user asked for a discussion or
   approves one. Applying fixes is the user's call; the host applies them,
   never the peer.

## Commands

```
peer.mjs <codex|agy> review [--repo DIR] [SCOPE] [OPTIONS]
peer.mjs <codex|agy> consult [--repo DIR] [OPTIONS] [--] QUESTION
```

| Flags | Rule |
|-------|------|
| `--uncommitted` / `--base B` / `--commit S` / `--custom T` | Review scope: at most one; default `--uncommitted`. |
| `--context TEXT` | Review only: neutral background (what the change is for); what to look for goes in `--custom`. Not with `--custom`. |
| `--model M`, `--effort L` | Omit both for the pinned default (running.md); pass them only when the user asked for a model, and always together. |
| `--timeout N`, `--resume ID` | Run deadline (default 3000 s); continuation — use the printed `resume:` line. |

```bash
PEER=<directory of this SKILL.md>/peer.mjs   # see running.md

"$PEER" codex review --repo /path/to/repo --uncommitted

"$PEER" agy consult --repo /path/to/repo \
  -- "Evaluate the migration plan in docs/plan.md: risks, missing edge cases"
```

The peer works in the live repository. Hold edits until the run ends: an edit
during it shows up as a drift warning.
