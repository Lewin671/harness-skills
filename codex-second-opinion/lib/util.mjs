import { createHash } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path'
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

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: options.encoding ?? 'utf8',
    input: options.input,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    stdio: options.stdio,
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

export function sha256(parts) {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part)
  return hash.digest('hex')
}
