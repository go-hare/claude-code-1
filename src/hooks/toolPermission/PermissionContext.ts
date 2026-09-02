import { feature } from 'bun:bundle'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from 'src/services/analytics/metadata.js'
import type { Dispatch, SetStateAction } from 'react'
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import type { DialogStore } from '../../dialog/dialogStore.js'
import {
  clearPermissionConfirms,
  getPermissionConfirm,
  registerPermissionConfirm,
  unregisterPermissionConfirm,
} from '../../dialog/permissionConfirmRegistry.js'
import { shouldQueuePermissionBehind } from '../../dialog/permissionQueueBehind.js'
import { permissionPromptDialogId } from '../../dialog/specs/permissionKinds.js'
import type {
  ToolPermissionContext,
  Tool as ToolType,
  ToolUseContext,
} from '../../Tool.js'
import { awaitClassifierAutoApproval } from '@claude-code/builtin-tools/tools/BashTool/bashPermissions.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import type { AssistantMessage } from '../../types/message.js'
import type {
  PendingClassifierCheck,
  PermissionAllowDecision,
  PermissionDecisionReason,
  PermissionDenyDecision,
} from '../../types/permissions.js'
import { setClassifierApproval } from '../../utils/classifierApprovals.js'
import { logForDebugging } from '../../utils/debug.js'
import { executePermissionRequestHooks } from '../../utils/hooks.js'
import {
  REJECT_MESSAGE,
  REJECT_MESSAGE_WITH_REASON_PREFIX,
  SUBAGENT_REJECT_MESSAGE,
  SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX,
  withMemoryCorrectionHint,
} from '../../utils/messages.js'
import type {
  PermissionAskDecision,
  PermissionDecision,
} from '../../utils/permissions/PermissionResult.js'
import {
  hasPermissionsToUseTool,
  stripWholeToolGrantsForAsk,
} from '../../utils/permissions/permissions.js'
import { emitPermissionRecheck } from '../../utils/permissions/permissionRecheck.js'
import { restoreDangerousPermissions } from '../../utils/permissions/permissionSetup.js'
import {
  applyPermissionUpdates,
  persistPermissionUpdates,
  supportsPersistence,
} from '../../utils/permissions/PermissionUpdate.js'
import type { PermissionUpdate } from '../../utils/permissions/PermissionUpdateSchema.js'
import {
  logPermissionDecision,
  type PermissionDecisionArgs,
} from './permissionLogging.js'

type PermissionApprovalSource =
  | { type: 'hook'; permanent?: boolean }
  | { type: 'user'; permanent: boolean }
  | { type: 'classifier' }

type PermissionRejectionSource =
  | { type: 'hook' }
  | { type: 'user_abort' }
  | { type: 'user_reject'; hasFeedback: boolean }

/** Hook rewrote input but recheck still asks — rebuild dialog, do not resolve. */
export type PermissionHookReprompt = {
  type: 'reprompt'
  reprompted: PermissionAskDecision
  finalInput: Record<string, unknown>
}

export function isPermissionHookReprompt(
  value: PermissionDecision | PermissionHookReprompt | null,
): value is PermissionHookReprompt {
  return value !== null && 'type' in value && value.type === 'reprompt'
}

// Generic interface for permission queue operations, decoupled from React.
// In the REPL, these are backed by React state.
type PermissionQueueOps = {
  push(item: ToolUseConfirm): void
  remove(toolUseID: string): void
  update(toolUseID: string, patch: Partial<ToolUseConfirm>): void
}

type ResolveOnce<T> = {
  resolve(value: T): void
  isResolved(): boolean
  /**
   * Atomically check-and-mark as resolved. Returns true if this caller
   * won the race (nobody else has resolved yet), false otherwise.
   * Use this in async callbacks BEFORE awaiting, to close the window
   * between the `isResolved()` check and the actual `resolve()` call.
   */
  claim(): boolean
}

function createResolveOnce<T>(resolve: (value: T) => void): ResolveOnce<T> {
  let claimed = false
  let delivered = false
  return {
    resolve(value: T) {
      if (delivered) return
      delivered = true
      claimed = true
      resolve(value)
    },
    isResolved() {
      return claimed
    },
    claim() {
      if (claimed) return false
      claimed = true
      return true
    },
  }
}

