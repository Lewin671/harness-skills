// The wrapper-built review prompt, for providers whose CLI has no review
// command of its own (Command Code, dsh): the scope in prose, the
// authoritative diff, and the report contract that makes the answer
// parseable. Each provider appends its own read-only note.

import { contextFence } from './scope.mjs'

// The report shape the wrapper asks for. Without a built-in review prompt,
// this contract IS the review prompt.
const REPORT_CONTRACT = `Report your findings as Markdown, in exactly this shape:

<one paragraph: the overall verdict>

- [P1] <title> — <path>:<line-range>
  <body>

One bullet per finding, priority ordered: [P0] most severe, then [P1], [P2], [P3]. Anchor each finding to a path and a line range. If there is nothing to report, say so explicitly in the verdict and return no bullets — never invent a finding to fill the list.`

function scopeSentence(scope) {
  if (scope.scopeFlag === '--uncommitted') {
    return 'Review the uncommitted changes in this repository: staged, unstaged, and untracked files. The authoritative diff for this review is included below, together with the `git status --porcelain` output captured when the review started.'
  }
  if (scope.scopeFlag === '--base') {
    return `Review the changes on the current branch against base ${scope.scopeValue}: the diff from merge base ${scope.resolvedBase} to the working tree. Do not review anything already contained in ${scope.scopeValue}.`
  }
  return `Review only the changes introduced by commit ${scope.resolvedCommit} (given as ${scope.scopeValue}). Do not review unrelated code.`
}

// Every review prompt carries the same mechanical facts — status, untracked
// list, authoritative diff — whichever scope named them.
export function reviewPrompt(review, scope, readOnlyNote) {
  const parts = [review.scopeFlag === '--custom' ? review.scopeValue : scopeSentence(scope)]
  if (scope.status) {
    parts.push(`Working tree when the review started (\`git status --porcelain\`):\n\n\`\`\`\n${scope.status}\n\`\`\``)
  }
  if (scope.untracked.length) {
    parts.push(`Untracked files — read them directly, their contents are not in the diff:\n\n\`\`\`\n${scope.untracked.join('\n')}\n\`\`\``)
  }
  if (scope.diff) parts.push(`Authoritative diff for this review (\`git diff\`):\n\n\`\`\`diff\n${scope.diff}\n\`\`\``)
  if (scope.diffTruncated) parts.push('The diff above was truncated. Read the affected files directly to review the parts the diff does not show.')
  if (review.context) parts.push(contextFence(review.context))
  parts.push(REPORT_CONTRACT, readOnlyNote)
  return `${parts.join('\n\n')}\n`
}
