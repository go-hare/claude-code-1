import type { Client } from '@modelcontextprotocol/client'
import type { DialogStore } from '../../dialog/dialogStore.js'
import { answerMcpUrlElicitationComplete } from '../../dialog/mcpUrlElicitationComplete.js'
import type { RequestDialog } from '../../dialog/requestDialog.js'
import {
  mcpElicitationSpec,
  mcpElicitationWaitingSpec,
} from '../../dialog/specs/jsuKinds.js'
import {
  isDeferredTaskElicitation,
  isMcpTask,
  McpTaskQuestionController,
  type McpTaskQuestionSurfaceState,
} from '../../tasks/McpTask/McpTask.js'
import type { ElicitRequestParams, ElicitResult } from './types.js'
import type { AppState } from '../../state/AppState.js'
import {
  executeElicitationHooks,
  executeElicitationResultHooks,
  executeNotificationHooks,
} from '../../utils/hooks.js'
import { logMCPDebug, logMCPError } from '../../utils/log.js'
import { HostSlot, getBootstrapSessionHost } from '../../utils/sessionRoot.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'

/** Configuration for the waiting state shown after the user opens a URL. */
export type ElicitationWaitingState = {
  /** Button label, e.g. "Retry now" or "Skip confirmation" */
  actionLabel: string
  /** Whether to show a visible Cancel button (e.g. for error-based retry flow) */
  showCancel?: boolean
}

export type ElicitationRequestEvent = {
  serverName: string
  /** The JSON-RPC request ID, unique per server connection. */
  requestId: string | number
  params: ElicitRequestParams
  signal: AbortSignal
  /**
   * Resolves the elicitation. For explicit elicitations, all actions are
   * meaningful. For error-based retry (-32042), 'accept' is a no-op —
   * the retry is driven by onWaitingDismiss instead.
   */
  respond: (response: ElicitResult) => void
  /** For URL elicitations: shown after user opens the browser. */
  waitingState?: ElicitationWaitingState
  /** Called when phase 2 (waiting) is dismissed by user action or completion. */
  onWaitingDismiss?: (action: 'dismiss' | 'retry' | 'cancel') => void
  /** Set to true by the completion notification handler when the server confirms completion. */
  completed?: boolean
  /** densable wne — start URL dialog in waiting phase. */
  startWaiting?: boolean
}

const MAX_LOGGED_FIELD_NAMES = 100
const MAX_LOGGED_FIELD_NAME_LEN = 100

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatElicitationFieldNames(obj: unknown): string {
  if (!isPlainRecord(obj)) return '[]'
  const keys = Object.keys(obj)
  const shown = keys
    .slice(0, MAX_LOGGED_FIELD_NAMES)
    .map(k =>
      k.length > MAX_LOGGED_FIELD_NAME_LEN
        ? `[name too long to show: ${k.length} characters]`
        : k,
    )
  const extra = keys.length - shown.length
  return extra > 0
    ? `${jsonStringify(shown)} and ${extra} more`
    : jsonStringify(shown)
}

/**
 * Official 2.1.327 `nKt` — log only elicitation mode and requested schema field names,
 * never raw prompt text, URLs, or form contents.
 */
export function formatElicitationRequestForLog(params: unknown): string {
  const rec = isPlainRecord(params) ? params : {}
  const requestedSchema = rec.requestedSchema
  const mode = rec.mode === 'url' ? 'url' : 'form'
  const properties = isPlainRecord(requestedSchema)
    ? requestedSchema.properties
    : undefined
  return `mode=${mode} fields=${formatElicitationFieldNames(properties)}`
}

/**
 * Official 2.1.327 `BAt` — log only elicitation response action, mode, and answered field names,
 * never field values.
 */
export function formatElicitationResponseForLog(
  mode: 'form' | 'url',
  result: ElicitResult,
): string {
  const action =
    result.action === 'accept' ||
    result.action === 'decline' ||
    result.action === 'cancel'
      ? result.action
      : 'other'
  return `action=${action} mode=${mode} fields=${formatElicitationFieldNames(result.content)}`
}

function getElicitationMode(params: ElicitRequestParams): 'form' | 'url' {
  return params.mode === 'url' ? 'url' : 'form'
}

function leftoverHasCompletionChannel(client: Client): boolean {
  const era = (client as { getProtocolEra?: () => string }).getProtocolEra?.()
  return era !== 'modern'
}