function createPermissionContext(
  tool: ToolType,
  input: Record<string, unknown>,
  toolUseContext: ToolUseContext,
  assistantMessage: AssistantMessage,
  toolUseID: string,
  /**
   * densable m4n 7th arg `permissionContextSetter` — teammate/mailbox override.
   * When set, persist uses this instead of setSessionToolPermissionContext
   * (and skips the session recheck emit path used by the default writer).
   */
  permissionContextSetter?: (
    context: ToolPermissionContext,
    options?: { preserveMode?: boolean },
  ) => void,
  queueOps?: PermissionQueueOps,
) {
  const messageId = assistantMessage.message.id!
  const ctx = {
    tool,
    input,
    toolUseContext,
    assistantMessage,
    messageId,
    toolUseID,
    logDecision(
      args: PermissionDecisionArgs,
      opts?: {
        input?: Record<string, unknown>
        permissionPromptStartTimeMs?: number
      },
    ) {
      logPermissionDecision(
        {
          tool,
          input: opts?.input ?? input,
          toolUseContext,
          messageId,
          toolUseID,
        },
        args,
        opts?.permissionPromptStartTimeMs,
      )
    },
    logCancelled() {
      logEvent('tengu_tool_use_cancelled', {
        messageID:
          messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        toolName: sanitizeToolNameForAnalytics(tool.name),
      })
    },
    persistPermissions(updates: PermissionUpdate[]) {
      if (updates.length === 0) return false
      persistPermissionUpdates(updates)
      if (permissionContextSetter !== undefined) {
        const appState = toolUseContext.getAppState()
        permissionContextSetter(
          applyPermissionUpdates(
            restoreDangerousPermissions(appState.toolPermissionContext),
            updates,
          ),
        )
      } else {
        toolUseContext.setSessionToolPermissionContext(prev =>
          applyPermissionUpdates(prev, updates),
        )
        // densable setImmediate(() => n3e.emit())
        setImmediate(() => {
          emitPermissionRecheck()
        })
      }
      return updates.some(update => supportsPersistence(update.destination))
    },
    resolveIfAborted(resolve: (decision: PermissionDecision) => void) {
      if (!toolUseContext.abortController.signal.aborted) return false
      this.logCancelled()
      resolve(this.cancelAndAbort(undefined, true))
      return true
    },
    cancelAndAbort(
      feedback?: string,
      isAbort?: boolean,
      contentBlocks?: ContentBlockParam[],
    ): PermissionDecision {
      const sub = !!toolUseContext.agentId
      const baseMessage = feedback
        ? `${sub ? SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX : REJECT_MESSAGE_WITH_REASON_PREFIX}${feedback}`
        : sub
          ? SUBAGENT_REJECT_MESSAGE
          : REJECT_MESSAGE
      const message = sub ? baseMessage : withMemoryCorrectionHint(baseMessage)
      if (isAbort || (!feedback && !contentBlocks?.length && !sub)) {
        logForDebugging(
          `Aborting: tool=${tool.name} isAbort=${isAbort} hasFeedback=${!!feedback} isSubagent=${sub}`,
        )
        toolUseContext.abortController.abort()
      }
      return { behavior: 'ask', message, contentBlocks }
    },
    ...(feature('BASH_CLASSIFIER')
      ? {
          async tryClassifier(
            pendingClassifierCheck: PendingClassifierCheck | undefined,
            updatedInput: Record<string, unknown> | undefined,
          ): Promise<PermissionDecision | null> {
            if (tool.name !== BASH_TOOL_NAME || !pendingClassifierCheck) {
              return null
            }
            const classifierDecision = await awaitClassifierAutoApproval(
              pendingClassifierCheck,
              toolUseContext.abortController.signal,
              toolUseContext.options.isNonInteractiveSession,
            )
            if (!classifierDecision) {
              return null
            }
            if (
              feature('TRANSCRIPT_CLASSIFIER') &&
              classifierDecision.type === 'classifier'
            ) {
              const matchedRule = classifierDecision.reason.match(
                /^Allowed by prompt rule: "(.+)"$/,
              )?.[1]
              if (matchedRule) {
                setClassifierApproval(toolUseID, matchedRule)
              }
            }
            logPermissionDecision(
              { tool, input, toolUseContext, messageId, toolUseID },
              { decision: 'accept', source: { type: 'classifier' } },
              undefined,
            )
            return {
              behavior: 'allow' as const,
              updatedInput: updatedInput ?? input,
              userModified: false,
              decisionReason: classifierDecision,
            }
          },
        }
      : {}),
    /**
     * Hook allow+updatedInput is rechecked; still-ask returns a tagged
     * reprompt so callers rebuild the dialog instead of treating rewrite
     * as a final allow (stale IDE/terminal answers).
     */
    async runHooks(
      permissionMode: string | undefined,
      suggestions: PermissionUpdate[] | undefined,
      updatedInput?: Record<string, unknown>,
      permissionPromptStartTimeMs?: number,
      opts?: { askSuppressesAlwaysAllowRule?: boolean },
    ): Promise<PermissionDecision | PermissionHookReprompt | null> {
      for await (const hookResult of executePermissionRequestHooks(
        tool.name,
        toolUseID,
        input,
        toolUseContext,
        permissionMode,
        suggestions as any,
        toolUseContext.abortController.signal,
      )) {
        if (hookResult.permissionRequestResult) {
          const decision = hookResult.permissionRequestResult
          if (decision.behavior === 'allow') {
            const finalInput = decision.updatedInput ?? updatedInput ?? input
            // densable: bare allow without updatedInput cannot satisfy
            // requiresUserInteraction tools — leave the dialog racing.
            if (!decision.updatedInput && tool.requiresUserInteraction?.()) {
              return null
            }
            if (decision.updatedInput) {
              const recheck = await hasPermissionsToUseTool(
                tool,
                finalInput,
                toolUseContext,
                assistantMessage,
                toolUseID,
              )
              if (recheck.behavior === 'deny') {
                this.logDecision(
                  { decision: 'reject', source: 'config' },
                  {
                    input: finalInput,
                    permissionPromptStartTimeMs,
                  },
                )
                return recheck
              }
              if (recheck.behavior === 'ask') {
                return {
                  type: 'reprompt',
                  reprompted: recheck,
                  finalInput,
                }
              }
            }
            return await this.handleHookAllow(
              finalInput,
              (decision.updatedPermissions ??
                []) as unknown as import('../../types/permissions.js').PermissionUpdate[],
              permissionPromptStartTimeMs,
              opts,
            )
          } else if (decision.behavior === 'deny') {
            this.logDecision(
              { decision: 'reject', source: { type: 'hook' } },
              { permissionPromptStartTimeMs },
            )
            if (decision.interrupt) {
              logForDebugging(
                `Hook interrupt: tool=${tool.name} hookMessage=${decision.message}`,
              )
              toolUseContext.abortController.abort()
            }
            return this.buildDeny(
              decision.message || 'Permission denied by hook',
              {
                type: 'hook',
                hookName: 'PermissionRequest',
                reason: decision.message,
              },
            )
          }
        }
      }
      return null
    },
    buildAllow(
      updatedInput: Record<string, unknown>,
      opts?: {
        userModified?: boolean
        decisionReason?: PermissionDecisionReason
        acceptFeedback?: string
        contentBlocks?: ContentBlockParam[]
      },
    ): PermissionAllowDecision {
      return {
        behavior: 'allow' as const,
        updatedInput,
        userModified: opts?.userModified ?? false,
        ...(opts?.decisionReason && { decisionReason: opts.decisionReason }),
        ...(opts?.acceptFeedback && { acceptFeedback: opts.acceptFeedback }),
        ...(opts?.contentBlocks &&
          opts.contentBlocks.length > 0 && {
            contentBlocks: opts.contentBlocks,
          }),
      }
    },
    buildDeny(
      message: string,
      decisionReason: PermissionDecisionReason,
    ): PermissionDenyDecision {
      return { behavior: 'deny' as const, message, decisionReason }
    },
    async handleUserAllow(
      updatedInput: Record<string, unknown>,
      permissionUpdates: PermissionUpdate[],
      feedback?: string,
      permissionPromptStartTimeMs?: number,
      contentBlocks?: ContentBlockParam[],
      decisionReason?: PermissionDecisionReason,
      opts?: { askSuppressesAlwaysAllowRule?: boolean },
    ): Promise<PermissionAllowDecision> {
      // densable 2.1.235 #12 accept-path: strip bare whole-tool allows when
      // the ask or tool marks suppressAlwaysAllowRule.
      const shouldStrip =
        tool.suppressesAlwaysAllowRule?.(updatedInput) === true ||
        opts?.askSuppressesAlwaysAllowRule === true
      const updatesToPersist = shouldStrip
        ? stripWholeToolGrantsForAsk(
            permissionUpdates,
            tool,
            toolUseContext.getAppState().toolPermissionContext,
          )
        : permissionUpdates
      const acceptedPermanentUpdates =
        await this.persistPermissions(updatesToPersist)
      this.logDecision(
        {
          decision: 'accept',
          source: { type: 'user', permanent: acceptedPermanentUpdates },
        },
        { input: updatedInput, permissionPromptStartTimeMs },
      )
      const userModified = tool.inputsEquivalent
        ? !tool.inputsEquivalent(input, updatedInput)
        : false
      const trimmedFeedback = feedback?.trim()
      return this.buildAllow(updatedInput, {
        userModified,
        decisionReason,
        acceptFeedback: trimmedFeedback || undefined,
        contentBlocks,
      })
    },
    async handleHookAllow(
      finalInput: Record<string, unknown>,
      permissionUpdates: PermissionUpdate[],
      permissionPromptStartTimeMs?: number,
      opts?: { askSuppressesAlwaysAllowRule?: boolean },
    ): Promise<PermissionAllowDecision> {
      // densable 2.1.235 #12 accept-path strip (same OR as handleUserAllow / jze).
      const shouldStrip =
        tool.suppressesAlwaysAllowRule?.(finalInput) === true ||
        opts?.askSuppressesAlwaysAllowRule === true
      const updatesToPersist = shouldStrip
        ? stripWholeToolGrantsForAsk(
            permissionUpdates,
            tool,
            toolUseContext.getAppState().toolPermissionContext,
          )
        : permissionUpdates
      const acceptedPermanentUpdates =
        await this.persistPermissions(updatesToPersist)
      this.logDecision(
        {
          decision: 'accept',
          source: { type: 'hook', permanent: acceptedPermanentUpdates },
        },
        { input: finalInput, permissionPromptStartTimeMs },
      )
      return this.buildAllow(finalInput, {
        decisionReason: { type: 'hook', hookName: 'PermissionRequest' },
      })
    },
    pushToQueue(item: ToolUseConfirm) {
      queueOps?.push(item)
    },
    removeFromQueue() {
      queueOps?.remove(toolUseID)
    },
    updateQueueItem(patch: Partial<ToolUseConfirm>) {
      queueOps?.update(toolUseID, patch)
    },
  }
  return Object.freeze(ctx)
}

