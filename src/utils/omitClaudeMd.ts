/**
 * densable 2.1.283 omitClaudeMd (gold Fl / He / pe).
 *
 * Subagent spawn drops user/project/local CLAUDE.md and keeps managed policy
 * files. Built-in and policySettings agents drop the whole claudeMd blob.
 * Main session agent: no effect — only AgentTool/runAgent applies Fl.
 */

import {
  filterInjectedMemoryFiles,
  getClaudeMds,
  getMemoryFiles,
} from './claudemd.js'

/** densable He: omitClaudeMd === "true" || === true → true, else undefined. */
export function coerceOmitClaudeMd(raw: unknown): true | undefined {
  return raw === 'true' || raw === true ? true : undefined
}

/**
 * densable Fl — applied only when spawning a subagent with omitClaudeMd and
 * no explicit override.userContext.
 */
export async function omitClaudeMdUserContext(
  agent: { source: string },
  userContext: { [k: string]: string },
): Promise<{
  userContext: { [k: string]: string }
  managedInstructionsOnly: boolean
}> {
  const { claudeMd: _dropped, ...withoutClaudeMd } = userContext
  const dropped: { [k: string]: string } = withoutClaudeMd
  if (agent.source === 'built-in' || agent.source === 'policySettings') {
    return { userContext: dropped, managedInstructionsOnly: false }
  }
  try {
    const managed = getClaudeMds(
      filterInjectedMemoryFiles(await getMemoryFiles()),
      type => type === 'Managed',
    )
    if (managed === '') {
      return { userContext: dropped, managedInstructionsOnly: false }
    }
    return {
      userContext: { ...userContext, claudeMd: managed },
      managedInstructionsOnly: true,
    }
  } catch {
    return { userContext, managedInstructionsOnly: false }
  }
}
