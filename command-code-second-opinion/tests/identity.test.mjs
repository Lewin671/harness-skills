// Unit tests for lib/identity.mjs: scope resolution and the reviewed-bytes
// fingerprint. These exercise the module directly with a hand-built env, so
// they need no CLI and no model call.

import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { MAX_DIFF_BYTES, consultScope, fingerprintScope, resolveScope } from '../lib/identity.mjs'

let root
let repo

function sh(command, cwd = repo) {
  const result = spawnSync('/bin/sh', ['-c', command], { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `setup failed: ${command}\n${result.stderr}`)
  return result.stdout
}

// identity.mjs touches only env.cwd, env.repoRoot and env.git.
function makeEnv(dir) {
  return {
    cwd: dir,
    repoRoot: dir,
    git(args) {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    },
  }
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'cmd-identity-'))
  repo = join(root, 'repo')
  mkdirSync(repo)
  sh('git init -q')
  writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
  sh('git add tracked.txt && git -c user.email=t@t -c user.name=t commit -q -m init')
})

after(() => {
  rmSync(root, { recursive: true, force: true })
})

function uncommitted(env = makeEnv(repo)) {
  return resolveScope({ scopeFlag: '--uncommitted', scopeValue: '' }, env)
}

test('an empty uncommitted scope is refused with exit 2, but --custom tolerates it', () => {
  assert.throws(() => uncommitted(), (error) => {
    assert.equal(error.code, 2)
    assert.match(error.message, /nothing to review/)
    return true
  })
  const custom = resolveScope({ scopeFlag: '--custom', scopeValue: 'review whatever matters' }, makeEnv(repo))
  assert.deepEqual(custom.paths, [])
})

test('--uncommitted covers untracked files while --base does not', () => {
  writeFileSync(join(repo, 'tracked.txt'), 'changed\n')
  writeFileSync(join(repo, 'untracked.txt'), 'new\n')
  try {
    const dirty = uncommitted()
    assert.deepEqual(dirty.paths, ['tracked.txt', 'untracked.txt'])
    assert.deepEqual(dirty.untracked, ['untracked.txt'])
    // --base reports the tracked change since the merge base and ignores an
    // unrelated untracked file. Its diff is the resolved one, not an empty
    // string assembled from an unresolved argument.
    const base = resolveScope({ scopeFlag: '--base', scopeValue: 'HEAD' }, makeEnv(repo))
    assert.deepEqual(base.paths, ['tracked.txt'])
    assert.deepEqual(base.untracked, [])
    assert.match(base.diff, /-committed/)
    assert.match(base.diff, /\+changed/)
  } finally {
    rmSync(join(repo, 'untracked.txt'), { force: true })
    writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
  }
})

test('the fingerprint is deterministic for one tree state', () => {
  writeFileSync(join(repo, 'tracked.txt'), 'changed\n')
  try {
    const scope = uncommitted()
    const first = fingerprintScope(makeEnv(repo), scope)
    const second = fingerprintScope(makeEnv(repo), scope)
    assert.match(first, /^[0-9a-f]{64}$/)
    assert.equal(first, second)
  } finally {
    writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
  }
})

test('staged content and working-tree content are distinct states', () => {
  writeFileSync(join(repo, 'tracked.txt'), 'staged\n')
  sh('git add tracked.txt')
  writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
  try {
    const scope = uncommitted()
    const withIndex = fingerprintScope(makeEnv(repo), scope)
    // Same working bytes, different index: the staged content is part of the
    // identity even though the file on disk never moved.
    sh('git reset -q HEAD -- tracked.txt')
    const withoutIndex = fingerprintScope(makeEnv(repo), scope)
    assert.notEqual(withIndex, withoutIndex)
  } finally {
    sh('git reset -q HEAD -- tracked.txt')
    writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
  }
})