type PermissionContext = ReturnType<typeof createPermissionContext>

/**
 * Create a PermissionQueueOps backed by a React state setter.
 * When dialogStore is provided, also mirrors densable bEt onto DialogStore so
 * managed-settings queueBehind can wait under an open permission prompt.
 */
function createPermissionQueueOps(
  setToolUseConfirmQueue: Dispatch<SetStateAction<ToolUseConfirm[]>>,
  dialogStore?: DialogStore | null,
): PermissionQueueOps {
  const mirrorOpen = (item: ToolUseConfirm) => {
    if (!dialogStore) return
    // densable doo path: requestDialog opens via mailbox — skip mirror
    if (item.toolUseContext.requestDialog) return
    registerPermissionConfirm(item)
    void (async () => {
      // densable foo order: Fwl → file Lno → Bash/sed → bEt
      const {
        selectBashPermissionDialog,
        selectFilePermissionDialog,
        selectPermissionDialog,
        selectPermissionDialogFwl,
      } = await import('../../dialog/selectPermissionDialog.js')
      const fwl = selectPermissionDialogFwl(item)
      const file = fwl ? null : await selectFilePermissionDialog(item)
      const bash = fwl || file ? null : await selectBashPermissionDialog(item)
      const selected = fwl ?? file ?? bash ?? selectPermissionDialog(item)
      const stillQueued = getPermissionConfirm(item.toolUseID)
      if (!stillQueued) return
      dialogStore.open({
        id: permissionPromptDialogId(item.toolUseID),
        kind: selected.spec.kind,
        payload: selected.descriptor,
        queueBehind: shouldQueuePermissionBehind(item),
      })
    })()
  }
  const mirrorClose = (toolUseID: string) => {
    unregisterPermissionConfirm(toolUseID)
    if (!dialogStore) return
    const id = permissionPromptDialogId(toolUseID)
    if (dialogStore.getState().open.some(d => d.id === id)) {
      dialogStore.dismiss(id)
    }
  }
  return {
    push(item: ToolUseConfirm) {
      setToolUseConfirmQueue(queue => [...queue, item])
      registerPermissionConfirm(item)
      mirrorOpen(item)
    },
    remove(toolUseID: string) {
      setToolUseConfirmQueue(queue =>
        queue.filter(item => item.toolUseID !== toolUseID),
      )
      mirrorClose(toolUseID)
    },
    update(toolUseID: string, patch: Partial<ToolUseConfirm>) {
      setToolUseConfirmQueue(queue =>
        queue.map(item =>
          item.toolUseID === toolUseID ? { ...item, ...patch } : item,
        ),
      )
      const prev = getPermissionConfirm(toolUseID)
      if (prev) registerPermissionConfirm({ ...prev, ...patch })
      if (!dialogStore) return
      const id = permissionPromptDialogId(toolUseID)
      const entry = dialogStore.getState().open.find(d => d.id === id)
      if (
        !entry ||
        typeof entry.payload !== 'object' ||
        entry.payload === null
      ) {
        return
      }
      const payload = entry.payload as { classifierState?: string }
      if (payload.classifierState === undefined) return
      let classifierState = payload.classifierState
      if (patch.classifierAutoApproved === true) classifierState = 'approved'
      else if (patch.classifierCheckInProgress === true)
        classifierState = 'checking'
      else if (patch.classifierCheckInProgress === false)
        classifierState = 'none'
      if (classifierState === payload.classifierState) return
      dialogStore.update(id, { ...payload, classifierState })
    },
  }
}

