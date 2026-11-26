import {
  getActiveSessionFromAls,
  getBootstrapSessionHost,
  HostSlot,
} from '../utils/sessionHost.js'
import type {
  createSkillCommand,
  parseSkillFrontmatterFields,
} from './loadSkillsDir.js'

/**
 * Write-once registry for the two loadSkillsDir functions that MCP skill
 * discovery needs. This module is a dependency-graph leaf: it imports nothing
 * but types, so both mcpSkills.ts and loadSkillsDir.ts can depend on it
 * without forming a cycle (client.ts → mcpSkills.ts → loadSkillsDir.ts → …
 * → client.ts).
 *
 * The non-literal dynamic-import approach ("await import(variable)") fails at
 * runtime in Bun-bundled binaries — the specifier is resolved against the
 * chunk's /$bunfs/root/… path, not the original source tree, yielding "Cannot
 * find module './loadSkillsDir.js'". A literal dynamic import works in bunfs
 * but dependency-cruiser tracks it, and because loadSkillsDir transitively
 * reaches almost everything, the single new edge fans out into many new cycle
 * violations in the diff check.
 *
 * Registration happens at loadSkillsDir.ts module init, which is eagerly
 * evaluated at startup via the static import from commands.ts — long before
 * any MCP server connects.
 */

export type MCPSkillBuilders = {
  createSkillCommand: typeof createSkillCommand
  parseSkillFrontmatterFields: typeof parseSkillFrontmatterFields
}

let defaultBuilders: MCPSkillBuilders | null = null
const hostBuildersSlot = new HostSlot<{ builders: MCPSkillBuilders | null }>(
  () => ({ builders: null }),
)

export function registerMCPSkillBuilders(b: MCPSkillBuilders): void {
  if (getActiveSessionFromAls() === undefined) {
    defaultBuilders = b
    hostBuildersSlot.of(getBootstrapSessionHost()).builders = null
    return
  }
  hostBuildersSlot.of(getBootstrapSessionHost()).builders = b
}

export function getMCPSkillBuilders(): MCPSkillBuilders {
  const resolved =
    hostBuildersSlot.peek(getBootstrapSessionHost())?.builders ??
    defaultBuilders
  if (!resolved) {
    throw new Error(
      'MCP skill builders not registered — loadSkillsDir.ts has not been evaluated yet',
    )
  }
  return resolved
}