test('a file that appears after the scope was resolved still changes the identity', () => {
  writeFileSync(join(repo, 'tracked.txt'), 'changed\n')
  try {
    const scope = uncommitted()
    const before = fingerprintScope(makeEnv(repo), scope)
    // This is the mutation a delegated sub-agent can still perform: the path
    // was not in the resolved scope, so only the status line can catch it.
    writeFileSync(join(repo, 'appeared-during-the-run.txt'), 'stray\n')
    const after = fingerprintScope(makeEnv(repo), scope)
    assert.notEqual(before, after)
  } finally {
    rmSync(join(repo, 'appeared-during-the-run.txt'), { force: true })
    writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
  }
})

test('a symlink target is part of the identity and is not followed', () => {
  const outside = join(root, 'outside.txt')
  writeFileSync(outside, 'outside\n')
  symlinkSync(outside, join(repo, 'link'))
  try {
    const scope = uncommitted()
    const first = fingerprintScope(makeEnv(repo), scope)
    rmSync(join(repo, 'link'))
    symlinkSync(join(root, 'a-different-target.txt'), join(repo, 'link'))
    const second = fingerprintScope(makeEnv(repo), scope)
    assert.notEqual(first, second)
    // The target does not exist, and the fingerprint still worked: the link was
    // read as a link, never followed into an outside file.
    assert.equal(readFileSync(join(repo, 'tracked.txt'), 'utf8'), 'committed\n')
  } finally {
    rmSync(join(repo, 'link'), { force: true })
    writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
  }
})

test('an oversized diff is capped and flagged', () => {
  const big = 'x'.repeat(MAX_DIFF_BYTES + 20000)
  writeFileSync(join(repo, 'big.txt'), `${big}\n`)
  sh('git add big.txt && git -c user.email=t@t -c user.name=t commit -q -m big')
  try {
    // The commit that adds the huge file: its diff is one enormous line pair.
    const scope = resolveScope({ scopeFlag: '--commit', scopeValue: 'HEAD' }, makeEnv(repo))
    assert.equal(scope.diffTruncated, true)
    assert.ok(scope.diff.includes('diff truncated at'), scope.diff.slice(-200))
    assert.ok(Buffer.byteLength(scope.diff, 'utf8') < MAX_DIFF_BYTES + 2000)
  } finally {
    sh('git reset -q --hard HEAD~1')
    rmSync(join(repo, 'big.txt'), { force: true })
  }
})

test('a root commit (no parent) resolves and diffs through git show', () => {
  const rootCommit = sh('git rev-list --max-parents=0 HEAD').trim()
  const scope = resolveScope({ scopeFlag: '--commit', scopeValue: rootCommit }, makeEnv(repo))
  assert.deepEqual(scope.paths, ['tracked.txt'])
  assert.equal(scope.resolvedParent, '')
  assert.match(scope.diff, /\+committed/)
  assert.equal(scope.diffTruncated, false)
})

test('consult takes a tolerant changed-set identity and refuses nothing', () => {
  const clean = makeEnv(repo)
  const scope = consultScope(clean)
  assert.deepEqual(scope.paths, [])
  assert.equal(scope.scopeFlag, '--consult')
  // A conflicted tree is a legitimate thing to ask about, so consult does not
  // run the review's merge check.
  sh('git checkout -q -b side')
  writeFileSync(join(repo, 'conflict.txt'), 'side\n')
  sh('git add conflict.txt && git -c user.email=t@t -c user.name=t commit -q -m side')
  sh('git checkout -q -')
  writeFileSync(join(repo, 'conflict.txt'), 'main\n')
  sh('git add conflict.txt && git -c user.email=t@t -c user.name=t commit -q -m main')
  const merge = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', 'side'], { cwd: repo, encoding: 'utf8' })
  assert.notEqual(merge.status, 0, 'the merge must conflict')
  try {
    assert.throws(() => uncommitted(), /unresolved merge entries/)
    const during = consultScope(makeEnv(repo))
    assert.ok(during.paths.includes('conflict.txt'), JSON.stringify(during.paths))
  } finally {
    sh('git merge --abort')
    sh('git branch -q -D side')
    sh('git reset -q --hard HEAD~1')
    rmSync(join(repo, 'conflict.txt'), { force: true })
  }
})
