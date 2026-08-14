import { assertAddressableMcpName, enabledMcpServers, McpShapeError } from './mcp.mjs'
import { assertValidatedPolicy } from './policy.mjs'
import { die, flat } from './util.mjs'

const DISABLED_FEATURES = ['hooks', 'apps', 'plugins']
const verifiedLaunchPlans = new WeakSet()

function verifyDisabledFeatures(environment) {
  const args = ['features', 'list', ...DISABLED_FEATURES.flatMap((name) => ['--disable', name])]
  const result = environment.codex(args)
  if (result.status !== 0) {
    die(3,
      `error: could not verify disabled Codex features with ${flat(environment.codexBin)}.`,
      'error: this Codex build does not satisfy the required capability contract; refusing to start.',
      'hint: upgrade Codex and rerun.')
  }

  const states = new Map()
  for (const line of result.stdout.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (DISABLED_FEATURES.includes(fields[0])) states.set(fields[0], fields.at(-1))
  }
  for (const feature of DISABLED_FEATURES) {
    const state = states.get(feature) || 'unknown'
    if (state !== 'false') {
      die(3,
        `error: codex ${feature} stay enabled (effective state: '${state}').`,
        `error: ${feature} act outside the read-only sandbox; refusing to start.`)
    }
  }
}

function verifyEphemeralReview(environment) {
  if (environment.state.mode !== 'review') return false
  const help = environment.codex(['exec', 'review', '--help'])
  if (help.status !== 0 || !/(?:^|\s)--ephemeral(?:[\s=]|$)/.test(`${help.stdout}\n${help.stderr}`)) {
    die(3,
      'error: this Codex build does not support ephemeral review sessions.',
      'error: review sessions must not be persisted; refusing to weaken that boundary for an older CLI.',
      'hint: upgrade Codex and rerun.')
  }
  return true
}

function verifyMcpPolicy(environment) {
  const base = ['mcp', 'list', '--json', ...DISABLED_FEATURES.flatMap((name) => ['--disable', name])]
  const listing = environment.codex(base)
  let problem = null
  let enabled = []
  if (listing.status !== 0) {
    problem = "could not verify standalone MCP exposure ('codex mcp list' failed)"
  } else {
    try {
      enabled = enabledMcpServers(listing.stdout.trimEnd())
      for (const entry of enabled) assertAddressableMcpName(entry.name)
    } catch (error) {
      problem = error instanceof McpShapeError ? error.message : `could not parse standalone MCP exposure (${error.message})`
    }
  }

  const overrides = enabled.flatMap(({ name }) => ['-c', `mcp_servers.${name}.enabled=false`])
  if (!problem && enabled.length && !environment.state.allowMcp) {
    const verify = environment.codex([...base, ...overrides])
    if (verify.status !== 0) {
      problem = "could not confirm the standalone MCP servers were switched off ('codex mcp list' failed on the re-check)"
    } else {
      try {
        const left = enabledMcpServers(verify.stdout.trimEnd())
        if (left.length) problem = `standalone MCP server(s) still enabled after being switched off: ${left.map((x) => x.name).join(' ')}`
      } catch (error) {
        if (error.message.includes('unrecognized')) {
          problem = 'could not confirm the standalone MCP servers were switched off (unrecognized re-check output)'
        } else if (error.message.includes('incomplete') || error.message.includes('malformed')) {
          problem = 'could not confirm the standalone MCP servers were switched off (incomplete re-check output)'
        } else {
          problem = `could not confirm the standalone MCP servers were switched off (${error.message})`
        }
      }
    }
  }

  if (problem && !environment.state.allowMcp) {
    die(3,
      `error: ${problem}.`,
      'error: refusing to start because MCP tools may mutate external systems.',
      'hint: disable those servers, or use --allow-mcp only after the user explicitly accepts that risk.')
  }
  if (problem) {
    process.stderr.write(`warning: ${problem}; proceeding because --allow-mcp was set\n`)
    process.stderr.write('warning: local commands stay read-only, but MCP tools may mutate external systems\n')
    return []
  }
  if (enabled.length && environment.state.allowMcp) {
    process.stderr.write(`warning: leaving ${enabled.length} enabled standalone MCP server(s) reachable because --allow-mcp was set\n`)
    process.stderr.write('warning: local commands stay read-only, but MCP tools may mutate external systems\n')
    return []
  }
  if (enabled.length) {
    process.stderr.write(`note: disabled ${enabled.length} enabled standalone MCP server(s) for this ${environment.state.runNoun}; pass --allow-mcp to keep them\n`)
  }
  return overrides
}

export function verifyCapabilityProfile(environment) {
  verifyDisabledFeatures(environment)
  const mcpArgs = verifyMcpPolicy(environment)
  const ephemeral = verifyEphemeralReview(environment)
  return Object.freeze({
    mode: environment.state.mode,
    allowMcp: environment.state.allowMcp,
    ephemeral,
    mcpArgs: Object.freeze(mcpArgs),
  })
}

function createLaunchPlan(policy, capabilities) {
  assertValidatedPolicy(policy)
  if (policy.mode !== capabilities.mode || policy.allowMcp !== capabilities.allowMcp ||
      capabilities.ephemeral !== (policy.mode === 'review')) {
    throw new TypeError('policy and capability profile do not form one verified launch plan')
  }
  const plan = Object.freeze({ policy, capabilities })
  verifiedLaunchPlans.add(plan)
  return plan
}

export function verifyLaunchPlan(environment) {
  return createLaunchPlan(environment.state, verifyCapabilityProfile(environment))
}

export function assertVerifiedLaunchPlan(plan) {
  if (!verifiedLaunchPlans.has(plan)) throw new TypeError('launch plan was not produced by capability verification')
}
