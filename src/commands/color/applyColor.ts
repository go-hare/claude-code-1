import type { UUID } from 'crypto'
import {
  AGENT_COLORS,
  type AgentColorName,
} from '@claude-code/builtin-tools/tools/AgentTool/agentColorManager.js'
import { getSessionId } from '../../bootstrap/state.js'
import type { ToolUseContext } from '../../Tool.js'
import {
  getTranscriptPath,
  saveAgentColor,
} from '../../utils/sessionStorage.js'
import { isTeammate } from '../../utils/teammate.js'

const RESET_ALIASES = ['default', 'reset', 'none', 'gray', 'grey'] as const

/**
 * densable Xfo (2.1.211) — shared color apply for interactive + non-interactive.
 * Empty arg picks a random AGENT_COLORS entry (densable).
 */
export async function applyColor(
  args: string,
  context: Pick<ToolUseContext, 'setAppState'>,
): Promise<string> {
  if (isTeammate()) {
    return 'Cannot set color: This session is a swarm teammate. Teammate colors are assigned by the team leader.'
  }

  const raw = args?.trim() ?? ''
  const colorArg =
    raw === ''
      ? AGENT_COLORS[Math.floor(Math.random() * AGENT_COLORS.length)]!
      : raw.toLowerCase()
  const isReset = (RESET_ALIASES as readonly string[]).includes(colorArg)

  if (!isReset && !AGENT_COLORS.includes(colorArg as AgentColorName)) {
    const colorList = AGENT_COLORS.join(', ')
    return `Invalid color "${colorArg}". Available colors: ${colorList}, default`
  }

  const sessionId = getSessionId() as UUID
  const fullPath = getTranscriptPath()
  const saved = isReset ? 'default' : colorArg
  const appColor = isReset ? undefined : (colorArg as AgentColorName)

  await saveAgentColor(sessionId, saved, fullPath)
  context.setAppState(prev => ({
    ...prev,
    standaloneAgentContext: {
      ...prev.standaloneAgentContext,
      name: prev.standaloneAgentContext?.name ?? '',
      color: appColor,
    },
  }))

  return isReset
    ? 'Session color reset to default'
    : `Session color set to: ${colorArg}`
}

export function colorArgumentHint(): string {
  return `[${[...AGENT_COLORS, 'default'].join('|')}]`
}