/**
 * densable tip bridge: enqueue onto React queue + DialogStore mirror so NMs
 * (DialogHost) renders — same surface as local canUseTool. Do not invent a
 * second PermissionRequest overlay.
 */
export function enqueuePermissionConfirm(
  setToolUseConfirmQueue: Dispatch<SetStateAction<ToolUseConfirm[]>>,
  dialogStore: DialogStore | null | undefined,
  item: ToolUseConfirm,
): void {
  createPermissionQueueOps(setToolUseConfirmQueue, dialogStore).push(item)
}

export function dequeuePermissionConfirm(
  setToolUseConfirmQueue: Dispatch<SetStateAction<ToolUseConfirm[]>>,
  dialogStore: DialogStore | null | undefined,
  toolUseID: string,
): void {
  createPermissionQueueOps(setToolUseConfirmQueue, dialogStore).remove(
    toolUseID,
  )
}

/**
 * densable Esc / cancel: wipe React queue + tip permission_prompt mirrors.
 * Does not dismiss doo mailbox ids (dialog-N).
 */
export function clearPermissionConfirmQueue(
  setToolUseConfirmQueue: (
    updater: (prev: ToolUseConfirm[]) => ToolUseConfirm[],
  ) => void,
  dialogStore: DialogStore | null | undefined,
): void {
  setToolUseConfirmQueue(() => [])
  clearPermissionConfirms()
  if (!dialogStore) return
  for (const d of [...dialogStore.getState().open]) {
    if (d.id.startsWith('permission_prompt:')) {
      dialogStore.dismiss(d.id)
    }
  }
}

export { createPermissionContext, createPermissionQueueOps, createResolveOnce }
export type {
  PermissionContext,
  PermissionApprovalSource,
  PermissionQueueOps,
  PermissionRejectionSource,
  ResolveOnce,
}
