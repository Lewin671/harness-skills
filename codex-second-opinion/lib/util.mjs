import { createHash } from 'node:crypto'
import { closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, normalize, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

export class ExitError extends Error {
  constructor(code, lines = []) {
    super(lines[0] || `exit ${code}`)
    this.code = code
    this.lines = lines
  }
}

export function die(code, ...lines) {
  throw new ExitError(code, lines)
}

export function flat(value) {
  return String(value).replace(/[\r\n]/g, ' ')
}

export function shellQuote(value) {
  const text = String(value)
  return text && /^[A-Za-z0-9._/-]+$/.test(text)
    ? text
    : `'${text.replaceAll("'", `'\\''`)}'`
}

export function parseTimeout(value, source) {
  const raw = String(value)
  if (!/^\d+$/.test(raw)) {
    die(3, `error: ${source} must be a whole number of seconds, got '${flat(raw)}'`)
  }
  const normalized = raw.replace(/^0+(?=\d)/, '')
  if (normalized.length > 5 || Number(normalized) > 86400 || Number(normalized) < 1) {
    die(3, `error: ${source} must be between 1 and 86400 seconds, got '${flat(raw)}'`)
  }
  return Number(normalized)
}

export function hasLineBreak(value) {
  return /[\r\n]/.test(String(value))
}

// Called once, before anything else runs. Process-group signal delivery
// (Runtime.terminateChild's negative-pid kill), the POSIX permission-bit
// checks throughout environment.mjs, and the symlink-chain resolution used
// to place CODEX_HOME safely are all POSIX behavior that was verified only
// on macOS/Linux -- an unverified platform degrades those guarantees
// silently rather than failing loudly, so it is refused instead.
// A relative PATH entry resolves against whatever this process's cwd is at
// the moment something searches it -- the repository under review, for
// nearly this whole run. resolveOnPath (environment.mjs) already skips such
// entries in its own search, but that alone does not protect a *spawned*
// child's own PATH search: codex's real-world packaging is a
// `#!/usr/bin/env node` script, so `env` performs its own fresh PATH lookup
// for `node`, after this process has already changed into the reviewed
// repository, using whatever PATH that child inherits. Filtering PATH down
// to absolute entries before it becomes part of any spawned child's
// environment closes that regardless of what the child -- or something it
// execs in turn -- searches for.
export function absolutePathEntries(value) {
  return String(value || '').split(delimiter).filter((dir) => dir && isAbsolute(dir))
}

export function assertSupportedPlatform(platform) {
  if (platform !== 'darwin' && platform !== 'linux') {
    die(3,
      `error: this skill supports macOS and Linux only (detected: '${flat(platform)}').`,
      'error: process-group cancellation and the filesystem-permission checks this script relies on for its safety boundary assume POSIX semantics that are unverified elsewhere.',
      'hint: run it from a macOS or Linux host -- WSL works on Windows.')
  }
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: options.encoding ?? 'utf8',
    input: options.input,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    stdio: options.stdio,
    // Every preflight probe -- git, `codex features list`, `codex mcp list`,
    // and the ephemeral-help check -- runs here before Runtime's watchdog
    // exists. Environment gives these probes a fixed, independent budget so
    // an unreachable mount or stalled config read cannot block the wrapper
    // indefinitely. A timeout surfaces as result.error below (status 127),
    // which every caller treats as a failed probe and refuses on.
    timeout: options.timeout,
    killSignal: 'SIGKILL',
    // Only meaningful when the caller resolved `command` to a different
    // path than the identity a symlink-dispatching or multicall target
    // expects to see itself invoked under (Environment.codexArgv0);
    // undefined here is spawnSync's own default (argv[0] = command).
    argv0: options.argv0,
  })
  if (result.error) {
    return { status: 127, stdout: '', stderr: result.error.message, error: result.error }
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal,
  }
}

export function physicalPath(path) {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

export function nearestExistingAncestor(path) {
  let probe = resolve(path)
  for (;;) {
    try {
      const st = statSync(probe)
      if (st.isDirectory()) return realpathSync(probe)
    } catch {}
    const parent = dirname(probe)
    if (parent === probe) return null
    probe = parent
  }
}

export function lexicallyResolve(path, base = process.cwd()) {
  return normalize(isAbsolute(path) ? path : resolve(base, path))
}

export function isInside(candidate, roots) {
  const target = normalize(candidate)
  return roots.some((root) => {
    const rel = relative(normalize(root), target)
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel))
  })
}

// Each part is length-prefixed rather than simply concatenated. Plain
// concatenation makes the digest ambiguous whenever a part's own bytes can
// reproduce a neighbouring part's boundary: scopeFingerprint (lib/review.mjs)
// pushes `<path>`, a one-character kind tag, and a value, per untracked
// entry. Two working trees holding the same two untracked symlink NAMES but
// different targets serialize identically --
//
//   A: d/x -> a            d/y -> bd/yLc
//   B: d/x -> ad/yLb       d/y -> c
//
// both flatten to `d/xLad/yLbd/yLc`. The path set is unchanged, so status
// output matches too, and the digest therefore agrees across a tree that
// genuinely changed -- from the one function whose entire job is noticing
// exactly that. SHA-256 is not what fails here; the serialization fed to it
// is. A NUL separator alone would not be enough either: paths cannot contain
// NUL, but git's diff and status output (also hashed as parts) is not
// guaranteed NUL-free.
// The prefix counts BYTES (Buffer.byteLength), not `part.length`. A string's
// .length is UTF-16 code units while hash.update() feeds it as UTF-8, so for
// any non-ASCII part -- a path with an accent, a diff of a UTF-8 file -- the
// declared length and the bytes actually consumed disagree. That mismatch
// leaves the framing no longer self-describing and turns "is this still
// injective?" into a question needing an argument rather than an invariant.
// Counting bytes makes the length exactly the number of units that follow.
export function sha256(parts) {
  const hash = createHash('sha256')
  for (const part of parts) {
    hash.update(`${Buffer.byteLength(part)}\0`)
    hash.update(part)
  }
  return hash.digest('hex')
}

// Hashes a file in fixed-size chunks rather than reading it all into memory.
// Returns null when the descriptor turns out not to be a regular file or on
// any I/O error, so the caller can degrade to "unmeasurable" the same way a
// read failure already does.
export function sha256File(path) {
  const CHUNK = 2 * 1024 * 1024
  let fd
  try {
    fd = openSync(path, 'r')
    const stat = fstatSync(fd)
    if (!stat.isFile()) return null
    const hash = createHash('sha256')
    const buf = Buffer.allocUnsafe(CHUNK)
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK)
      if (n === 0) break
      hash.update(n === CHUNK ? buf : buf.subarray(0, n))
    }
    return hash.digest('hex')
  } catch {
    return null
  } finally {
    if (fd !== undefined) try { closeSync(fd) } catch {}
  }
}
