// One provider run, start to usable outcome: launch, decode, verify the
// continuation, retry a transient failure, and turn every other failure into
// a wrapper exit. Provider-neutral: the provider builds argv and decodes
// output; everything here is policy that must not differ between providers.

import { rmSync, writeFileSync } from 'node:fs'

import { die, EXIT, flat, interruptibleWait, runProcess, tailLog, UUID } from './core.mjs'

// ctx: { provider, env, mode, policy, artifacts, build, onTimeout, retryDelays }
//   build(sessionId, continuing) -> { args, prompt, via: 'argv' | 'stdin', env? }
//     env: extra variables for this CLI process only (e.g. a sandbox mode).
//     sessionId: the session to resume ('' for a fresh run); continuing: the
//     run is a recovery after a transient failure and should send 'Continue'.
//   onTimeout(state): called before the timeout exit with the decoder state
//     ({ sessionId, model, workdir }), its sessionId cleared when the run was
//     meant to be in another session.
// Returns the provider outcome; dies with 4 (failed), 5 (timed out) or
// 129/130/143 (signalled), discarding the result file but keeping the log.
export async function runAgent(ctx) {
  const { provider, env, mode, policy, artifacts } = ctx
  const delays = ctx.retryDelays ?? provider.retryDelays ?? []
  const discard = () => rmSync(artifacts.out, { force: true })
  const tail = () => tailLog(artifacts.log, provider.prefix)
  // One total deadline for attempts and backoff, not a fresh one per retry.
  const deadline = Date.now() + policy.timeout * 1000
  let expected = policy.sessionId || ''
  let continuing = false
  let lastState = { sessionId: '', model: '', workdir: '' }

  const timedOut = (message, state) => {
    process.stderr.write(`${message}\n`)
    discard()
    ctx.onTimeout?.(state)
    die(EXIT.timeout)
  }

  for (let attempt = 0; ; attempt += 1) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) timedOut('error: retries exhausted the run timeout', { ...lastState, sessionId: expected })
    const invocation = ctx.build(expected, continuing)
    const prompt = invocation.prompt
    if (prompt != null && !prompt.trim()) {
      die(EXIT.usage, 'error: refusing to run with an empty prompt (wrapper bug, not a verdict on the code)')
    }
    const viaArgv = prompt != null && invocation.via !== 'stdin'
    const args = viaArgv ? [...invocation.args, '--', prompt] : invocation.args
    let diagnostic = `running: ${env.bin} ${invocation.args.join(' ')}`
    if (viaArgv) diagnostic += ` -- <prompt: ${prompt.length} chars>`
    else if (prompt != null) diagnostic += ` <prompt on stdin: ${prompt.length} chars>`
    process.stderr.write(`${flat(diagnostic)}\n`)

    // Each attempt writes a fresh result; a failed attempt's partial file
    // must not pass for the next one's.
    writeFileSync(artifacts.out, '', { mode: 0o600 })
    const decoder = provider.decoder({ mode, policy, artifacts, env })
    let proc
    try {
      const procEnv = invocation.env ? { ...env, baseEnv: { ...env.baseEnv, ...invocation.env } } : env
      proc = await runProcess(procEnv, {
        args,
        stdin: viaArgv ? null : prompt,
        timeoutSeconds: remaining / 1000,
        log: artifacts.log,
        prefix: provider.prefix,
        decoder,
      })
    } catch (error) {
      discard()
      throw error
    }
    lastState = { ...decoder.state }

    if (proc.timedOut) {
      process.stderr.write(`hint: raise --timeout, or check the log for where it stalled: ${artifacts.log}\n`)
      tail()
      // Advertise only the session this attempt was meant to be in.
      const session = decoder.state.sessionId
      timedOut(`error: the ${mode} exceeded ${policy.timeout}s and was terminated`,
        { ...decoder.state, sessionId: expected && session !== expected ? '' : session })
    }

    // The one place the CLI's own status is reported: every exit path below
    // — failure, retry, rejected continuation, partial success — follows it.
    if (proc.status !== 0) process.stderr.write(`provider-exit: ${proc.status}\n`)
    const outcome = decoder.finish(proc)
    const failed = !outcome.usable && !outcome.transient
    // A plain failure reports its own reason below; a session check on it
    // would bury that reason under a resume error.
    if (!failed && expected && outcome.sessionId && outcome.sessionId !== expected) {
      tail()
      discard()
      die(EXIT.failed,
        `error: ${provider.name} did not resume session ${expected} (it reported ${flat(outcome.sessionId)}).`,
        'error: the answer therefore lacked the prior discussion and was discarded.',
        'hint: the session may have expired; start a fresh run and restate the context.')
    }

    if (outcome.transient && !outcome.usable) {
      tail()
      discard()
      const session = outcome.sessionId || expected
      let action = 'repeat the original invocation'
      if (provider.resumeMode(mode) && UUID.test(session)) {
        expected = session
        continuing = true
        action = `resume session ${session} with Continue`
      } else if (outcome.workStarted) {
        die(EXIT.failed, 'error: transient failure after work began, but no recoverable session is available; refusing to replay the run')
      }
      if (attempt >= delays.length) {
        die(EXIT.failed, `error: ${outcome.transient} persisted after ${attempt + 1} attempts; no model change was attempted`)
      }
      const delay = delays[attempt]
      if (Date.now() + delay >= deadline) {
        timedOut('error: insufficient run timeout remaining for the next retry', { ...outcome, sessionId: expected })
      }
      await interruptibleWait(delay, () => {
        process.stderr.write(`note: ${outcome.transient}; retry ${attempt + 1}/${delays.length} in ${delay / 1000}s with the same model; ${action}\n`)
      })
      continue
    }

    if (failed) {
      if (proc.spawnError) process.stderr.write(`error: could not start ${flat(env.bin)}: ${flat(proc.spawnError)}\n`)
      for (const line of outcome.errors) process.stderr.write(`error: ${flat(line)}\n`)
      if (proc.status !== 0) {
        process.stderr.write(`error: the ${mode} failed; raw output at ${artifacts.log}\n`)
      } else {
        process.stderr.write(`error: ${provider.name} produced no result; raw output at ${artifacts.log}\n`)
      }
      for (const line of outcome.hints) process.stderr.write(`hint: ${flat(line)}\n`)
      tail()
      discard()
      die(EXIT.failed)
    }

    if (expected && outcome.sessionId !== expected) {
      tail()
      discard()
      die(EXIT.failed,
        `error: ${provider.name} reported no session, so this answer could not be confirmed as a follow-up to session ${expected}.`,
        'error: the answer was discarded rather than passed off as deliberation.',
        'hint: start a fresh run and restate the context.')
    }
    return outcome
  }
}
