import { runConsult } from './lib/consult.mjs'
import { runReview } from './lib/review.mjs'
import { createState, terminateActiveChild } from './lib/runtime.mjs'
import { assertSupportedPlatform, ExitError, flat, parseTimeout } from './lib/util.mjs'

const TOP_USAGE = `Usage: run-codex-second-opinion <review|consult> [ARGS]

  review   run codex exec review over a code change
  consult  ask a free-form question answered with the repo as context

Run run-codex-second-opinion <mode> --help for that mode's arguments.`

function topUsage() {
  process.stderr.write(`${TOP_USAGE}\n`)
}

async function main(argv) {
  assertSupportedPlatform(process.platform)
  const [mode, ...args] = argv
  if (mode === '-h' || mode === '--help') { topUsage(); return }
  if (!mode) {
    process.stderr.write('error: a mode is required\n')
    topUsage()
    process.exitCode = 3
    return
  }
  if (mode !== 'review' && mode !== 'consult') {
    process.stderr.write(`error: unknown mode: ${flat(mode)}\n`)
    topUsage()
    process.exitCode = 3
    return
  }

  const state = createState(mode)
  state.timeout = parseTimeout(process.env.CODEX_SECOND_OPINION_TIMEOUT || '3000', 'CODEX_SECOND_OPINION_TIMEOUT')
  if (mode === 'review') await runReview(state, args)
  else await runConsult(state, args)
}

// A last-resort net for anything thrown outside the awaited path below --
// an EventEmitter callback, a stream error, a timer. Node's default for
// those is a raw stack trace and exit 1, which is not one of this skill's
// documented exit codes and, worse, skips every teardown: codex is spawned
// detached, so an uncaught throw left its whole process group running with
// nothing to reap it. Both handlers report in this script's own error
// vocabulary and kill that group first.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (error) => {
    terminateActiveChild('SIGKILL')
    process.stderr.write(`error: internal failure (${event}): ${flat(error?.stack || error)}\n`)
    process.stderr.write('error: this is a bug in the wrapper, not a verdict on the code under review.\n')
    process.exit(3)
  })
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  if (error instanceof ExitError || (Number.isInteger(error?.code) && Array.isArray(error?.lines))) {
    for (const line of error.lines) process.stderr.write(`${line}\n`)
    process.exitCode = error.code
  } else {
    process.stderr.write(`error: internal failure: ${flat(error?.stack || error)}\n`)
    process.exitCode = 3
  }
}