type LeftoverMcpElicitationFlow = {
  completed: boolean
  closeWaiting?: () => void
}

type LeftoverMcpElicitationDeps = {
  serverName: string
  requestDialog: RequestDialog
  setAppState: (f: (prevState: AppState) => AppState) => void
}

function extractRelatedMcpTaskId(
  params: ElicitRequestParams,
): string | undefined {
  const meta = (params as { _meta?: Record<string, unknown> })._meta
  const related =
    meta?.['io.modelcontextprotocol/related-task'] ?? meta?.relatedTask
  if (
    typeof related === 'object' &&
    related !== null &&
    typeof (related as { taskId?: unknown }).taskId === 'string'
  ) {
    return (related as { taskId: string }).taskId
  }
  return undefined
}

function updateMatchingMcpTaskQuestionState(
  setAppState: (f: (prevState: AppState) => AppState) => void,
  serverName: string,
  relatedTaskId: string | undefined,
  openQuestion: (() => void) | undefined,
  questionState: McpTaskQuestionSurfaceState,
): void {
  setAppState(prev => {
    const tasks = prev.tasks
    if (!tasks) return prev
    let targetId: string | undefined
    if (relatedTaskId) {
      if (relatedTaskId in tasks) {
        targetId = relatedTaskId
      } else {
        for (const task of Object.values(tasks)) {
          if (
            isMcpTask(task) &&
            task.status === 'running' &&
            task.mcpTaskId === relatedTaskId
          ) {
            targetId = task.id
            break
          }
        }
      }
    } else {
      for (const task of Object.values(tasks)) {
        if (
          isMcpTask(task) &&
          task.status === 'running' &&
          task.serverName === serverName
        ) {
          targetId = task.id
          break
        }
      }
    }
    if (!targetId) return prev
    const current = tasks[targetId]
    if (!isMcpTask(current) || current.status !== 'running') return prev
    if (
      current.openQuestion === openQuestion &&
      current.questionState === questionState
    ) {
      return prev
    }
    return {
      ...prev,
      tasks: {
        ...tasks,
        [targetId]: {
          ...current,
          openQuestion,
          questionState,
          ...(questionState !== undefined
            ? { mcpStatus: 'input_required' as const }
            : {}),
        },
      },
    }
  })
}

type LeftoverMcpElicitationHost = {
  rebind: (deps: LeftoverMcpElicitationDeps) => void
  handle: (
    request: { params: ElicitRequestParams },
    extra: { signal: AbortSignal },
  ) => Promise<ElicitResult>
  complete: (elicitationId: string) => boolean
}

const leftoverMcpElicitationHosts = new WeakMap<
  Client,
  LeftoverMcpElicitationHost
>()

