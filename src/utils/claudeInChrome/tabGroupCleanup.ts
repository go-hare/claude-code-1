/**
 * densable 2.1.239 #54 — `jrl` / `ENS` / `ANS` / `zLS` / `SNS` / `iDn`.
 * Chrome `/clear` closes the session tab group; empty groups close on
 * `/resume` (session switch) and process exit.
 */
import { getSessionId, onSessionSwitch } from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isTerminalTaskStatus, type TaskStatus } from '../../Task.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { logError } from '../log.js'
import { isShuttingDown } from '../gracefulShutdown.js'
import { withTimeout } from '../sleep.js'
import {
  type ChromeTabGroupSocketClient,
  getChromeInstallSessionState,
} from './sessionState.js'

export const EMPTY_TAB_URLS = new Set(['chrome://newtab/', 'about:blank'])
export const CHROME_TAB_GROUP_CLOSE_CAP = 50
export const CHROME_TAB_GROUP_EXIT_TIMEOUT_MS = 1500
export const CHROME_TAB_GROUP_CALL_TIMEOUT_MS = 5000

const PRESERVED_AGENT_TASK_TYPES = new Set([
  'local_agent',
  'in_process_teammate',
  'local_workflow',
  'dream',
])

export type ChromeTabGroupCloseStatus =
  | 'disabled'
  | 'not_connected'
  | 'no_group'
  | 'kept'
  | 'closed'

export type ChromeTabGroupCloseResult = {
  status: ChromeTabGroupCloseStatus
  tabs?: number
  closed?: number
  failed?: number
}

export type CloseSessionTabGroupArgs = {
  sessionId: string
  onlyIfEmpty?: boolean
  clientOverride?: ChromeTabGroupSocketClient
  callTimeoutMs?: number
}

/** densable `bve`. */
export function isHumanSubmissionOrigin(
  origin: { kind?: string } | undefined,
): boolean {
  return origin?.kind === 'human'
}

/** densable `JPl` — explicit foreground task (killed on /clear). */
export function isForegroundKilledTask(task: {
  isBackgrounded?: boolean
}): boolean {
  return 'isBackgrounded' in task && task.isBackgrounded === false
}

/** densable `ZPl` — preserved live agent-family tasks survive /clear. */
export function hasPreservedLiveAgentTasks(
  tasks: Record<
    string,
    { type?: string; status?: string; isBackgrounded?: boolean }
  >,
): boolean {
  return Object.values(tasks).some(
    task =>
      !isForegroundKilledTask(task) &&
      PRESERVED_AGENT_TASK_TYPES.has(task.type ?? '') &&
      !isTerminalTaskStatus((task.status ?? 'pending') as TaskStatus),
  )
}

/**
 * densable `/clear` `o` — human origin and no preserved live agents →
 * close even when the group has content (`onlyIfEmpty: !o`).
 */
export function shouldForceCloseChromeTabGroupOnClear(
  origin: { kind?: string } | undefined,
  tasks: Record<
    string,
    { type?: string; status?: string; isBackgrounded?: boolean }
  >,
): boolean {
  return isHumanSubmissionOrigin(origin) && !hasPreservedLiveAgentTasks(tasks)
}

/** densable `iDn`. */
export function parseTabsContextResult(raw: unknown): {
  tabId?: number
  tabGroupId?: number
  json?: string
} {
  const content = (raw as { result?: { content?: unknown } } | undefined)
    ?.result?.content
  if (!Array.isArray(content)) return {}
  for (const block of content) {
    if (
      typeof block !== 'object' ||
      block === null ||
      (block as { type?: unknown }).type !== 'text' ||
      typeof (block as { text?: unknown }).text !== 'string'
    ) {
      continue
    }
    const text = (block as { text: string }).text
    try {
      const parsed = JSON.parse(text) as {
        availableTabs?: unknown
        tabGroupId?: unknown
      }
      if (!Array.isArray(parsed.availableTabs)) continue
      const tabId = parsed.availableTabs.find(
        (tab: unknown) =>
          typeof (tab as { tabId?: unknown } | undefined)?.tabId === 'number',
      )?.tabId as number | undefined
      const tabGroupId =
        typeof parsed.tabGroupId === 'number' ? parsed.tabGroupId : undefined
      return { tabId, tabGroupId, json: text }
    } catch {
      // try next text block
    }
  }
  return {}
}

/** densable `SNS`. */
export function isTabsCloseSuccess(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  const result = (raw as { result?: { isError?: unknown } }).result
  if (typeof result !== 'object' || result === null) return false
  return result.isError !== true
}

function parseAvailableTabs(
  json: string,
): Array<{ tabId: number; url: string }> | null {
  try {
    const parsed = JSON.parse(json) as {
      availableTabs?: Array<{ tabId?: unknown; url?: unknown }>
    }
    if (!Array.isArray(parsed.availableTabs)) return null
    const tabs: Array<{ tabId: number; url: string }> = []
    for (const tab of parsed.availableTabs) {
      if (typeof tab?.tabId !== 'number' || typeof tab?.url !== 'string') {
        return null
      }
      tabs.push({ tabId: tab.tabId, url: tab.url })
    }
    return tabs
  } catch {
    return null
  }
}

/** densable `zLS`. */
export function setChromeBinding(
  _context: unknown,
  socketClient: ChromeTabGroupSocketClient,
): void {
  getChromeInstallSessionState().bridgeBinding = { socketClient }
}

