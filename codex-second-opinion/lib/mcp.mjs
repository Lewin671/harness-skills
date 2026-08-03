export class McpShapeError extends Error {}

export function parseMcpListing(text) {
  if (text === '') throw new McpShapeError("unrecognized 'codex mcp list --json' output")

  let value
  try {
    value = JSON.parse(text)
  } catch {
    if (!text.trimStart().startsWith('[')) {
      throw new McpShapeError("unrecognized 'codex mcp list --json' output")
    }
    if (/"enabled"\s*:\s*(?:true|false)[A-Za-z0-9_]/.test(text)) {
      throw new McpShapeError("an 'enabled' field is not a bare true or false")
    }
    throw new McpShapeError('the standalone MCP listing is incomplete or malformed')
  }
  if (!Array.isArray(value)) {
    throw new McpShapeError("unrecognized 'codex mcp list --json' output")
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new McpShapeError('unrecognized standalone MCP listing entry: expected an object')
    }
    if (!Object.hasOwn(entry, 'enabled')) {
      throw new McpShapeError("a standalone MCP entry carries no 'enabled' field, so whether it is reachable cannot be read from this listing")
    }
    if (typeof entry.enabled !== 'boolean') {
      throw new McpShapeError("an 'enabled' field is not a bare true or false")
    }
    if (entry.enabled && typeof entry.name !== 'string') {
      throw new McpShapeError('an enabled standalone MCP server has no readable name and so cannot be switched off')
    }
    return { name: entry.name, enabled: entry.enabled }
  })
}

export function enabledMcpServers(text) {
  return parseMcpListing(text).filter((entry) => entry.enabled)
}

export function assertAddressableMcpName(name) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new McpShapeError(`standalone MCP server '${name}' cannot be addressed by a config override and so cannot be switched off`)
  }
}
