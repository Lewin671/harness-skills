// Live-tree scope resolution and identity for run-command-code-second-opinion.mjs.
//
// There is no snapshot clone here on purpose. The reviewer reads the live
// repository, so the wrapper's job is not to freeze bytes but to (a) enumerate
// exactly which paths a scope covers, (b) hand the model an authoritative diff
// so the scope is fixed by the wrapper rather than by whatever the model runs,
// and (c) fingerprint those paths before and after so a result can be tied to
// the bytes it actually saw.
//
// The guard is a detector, not a lock: the run has a shell (see buildArgs in
// lib/runtime.mjs), so drift is reported after the fact rather than prevented.

import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { die, flat } from './runtime.mjs'

// A diff past this size is cut with an explicit marker: the reviewer still has
// file reads, and an unbounded prompt would push the run toward the context
// ceiling for no extra signal.
export const MAX_DIFF_BYTES = 400000

const GIT_READ = ['--no-optional-locks']

function nulList(output) {
  return output.split('\0').filter(Boolean)
}

function safePath(root, path) {
  if (!path || isAbsolute(path)) die(11, `error: unsafe path in git output: ${flat(path)}`)
  const target = resolve(root, path)
  const rel = relative(root, target)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    die(11, `error: unsafe path in git output: ${flat(path)}`)
  }
  return target
}

function gitDetail(result) {
  return result.stderr.trim() ? `: ${flat(result.stderr.trim())}` : ''
}

// Refuses to spend a model run on an empty scope: the CLI treats "there are no
// changes" as an ordinary successful answer, which reads like a clean review.
function mustResolveBase(review, env) {
  const verified = env.git(['rev-parse', '--verify', '--quiet', review.scopeValue])
  if (verified.status !== 0) die(11, `error: no such branch or ref: ${flat(review.scopeValue)}`)
  const mergeBase = env.git(['merge-base', review.scopeValue, 'HEAD'])
  if (mergeBase.status !== 0 || !mergeBase.stdout.trim()) {
    die(11, `error: ${flat(review.scopeValue)} and HEAD have no common ancestor`)
  }
  const resolvedBase = mergeBase.stdout.trim()
  const diff = env.git([...GIT_READ, 'diff', '--no-ext-diff', '--no-textconv', '--quiet', resolvedBase])
  if (diff.status === 0) {
    die(2, `nothing to review: no changes since the merge base with ${flat(review.scopeValue)}`)
  }
  if (diff.status !== 1) {
    die(11, `error: git diff failed against merge base ${resolvedBase}${gitDetail(diff)}`)
  }
  return resolvedBase
}

function mustResolveCommit(review, env) {
  const commit = env.git(['rev-parse', '--verify', '--quiet', `${review.scopeValue}^{commit}`])
  if (commit.status !== 0 || !commit.stdout.trim()) die(11, `error: no such commit: ${flat(review.scopeValue)}`)
  const resolvedCommit = commit.stdout.trim()
  const parent = env.git(['rev-parse', '--verify', '--quiet', `${resolvedCommit}^1`])
  let files
  let resolvedParent = ''
  if (parent.status === 0) {
    resolvedParent = parent.stdout.trim()
    files = env.git([...GIT_READ, 'diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', resolvedParent, resolvedCommit])
  } else {
    files = env.git(['show', '--pretty=format:', '--name-only', '-z', resolvedCommit])
  }
  if (files.status !== 0) die(11, `error: git could not list ${flat(review.scopeValue)}${gitDetail(files)}`)
  const paths = nulList(files.stdout)
  if (!paths.length) die(2, `nothing to review: ${flat(review.scopeValue)} is an empty commit`)
  return { commit: resolvedCommit, parent: resolvedParent, paths }
}

// A listing call that fails is a wrapper bug, never an empty scope: swallowing
// the status would turn "git rejected these arguments" into "nothing to
// review", which reads like a clean tree.
function mustList(env, args, what) {
  const result = env.git(args)
  if (result.status !== 0) {
    die(11, `error: git could not ${what}${gitDetail(result)}`, `hint: the arguments were: git ${args.join(' ')}`)
  }
  return result.stdout
}

