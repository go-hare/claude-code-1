import type { UUID } from 'crypto'
import {
  getBridgeBaseUrlOverride,
  getBridgeTokenOverride,
} from '../../bridge/bridgeConfig.js'
import { getSessionId } from '../../bootstrap/state.js'
import type { ToolUseContext } from '../../Tool.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'
import {
  getTranscriptPath,
  saveAgentName,
  saveCustomTitle,
} from '../../utils/sessionStorage.js'
import { isTeammate } from '../../utils/teammate.js'
import { generateSessionName } from './generateSessionName.js'

/**
 * densable xTo (2.1.211) — shared rename for interactive + non-interactive.
 */
export async function applyRename(
  args: string,
  context: Pick<
    ToolUseContext,
    'messages' | 'abortController' | 'setAppState' | 'getAppState'
  >,
): Promise<{ message: string; newName?: string; isGenerated?: boolean }> {
  if (isTeammate()) {
    return {
      message:
        'Cannot rename: This session is a swarm teammate. Teammate names are set by the team leader.',
    }
  }

  const isGenerated = !args || args.trim() === ''
  let newName: string
  if (isGenerated) {
    const generated = await generateSessionName(
      getMessagesAfterCompactBoundary(context.messages),
      context.abortController.signal,
    )
    if (!generated) {
      return {
        message:
          'Could not generate a name: no conversation context yet. Usage: /rename <name>',
      }
    }
    newName = generated
  } else {
    newName = args.trim()
  }

  const sessionId = getSessionId() as UUID
  const fullPath = getTranscriptPath()

  await saveCustomTitle(sessionId, newName, fullPath)

  const appState = context.getAppState()
  const bridgeSessionId = appState.replBridgeSessionId
  if (bridgeSessionId) {
    const tokenOverride = getBridgeTokenOverride()
    void import('../../bridge/createSession.js').then(
      ({ updateBridgeSessionTitle }) =>
        updateBridgeSessionTitle(bridgeSessionId, newName, {
          baseUrl: getBridgeBaseUrlOverride(),
          getAccessToken: tokenOverride ? () => tokenOverride : undefined,
        }).catch(() => {}),
    )
  }

  await saveAgentName(sessionId, newName, fullPath)
  context.setAppState(prev => ({
    ...prev,
    standaloneAgentContext: {
      ...prev.standaloneAgentContext,
      name: newName,
    },
  }))

  return {
    message: `Session renamed to: ${newName}`,
    newName,
    isGenerated,
  }
}
