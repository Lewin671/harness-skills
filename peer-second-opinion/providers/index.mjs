// The provider registry. Adding a CLI: write a module with the shape of
// codex.mjs or command-code.mjs, list it here, and add
// references/providers/<id>.md plus its tests.

import codex from './codex.mjs'
import commandCode from './command-code.mjs'

export const PROVIDERS = new Map([codex, commandCode].map((provider) => [provider.id, provider]))
