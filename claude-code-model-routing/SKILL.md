---
name: claude-code-model-routing
description: Claude Code ONLY — never apply in Codex or any other harness; each harness gets its own routing skill. Use this skill in Claude Code whenever spawning subagents via the Agent tool or Workflow agent() calls, especially fan-outs of 3+ agents, or when the user asks about the cost or speed of delegated work. It picks the right model tier (haiku/sonnet/opus) per subtask so mechanical work runs cheap and hard reasoning runs strong. Can also be invoked directly to plan tiering before a delegation. Scope is subagents only — never use it to change or comment on the main-loop model.
---

# Claude Code Model Routing

When delegating work to subagents in Claude Code, set the `model`
option per agent based on the subtask, not on habit. The goal: never
pay opus prices for grep work, never trust haiku with architecture.

This skill is the Claude Code variant of model routing. It governs
only the `model` parameter of `Agent` tool calls and Workflow
`agent()` calls. In any other harness (Codex, Kiro, etc.) skip it
entirely and use that harness's own routing skill if one exists —
the tier names and delegation tools here are Claude Code specific.
The main-loop model is the user's choice; do not suggest changing
it or comment on it.

## Routing Table

Match the subtask against the first tier that fits, top to bottom:

| Tier | Use for | Signatures |
|------|---------|------------|
| `haiku` | Mechanical, fully specified work | Bulk file search and inventory, Explore fan-outs, format/rename sweeps, extracting facts from known locations, applying an edit that is spelled out exactly |
| `sonnet` | Standard, well-scoped engineering | Implementing a defined function or fix, writing tests for known behavior, routine refactors, drafting docs, single-dimension review passes |
| `opus` | Judgment-heavy or high-stakes work | Architecture and design tradeoffs, debugging with unknown root cause, ambiguous multi-step planning, adversarial verification of findings, final synthesis across many agents' results |
| omit | Unsure, or the task mixes tiers | Inheriting the main-loop model is the safe default; omission is never wrong, only sometimes wasteful |

If the session exposes a stronger override than `opus` (e.g.
`fable`), treat it as the top tier with the same criteria.

## Rules

1. **Decide the tier when you write the prompt.** A vague prompt needs
   a stronger model; a precise prompt makes a cheaper tier safe. If
   you can tighten the prompt enough to drop a tier, do it.
2. **Fan-out multiplies the choice.** With 5+ parallel agents, tier
   selection dominates cost. Push the repetitive stage down to
   `haiku`/`sonnet` and reserve `opus` for the one synthesis or
   verification agent that reads everything.
3. **Never downgrade verification.** Agents that judge, refute, or
   gate other agents' findings get at least the tier of the agents
   that produced those findings.
4. **Escalate once, don't loop.** If a cheap-tier agent returns a
   weak or uncertain result, rerun that one subtask one tier up.
   Do not retry at the same tier and do not silently accept it.
5. **Mixed task, split it.** If one subtask has both a mechanical
   part and a judgment part, split into two agents at two tiers
   rather than sending the whole thing to the high tier.

## When Invoked Directly

If the user invokes this skill by name, list the subtasks you are
about to delegate, the tier assigned to each, and a one-line reason
per assignment — then proceed with the delegation.
