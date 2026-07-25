---
name: claude-code-model-routing
description: Claude Code ONLY — never apply in Codex or any other harness; each harness gets its own routing skill. Use this skill in Claude Code whenever spawning subagents via the Agent tool or Workflow agent() calls, especially fan-outs of 3+ agents, or when the user asks which model tier or reasoning effort delegated work should use for cost or speed reasons. It picks the right tier (haiku/sonnet/opus, plus any stronger tier the tool declares) and the right effort per subtask so mechanical work runs cheap and hard reasoning runs strong. Can also be invoked directly to plan tiering before a delegation. Scope is subagents only — never use it to change or comment on the main-loop model.
harnesses: [claude-code]
---

# Claude Code Model Routing

When delegating work to subagents in Claude Code, set the `model` and
`effort` parameters per agent based on the subtask, not on habit. Never
pay top-tier prices for grep work, never trust the cheapest tier with
architecture. Scope: only the `model` and `effort` parameters of `Agent`
tool calls and Workflow `agent()` calls. The main-loop model is the
user's choice; never suggest changing it or comment on it.

## Routing Table

| Tier | Use for | Signatures |
|------|---------|------------|
| `haiku` | Mechanical, fully specified work | Bulk file search and inventory, format/rename sweeps, extracting facts from known locations, applying an edit that is spelled out exactly |
| `sonnet` | Standard, well-scoped engineering | Implementing a defined function or fix, writing tests for known behavior, routine refactors, drafting docs, single-dimension review passes |
| `opus` | Judgment-heavy or high-stakes work | Architecture and design tradeoffs, debugging with unknown root cause, ambiguous multi-step planning, final synthesis across many agents' results |
| omit | Inherited default is already right, or the task is mixed and unsplittable (rule 5) | Fallback, not the default: when a row clearly fits and nothing stronger is inherited, set the tier — this skill intentionally overrides omit-by-default habits |

Resolution order, before the table:

- **The tool schema is the source of truth for tier names.** Pass only a
  value the current `Agent` / `agent()` schema declares. If a tier named
  here is absent, map the subtask to the nearest declared tier or omit
  `model`. Never keep a model-id, price, or release list in this skill.
- An explicit user model choice always wins; at most note a cheaper
  alternative once.
- If the chosen agentType declares its own `model` in its agent
  definition, omit `model` unless a row clearly demands a different
  tier. Omitting yields that declared model, or the parent's model when
  the definition declares none — so omission under-tiers only in the
  latter case.
- `model` is **ignored for `subagent_type: "fork"`**; forks always
  inherit the parent model. Don't assign a tier to a fork — spawn a
  fresh agent if the subtask needs a different one.
- If a subtask fits more than one row, take the highest matching
  tier — or split it (rule 5).
- If the schema declares a tier above `opus`, treat it as specialized,
  not as the new ceiling: use it only for the single final synthesis or
  verification agent, or when the user asked for maximum quality.

## Reasoning Effort

Only Workflow `agent()` takes `opts.effort`
(`low` | `medium` | `high` | `xhigh` | `max`). The `Agent` tool has no
effort parameter — don't try to pass one there. Omitting `effort`
inherits the session effort, which is the default and usually correct.

Set it only when a stage clearly deviates from that default:

- `low` for cheap mechanical stages that pair with `haiku`.
- `high` for debugging, nontrivial review, or integration judgment.
- `xhigh` / `max` only for the rare final synthesis or highest-risk
  verify stage, where depth beats latency.

`model` and `effort` are orthogonal: pick the tier from the table first,
then adjust effort. Raising effort does not rescue an under-tiered
agent, and neither substitutes for a well-scoped prompt.

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
   weak or uncertain result, rerun that one subtask one tier up. At the
   top declared tier, raise `effort` instead (Workflow only) or pull the
   work into the main loop. If the escalated rerun is still weak, stop
   delegating and surface the uncertainty. Never retry at the same
   settings and never silently accept.
5. **Mixed task, split it.** If one subtask has both a mechanical
   part and a judgment part, split into two agents at two tiers
   rather than sending the whole thing to the high tier. If the
   parts can't be separated cleanly, omit `model` instead.

## Pairing With Parallel Execution

Use `parallel-agent-execution` first to decide whether parallel work is
worth it, which execution mode is safe, and what ownership boundaries
apply. Use this skill only after that, to pick the tier and effort for
each delegated subagent.

## When Invoked Directly

If the user invokes this skill by name, list the subtasks you are
about to delegate, the tier and any effort override assigned to each
(`omit` is a valid setting), and a one-line reason per assignment. Then
proceed with the delegation only if the user asked for the work itself;
if they asked only for the tiering plan, stop there.