function leftoverBindMcpElicitationHost(
  client: Client,
  deps: LeftoverMcpElicitationDeps,
): LeftoverMcpElicitationHost {
  const existing = leftoverMcpElicitationHosts.get(client)
  if (existing) {
    existing.rebind(deps)
    return existing
  }
  let bound = deps
  const urlFlows = new Map<string, Set<LeftoverMcpElicitationFlow>>()
  const forget = (
    id: string | undefined,
    flow: LeftoverMcpElicitationFlow | undefined,
  ) => {
    if (id === undefined || flow === undefined) return
    const set = urlFlows.get(id)
    if (!set) return
    set.delete(flow)
    if (set.size === 0) urlFlows.delete(id)
  }
  const host: LeftoverMcpElicitationHost = {
    rebind(next) {
      bound = next
    },
    complete(elicitationId) {
      const set = urlFlows.get(elicitationId)
      if (!set || set.size === 0) return false
      for (const flow of set) {
        flow.completed = true
        flow.closeWaiting?.()
      }
      return true
    },
    async handle(request, extra) {
      const { signal } = extra
      const { serverName, requestDialog } = bound
      const params = request.params
      const mode = getElicitationMode(params)
      logMCPDebug(
        serverName,
        `Received elicitation request: ${formatElicitationRequestForLog(params)}`,
      )
      logEvent('tengu_mcp_elicitation_shown', {
        mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      try {
        const hookResponse = await runElicitationHooks(
          serverName,
          params,
          signal,
        )
        if (hookResponse) {
          logMCPDebug(
            serverName,
            `Elicitation resolved by hook: ${formatElicitationResponseForLog(mode, hookResponse)}`,
          )
          logEvent('tengu_mcp_elicitation_response', {
            mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            action:
              hookResponse.action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            byHook: true,
          })
          if (hookResponse.action === 'decline') {
            recordMcpElicitationDeclinedForServer(serverName)
          }
          return hookResponse
        }
        const rawElicitationId = (params as { elicitationId?: unknown })
          .elicitationId
        const elicitationId =
          params.mode === 'url' &&
          leftoverHasCompletionChannel(client) &&
          typeof rawElicitationId === 'string'
            ? rawElicitationId
            : undefined
        if (signal.aborted) return { action: 'cancel' }
        let flow: LeftoverMcpElicitationFlow | undefined
        if (elicitationId !== undefined) {
          flow = { completed: false }
          const set = urlFlows.get(elicitationId)
          if (set) set.add(flow)
          else urlFlows.set(elicitationId, new Set([flow]))
        }
        const isBackgroundTask = isBackgroundMcpTaskElicitation(params)
        let result: ElicitResult
        if (isBackgroundTask) {
          const relatedTaskId = extractRelatedMcpTaskId(params)
          let wakeReopen: (() => void) | undefined
          const controller = new McpTaskQuestionController((openFn, state) => {
            const wrappedOpen = openFn
              ? () => {
                  openFn()
                  wakeReopen?.()
                }
              : undefined
            updateMatchingMcpTaskQuestionState(
              bound.setAppState,
              serverName,
              relatedTaskId,
              wrappedOpen,
              state,
            )
          })
          try {
            while (true) {
              if (signal.aborted) {
                result = { action: 'cancel' }
                break
              }
              controller.set('asking')
              result = (await requestDialog(
                mcpElicitationSpec,
                {
                  serverName,
                  params,
                  isBackgroundTask: true,
                  ...(params.mode === 'url' &&
                    elicitationId === undefined && {
                      userConfirmsCompletion: true,
                    }),
                },
                { signal, place: 'under' },
              )) as ElicitResult
              // Official 2.1.325 #2367: Esc on a background MCP task elicitation
              // is "answer later" — suspend without returning { action: 'cancel' }
              // as a JSON-RPC response to the MCP server until the user reopens
              // from /tasks or the request signal aborts.
              if (result.action === 'cancel' && !signal.aborted) {
                await new Promise<void>(resolve => {
                  const onAbort = () => {
                    wakeReopen = undefined
                    resolve()
                  }
                  wakeReopen = () => {
                    wakeReopen = undefined
                    signal.removeEventListener('abort', onAbort)
                    resolve()
                  }
                  signal.addEventListener('abort', onAbort, { once: true })
                  controller.putAside(
                    `${serverName}:${elicitationId ?? 'deferred'}`,
                  )
                  if (signal.aborted) {
                    signal.removeEventListener('abort', onAbort)
                    wakeReopen = undefined
                    resolve()
                  }
                })
                if (signal.aborted) {
                  result = { action: 'cancel' }
                  break
                }
                controller.takeOpen()
                continue
              }
              controller.answered()
              break
            }
          } finally {
            wakeReopen = undefined
            controller.set(undefined)
          }
          if (signal.aborted && result.action === 'cancel') {
            forget(elicitationId, flow)
            return result
          }
        } else {
          result = (await requestDialog(
            mcpElicitationSpec,
            {
              serverName,
              params,
              ...(params.mode === 'url' &&
                elicitationId === undefined && {
                  userConfirmsCompletion: true,
                }),
            },
            { signal, place: 'under' },
          )) as ElicitResult
        }
        if (!signal.aborted) {
          logEvent('tengu_mcp_elicitation_response', {
            mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            action:
              result.action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
        }
        if (params.mode === 'url' && result.action === 'accept' && flow) {
          if (flow.completed) forget(elicitationId, flow)
          else {
            const waitingAbort = new AbortController()
            flow.closeWaiting = () => waitingAbort.abort()
            try {
              await requestDialog(
                mcpElicitationWaitingSpec,
                {
                  serverName,
                  params,
                  waitingState: { actionLabel: 'Skip confirmation' },
                },
                {
                  signal: AbortSignal.any([waitingAbort.signal, signal]),
                  succeeds: true,
                },
              )
            } finally {
              forget(elicitationId, flow)
            }
          }
        } else {
          forget(elicitationId, flow)
        }
        logMCPDebug(
          serverName,
          `Elicitation response: ${formatElicitationResponseForLog(mode, result)}`,
        )
        const hooked = await runElicitationResultHooks(
          serverName,
          result,
          signal,
          mode,
          elicitationId,
        )
        if (hooked.action !== result.action) {
          logEvent('tengu_mcp_elicitation_result_hook', {
            mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            action:
              hooked.action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
        }
        if (
          params.mode === 'url' &&
          result.action === 'accept' &&
          hooked.action !== 'accept'
        ) {
          flow?.closeWaiting?.()
          forget(elicitationId, flow)
        }
        return hooked
      } catch (error) {
        logMCPError(serverName, `Elicitation error: ${error}`)
        return { action: 'cancel' as const }
      }
    },
  }
  leftoverMcpElicitationHosts.set(client, host)
  return host
}

/** Find a queued elicitation event by server name and elicitationId. */
function findElicitationInQueue(
  queue: ElicitationRequestEvent[],
  serverName: string,
  elicitationId: string,
): number {
  return queue.findIndex(
    e =>
      e.serverName === serverName &&
      e.params.mode === 'url' &&
      'elicitationId' in e.params &&
      e.params.elicitationId === elicitationId,
  )
}

/**
 * Official 2.1.325 #2309 (`cueBehindDraft`): a background MCP task question
 * must NOT steal focus over a message the user is still typing; it waits behind
 * the draft until the user sends or clears it while keeping the spinner and
 * turn timer running.
 */
export function isBackgroundMcpTaskElicitation(
  params: ElicitRequestParams,
): boolean {
  if (isDeferredTaskElicitation(params)) return true
  const meta = (params as { _meta?: Record<string, unknown> })._meta
  const related =
    meta?.['io.modelcontextprotocol/related-task'] ?? meta?.relatedTask
  return (
    typeof related === 'object' &&
    related !== null &&
    typeof (related as { taskId?: unknown }).taskId === 'string'
  )
}

export function getElicitationCueBehindDraft(payload: {
  serverName: string
  params: ElicitRequestParams
  isBackgroundTask?: boolean
}): { text: string; keepSpinnerRunning: true } | undefined {
  if (
    payload.isBackgroundTask !== true &&
    !isBackgroundMcpTaskElicitation(payload.params)
  ) {
    return undefined
  }
  return {
    text: `MCP task (${payload.serverName}) needs your input — send or clear your draft to answer`,
    keepSpinnerRunning: true,
  }
}

export function registerElicitationHandler(
  client: Client,
  serverName: string,
  setAppState: (f: (prevState: AppState) => AppState) => void,
  dialogStore?: DialogStore | null,
  requestDialog?: RequestDialog | null,
  transportErrorState?: {
    activeCallWatchdogs: Set<{ openQuestions?: number }>
  },
): void {
  const trackOpenQuestion = async <T>(fn: () => Promise<T>): Promise<T> => {
    const watchdogs = [...(transportErrorState?.activeCallWatchdogs ?? [])]
    const single = watchdogs.length === 1 ? watchdogs[0] : undefined
    if (single !== undefined) {
      single.openQuestions = (single.openQuestions ?? 0) + 1
    }
    try {
      return await fn()
    } finally {
      if (single !== undefined) {
        single.openQuestions = Math.max(0, (single.openQuestions ?? 1) - 1)
      }
    }
  }
  // Register the elicitation request handler.
  // Wrapped in try/catch because setRequestHandler throws if the client wasn't
  // created with elicitation capability declared.
  try {
    if (requestDialog) {
      const leftoverHost = leftoverBindMcpElicitationHost(client, {
        serverName,
        requestDialog,
        setAppState,
      })
      client.setRequestHandler('elicitation/create', async (request, ctx) =>
        trackOpenQuestion(() =>
          leftoverHost.handle(request, { signal: ctx.mcpReq.signal }),
        ),
      )
      client.setNotificationHandler(
        'notifications/elicitation/complete',
        notification => {
          const params = (
            notification as { params?: { elicitationId?: string } }
          ).params
          const elicitationId = params?.elicitationId
          if (typeof elicitationId !== 'string') {
            logMCPDebug(
              serverName,
              `Ignoring elicitation completion notification without elicitationId`,
            )
            return
          }
          logMCPDebug(
            serverName,
            `Received elicitation completion notification: ${elicitationId}`,
          )
          void executeNotificationHooks({
            message: `MCP server "${serverName}" confirmed elicitation ${elicitationId} complete`,
            notificationType: 'elicitation_complete',
          })
          if (leftoverHost.complete(elicitationId)) return
          if (
            dialogStore &&
            answerMcpUrlElicitationComplete(
              dialogStore,
              serverName,
              elicitationId,
            )
          ) {
            return
          }
          logMCPDebug(
            serverName,
            `Ignoring completion notification for unknown elicitation: ${elicitationId}`,
          )
        },
      )
      return
    }
    // densable: setRequestHandler("elicitation/create", ...)
    // v2 BaseContext: signal/id live on ctx.mcpReq (not top-level extra).
    client.setRequestHandler('elicitation/create', async (request, ctx) =>
      trackOpenQuestion(async () => {
        const mode = getElicitationMode(request.params)
        logMCPDebug(
          serverName,
          `Received elicitation request: ${formatElicitationRequestForLog(request.params)}`,
        )

        const signal = ctx.mcpReq.signal
        const requestId = ctx.mcpReq.id

        logEvent('tengu_mcp_elicitation_shown', {
          mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })

        try {
          // Run elicitation hooks first - they can provide a response programmatically
          const hookResponse = await runElicitationHooks(
            serverName,
            request.params,
            signal,
          )
          if (hookResponse) {
            logMCPDebug(
              serverName,
              `Elicitation resolved by hook: ${formatElicitationResponseForLog(mode, hookResponse)}`,
            )
            logEvent('tengu_mcp_elicitation_response', {
              mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              action:
                hookResponse.action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            return hookResponse
          }

          const elicitationId =
            mode === 'url' && 'elicitationId' in request.params
              ? (request.params.elicitationId as string | undefined)
              : undefined

          const response = new Promise<ElicitResult>(resolve => {
            const onAbort = () => {
              resolve({ action: 'cancel' })
            }

            if (signal.aborted) {
              onAbort()
              return
            }

            const waitingState: ElicitationWaitingState | undefined =
              elicitationId ? { actionLabel: 'Skip confirmation' } : undefined

            setAppState(prev => ({
              ...prev,
              elicitation: {
                queue: [
                  ...prev.elicitation.queue,
                  {
                    serverName,
                    requestId,
                    params: request.params,
                    signal,
                    waitingState,
                    respond: (result: ElicitResult) => {
                      signal.removeEventListener('abort', onAbort)
                      logEvent('tengu_mcp_elicitation_response', {
                        mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                        action:
                          result.action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      })
                      resolve(result)
                    },
                  },
                ],
              },
            }))

            signal.addEventListener('abort', onAbort, { once: true })
          })
          const rawResult = await response
          logMCPDebug(
            serverName,
            `Elicitation response: ${formatElicitationResponseForLog(mode, rawResult)}`,
          )
          const result = await runElicitationResultHooks(
            serverName,
            rawResult,
            signal,
            mode,
            elicitationId,
          )
          return result
        } catch (error) {
          logMCPError(serverName, `Elicitation error: ${error}`)
          return { action: 'cancel' as const }
        }
      }),
    )

    // Register handler for elicitation completion notifications (URL mode).
    // Sets `completed: true` on the matching queue event; the dialog reacts to this flag.
    // densable: setNotificationHandler("notifications/elicitation/complete", ...)
    client.setNotificationHandler(
      'notifications/elicitation/complete',
      notification => {
        const params = (notification as { params?: { elicitationId?: string } })
          .params
        const elicitationId = params?.elicitationId
        if (typeof elicitationId !== 'string') {
          logMCPDebug(
            serverName,
            `Ignoring elicitation completion notification without elicitationId`,
          )
          return
        }
        logMCPDebug(
          serverName,
          `Received elicitation completion notification: ${elicitationId}`,
        )
        void executeNotificationHooks({
          message: `MCP server "${serverName}" confirmed elicitation ${elicitationId} complete`,
          notificationType: 'elicitation_complete',
        })
        if (
          dialogStore &&
          answerMcpUrlElicitationComplete(
            dialogStore,
            serverName,
            elicitationId,
          )
        ) {
          return
        }
        let found = false
        setAppState(prev => {
          const idx = findElicitationInQueue(
            prev.elicitation.queue,
            serverName,
            elicitationId,
          )
          if (idx === -1) return prev
          found = true
          const queue = [...prev.elicitation.queue]
          queue[idx] = { ...queue[idx]!, completed: true }
          return { ...prev, elicitation: { queue } }
        })
        if (!found) {
          logMCPDebug(
            serverName,
            `Ignoring completion notification for unknown elicitation: ${elicitationId}`,
          )
        }
      },
    )
  } catch {
    // Client wasn't created with elicitation capability - nothing to register
    return
  }
}

export async function runElicitationHooks(
  serverName: string,
  params: ElicitRequestParams,
  signal: AbortSignal,
): Promise<ElicitResult | undefined> {
  try {
    const mode = params.mode === 'url' ? 'url' : 'form'
    const url = 'url' in params ? (params.url as string) : undefined
    const elicitationId =
      'elicitationId' in params
        ? (params.elicitationId as string | undefined)
        : undefined

    const message =
      typeof params.message === 'string'
        ? params.message
        : String(params.message ?? '')
    const { elicitationResponse, blockingError } =
      await executeElicitationHooks({
        serverName,
        message,
        requestedSchema:
          'requestedSchema' in params
            ? (params.requestedSchema as Record<string, unknown>)
            : undefined,
        signal,
        mode,
        url,
        elicitationId,
      })

    if (blockingError) {
      return { action: 'decline' }
    }

    if (elicitationResponse) {
      return {
        action: elicitationResponse.action,
        content: elicitationResponse.content,
      }
    }

    return undefined
  } catch (error) {
    logMCPError(serverName, `Elicitation hook error: ${error}`)
    return undefined
  }
}

/**
 * Official 2.1.326 #81: Track when an MCP elicitation question for a server
 * was declined so that if the server subsequently fails the in-flight tool
 * call, Claude is explicitly informed that the failure followed a declined
 * question and the decline still stands.
 */
const hostElicitationDeclinedSlot = new HostSlot<Map<string, number>>(
  () => new Map<string, number>(),
)

function getLastElicitationDeclinedAtByServer(): Map<string, number> {
  return hostElicitationDeclinedSlot.of(getBootstrapSessionHost())
}

export function recordMcpElicitationDeclinedForServer(
  serverName: string,
  atMs: number = Date.now(),
): void {
  getLastElicitationDeclinedAtByServer().set(serverName, atMs)
}

export function consumeMcpElicitationDeclinedDuringCall(
  serverName: string,
  callStartMs: number,
): boolean {
  const map = hostElicitationDeclinedSlot.peek(getBootstrapSessionHost())
  if (!map) return false
  const declinedAt = map.get(serverName)
  if (declinedAt === undefined || declinedAt < callStartMs) {
    return false
  }
  map.delete(serverName)
  return true
}

export function clearMcpElicitationDeclinedState(): void {
  hostElicitationDeclinedSlot.peek(getBootstrapSessionHost())?.clear()
}

/**
 * Run ElicitationResult hooks after the user has responded, then fire a
 * `elicitation_response` notification. Returns a (potentially modified)
 * ElicitResult — hooks may override the action/content or block the response.
 */
export async function runElicitationResultHooks(
  serverName: string,
  result: ElicitResult,
  signal: AbortSignal,
  mode?: 'form' | 'url',
  elicitationId?: string,
): Promise<ElicitResult> {
  try {
    const { elicitationResultResponse, blockingError } =
      await executeElicitationResultHooks({
        serverName,
        action: result.action,
        content: result.content as Record<string, unknown> | undefined,
        signal,
        mode,
        elicitationId,
      })

    if (blockingError) {
      recordMcpElicitationDeclinedForServer(serverName)
      void executeNotificationHooks({
        message: `Elicitation response for server "${serverName}": decline`,
        notificationType: 'elicitation_response',
      })
      return { action: 'decline' }
    }

    const finalResult = elicitationResultResponse
      ? {
          action: elicitationResultResponse.action,
          content: elicitationResultResponse.content ?? result.content,
        }
      : result

    if (finalResult.action === 'decline') {
      recordMcpElicitationDeclinedForServer(serverName)
    }

    // Fire a notification for observability
    void executeNotificationHooks({
      message: `Elicitation response for server "${serverName}": ${finalResult.action}`,
      notificationType: 'elicitation_response',
    })

    return finalResult
  } catch (error) {
    logMCPError(serverName, `ElicitationResult hook error: ${error}`)
    if (result.action === 'decline') {
      recordMcpElicitationDeclinedForServer(serverName)
    }
    // Fire notification even on error
    void executeNotificationHooks({
      message: `Elicitation response for server "${serverName}": ${result.action}`,
      notificationType: 'elicitation_response',
    })
    return result
  }
}
