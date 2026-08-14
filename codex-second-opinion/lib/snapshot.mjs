// Build an isolated copy of a live review scope. Codex can spend minutes
// reading this copy while the caller keeps editing the source repository.

import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { die, flat } from './runtime.mjs'

const SNAPSHOT_TIMEOUT_MS = 120000

function command(env, cwd, args, input) {
  const result = spawnSync('git', args, {
    cwd,
    env: env.baseEnv,
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    timeout: SNAPSHOT_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
  if (result.error) return { status: 127, stdout: '', stderr: result.error.message }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function git(env, args, options = {}) {
  return command(env, options.cwd || env.repoRoot, args, options.input)
}

function mustGit(env, args, description, options = {}) {
  const result = git(env, args, options)
  if (result.status !== 0) {
    const detail = result.stderr.trim() ? `: ${flat(result.stderr.trim())}` : ''
    die(3, `error: could not ${description}${detail}`)
  }
  return result.stdout
}

function nulList(output) {
  return output.split('\0').filter(Boolean)
}

function safePath(root, path) {
  if (!path || isAbsolute(path)) die(3, `error: unsafe path in git snapshot: ${flat(path)}`)
  const target = resolve(root, path)
  const rel = relative(root, target)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    die(3, `error: unsafe path in git snapshot: ${flat(path)}`)
  }
  return target
}

function isInside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function bestRealpath(path) {
  let probe = resolve(path)
  const pending = []
  for (;;) {
    try {
      const real = realpathSync(probe)
      return pending.length ? join(real, ...pending) : real
    } catch {}
    const parent = dirname(probe)
    if (parent === probe) return resolve(path)
    pending.unshift(basename(probe))
    probe = parent
  }
}

function rejectSymlinkAncestor(root, path) {
  const parts = path.split(sep).slice(0, -1)
  let cursor = root
  for (const part of parts) {
    cursor = join(cursor, part)
    let stat
    try {
      stat = lstatSync(cursor)
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return
      die(3, `error: cannot inspect path ancestors for ${flat(path)}: ${flat(error.message)}`)
    }
    if (stat.isSymbolicLink()) {
      die(3,
        `error: cannot snapshot ${flat(path)} because ancestor ${flat(relative(root, cursor))} is a symbolic link.`,
        'hint: restore a normal repository directory, or commit a reviewable tree and use --commit.')
    }
  }
}

function changedPaths(review, env) {
  const unmerged = mustGit(env,
    ['diff', '--name-only', '-z', '--diff-filter=U', '--'],
    'check the working tree for unresolved merges')
  if (unmerged) {
    die(3,
      'error: cannot snapshot a working tree with unresolved merge entries.',
      'hint: resolve the conflicts first, or review an existing commit with --commit.')
  }

  const staged = nulList(mustGit(env,
    ['diff', '--cached', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', 'HEAD', '--'],
    'list staged files'))
  const unstaged = nulList(mustGit(env,
    ['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--'],
    'list unstaged files'))
  const untracked = review.scopeFlag === '--uncommitted'
    ? nulList(mustGit(env,
      ['ls-files', '--others', '--exclude-standard', '-z', '--'],
      'list untracked files'))
    : []

  const paths = [...new Set([...staged, ...unstaged, ...untracked])].sort()
  if (!paths.length && review.scopeFlag === '--uncommitted') {
    die(2, 'nothing to review: no staged, unstaged, or untracked changes')
  }

  const stages = nulList(mustGit(env, ['ls-files', '--stage', '-z'], 'inspect submodule entries'))
  const submodules = new Set()
  for (const record of stages) {
    const match = /^160000 [0-9a-f]+ \d+\t(.*)$/s.exec(record)
    if (match) submodules.add(match[1])
  }
  for (const path of paths) {
    if (submodules.has(path)) {
      die(3,
        `error: cannot snapshot live changes inside submodule ${flat(path)}.`,
        'hint: commit the submodule and superproject change, then review with --commit.')
    }
  }
  return paths
}

function fingerprintEntry(hash, root, path) {
  const source = safePath(root, path)
  rejectSymlinkAncestor(root, path)
  hash.update(`path\0${path}\0`)
  let stat
  try {
    stat = lstatSync(source)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      hash.update('deleted\0')
      return
    }
    die(3, `error: cannot inspect ${flat(path)} while creating the review snapshot: ${flat(error.message)}`)
  }
  hash.update(`mode\0${stat.mode & 0o7777}\0`)
  if (stat.isSymbolicLink()) {
    hash.update('symlink\0')
    hash.update(readlinkSync(source))
    hash.update('\0')
    return
  }
  if (!stat.isFile()) {
    die(3,
      `error: cannot snapshot directory entry ${flat(path)}; it may be an embedded repository.`,
      'hint: add or ignore its files explicitly, or commit a reviewable tree and use --commit.')
  }
  hash.update('file\0')
  hash.update(readFileSync(source))
  hash.update('\0')
}

function captureState(review, env) {
  const head = mustGit(env, ['rev-parse', '--verify', 'HEAD'], 'resolve HEAD').trim()
  const paths = changedPaths(review, env)
  const indexPatch = mustGit(env,
    ['diff', '--cached', '--binary', '--full-index', '--src-prefix=a/', '--dst-prefix=b/', '--no-ext-diff', '--no-textconv', 'HEAD', '--'],
    'capture the staged changes')
  const hash = createHash('sha256')
  hash.update(`head\0${head}\0`)
  hash.update('index\0')
  hash.update(indexPatch)
  hash.update('\0')
  for (const path of paths) fingerprintEntry(hash, env.repoRoot, path)
  return { head, paths, indexPatch, fingerprint: hash.digest('hex') }
}

function copyEntry(sourceRoot, targetRoot, path) {
  const source = safePath(sourceRoot, path)
  const target = safePath(targetRoot, path)
  rejectSymlinkAncestor(sourceRoot, path)
  rejectSymlinkAncestor(targetRoot, path)
  rmSync(target, { recursive: true, force: true })
  let stat
  try {
    stat = lstatSync(source)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    die(3, `error: cannot copy ${flat(path)} into the review snapshot: ${flat(error.message)}`)
  }
  mkdirSync(dirname(target), { recursive: true })
  if (stat.isSymbolicLink()) {
    symlinkSync(readlinkSync(source), target)
  } else if (stat.isFile()) {
    copyFileSync(source, target)
    chmodSync(target, stat.mode & 0o7777)
  } else {
    die(3,
      `error: cannot snapshot directory entry ${flat(path)}; it may be an embedded repository.`,
      'hint: add or ignore its files explicitly, or commit a reviewable tree and use --commit.')
  }
}

function materialize(env, snapshotRepo, state) {
  mustGit(env, ['-C', snapshotRepo, 'reset', '--hard', '--quiet', state.head], 'reset the review snapshot')
  mustGit(env, ['-C', snapshotRepo, 'clean', '-fdq'], 'clean the review snapshot')
  if (state.indexPatch) {
    mustGit(env,
      ['-C', snapshotRepo, 'apply', '--cached', '--binary', '--whitespace=nowarn', '-'],
      'restore the staged changes in the review snapshot',
      { input: state.indexPatch })
  }
  for (const path of state.paths) copyEntry(env.repoRoot, snapshotRepo, path)
}

function guardSnapshotSymlinks(review, env, state, sourceRoot) {
  const changed = new Set(state.paths)
  // state.paths diffs against HEAD only; a --base review also covers what
  // the branch commits changed since the merge base, so those paths are
  // reviewed content too.
  if (review.resolvedBase) {
    for (const path of nulList(mustGit(env,
      ['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', review.resolvedBase, '--'],
      'list the base-review changes in the snapshot'))) changed.add(path)
  }
  const candidates = new Set(changed)
  for (const record of nulList(mustGit(env, ['ls-files', '--stage', '-z'], 'inspect snapshot symlinks'))) {
    const match = /^120000 [0-9a-f]+ \d+\t(.*)$/s.exec(record)
    if (match) candidates.add(match[1])
  }
  if (review.scopeFlag === '--uncommitted') {
    for (const path of nulList(mustGit(env,
      ['ls-files', '--others', '--exclude-standard', '-z', '--'],
      'inspect untracked snapshot symlinks'))) candidates.add(path)
  }

  const root = realpathSync(env.repoRoot)
  for (const path of candidates) {
    const link = safePath(root, path)
    let stat
    try {
      stat = lstatSync(link)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      die(3, `error: cannot inspect snapshot symlink ${flat(path)}: ${flat(error.message)}`)
    }
    if (!stat.isSymbolicLink()) continue
    const target = bestRealpath(resolve(dirname(link), readlinkSync(link)))
    // A changed symlink is part of the reviewed content and must stay inside
    // the clone. An unchanged one is tolerated wherever it points — the same
    // exposure a live-repository review has — unless it resolves back into
    // the live source repository, where it would alias files the caller may
    // still be editing.
    const breaksIsolation = changed.has(path)
      ? !isInside(root, target)
      : isInside(sourceRoot, target)
    if (breaksIsolation) {
      die(3,
        `error: snapshot symlink ${flat(path)} resolves outside the isolated review repository.`,
        'hint: replace it with a repository-local link, or review an immutable commit with --commit.')
    }
  }
}

function ensureCommit(env, snapshotRepo, commit, description) {
  const present = git(env, ['-C', snapshotRepo, 'cat-file', '-e', `${commit}^{commit}`])
  if (present.status === 0) return
  mustGit(env,
    ['-C', snapshotRepo, 'fetch', '--quiet', '--no-tags', '--', env.repoRoot, commit],
    description)
}

function scrubSourceMetadata(snapshotRepo) {
  rmSync(join(snapshotRepo, '.git', 'logs'), { recursive: true, force: true })
  rmSync(join(snapshotRepo, '.git', 'FETCH_HEAD'), { force: true })
}

export function createReviewSnapshot(review, env) {
  if (!['--uncommitted', '--base'].includes(review.scopeFlag)) return null

  const container = mkdtempSync(join(env.scratch, 'codex-review-snapshot-'))
  const snapshotRepo = join(container, 'repo')
  const cleanup = () => {
    try {
      rmSync(container, { recursive: true, force: true })
    } catch (error) {
      process.stderr.write(`warning: could not remove review snapshot ${flat(container)}: ${flat(error.message)}\n`)
    }
  }
  const signalHandlers = new Map()
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    const handler = () => {
      cleanup()
      process.exit(code)
    }
    signalHandlers.set(signal, handler)
    process.once(signal, handler)
  }
  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler)
  }
  try {
    let before = captureState(review, env)
    mustGit(env,
      ['clone', '--quiet', '--no-hardlinks', '--no-checkout', '--', env.repoRoot, snapshotRepo],
      'clone the repository for an isolated review snapshot',
      { cwd: env.scratch })

    // A linked worktree's HEAD can be absent from the refs copied by clone.
    ensureCommit(env, snapshotRepo, before.head, 'copy the current HEAD into the review snapshot')
    if (review.resolvedBase) {
      ensureCommit(env, snapshotRepo, review.resolvedBase, 'copy the resolved base into the review snapshot')
    }
    mustGit(env, ['-C', snapshotRepo, 'remote', 'remove', 'origin'], 'detach the review snapshot from the source repository')

    let stable = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      ensureCommit(env, snapshotRepo, before.head, 'copy the updated HEAD into the review snapshot')
      materialize(env, snapshotRepo, before)
      const after = captureState(review, env)
      const snapshotEnv = { ...env, cwd: snapshotRepo, repoRoot: snapshotRepo }
      const copied = captureState(review, snapshotEnv)
      if (before.fingerprint === after.fingerprint && copied.fingerprint === after.fingerprint) {
        guardSnapshotSymlinks(review, snapshotEnv, after, env.repoRoot)
        stable = after
        break
      }
      if (before.fingerprint === after.fingerprint) {
        die(3, 'error: the isolated review snapshot did not match the source state; refusing an incomplete review.')
      }
      before = after
    }
    if (!stable) {
      die(3,
        'error: the working tree kept changing while the review snapshot was being created.',
        'hint: pause edits until the wrapper prints the snapshot: ready marker, then continue normally.')
    }
    scrubSourceMetadata(snapshotRepo)

    const relativeCwd = relative(env.repoRoot, env.cwd)
    const snapshotCwd = safePath(snapshotRepo, relativeCwd || '.')
    process.stderr.write(`snapshot: ready ${stable.fingerprint}\n`)
    const snapshotEnv = {
      ...env,
      cwd: snapshotCwd,
      repoRoot: snapshotRepo,
      baseEnv: { ...env.baseEnv, PWD: snapshotCwd, OLDPWD: snapshotCwd },
    }
    removeSignalHandlers()
    return {
      env: snapshotEnv,
      cleanup,
      fingerprint: stable.fingerprint,
    }
  } catch (error) {
    removeSignalHandlers()
    cleanup()
    throw error
  }
}