function rawChangedSet(env) {
  const list = ['--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none']
  return {
    staged: nulList(mustList(env, [...GIT_READ, 'diff', '--name-only', '-z', '--cached', ...list, 'HEAD', '--'], 'list staged files')),
    unstaged: nulList(mustList(env, [...GIT_READ, 'diff', '--name-only', '-z', ...list, '--'], 'list unstaged files')),
    untracked: nulList(mustList(env, ['ls-files', '--others', '--exclude-standard', '-z', '--'], 'list untracked files')),
  }
}

function newScope(scopeFlag, scopeValue) {
  return {
    scopeFlag,
    scopeValue,
    resolvedBase: '',
    resolvedCommit: '',
    resolvedParent: '',
    paths: [],
    untracked: [],
    status: '',
    diff: '',
    diffTruncated: false,
    durable: false,
  }
}

function changedPaths(review, env) {
  const unmerged = env.git([...GIT_READ, 'diff', '--name-only', '-z', '--diff-filter=U', '--'])
  if (unmerged.status !== 0) die(11, `error: git could not check the working tree${gitDetail(unmerged)}`)
  if (unmerged.stdout) {
    die(11,
      'error: cannot review a working tree with unresolved merge entries.',
      'hint: resolve the conflicts first, or review an existing commit with --commit.')
  }

  const { staged, unstaged, untracked } = rawChangedSet(env)
  const includeUntracked = review.scopeFlag === '--uncommitted' || review.scopeFlag === '--custom'
  return {
    paths: [...new Set([...staged, ...unstaged, ...(includeUntracked ? untracked : [])])].sort(),
    untracked: includeUntracked ? untracked : [],
  }
}

// A consult has no declared scope, so its identity is the changed set alone.
// Weaker than a review's by construction — it says nothing about untouched
// files the question was about — and tolerant by design: a question can
// legitimately be asked about a tree mid-merge, so no scope refusal applies.
export function consultScope(env) {
  const scope = newScope('--consult', '')
  if (!env.repoRoot) return scope
  const { staged, unstaged, untracked } = rawChangedSet(env)
  scope.paths = [...new Set([...staged, ...unstaged, ...untracked])].sort()
  scope.untracked = untracked
  return scope
}

function submodulePaths(env) {
  const stages = env.git(['ls-files', '--stage', '-z'])
  if (stages.status !== 0) return new Set()
  const set = new Set()
  for (const record of nulList(stages.stdout)) {
    const match = /^160000 [0-9a-f]+ \d+\t(.*)$/s.exec(record)
    if (match) set.add(match[1])
  }
  return set
}

function capDiff(text) {
  if (Buffer.byteLength(text, 'utf8') <= MAX_DIFF_BYTES) return { text, truncated: false }
  // Decoded with the stream flag so a cut landing mid-character drops the
  // incomplete sequence instead of replacing it with U+FFFD.
  const cut = new TextDecoder('utf-8').decode(Buffer.from(text, 'utf8').subarray(0, MAX_DIFF_BYTES), { stream: true })
  return {
    text: `${cut}\n\n[... diff truncated at ${MAX_DIFF_BYTES} bytes; read the affected files directly for the rest ...]\n`,
    truncated: true,
  }
}

// The diff is produced by the wrapper's own read-only git call and travels as
// DATA in the prompt. That keeps a review of uncommitted work reproducible and
// independent of whether the model thinks to reach for a shell it may not have.
// It reads the resolved scope, not the caller's request: the base and commit
// this diff is taken against are the resolved ones.
function collectDiff(scope, env) {
  const base = [
    ...GIT_READ, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/',
  ]
  if (scope.scopeFlag === '--uncommitted') {
    return env.git([...base, 'HEAD', '--'])
  }
  if (scope.scopeFlag === '--base') {
    return env.git([...base, scope.resolvedBase, '--'])
  }
  if (scope.scopeFlag === '--commit') {
    if (scope.resolvedParent) return env.git([...base, scope.resolvedParent, scope.resolvedCommit, '--'])
    return env.git(['show', '--no-ext-diff', '--no-textconv', '--format=', '--patch', scope.resolvedCommit])
  }
  return null
}

