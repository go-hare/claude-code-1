import type { UUID } from 'crypto'
import { getSessionId } from '../../bootstrap/state.js'
import {
  getBridgeBaseUrlOverride,
  getBridgeTokenOverride,
} from '../../bridge/bridgeConfig.js'
import type { ToolUseContext } from '../../Tool.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { listLiveSessionRecords } from '../../utils/concurrentSessions.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  getMessagesAfterCompactBoundary,
  wrapInSystemReminder,
} from '../../utils/messages.js'
import {
  getTranscriptPath,
  saveAgentName,
  saveCustomTitle,
} from '../../utils/sessionStorage.js'
import {
  formatSessionRenamedMessage,
  resolveUniqueSessionName,
  scheduleSessionNameRenameRecheck,
  sessionNameState,
} from '../../utils/sessionNameUniqueness.js'
import { updateSessionName } from '../../utils/concurrentSessions.js'
import {
  RENAME_EMPTY_AFTER_SANITIZE_MESSAGE,
  sanitizeSessionTitle,
} from '../../utils/sessionTitleSanitize.js'
import { isTeammate } from '../../utils/teammate.js'
import { escapeOutputStyleName } from '../../utils/xml.js'
import { generateSessionName } from './generateSessionName.js'

/**
 * densable yos — meta message informing the model of a user-initiated /rename.
 */
export function buildRenameMetaMessage(
  newName: string,
  requestedName: string = newName,
): string {
  const escapedNew = escapeOutputStyleName(newName)
  const escapedRequested = escapeOutputStyleName(requestedName)
  return wrapInSystemReminder(
    requestedName === newName
      ? `The user named this session "${escapedNew}". This may indicate the session's focus or intent.`
      : `The user asked to name this session "${escapedRequested}"; another live session on this machine already holds that name, so this session is "${escapedNew}". The requested name may indicate the session's focus or intent.`,
  )
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<null> {
  // Prevent teammates from renaming - their names are set by team leader
  // densable: "Cannot rename: This session is a teammate. ..."
  if (isTeammate()) {
    onDone(
      'Cannot rename: This session is a teammate. Teammate names are set by the team leader.',
      { display: 'system' },
    )
    return null
  }

  const isGenerated = !args || args.trim() === ''
  let requestedName: string
  if (isGenerated) {
    const generated = await generateSessionName(
      getMessagesAfterCompactBoundary(context.messages),
      context.abortController.signal,
    )
    const sanitized = generated ? sanitizeSessionTitle(generated) : ''
    if (!sanitized) {
      onDone(
        'Could not generate a name: no conversation context yet. Usage: /rename <name>',
        { display: 'system' },
      )
      return null
    }
    requestedName = sanitized
  } else {
    // densable 2.1.221: shared uge (ly/vhn) before persist — FXe funnel.
    requestedName = sanitizeSessionTitle(args)
    if (!requestedName) {
      onDone(RENAME_EMPTY_AFTER_SANITIZE_MESSAGE, { display: 'system' })
      return null
    }
  }

  // densable 2.1.232 #4 kxr/mEn/ZM_: yield name-word-word when another live
  // session already holds the requested name.
  let newName = requestedName
  let yieldedFrom: string | undefined
  try {
    const live = await listLiveSessionRecords()
    const self =
      live.find(r => r.pid === process.pid) ??
      ({
        pid: process.pid,
        startedAt: Date.now(),
        name: undefined,
      } as const)
    const resolved = resolveUniqueSessionName({
      desiredName: requestedName,
      self,
      live,
      moment: 'rename',
    })
    newName = resolved.name
    if (resolved.yielded) {
      yieldedFrom = requestedName
      logForDebugging(
        `[session-name] "${requestedName}" is held by live pid ${resolved.holders[0]?.pid}; this session takes "${newName}"`,
      )
    }
  } catch (e) {
    logForDebugging(
      `[session-name] uniqueness check failed, keeping "${requestedName}": ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  const sessionId = getSessionId() as UUID
  const fullPath = getTranscriptPath()

  // Always save the custom title (session name)
  await saveCustomTitle(sessionId, newName, fullPath)

  // Sync title to bridge session on claude.ai/code (best-effort, non-blocking).
  // v2 env-less bridge stores cse_* in replBridgeSessionId —
  // updateBridgeSessionTitle retags internally for the compat endpoint.
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

  // Also persist as the session's agent name for prompt-bar display
  // (updateSessionName → PID registry so peers see the claim).
  await saveAgentName(sessionId, newName, fullPath)
  // densable nameSource: collision when yielded, else user.
  // densable 2.1.247 #13 — `registryUpdated` from pid-file persist.
  const registryUpdated = await updateSessionName(
    newName,
    yieldedFrom ? 'collision' : 'user',
  )
  sessionNameState.userTypedName = newName
  context.setAppState(prev => ({
    ...prev,
    standaloneAgentContext: {
      ...prev.standaloneAgentContext,
      name: newName,
    },
  }))

  // densable kxr/announceYield — notify UDS correspondents when we yielded.
  if (yieldedFrom) {
    sessionNameState.announceYield(newName, yieldedFrom)
  }

  // densable G$o — recheck after rename; if another live session steals the
  // name within eO_=3s, yield again and rewrite registry.
  scheduleSessionNameRenameRecheck({
    name: newName,
    suffixBase: requestedName,
    onYield: async (yielded, previous) => {
      await updateSessionName(yielded, 'collision')
      await saveAgentName(sessionId, yielded, fullPath)
      context.setAppState(prev => ({
        ...prev,
        standaloneAgentContext: {
          ...prev.standaloneAgentContext,
          name: yielded,
        },
      }))
      // densable announceYield on recheck path is also fired inside G$o
      logForDebugging(
        `[session-name] recheck yielded "${previous}" → "${yielded}"`,
      )
    },
  })

  onDone(formatSessionRenamedMessage(newName, yieldedFrom, registryUpdated), {
    display: 'system',
    metaMessages: !isGenerated
      ? [buildRenameMetaMessage(newName, yieldedFrom ?? newName)]
      : undefined,
  })
  return null
}
