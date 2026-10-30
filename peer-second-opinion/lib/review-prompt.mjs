// Prompt pieces the wrapper builds: the note every review and consult
// carries, and the review prompt for a CLI with no review command of its own
// (Command Code): the scope in prose, the authoritative diff, and the report
// contract that makes the answer parseable.

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

// Review and consult run without a sandbox, with the user's own shell, so
// the peer can build and test in the real environment — dependencies,
// caches, services. This note is the only thing keeping the run from
// changing the repository. Measured on Command Code 2026-10-14 with this
// note's read-only predecessor: without it, 4/4 "fix it"-style consults
// tried to edit the repository; with it, 0/4. Comparing revisions goes through a copy under scratch because the
// natural move — stash or checkout in place — would wreck concurrent work.
export function investigationNote(scratch) {
  return `---
This is a second opinion, run headlessly with the user's own shell and no sandbox. Investigate as far as the question needs: read code and git history, build, run tests, linters and analyzers, and write small reproductions. Put reproduction files and every output you can redirect (temporary files, build output, coverage, reports) under ${scratch}. To examine another revision, read it with \`git show REV:PATH\` or extract it into a new directory under ${scratch} with \`git archive REV | tar -x -C DIR\`.
Do not modify the repository: no edits to source, configuration, lockfiles, snapshots or expected outputs, and no git state changes (no commit, checkout, switch, reset, restore, stash, clean, worktree or push). Do not install or upgrade anything, and do not change anything outside this machine. If a check leaves a file in the repository that you created, delete it; never delete a file you did not create. Do not offer to make changes.
End your answer with a paragraph that starts with "Verification:" naming the commands you ran and their outcomes, and the checks you skipped or could not run and why. For each failure, say whether it came from the code or from the environment (a missing dependency, service, network access or credential).`
}

// Every review prompt carries the same mechanical facts — status, untracked
// list, authoritative diff — whichever scope named them.
export function reviewPrompt(review, scope, note) {
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
  parts.push(REPORT_CONTRACT, note)
  return `${parts.join('\n\n')}\n`
}
