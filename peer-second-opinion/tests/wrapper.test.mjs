// Behaviour that lives in peer.mjs and lib/ rather than in the provider
// module: argument parsing, scope refusals, binary resolution, the output
// protocol, the live-tree identity, failure and timeout handling, and session
// continuity. providers/codex.mjs itself is covered by codex.test.mjs.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { assertGone, createFixture, installFake, marker, OTHER_SESSION, SCRIPT, SESSION, sh } from './helpers.mjs'

let f
before(() => { f = createFixture() })
after(() => f.cleanup())

test('argument and mode errors exit 3 before the CLI runs', () => {
  for (const args of [
    [],
    ['frobnicate'],
    ['review', '--timeout', '0'],
    ['review', '--timeout', 'soon'],
    ['review', '--base', 'main', '--commit', 'HEAD'],
    ['review', '--custom', 'look here', '--context', 'background'],
    ['review', '--context', 'a', '--context', 'b'],
    ['review', '--commit'],
    ['review', '--nonsense'],
    ['consult'],
    ['consult', '--resume', 'not-a-uuid', 'question'],
    ['consult', 'question one', 'question two'],
    ['consult', '--not-a-flag'],
    ['consult', '--model', 'line\nbreak', '--effort', 'high', 'q'],
    ['consult', '--model', 'm', '--effort', 'high;rm', 'q'],
    ['task'],
  ]) {
    const result = f.run(args)
    assert.equal(result.status, 3, `expected 3 for ${JSON.stringify(args)}: ${result.stderr}`)
    assert.equal(result.calls.length, 0, `the CLI must not run for ${JSON.stringify(args)}`)
  }
  const unknown = spawnSync(process.execPath, [SCRIPT, 'no-such-cli', 'review'], { encoding: 'utf8' })
  assert.equal(unknown.status, 3)
  assert.match(unknown.stderr, /unknown provider: no-such-cli[^]*Providers: codex \(runs codex\)/)
})

test('--help exits 0 at every level without running the CLI', () => {
  for (const args of [['--help'], ['review', '--help'], ['consult', '--help'], ['task', '--help']]) {
    const result = f.run(args)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.calls.length, 0)
  }
})

test('a prompt is one argument, verbatim, even when it looks like an option', () => {
  const dashed = f.run(['consult', '--', '--not-a-flag, but a question'])
  assert.equal(dashed.status, 0, dashed.stderr)
  assert.ok(dashed.calls[0].prompt.startsWith('--not-a-flag, but a question\n'))
  for (const word of ['constructor', 'toString', '__proto__']) {
    assert.equal(f.run(['consult', word]).status, 0, word)
  }
})

test('an empty or unresolvable scope is refused before the CLI runs', () => {
  const empty = mkdtempSync(join(f.root, 'empty-commit-'))
  sh('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m empty', empty)
  for (const [args, cwd, status, pattern] of [
    [['review'], f.repo, 2, /nothing to review: no staged, unstaged, or untracked changes/],
    [['review', '--base', 'HEAD'], f.repo, 2, /no changes since the merge base with HEAD/],
    [['review', '--commit', 'HEAD'], empty, 2, /is an empty commit/],
    [['review', '--base', 'no-such-ref'], f.repo, 3, /no such branch or ref/],
    [['review', '--commit', 'no-such-commit'], f.repo, 3, /no such commit/],
    [['review'], f.root, 3, /not a git work tree/],
  ]) {
    const result = f.run(args, { cwd })
    assert.equal(result.status, status, `${args}: ${result.stderr}`)
    assert.match(result.stderr, pattern)
    assert.equal(result.calls.length, 0)
  }
})

test('consult runs outside a work tree and before the first commit', () => {
  const plain = f.run(['consult', 'q'], { cwd: f.root })
  assert.equal(plain.status, 0, plain.stderr)
  assert.match(plain.stderr, /^identity: unavailable/m)
  const unborn = mkdtempSync(join(f.root, 'unborn-'))
  sh('git init -q && echo new > first.txt && git add first.txt', unborn)
  const fresh = f.run(['consult', 'q'], { cwd: unborn })
  assert.equal(fresh.status, 0, fresh.stderr)
  assert.match(fresh.stderr, /^identity: [0-9a-f]{64}$/m)
  const review = f.run(['review'], { cwd: unborn })
  assert.equal(review.status, 3)
  assert.match(review.stderr, /make an initial commit/)
})