export function resolveScope(review, env) {
  const scope = newScope(review.scopeFlag, review.scopeValue)

  if (review.scopeFlag === '--base') {
    scope.resolvedBase = mustResolveBase(review, env)
    const { paths, untracked } = changedPaths(review, env)
    scope.paths = paths
    scope.untracked = untracked
    if (!paths.length) die(2, `nothing to review: no changes since the merge base with ${flat(review.scopeValue)}`)
  } else if (review.scopeFlag === '--commit') {
    const resolved = mustResolveCommit(review, env)
    scope.resolvedCommit = resolved.commit
    scope.resolvedParent = resolved.parent
    scope.paths = resolved.paths
    // The commit object is durable, but the reviewer reads the live tree, so
    // those paths are still fingerprinted.
    scope.durable = true
  } else {
    // --uncommitted (default) and --custom share the changed-set enumeration;
    // only --uncommitted refuses an empty scope.
    const { paths, untracked } = changedPaths(review, env)
    scope.paths = paths
    scope.untracked = untracked
    if (!paths.length && review.scopeFlag === '--uncommitted') {
      die(2, 'nothing to review: no staged, unstaged, or untracked changes')
    }
  }

  // A gitlink bump inside a commit is an ordinary reviewed change, so the
  // submodule refusal applies to the live scopes only: a change inside a
  // submodule's own working tree cannot be reviewed from this repository.
  const submodules = submodulePaths(env)
  if (!scope.durable) {
    for (const path of scope.paths) {
      if (submodules.has(path)) {
        die(11,
          `error: cannot review live changes inside submodule ${flat(path)}.`,
          'hint: commit the submodule and superproject change, then review with --commit.')
      }
    }
  }

  const status = env.git([...GIT_READ, 'status', '--porcelain=v1', '--untracked-files=normal'])
  if (status.status === 0) scope.status = status.stdout.trim()
  const diff = collectDiff(scope, env)
  if (diff && diff.status === 0) {
    const capped = capDiff(diff.stdout)
    scope.diff = capped.text
    scope.diffTruncated = capped.truncated
  }
  return scope
}

// Identity of the reviewed bytes: the commit the scope is anchored to, the
// index contents, the working-tree status, and every scoped path's mode plus
// bytes (or link target, read without following so a symlinked path cannot pull
// in an outside file).
//
// The status line is in the digest on purpose. Hashing only the scoped paths
// would miss a file the run creates during the review — a path that was not in
// the set when it was resolved is not in the set afterwards either — which is
// exactly the mutation a delegated sub-agent can still perform. `--ignored`
// extends that to ignored paths, where a build directory or a local `.env` would
// otherwise be a blind spot.
//
// KNOWN BLIND SPOT — an in-place rewrite of an *existing* ignored file, and any
// write under `.git/`, still leave this digest unchanged, because neither the
// name nor the bytes of those paths are hashed. Hashing ignored file contents
// would make the cost of a run proportional to `node_modules`. The docs say so
// next to the drift warning; do not describe the identity as proving the tree
// was untouched.
export function fingerprintScope(env, scope) {
  const hash = createHash('sha256')
  const head = env.git(['rev-parse', '--verify', '--quiet', 'HEAD'])
  hash.update(`head\0${head.status === 0 ? head.stdout.trim() : 'unborn'}\0`)
  hash.update(`scope\0${scope.scopeFlag}\0${scope.resolvedBase}\0${scope.resolvedCommit}\0`)
  const indexPatch = env.git([...GIT_READ, 'diff', '--cached', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', 'HEAD', '--'])
  hash.update('index\0')
  hash.update(indexPatch.status === 0 ? indexPatch.stdout : '')
  hash.update('\0')
  const status = env.git([...GIT_READ, 'status', '--porcelain=v1', '--untracked-files=normal', '--ignored=matching'])
  hash.update('status\0')
  hash.update(status.status === 0 ? status.stdout : '')
  hash.update('\0')
  const root = env.repoRoot || env.cwd
  for (const path of scope.paths) {
    hash.update(`path\0${path}\0`)
    let stat
    try {
      stat = lstatSync(safePath(root, path))
    } catch (error) {
      if (error?.code === 'ENOENT') {
        hash.update('absent\0')
        continue
      }
      die(11, `error: cannot inspect ${flat(path)} while fingerprinting: ${flat(error.message)}`)
    }
    hash.update(`mode\0${stat.mode & 0o7777}\0`)
    if (stat.isSymbolicLink()) {
      hash.update('symlink\0')
      hash.update(readlinkSync(safePath(root, path)))
      hash.update('\0')
    } else if (stat.isFile()) {
      hash.update('file\0')
      hash.update(readFileSync(safePath(root, path)))
      hash.update('\0')
    } else {
      hash.update('other\0')
    }
  }
  return hash.digest('hex')
}
