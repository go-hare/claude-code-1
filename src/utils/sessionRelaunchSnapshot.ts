/**
 * densable 2.1.248 Mhr leftover hosts: zL / EBt / dtt / ha / proactivity.
 *
 * Gold:
 *   zL(e,t,{responseStreaming},r) @189574045
 *   EBt(e,t) @183109460
 *   dtt @189561724
 *   ha() @179897504 = kb() || Tdr() → leftover isTeammate()
 *   getProactivityLevel() → AppState.proactivityLevel
 *   lUe @189575220 → leftover assertProcessWrapperRunnableForRelaunch
 */

import { randomUUID } from 'crypto'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type { Message } from '../types/message.js'
import { EMPTY_USAGE } from '../services/api/emptyUsage.js'
import type { CancelReason } from '../services/quotaAutoResume.js'
import { READY_PUSH_SYNTHETIC_MODEL } from './remoteControlReadyPush.js'
import { isTeammate } from './teammate.js'

/** official dtt — quota auto-resume persist warning per handoff kind. */
export const QUOTA_HANDOFF_WARNING = {
  background_handoff:
    'Automatic continue cancelled \u00b7 this session moved to the background, so the task will not resume on its own when the usage limit resets',
  relaunch:
    'Automatic continue cancelled \u00b7 Claude Code relaunched during the wait, so the task will not resume on its own when the usage limit resets (send a prompt then to continue)',
  desktop_handoff:
    'Automatic continue cancelled \u00b7 this session moved to Claude Desktop, so the task will not resume on its own when the usage limit resets (continue it there)',
  cloud_handoff:
    'Automatic continue cancelled \u00b7 sending this session to the cloud, so the task will not resume here on its own when the usage limit resets (continue it in the cloud session)',
  process_exit:
    'Automatic continue cancelled \u00b7 Claude Code exited during the wait, so the task will not resume on its own when the usage limit resets (send a prompt after the reset to continue)',
} as const

export type QuotaHandoffWarningKind = keyof typeof QUOTA_HANDOFF_WARNING

export type RelaunchProactivity = {
  proactivityLevel: unknown
  toolPermissionContext: unknown
}

/**
 * official ha() — skip CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME when this
 * process is already a teammate (ALS kb() or tmux Tdr()).
 */
export function isAssistantTeamEnvSkipped(): boolean {
  return isTeammate()
}

/**
 * official getProactivityLevel() — AppState.proactivityLevel.
 */
export function getSessionProactivityLevel(appState: {
  proactivityLevel?: unknown
}): unknown {
  return appState.proactivityLevel
}

export function buildRelaunchProactivity(
  proactivityLevel: unknown,
  toolPermissionContext: unknown,
): RelaunchProactivity {
  return { proactivityLevel, toolPermissionContext }
}

/**
 * official EBt(e,t) — SDK assistant text frame for writeSdkMessages.
 * Not leftover bzu (tool_use / is_meta).
 */
export function createRelaunchSdkAssistantMessage(
  text: string,
  sessionId: string,
): SDKMessage {
  return {
    type: 'assistant',
    message: {
      diagnostics: null,
      id: randomUUID(),
      container: null,
      model: READY_PUSH_SYNTHETIC_MODEL,
      role: 'assistant',
      stop_details: null,
      stop_reason: 'stop_sequence',
      stop_sequence: '',
      type: 'message',
      usage: { ...EMPTY_USAGE },
      content: [{ type: 'text', text, citations: null }],
      context_management: null,
    },
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  } as SDKMessage
}

/** official Switching-to-latest EBt copy. */
export const RELAUNCH_BRIDGE_SDK_COPY =
  'Switching to latest Claude Code\u2026 reconnecting'

/**
 * official zL(messages, kind, {responseStreaming}, storageV5).
 * ptt = leftover beginQuotaAutoResumeHandoff; rS = leftover recordTranscript;
 * relaunch lR = leftover flushSessionStorage; RX = leftover endQuotaAutoResumeHandoff.
 */
export async function snapshotSessionForRelaunch(
  messages: readonly Message[],
  kind: QuotaHandoffWarningKind,
  opts: { responseStreaming?: boolean } = {},
  _storageV5?: unknown,
): Promise<boolean> {
  const { beginQuotaAutoResumeHandoff, endQuotaAutoResumeHandoff } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/quotaAutoResume.js') as typeof import('../services/quotaAutoResume.js')
  const armed = beginQuotaAutoResumeHandoff(kind as CancelReason)
  if (!armed || opts.responseStreaming) return armed
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSystemMessage } =
      require('./messages.js') as typeof import('./messages.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { recordTranscript, flushSessionStorage } =
      require('./sessionStorage.js') as typeof import('./sessionStorage.js')
    const warning = createSystemMessage(QUOTA_HANDOFF_WARNING[kind], 'warning')
    await recordTranscript([...messages, warning] as Message[])
    if (kind === 'relaunch') {
      await flushSessionStorage()
    }
  } catch (err) {
    endQuotaAutoResumeHandoff()
    throw err
  }
  return true
}

/** official WL p — persist-fail clause after leftover zL succeeded. */
export const QUOTA_HANDOFF_CANCEL_CLAUSE =
  'the automatic continue at the usage-limit reset was cancelled (/rate-limit-options to wait again)'

/** official WL d */
export const QUOTA_HANDOFF_CANCEL_SENTENCE = `${QUOTA_HANDOFF_CANCEL_CLAUSE.charAt(0).toUpperCase()}${QUOTA_HANDOFF_CANCEL_CLAUSE.slice(1)}.`

/** official WL R */
export const QUOTA_HANDOFF_CANCEL_EXIT =
  'Automatic continue at the usage-limit reset was cancelled.'

/**
 * official WL(e,t,{as,exitsAfterward}) @189574748 — leftover RX then clause.
 */
export function formatRelaunchPersistFailMessage(
  message: string,
  persistResult: unknown,
  opts: { as?: 'clause' | 'sentence'; exitsAfterward?: boolean } = {},
): string {
  const { endQuotaAutoResumeHandoff } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/quotaAutoResume.js') as typeof import('../services/quotaAutoResume.js')
  endQuotaAutoResumeHandoff()
  if (!persistResult) return message
  if (opts.as === 'clause') {
    return `${message} \u2014 ${QUOTA_HANDOFF_CANCEL_CLAUSE}`
  }
  return `${message} ${opts.exitsAfterward ? QUOTA_HANDOFF_CANCEL_EXIT : QUOTA_HANDOFF_CANCEL_SENTENCE}`
}

/**
 * official Ket(e,t,o) — leftover `_G` catch prepends leftover WL clause.
 */
export async function withRelaunchKet<T>(
  persistResult: unknown,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof Error) {
      err.message = formatRelaunchPersistFailMessage(
        err.message,
        persistResult,
        {
          as: 'clause',
        },
      )
    } else {
      const { endQuotaAutoResumeHandoff } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/quotaAutoResume.js') as typeof import('../services/quotaAutoResume.js')
      endQuotaAutoResumeHandoff()
    }
    throw err
  }
}