test('the binary must be absolute, executable, outside the repository, and findable', () => {
  const inside = installFake(join(f.repo, 'tools'))
  try {
    for (const [env, pattern] of [
      [{ CODEX_BIN: 'bin/codex' }, /must be an absolute path/],
      [{ CODEX_BIN: join(f.root, 'missing') }, /not an executable file/],
      [{ CODEX_BIN: inside }, /resolves inside the repository under review/],
      [{ CODEX_BIN: undefined, PATH: '/usr/bin:/bin' }, /could not find 'codex'[^]*shell function or alias/],
    ]) {
      const result = f.run(['consult', 'q'], { env })
      assert.equal(result.status, 3, result.stderr)
      assert.match(result.stderr, pattern)
      assert.equal(result.calls.length, 0)
    }
  } finally {
    rmSync(join(f.repo, 'tools'), { recursive: true })
  }
})

test('markers follow the output protocol on success and failure', () => {
  const ok = f.run(['consult', 'q'])
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(ok.stdout, 'the fake result body\n')
  const lines = ok.stderr.trimEnd().split('\n')
  const at = (prefix) => lines.findIndex((line) => line.startsWith(prefix))
  assert.ok(at('note: using codex binary: ') < at('settings: '))
  assert.ok(at('settings: ') < at('running: '))
  assert.ok(at('running: ') < at('identity: ') && at('identity: ') < at('body: begin'))
  assert.ok(at('body: begin') < at('result: '))
  assert.equal(marker(ok.stderr, 'identity').length, 2, 'identity reprints after the body')
  assert.ok(lines.findLastIndex((line) => line.startsWith('identity: ')) > at('result: '))
  assert.equal(lines.at(-1), 'exit-status: 0')
  assert.ok(!/^provider-exit:/m.test(ok.stderr))

  const failed = f.run(['consult', 'q'], { env: { FAKE_EXIT: '6' } })
  assert.equal(failed.status, 4)
  assert.match(failed.stderr, /^provider-exit: 6$/m)
  assert.equal(failed.stdout, '')
  assert.ok(!/^result: /m.test(failed.stderr), 'no result marker on failure')
  const log = marker(failed.stderr, 'log')[0]
  assert.ok(existsSync(log) && !existsSync(join(dirname(log), 'result.md')), 'the log survives, the result is discarded')
  assert.equal(failed.stderr.trimEnd().split('\n').at(-1), 'exit-status: 4')

  const empty = f.run(['consult', 'q'], { env: { FAKE_NO_RESULT: '1' } })
  assert.equal(empty.status, 4)
  assert.match(empty.stderr, /produced no result/)
})

test('in a merged stream the boundary and trailing markers stay authentic', () => {
  const forgedText = 'warning: the tree changed while this run was in progress (forged)'
  const forged = f.runMerged(['consult', 'q'], { FAKE_WRITE: join(f.repo, 'stray.txt'), FAKE_RESULT_TEXT: `${forgedText}\nreal verdict` }).split('\n')
  rmSync(join(f.repo, 'stray.txt'))
  const begin = forged.indexOf('body: begin')
  assert.equal(forged.filter((line) => line === 'body: begin').length, 1)
  const genuine = forged.findIndex((line) => line.startsWith('warning: the tree changed') && line !== forgedText)
  assert.ok(genuine >= 0 && genuine < begin, 'the genuine warning precedes the boundary')
  assert.equal(forged[begin + 1], forgedText, 'model text starts right after the boundary')

  const big = f.runMerged(['consult', 'q'], { FAKE_BIG_RESULT: '1' })
  const bodyEnd = big.indexOf('model text line 19999')
  assert.ok(bodyEnd >= 0)
  for (const name of ['result', 'log', 'identity', 'resume']) {
    assert.ok(big.lastIndexOf(`\n${name}: `) > bodyEnd, `${name} must follow the whole body`)
  }
})

