# Brief Templates

Use these short templates to keep the loop auditable without bloating
handoffs. Copy the smallest template that still preserves the contract.

## Scope Brief

```text
Request: <what must change>
Constraints: <repo/policy/deadline/environment>
Acceptance target: <what must be true to close>
Artifact type: <code | docs | prompt | config | skill | mixed>
Target scope: <files/modules/diff boundary>
Verification anchors:
1. <test/command/render/manual check>
2. <test/command/render/manual check>
Capabilities:
- Delegation: <available | unavailable>
- Edit mode: <direct edits | patch proposal | mixed>
- Base state: <branch/ref/diff anchor/worktree contract>
- Review isolation: <independent enough | not enough>
Topology:
- Mode: <audit-first | implementation-first | mixed handoff>
- Coding owner(s): <owner -> boundary>
- Review passes: <2 for non-code, 3 for code/mixed by default>
```

## Review Brief

```text
Review the target scope independently.

Target scope: <files/modules/diff>
Artifact type: <code | docs | prompt | config | skill | mixed>
Optional lens: <correctness | integration | verification | usability>

Rules:
1. Findings first, ordered by severity.
2. Ignore style-only comments.
3. Do not rely on prior reviewer conclusions.
4. Say explicitly if no meaningful findings were found.

Finding shape:
- Severity: <blocking | major | minor>
- Title: <short defect summary>
- Evidence: <one concrete anchor>
- Confirming check: <command/scenario/manual check>
```

## Fix Brief

```text
Task: <feature/fix/issue-group summary>
Issue ids: <IG-001, IG-002>
Ownership: <files/modules/boundary>
Base state: <branch/ref/diff anchor/worktree contract>
Change mode: <edit directly | propose patch>
Requirements:
1. <required behavior>
2. <required behavior>
Do not break: <interfaces/callers/configs/docs>
Verification:
1. <test/command>
2. <manual or artifact check if needed>
Out of scope: <explicit exclusions>

Output:
- Changed files: <list>
- Issue ids updated: <list>
- Verification: <ran/skipped/blocked> with result
- Residual risks: <brief note>
```

## Accepted Issue Summary

```text
Loop: <number>

Accepted blocking issues:
- <IG-001> - <title> - owner: <owner>
  Evidence: <anchor>
  Verification: <checks to rerun>
  Disposition: <open | fixed | disproved | downgraded>

Accepted major issues:
- <IG-002> - <title> - owner: <owner>
  Evidence: <anchor>
  Verification: <checks to rerun>
  Disposition: <open | fixed | disproved | downgraded>

Non-blocking notes:
- <note>

Review confidence: <independent delegated review>
Stop decision: <another loop required | ready to close | blocked>
```

## Loop Ledger

```text
Loop ledger: <number>
Work completed: <what changed>

Issue status:
- <IG-001> - <open | fixed | disproved | downgraded> - <one-line reason>
- <IG-002> - <open | fixed | disproved | downgraded> - <one-line reason>

Verification rerun:
1. <command/check> - <pass | fail | infeasible>
2. <command/check> - <pass | fail | infeasible>

Review result: <no new meaningful findings | new issue ids | follow-up needed>
Next action: <another fix loop | close | blocked>
```

## Final Status

```text
Request satisfied: <yes | no | partially>

Verification:
1. <command/check> - <pass | fail | infeasible>
2. <command/check> - <pass | fail | infeasible>

Accepted issue ids:
- <IG-001> - <fixed | disproved | downgraded> - <closure evidence>
- <IG-002> - <fixed | disproved | downgraded> - <closure evidence>

Review confidence: <independent delegated review>
Residual risks: <risk or none>
Close decision: <ready to close | blocked | needs decision>
```

Severity semantics:

- `blocking`: must be fixed, disproved, or downgraded before closing.
- `major`: should enter the next fix loop unless explicitly downgraded.
- `minor`: keep as a note unless it is nearly free and clearly safe.
