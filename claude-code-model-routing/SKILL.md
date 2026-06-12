---
name: claude-code-model-routing
description: Claude Code ONLY — never apply in Codex or any other harness; each harness gets its own routing skill. Use this skill in Claude Code whenever spawning subagents via the Agent tool or Workflow agent() calls, especially fan-outs of 3+ agents, or when the user asks which model tier delegated work should use for cost or speed reasons. It picks the right tier (haiku/sonnet/opus, plus fable when warranted) per subtask so mechanical work runs cheap and hard reasoning runs strong. Can also be invoked directly to plan tiering before a delegation. Scope is subagents only — never use it to change or comment on the main-loop model.
harnesses: [claude-code]
---

# Claude Code Model Routing

When delegating work to subagents in Claude Code, set the `model`
parameter per agent based on the subtask, not on habit. Never pay
opus prices for grep work, never trust haiku with architecture.
Scope: only the `model` parameter of `Agent` tool calls and Workflow
`agent()` calls. The main-loop model is the user's choice; never
suggest changing it or comment on it.

## Routing Table

| Tier | Use for | Signatures |
|------|---------|------------|
| `haiku` | Mechanical, fully specified work | Bulk file search and inventory, format/rename sweeps, extracting facts from known locations, applying an edit that is spelled out exactly |
| `sonnet` | Standard, well-scoped engineering | Implementing a defined function or fix, writing tests for known behavior, routine refactors, drafting docs, single-dimension review passes |
| `opus` | Judgment-heavy or high-stakes work | Architecture and design tradeoffs, debugging with unknown root cause, ambiguous multi-step planning, final synthesis across many agents' results |
| omit | Genuinely unclassifiable, or mixed and unsplittable (rule 5) | Fallback, not the default: when a row clearly fits, set the tier — this skill intentionally overrides omit-by-default habits. Omission under-tiers when the main loop runs cheaper than the subtask needs |

Resolution order, before the table:

- An explicit user model choice always wins; at most note a cheaper
  alternative once.
- If the agentType ships its own tuned default (e.g. `Explore`),
  omit `model` unless a row clearly demands a different tier.
- If a subtask fits more than one row, take the highest matching
  tier — or split it (rule 5).
- `fable` sits one tier above `opus`: use it only when the main loop
  itself runs fable and the subtask is the single synthesis or
  verification agent, or the user asked for maximum quality.

## Rules

1. **Decide the tier when you write the prompt.** A vague prompt needs
   a stronger model; a precise prompt makes a cheaper tier safe. If
   you can tighten the prompt enough to drop a tier, do it.
2. **Fan-out multiplies the choice.** With 3+ parallel agents, tier
   selection dominates cost. Push the repetitive stage down to
   `haiku`/`sonnet` and reserve the top tier for the one synthesis
   or verification agent that reads everything (rule 3 sets it).
3. **Verification floor.** Agents that judge, refute, or gate other
   agents' findings get at least the tier of the agents that produced
   those findings — and a higher one when their verdict is final and
   the user will act on it without further review.
4. **Escalate once, don't loop.** If a cheap-tier agent returns a
   weak or uncertain result, rerun that one subtask one tier up —
   from `opus`, follow the fable rule or pull the work into the main
   loop. If the escalated rerun is still weak, stop delegating and
   surface the uncertainty. Never retry at the same tier and never
   silently accept.
5. **Mixed task, split it.** If one subtask has both a mechanical
   part and a judgment part, split into two agents at two tiers
   rather than sending the whole thing to the high tier. If the
   parts can't be separated cleanly, omit `model` instead.

## When Invoked Directly

If the user invokes this skill by name, list the subtasks you are
about to delegate, the tier assigned to each, and a one-line reason
per assignment. Then proceed with the delegation only if the user
asked for the work itself; if they asked only for the tiering plan,
stop there.