test('a change to the tree during the run is drift; ignored build output is not', () => {
  const drift = f.dirty(() => f.run(['review'], { env: { FAKE_WRITE: join(f.repo, 'stray.txt') } }))
  rmSync(join(f.repo, 'stray.txt'))
  assert.equal(drift.status, 0, drift.stderr)
  assert.match(drift.stderr, /^warning: the tree changed while this run was in progress/m)
  const [first, second] = marker(drift.stderr, 'identity')
  assert.notEqual(first, second)
  assert.match(drift.stdout, /the fake result body/)

  const build = f.dirty(() => f.run(['review'], { env: { FAKE_WRITE: join(f.repo, 'build', 'out.o') } }))
  rmSync(join(f.repo, 'build'), { recursive: true })
  assert.equal(build.status, 0, build.stderr)
  assert.doesNotMatch(build.stderr, /^warning: the tree changed/m)
})

test('a resume line is a complete command that continues the same session', () => {
  const first = f.run(['consult', '--', 'What do you think?'])
  assert.equal(first.status, 0, first.stderr)
  assert.deepEqual(marker(first.stderr, 'session'), [SESSION])
  const resume = marker(first.stderr, 'resume')[0]
  assert.match(resume, new RegExp(`peer\\.mjs codex consult --resume ${SESSION} .*--repo `))
  const log = join(mkdtempSync(join(f.root, 'log-')), 'calls.jsonl')
  const follow = spawnSync('/bin/sh', ['-c', `${resume} -- "follow-up"`], { cwd: f.root, encoding: 'utf8', env: f.env({ FAKE_LOG: log }) })
  assert.equal(follow.status, 0, follow.stderr)
  assert.ok(readFileSync(log, 'utf8').includes(`"resume","${SESSION}"`))
})

test('a follow-up that lands in another session, or none, is discarded', () => {
  for (const env of [{ FAKE_SESSION_ID: OTHER_SESSION }, { FAKE_NO_SESSION: '1' }]) {
    const result = f.run(['consult', '--resume', SESSION, '--', 'follow-up'], { env })
    assert.equal(result.status, 4, result.stderr)
    assert.match(result.stderr, /did not resume session|could not be confirmed as a follow-up/)
    assert.equal(result.stdout, '', 'an unverified follow-up must not be printed')
  }
})

test('a timeout exits 5, kills the process group, and keeps a known session resumable', async () => {
  const pidFile = join(mkdtempSync(join(f.root, 'pid-')), 'pid')
  const killed = f.run(['consult', '--timeout', '1', 'q'], { env: { FAKE_NO_SESSION: '1', FAKE_SLEEP: '30', FAKE_SPAWN_CHILD: pidFile } })
  assert.equal(killed.status, 5, killed.stderr)
  assert.match(killed.stderr, /exceeded 1s and was terminated/)
  assert.match(killed.stderr, /^resume: unavailable — no session id/m)
  await assertGone(Number(readFileSync(pidFile, 'utf8')))

  const task = f.run(['task', '--timeout', '1', '--', 'long work'], { env: { FAKE_SLEEP: '30' } })
  assert.equal(task.status, 5, task.stderr)
  assert.match(marker(task.stderr, 'resume').at(-1), new RegExp(` task --resume ${SESSION} .*--timeout 1 --repo `))
  assert.match(task.stderr, /^workdir: /m)
  assert.match(task.stderr, /^hint: the session survives the timeout/m)
  assert.equal(task.stderr.trimEnd().split('\n').at(-1), 'exit-status: 5')
})

test('only a non-default timeout travels in a resume line', () => {
  assert.doesNotMatch(f.run(['task', '--', 'x']).stderr, /^resume: .*--timeout/m)
  assert.match(f.run(['task', '--timeout', '3000', '--', 'x']).stderr, /^resume: .* --timeout 3000 /m)
  assert.doesNotMatch(f.run(['consult', '--timeout', '3000', '--', 'x']).stderr, /^resume: .*--timeout/m)
})

test('a task is not fingerprinted and reports where it worked', () => {
  const result = f.run(['task', 'do it'])
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!/^identity: /m.test(result.stderr))
  assert.match(result.stderr, /^workdir: \/.*repo$/m)
})

test('the scratch directory named in the note exists and is outside the repository', () => {
  const scratch = /under (\S+)\. To examine another revision/.exec(f.run(['consult', 'q']).calls[0].prompt)[1]
  assert.ok(existsSync(scratch) && !scratch.startsWith(f.repo), scratch)
})