/** densable `jrl`. */
export function closeSessionTabGroup({
  sessionId,
  onlyIfEmpty,
  clientOverride,
  callTimeoutMs = CHROME_TAB_GROUP_CALL_TIMEOUT_MS,
}: CloseSessionTabGroupArgs): Promise<ChromeTabGroupCloseResult> {
  if (
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID ||
    !getFeatureValue_CACHED_MAY_BE_STALE('tengu_chrome_tab_group_close', true)
  ) {
    return Promise.resolve({ status: 'disabled' })
  }
  const inFlight = getChromeInstallSessionState().closesInFlight
  const existing = inFlight.get(sessionId)
  if (existing && (onlyIfEmpty || !existing.onlyIfEmpty)) {
    return existing.promise as Promise<ChromeTabGroupCloseResult>
  }
  const promise = (existing?.promise ?? Promise.resolve())
    .then(() =>
      closeSessionTabGroupImpl({
        sessionId,
        onlyIfEmpty,
        clientOverride,
        callTimeoutMs,
      }),
    )
    .finally(() => {
      if (inFlight.get(sessionId)?.promise === promise) {
        inFlight.delete(sessionId)
      }
    })
  inFlight.set(sessionId, { onlyIfEmpty, promise })
  return promise
}

/** densable `ENS`. */
async function closeSessionTabGroupImpl({
  sessionId,
  onlyIfEmpty,
  clientOverride,
  callTimeoutMs = CHROME_TAB_GROUP_CALL_TIMEOUT_MS,
}: CloseSessionTabGroupArgs): Promise<ChromeTabGroupCloseResult> {
  const client =
    clientOverride ?? getChromeInstallSessionState().bridgeBinding?.socketClient
  if (!client || !client.isConnected()) {
    logForDebugging('[closeSessionTabGroup] bridge not connected, skipping')
    return { status: 'not_connected' }
  }
  const scope = { permissionMode: 'ask', sessionScope: { sessionId } }
  let tabs: Array<{ tabId: number; url: string }>
  let tabGroupId: number
  try {
    const raw = await withTimeout(
      client.callTool('tabs_context_mcp', { createIfEmpty: false }, scope),
      callTimeoutMs,
      'tabs_context_mcp timed out',
    )
    const parsed = parseTabsContextResult(raw)
    if (parsed.tabGroupId === undefined || parsed.json === undefined) {
      logForDebugging('[closeSessionTabGroup] no group for session')
      return { status: 'no_group' }
    }
    tabGroupId = parsed.tabGroupId
    const available = parseAvailableTabs(parsed.json)
    if (!available) {
      logForDebugging(
        `[closeSessionTabGroup] group ${tabGroupId}: unreadable tab list, keeping it`,
      )
      return { status: 'kept', tabs: 0 }
    }
    tabs = available
  } catch (error) {
    logForDebugging(
      `[closeSessionTabGroup] tabs_context_mcp failed: ${String(error)}`,
    )
    return { status: 'no_group' }
  }
  if (onlyIfEmpty && tabs.some(tab => !EMPTY_TAB_URLS.has(tab.url))) {
    logForDebugging(
      `[closeSessionTabGroup] group ${tabGroupId} has content, keeping ${tabs.length} tabs`,
    )
    return { status: 'kept', tabs: tabs.length }
  }
  if (tabs.length > CHROME_TAB_GROUP_CLOSE_CAP) {
    logForDebugging(
      `[closeSessionTabGroup] group ${tabGroupId} holds ${tabs.length} tabs, over the close cap; keeping it`,
    )
    return { status: 'kept', tabs: tabs.length }
  }
  const closeScope = {
    permissionMode: 'ask',
    sessionScope: { sessionId, tabGroupId },
  }
  let closed = 0
  let failed = 0
  for (let i = tabs.length - 1; i >= 0; i--) {
    const tabId = tabs[i]!.tabId
    try {
      const result = await withTimeout(
        client.callTool('tabs_close_mcp', { tabId }, closeScope),
        callTimeoutMs,
        'tabs_close_mcp timed out',
      )
      if (!isTabsCloseSuccess(result)) {
        failed++
        break
      }
      closed++
    } catch {
      failed++
      break
    }
  }
  logForDebugging(
    `[closeSessionTabGroup] group ${tabGroupId}: closed ${closed}/${tabs.length} tabs${
      failed > 0 ? ', stopped at a failed close' : ''
    }`,
  )
  return { status: 'closed', closed, failed }
}

/** densable `ANS`. */
export function registerChromeTabGroupCleanup(): void {
  const state = getChromeInstallSessionState()
  if (state.tabGroupCleanupRegistered) return
  state.tabGroupCleanupRegistered = true
  let currentSessionId = getSessionId()
  state.unsubscribeSessionSwitch = onSessionSwitch(nextId => {
    if (nextId === currentSessionId) return
    const previousId = currentSessionId
    currentSessionId = nextId
    void closeSessionTabGroup({
      sessionId: previousId,
      onlyIfEmpty: true,
    }).catch(logError)
  })
  state.unregisterExitCleanup = registerCleanup(async () => {
    if (!isShuttingDown()) return
    const inFlight = Array.from(
      state.closesInFlight.values(),
      entry => entry.promise,
    )
    try {
      await withTimeout(
        Promise.allSettled([
          ...inFlight,
          closeSessionTabGroup({
            sessionId: getSessionId(),
            onlyIfEmpty: true,
          }),
        ]),
        CHROME_TAB_GROUP_EXIT_TIMEOUT_MS,
        'chrome tab group close timed out at exit',
      )
    } catch {
      // official swallows exit-timeout
    }
  })
}
