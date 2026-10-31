import { randomUUID, type UUID } from 'crypto'
import type { Dispatch, SetStateAction } from 'react'
import { logEvent } from 'src/services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/metadata.js'
import {
  claimQuotaAutoResumeTurn,
  filterPendingQuotaContinuationIfRevoked,
  isQuotaWaitStale,
  onQuotaAutoResumeHumanSubmit,
  releaseQuotaAutoResumeTurnClaim,
  type QuotaTurnClaim,
} from 'src/services/quotaAutoResume.js'
import {
  type Command,
  findCommand,
  getCommandName,
  isCommandEnabled,
} from '../commands.js'
import { selectableUserMessagesFilter } from '../components/MessageSelector.js'
import type { SpinnerMode } from '../components/Spinner/types.js'
import type { QuerySource } from '../constants/querySource.js'
import {
  addToHistory,
  expandPastedTextRefs,
  formatUnavailablePastedRefsMessage,
  parseReferences,
  processPastedRefs,
} from '../history.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { IDESelection } from '../hooks/useIdeSelection.js'
import type { AppState } from '../state/AppState.js'
import type { SetToolJSXFn } from '../Tool.js'
import type { LocalJSXCommandOnDone } from '../types/command.js'
import type { Message } from '../types/message.js'
import {
  isValidImagePaste,
  type PromptInputMode,
  type QueuedCommand,
  type QueuePriority,
} from '../types/textInputTypes.js'
import {
  createAbortController,
  getAbortReasonMessage,
} from './abortController.js'
import type { PastedContent } from './config.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import type { EffortValue } from './effort.js'
import type { FileHistoryState } from './fileHistory.js'
import { fileHistoryEnabled, fileHistoryMakeSnapshot } from './fileHistory.js'
import { gracefulShutdownSync } from './gracefulShutdown.js'
import { toError } from './errors.js'
import { logError } from './log.js'
import {
  enqueue,
  enqueueReportingAdmission,
  extractImagesFromValue,
  getCommandQueue,
  isDrainableQueuedCommand,
  isQueuedCommandEditable,
  settleScreening,
  shouldHandBackIdeSelection,
} from './messageQueueManager.js'
import {
  hasUltraplanKeyword,
  isUltraplanProductEnabled,
  stampSlashNameOnlyPastedGaps,
} from './ultraplanKeyword.js'
import { resolveSkillModelOverride } from './model/model.js'
import {
  claimConsumableQueuedAutonomyCommands,
  finalizeAutonomyCommandsForTurn,
} from './autonomyQueueLifecycle.js'
import type { ProcessUserInputContext } from './processUserInput/processUserInput.js'
import { getMainThreadTurn } from './mainThreadTurn.js'
import { processUserInput } from './processUserInput/processUserInput.js'
import {
  runPromptSubmit,
  snapshotPromptScreen,
  type PromptSubmitEnterValue,
  type PromptSubmittedStamp,
} from './processUserInput/promptSubmit.js'
import { createPromptSubmitEntries } from './processUserInput/promptSubmitEntries.js'
import { batchPromptSubmitWaitGuard } from './processUserInput/promptSubmitWaits.js'
import type { QueryGuard } from './QueryGuard.js'
import { queryCheckpoint, startQueryProfile } from './queryProfiler.js'
import {
  applyTurnStartOriginFraming,
  createUserInterruptionMessage,
  isHumanLikeOrigin,
  stampQueueOriginOnUserMessages,
} from './messages.js'
import { isCommandImmediate } from './immediateCommand.js'
import { isFullscreenEnvEnabled } from './fullscreen.js'
import { runWithWorkload } from './workloadContext.js'

function exit(): void {
  gracefulShutdownSync(0)
}

/**
 * densable `ouo` / `Tkr` — idle queue (not screening) drainOnly when UPS
 * hooks or prompt.submit plugins are present. Fail-open true.
 */
function promptSubmitIdleHooksDrainOnly(
  getToolUseContext: HandlePromptSubmitParams['getToolUseContext'],
  messages: Message[],
  mainLoopModel: string,
): boolean {
  try {
    const screen = snapshotPromptScreen(
      getToolUseContext(messages, [], createAbortController(), mainLoopModel),
    )
    return screen.hooks !== '' || screen.plugins !== ''
  } catch (err) {
    logForDebugging(
      `prompt.submit at Enter could not read the hooks: ${err instanceof Error ? err.message : String(err)}`,
    )
    return true
  }
}

/**
 * densable Enter `wn` — stamp screeningPending after Unn. `under` is the
 * pre-Unn RNe snapshot. cancelled / missing under → drainOnly, no stamp.
 */
function settleEnterScreening(
  uuid: string,
  value: PromptSubmitEnterValue | undefined,
  under: PromptSubmittedStamp['under'] | undefined,
  messages: PromptSubmittedStamp['messages'],
): boolean {
  const cancelled = value?.wasCancelled === true
  if (value === undefined || under === undefined || cancelled) {
    return settleScreening(uuid, {
      promptSubmitted: undefined,
      drainOnly: true,
    })
  }
  if ('ended' in value) {
    return settleScreening(uuid, {
      promptSubmitted: {
        text: value.text ?? '',
        under,
        context: value.context,
        messages,
        stopped: value.stopped,
      },
      drainOnly: true,
    })
  }
  return settleScreening(uuid, {
    promptSubmitted: {
      text: value.proceeds.text,
      under,
      context: value.proceeds.context,
      sessionTitle: value.proceeds.sessionTitle,
      messages,
    },
  })
}

type BaseExecutionParams = {
  queuedCommands?: QueuedCommand[]
  messages: Message[]
  mainLoopModel: string
  ideSelection: IDESelection | undefined
  querySource: QuerySource
  commands: Command[]
  queryGuard: QueryGuard
  /**
   * True when external loading (remote session, foregrounded background task)
   * is active. These don't route through queryGuard, so the queue check must
   * account for them separately. Omit (defaults to false) for the dequeue path
   * (executeQueuedInput) — dequeued items were already queued past this check.
   */
  isExternalLoading?: boolean
  setToolJSX: SetToolJSXFn
  getToolUseContext: (
    messages: Message[],
    newMessages: Message[],
    abortController: AbortController,
    mainLoopModel: string,
  ) => ProcessUserInputContext
  setUserInputOnProcessing: (prompt?: string) => void
  setAbortController: (abortController: AbortController | null) => void
  onQuery: (
    newMessages: Message[],
    abortController: AbortController,
    shouldQuery: boolean,
    additionalAllowedTools: string[],
    mainLoopModel: string,
    onBeforeQuery?: (input: string, newMessages: Message[]) => Promise<boolean>,
    input?: string,
    effort?: EffortValue,
    /** Official drain: any command in the batch carried stopHookActive. */
    stopHookActive?: boolean,
    /** Official drain: first clientPlatform on the batch (remote/SDK). */
    clientPlatform?: string,
    /**
     * densable 2.1.229 — slash/skill disallowedTools for the turn
     * (alwaysDenyRules.command). Optional so existing call sites omit it.
     */
    additionalDisallowedTools?: string[],
  ) => Promise<boolean>
  setAppState: (updater: (prev: AppState) => AppState) => void
  onBeforeQuery?: (input: string, newMessages: Message[]) => Promise<boolean>
  canUseTool?: CanUseToolFn
}

/**
 * Parameters for core execution logic (no UI concerns).
 */
type ExecuteUserInputParams = BaseExecutionParams & {
  resetHistory: () => void
  onInputChange: (value: string) => void
  /**
   * densable WZe `getCurrentInput` — Rt fallback joins this with the
   * handed-back prompt when restoreHandedBackPrompt is omitted.
   */
  getCurrentInput?: () => string
  /**
   * densable WZe `restoreHandedBackPrompt` — idle YH / queue drain both
   * pass WN (setMode prompt + join). When set, Rt does not join itself.
   */
  restoreHandedBackPrompt?: (text: string) => void
  /**
   * densable WZe `onPromptHandedBack` / `restoreIdeSelectionConsumedBy`.
   */
  onPromptHandedBack?: HandlePromptSubmitParams['onPromptHandedBack']
  /**
   * densable WZe `X.awaitSessionStartHooks`. After the wait, aborted
   * user-cancel restores drainable string cmds via Rt and returns.
   */
  awaitSessionStartHooks?: () => Promise<void>
  /**
   * densable WZe `h.setPastedContents` — qLr merge on abort restore.
   */
  setPastedContents?: Dispatch<SetStateAction<Record<number, PastedContent>>>
  /**
   * densable WZe abort lr append host (`hT({})` interrupt marker).
   */
  setMessages?: HandlePromptSubmitParams['setMessages']
}

/**
 * densable `jN` — join the live composer draft with a handed-back prompt.
 */
export function joinHandedBackPrompt(current: string, next: string): string {
  if (current.trim() === '') return next
  return `${current}\n${next}`
}

/**
 * densable mSe — slash name is the token before the first whitespace.
 */
function slashCommandName(value: string): string {
  const without = value.startsWith('/') ? value.slice(1) : value
  const space = without.search(/\s/)
  return space === -1 ? without : without.slice(0, space)
}

/**
 * densable WZe `Ln` — wait session-start unless every prompt cmd is a known
 * local non-prompt slash.
 */
export function queuedCommandsNeedSessionStartWait(
  queued: QueuedCommand[],
  commands: Command[],
): boolean {
  return queued.some(cmd => {
    if (cmd.mode !== 'prompt') return false
    if (
      typeof cmd.value !== 'string' ||
      cmd.skipSlashCommands ||
      !cmd.value.trim().startsWith('/')
    ) {
      return true
    }
    const found = findCommand(slashCommandName(cmd.value.trim()), commands)
    return found === undefined || found.type === 'prompt'
  })
}

/**
 * densable Stt — paste-expanded when skipSlash or pasteTagged and
 * preExpansionValue is a nonempty string.
 */
export function queuedCommandWasPasteExpanded(cmd: QueuedCommand): boolean {
  return (
    (cmd.skipSlashCommands === true || cmd.pasteTagged === true) &&
    typeof cmd.preExpansionValue === 'string' &&
    cmd.preExpansionValue.trim() !== ''
  )
}

/**
 * densable fun — restore preExpansionValue when Stt, else the string value.
 */
export function queuedCommandRestoreText(cmd: QueuedCommand): string {
  if (queuedCommandWasPasteExpanded(cmd)) {
    return cmd.preExpansionValue as string
  }
  return typeof cmd.value === 'string' ? cmd.value : ''
}

/**
 * densable qLr — image / inline pastes, or all pastes when Stt.
 */
export function queuedPastedContentsToRestore(
  cmd: QueuedCommand,
): PastedContent[] {
  if (!cmd.pastedContents) return []
  const expanded = queuedCommandWasPasteExpanded(cmd)
  return Object.values(cmd.pastedContents).filter(
    item => item.type === 'image' || item.inline === true || expanded,
  )
}

/**
 * densable PMt — min integer key (including 0 / negatives), else 0.
 */
function nextNegativePasteId(contents: Record<number, PastedContent>): number {
  const keys = Object.keys(contents)
    .map(Number)
    .filter(n => Number.isSafeInteger(n) && n > -4294967296)
  return keys.length === 0 ? 0 : Math.min(0, ...keys)
}

/**
 * densable pde — merge restored pastes into the live composer map.
 * Inline pastes get a fresh negative id; positive ids keep their key.
 */
export function mergeHandedBackPastedContents(
  current: Record<number, PastedContent>,
  incoming: PastedContent[],
): Record<number, PastedContent> {
  const next = { ...current }
  let negative = nextNegativePasteId(next)
  for (const item of incoming) {
    if (item.inline) {
      negative -= 1
      next[negative] = { ...item, id: negative }
    } else if (Number.isSafeInteger(item.id) && item.id > 0) {
      next[item.id] = item
    }
  }
  return next
}

/**
 * densable WZe abort `lr` map — keep historyEntry, else fun display + XLr
 * images from a non-string value.
 */
export function ensureQueuedCommandHistoryEntry(
  cmd: QueuedCommand,
  imageStartId: number = Date.now(),
): NonNullable<QueuedCommand['historyEntry']> {
  if (cmd.historyEntry) {
    return cmd.historyEntry
  }
  const pastedContents: Record<number, PastedContent> = {
    ...(cmd.pastedContents ?? {}),
  }
  for (const image of extractImagesFromValue(cmd.value, imageStartId)) {
    pastedContents[image.id] = image
  }
  return {
    display: queuedCommandRestoreText(cmd),
    pastedContents,
  }
}

/**
 * densable R1e — flush historyEntry; skip missing. No armUndo host.
 */
function flushQueuedHistoryEntries(
  commands: Array<{ historyEntry?: QueuedCommand['historyEntry'] }>,
): void {
  for (const command of commands) {
    if (!command.historyEntry) continue
    try {
      addToHistory(command.historyEntry)
    } catch (err) {
      logError(toError(err))
    }
  }
}

export type PromptInputHelpers = {
  setCursorOffset: (offset: number) => void
  clearBuffer: () => void
  resetHistory: () => void
}

export type HandlePromptSubmitParams = BaseExecutionParams & {
  // Direct user input path (set when called from onSubmit, absent for queue processor)
  input?: string
  mode?: PromptInputMode
  pastedContents?: Record<number, PastedContent>
  helpers: PromptInputHelpers
  onInputChange: (value: string) => void
  setPastedContents: Dispatch<SetStateAction<Record<number, PastedContent>>>
  abortController?: AbortController | null
  addNotification?: (notification: {
    key: string
    text: string
    priority: 'low' | 'medium' | 'high' | 'immediate'
  }) => void
  setMessages?: (updater: (prev: Message[]) => Message[]) => void
  streamMode?: SpinnerMode
  hasInterruptibleToolInProgress?: boolean
  uuid?: UUID
  /**
   * When true, input starting with `/` is treated as plain text.
   * Used for remotely-received messages (bridge/CCR) that should not
   * trigger local slash commands or skills.
   */
  skipSlashCommands?: boolean
  /** Preserves that the input originated from Remote Control when queued. */
  bridgeOrigin?: boolean
  /**
   * densable 2.1.234 — history entry built at submit; flushed on drain (JDr).
   * Mid-turn queue stamps this on QueuedCommand instead of addToHistory now.
   */
  historyEntry?: QueuedCommand['historyEntry']
  /**
   * densable onSubmitProceed — mid-turn enqueue calls this before queueing so
   * bang (`!`) mode resets to prompt (#20 stickiness).
   */
  onSubmitProceed?: () => void
  /**
   * densable resumesStaleQuotaWait — empty Enter substituted A4f in PromptInput.
   * Mid-turn / idle submit no-ops when the wait is no longer stale (hSl).
   */
  resumesStaleQuotaWait?: boolean
  /**
   * densable 2.1.283 send-now — enqueue with priority now (interrupt + flush).
   */
  queuePriority?: QueuePriority
  /** densable chat:queueSubmit — enqueue even when the query is idle. */
  forceQueue?: boolean
  /**
   * densable Art `composerEnter` — live composer Enter only. Queued drain
   * omits this; print/QE omit.
   */
  composerEnter?: unknown
  /**
   * densable `takeIdeSelectionForQueue` — snapshot live IDE selection at
   * mid-turn enqueue. Bash / empty selection returns undefined.
   */
  takeIdeSelectionForQueue?: () => IDESelection | undefined
  /**
   * densable `recordIdeSelectionConsumedBy` — pair uuid with the captured
   * selection so drop can restore when the stamp was not passed through.
   */
  recordIdeSelectionConsumedBy?: (
    uuid: string,
    selection: IDESelection | undefined,
  ) => void
  /**
   * densable `onPromptHandedBack` / `restoreIdeSelectionConsumedBy`.
   */
  onPromptHandedBack?: (
    uuid: string,
    selection: IDESelection | undefined,
  ) => void
  /**
   * densable WZe `getCurrentInput` — live composer text for Rt join.
   */
  getCurrentInput?: () => string
  /**
   * densable WZe `restoreHandedBackPrompt`.
   */
  restoreHandedBackPrompt?: (text: string) => void
  /**
   * densable WZe `X.awaitSessionStartHooks`.
   */
  awaitSessionStartHooks?: () => Promise<void>
}

export async function handlePromptSubmit(
  params: HandlePromptSubmitParams,
): Promise<void> {
  const {
    helpers,
    queryGuard,
    isExternalLoading = false,
    commands,
    onInputChange,
    setPastedContents,
    setToolJSX,
    getToolUseContext,
    messages,
    mainLoopModel,
    ideSelection,
    setUserInputOnProcessing,
    setAbortController,
    onQuery,
    setAppState,
    onBeforeQuery,
    canUseTool,
    queuedCommands,
    uuid,
    skipSlashCommands,
    bridgeOrigin,
    historyEntry,
    onSubmitProceed,
  } = params
  // densable Z = resumesStaleQuotaWait===true && !hSl
  const staleResumeGone = (): boolean =>
    params.resumesStaleQuotaWait === true && !isQuotaWaitStale()

  const { setCursorOffset, clearBuffer, resetHistory } = helpers

  // Queue processor path: commands are pre-validated and ready to execute.
  // Skip all input validation, reference parsing, and queuing logic.
  if (queuedCommands?.length) {
    startQueryProfile()
    await executeUserInput({
      queuedCommands,
      messages,
      mainLoopModel,
      ideSelection,
      querySource: params.querySource,
      commands,
      queryGuard,
      setToolJSX,
      getToolUseContext,
      setUserInputOnProcessing,
      setAbortController,
      onQuery,
      setAppState,
      onBeforeQuery,
      resetHistory,
      canUseTool,
      onInputChange,
      getCurrentInput: params.getCurrentInput,
      restoreHandedBackPrompt: params.restoreHandedBackPrompt,
      onPromptHandedBack: params.onPromptHandedBack,
      awaitSessionStartHooks: params.awaitSessionStartHooks,
      setPastedContents: params.setPastedContents,
      setMessages: params.setMessages,
    })
    return
  }

  const input = params.input ?? ''
  const mode = params.mode ?? 'prompt'
  const rawPastedContents = params.pastedContents ?? {}

  // Images are only sent if their [Image #N] placeholder is still in the text.
  // Deleting the inline pill drops the image; orphaned entries are filtered here.
  // densable Fk: keep non-image/non-audio always; keep image/audio only if referenced.
  const referencedIds = new Set(parseReferences(input).map(r => r.id))
  const pastedContents = Object.fromEntries(
    Object.entries(rawPastedContents).filter(
      ([, c]) => c.type !== 'image' || referencedIds.has(c.id),
    ),
  )

  const hasImages = Object.values(pastedContents).some(isValidImagePaste)
  if (input.trim() === '') {
    return
  }

  // Handle exit commands by triggering the exit command instead of direct process.exit
  // Skip for remote bridge messages — "exit" typed on iOS shouldn't kill the local session
  if (
    !skipSlashCommands &&
    ['exit', 'quit', ':q', ':q!', ':wq', ':wq!'].includes(input.trim())
  ) {
    // Trigger the exit command which will show the feedback dialog
    const exitCommand = commands.find(cmd => cmd.name === 'exit')
    if (exitCommand) {
      // Submit the /exit command instead - recursive call needs to be handled
      void handlePromptSubmit({
        ...params,
        input: '/exit',
      })
    } else {
      // Fallback to direct exit if exit command not found
      exit()
    }
    return
  }

  // densable hLd/mLd/gLd (#3/#14): strip unavailable non-image paste refs.
  // Cancel-and-confirm (do not submit) when strip leaves empty / bash / slash.
  // Otherwise continue with stripped input so expanded text omits dead pastes.
  const { stripped, expanded, removed } = processPastedRefs(
    input,
    pastedContents,
  )
  if (removed.length > 0) {
    params.addNotification?.({
      key: 'pasted-text-unavailable',
      text: formatUnavailablePastedRefsMessage(removed),
      priority: 'immediate',
    })
    if (
      stripped.trim() === '' ||
      mode === 'bash' ||
      input.trimStart().startsWith('/')
    ) {
      // densable: cancel submit; input box still holds original R (not cleared yet).
      return
    }
  }

  // Prefer densable expanded path (mLd.expanded) so unavailable skips match d6e.
  // Fall back to expandPastedTextRefs for empty-removed case (identical).
  const finalInput =
    removed.length > 0 ? expanded : expandPastedTextRefs(input, pastedContents)
  // densable: only count available text pastes for tengu_paste_text.
  const pastedTextRefs = parseReferences(input).filter(
    r =>
      pastedContents[r.id]?.type === 'text' &&
      !pastedContents[r.id]?.unavailable,
  )
  const pastedTextCount = pastedTextRefs.length
  const pastedTextBytes = pastedTextRefs.reduce(
    (sum, r) => sum + (pastedContents[r.id]?.content.length ?? 0),
    0,
  )
  logEvent('tengu_paste_text', { pastedTextCount, pastedTextBytes })

  // Handle local-jsx immediate commands (e.g., /config, /doctor)
  // Skip for remote bridge messages — slash commands from CCR clients are plain text
  if (!skipSlashCommands && finalInput.trim().startsWith('/')) {
    const trimmedInput = finalInput.trim()
    const spaceIndex = trimmedInput.indexOf(' ')
    const commandName =
      spaceIndex === -1
        ? trimmedInput.slice(1)
        : trimmedInput.slice(1, spaceIndex)
    const commandArgs =
      spaceIndex === -1 ? '' : trimmedInput.slice(spaceIndex + 1).trim()

    // densable ARt(cmd, args) — resolve boolean | (args)=>boolean
    const immediateCommand = commands.find(
      cmd =>
        isCommandImmediate(
          cmd,
          commandArgs,
          isFullscreenEnvEnabled() ? 'fullscreen' : 'inline',
        ) &&
        isCommandEnabled(cmd) &&
        (cmd.name === commandName ||
          cmd.aliases?.includes(commandName) ||
          getCommandName(cmd) === commandName),
    )

    if (
      immediateCommand &&
      immediateCommand.type === 'local-jsx' &&
      (queryGuard.isActive || isExternalLoading)
    ) {
      logEvent('tengu_immediate_command_executed', {
        commandName:
          immediateCommand.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })

      // Clear input
      onInputChange('')
      setCursorOffset(0)
      setPastedContents({})
      clearBuffer()

      const context = getToolUseContext(
        messages,
        [],
        createAbortController(),
        mainLoopModel,
      )

      let doneWasCalled = false
      const onDone: LocalJSXCommandOnDone = (result, options) => {
        doneWasCalled = true
        // Use clearLocalJSX to explicitly clear the local JSX command
        setToolJSX({
          jsx: null,
          shouldHidePromptInput: false,
          clearLocalJSX: true,
        })
        if (result && options?.display !== 'skip' && params.addNotification) {
          params.addNotification({
            key: `immediate-${immediateCommand.name}`,
            text: result,
            priority: 'immediate',
          })
        }
        if (options?.nextInput) {
          if (options.submitNextInput) {
            enqueue({ value: options.nextInput, mode: 'prompt' })
          } else {
            onInputChange(options.nextInput)
          }
        }
      }

      const impl = await immediateCommand.load()
      const jsx = await impl.call(
        onDone,
        { ...context, dispatchedAsImmediate: true },
        commandArgs,
      )

      // Skip if onDone already fired — prevents stuck isLocalJSXCommand
      // (see processSlashCommand.tsx local-jsx case for full mechanism).
      if (jsx && !doneWasCalled) {
        setToolJSX({
          jsx,
          shouldHidePromptInput: false,
          isLocalJSXCommand: true,
          isImmediate: true,
        })
      }
      return
    }
  }

  if (queryGuard.isActive || isExternalLoading || params.forceQueue) {
    // Only allow prompt and bash mode commands to be queued
    if (mode !== 'prompt' && mode !== 'bash') {
      return
    }
    if (staleResumeGone()) return

    // Interrupt the current turn when all executing tools have
    // interruptBehavior 'cancel' (e.g. SleepTool).
    if (params.hasInterruptibleToolInProgress) {
      logForDebugging(
        `[interrupt] Aborting current turn: streamMode=${params.streamMode}`,
      )
      logEvent('tengu_cancel', {
        source:
          'interrupt_on_submit' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        streamMode:
          params.streamMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      params.abortController?.abort('interrupt')
    }

    // densable: e.onSubmitProceed?.() before oI — reset bang mode mid-turn (#20)
    onSubmitProceed?.()
    // densable Yqn(O) — se = I==="prompt" && Ydg; Ydg residual, prompt-mode is the gate
    const queuedUuid = uuid ?? randomUUID()
    if (mode === 'prompt') {
      onQuotaAutoResumeHumanSubmit(queuedUuid)
    }

    // densable Qo: prompt-mode and not a real slash.
    // kn=Qo&&jj()&&C$t(...) → drainOnly. bn=Qo&&!kn&&xt.isRunning&&turnId.
    const isRealSlash = !skipSlashCommands && finalInput.trim().startsWith('/')
    const promptMode = mode === 'prompt' && !isRealSlash
    const knPasted =
      pastedContents === undefined
        ? pastedContents
        : stampSlashNameOnlyPastedGaps(pastedContents, input.trim())
    const kn =
      promptMode &&
      isUltraplanProductEnabled() &&
      hasUltraplanKeyword(input.trim(), knPasted)
    const screening =
      promptMode &&
      !kn &&
      queryGuard.isRunning &&
      getMainThreadTurn()?.turnId !== undefined
    const drainOnlyIdleHooks =
      promptMode &&
      !screening &&
      promptSubmitIdleHooksDrainOnly(getToolUseContext, messages, mainLoopModel)
    const queuedIdeSelection =
      mode !== 'bash' ? params.takeIdeSelectionForQueue?.() : undefined
    if (queuedIdeSelection !== undefined) {
      params.recordIdeSelectionConsumedBy?.(queuedUuid, queuedIdeSelection)
    }

    // Enqueue with string value + raw pastedContents. Images will be resized
    // at execution time when processUserInput runs (not baked in here).
    enqueue({
      value: finalInput.trim(),
      preExpansionValue: input.trim(),
      mode,
      pastedContents: hasImages ? pastedContents : undefined,
      skipSlashCommands,
      bridgeOrigin,
      // densable prompt enqueue stamps human origin so Wzn keyword gate can fire.
      origin: { kind: 'human' },
      uuid: queuedUuid,
      historyEntry,
      composerEnter: params.composerEnter,
      ...(params.queuePriority ? { priority: params.queuePriority } : {}),
      ...(queuedIdeSelection !== undefined
        ? { ideSelection: queuedIdeSelection }
        : {}),
      ...(screening ? { screeningPending: true } : {}),
      ...(kn || drainOnlyIdleHooks ? { drainOnly: true } : {}),
    })

    onInputChange('')
    setCursorOffset(0)
    setPastedContents({})
    resetHistory()
    clearBuffer()
    if (!screening) {
      return
    }

    // densable Enter Unn: screen then stamp so Art does not double-run UPS.
    const screeningResult: {
      messages: NonNullable<PromptSubmittedStamp['messages']>
      shouldQuery: boolean
      resultText?: string
      allowedTools?: string[]
    } = { messages: [], shouldQuery: true }
    let under: PromptSubmittedStamp['under'] | undefined
    let outcome: Awaited<ReturnType<typeof runPromptSubmit>> | undefined
    let enterSettled = false
    try {
      const abortController = params.abortController ?? createAbortController()
      const toolUseContext = getToolUseContext(
        messages,
        [],
        abortController,
        mainLoopModel,
      )
      under = snapshotPromptScreen(toolUseContext)
      outcome = await runPromptSubmit({
        text: finalInput.trim(),
        originalInput: finalInput.trim(),
        result: screeningResult,
        context: toolUseContext,
        isStartInput: false,
        promptSource: 'queued',
        enter: value => {
          enterSettled = true
          settleEnterScreening(
            queuedUuid,
            value,
            under,
            screeningResult.messages,
          )
        },
      })
    } catch (err) {
      logForDebugging(
        `prompt.submit at Enter failed, leaving it to the drain: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    if (enterSettled) {
      return
    }
    if (
      outcome !== undefined &&
      'ended' in outcome.value &&
      outcome.value.stopped === undefined
    ) {
      if (!settleScreening(queuedUuid, { dropped: true })) {
        logForDebugging(
          'prompt.submit at Enter dropped a prompt that had left the queue',
        )
        return
      }
      if (historyEntry) {
        try {
          addToHistory(historyEntry)
        } catch (err) {
          logError(toError(err))
        }
      }
      if (shouldHandBackIdeSelection(getCommandQueue(), queuedIdeSelection)) {
        params.onPromptHandedBack?.(queuedUuid, queuedIdeSelection)
      }
      params.addNotification?.({
        key: 'prompt-submit-dropped',
        text: outcome.value.ended.resultText ?? 'Prompt dropped by a hook',
        priority: 'immediate',
      })
      return
    }
    settleEnterScreening(
      queuedUuid,
      outcome?.value,
      under,
      screeningResult.messages,
    )
    return
  }

  if (staleResumeGone()) {
    setUserInputOnProcessing(undefined)
    return
  }

  // Start query profiling for this query
  startQueryProfile()

  // Construct a QueuedCommand from the direct user input so both paths
  // go through the same executeUserInput loop. This ensures images get
  // resized via processUserInput regardless of how the command arrives.
  const cmdUuid = uuid ?? randomUUID()
  const cmd: QueuedCommand = {
    value: finalInput,
    preExpansionValue: input,
    mode,
    pastedContents: hasImages ? pastedContents : undefined,
    skipSlashCommands,
    bridgeOrigin,
    // densable prompt path: origin.kind === "human" (Wzn for ultracode keyword).
    origin: { kind: 'human' },
    uuid: cmdUuid,
    historyEntry,
    composerEnter: params.composerEnter,
  }

  // densable Yqn(O,{dispatching:!0}) — idle-path prompt submit
  if (mode === 'prompt') {
    onQuotaAutoResumeHumanSubmit(cmdUuid, { dispatching: true })
  }

  await executeUserInput({
    queuedCommands: [cmd],
    messages,
    mainLoopModel,
    ideSelection,
    querySource: params.querySource,
    commands,
    queryGuard,
    setToolJSX,
    getToolUseContext,
    setUserInputOnProcessing,
    setAbortController,
    onQuery,
    setAppState,
    onBeforeQuery,
    resetHistory,
    canUseTool,
    onInputChange,
    getCurrentInput: params.getCurrentInput,
    restoreHandedBackPrompt: params.restoreHandedBackPrompt,
    onPromptHandedBack: params.onPromptHandedBack,
    awaitSessionStartHooks: params.awaitSessionStartHooks,
    setPastedContents: params.setPastedContents,
    setMessages: params.setMessages,
  })
}

/**
 * Core logic for executing user input without UI side effects.
 *
 * All commands arrive as `queuedCommands`. First command gets full treatment
 * (attachments, ideSelection, pastedContents with image resizing). Commands 2-N
 * get `skipAttachments` to avoid duplicating turn-level context.
 */
async function executeUserInput(params: ExecuteUserInputParams): Promise<void> {
  const {
    messages,
    mainLoopModel,
    ideSelection,
    querySource,
    queryGuard,
    setToolJSX,
    getToolUseContext,
    setUserInputOnProcessing,
    setAbortController,
    onQuery,
    setAppState,
    onBeforeQuery,
    resetHistory,
    canUseTool,
    queuedCommands,
    onPromptHandedBack,
    restoreHandedBackPrompt,
    getCurrentInput,
    awaitSessionStartHooks,
    setPastedContents,
    setMessages,
  } = params

  /**
   * densable WZe `Rt` — restore handed-back prompt text, then zZe ideSelection.
   */
  function restoreHandedBack(
    text: string,
    cmd: {
      uuid?: string
      ideSelection?: QueuedCommand['ideSelection']
    },
  ): void {
    if (restoreHandedBackPrompt) {
      restoreHandedBackPrompt(text)
    } else {
      params.onInputChange(
        joinHandedBackPrompt(getCurrentInput?.() ?? '', text),
      )
    }
    if (
      cmd.uuid &&
      shouldHandBackIdeSelection(getCommandQueue(), cmd.ideSelection)
    ) {
      onPromptHandedBack?.(cmd.uuid, cmd.ideSelection)
    }
  }

  // Note: paste references are already processed before calling this function
  // (either in handlePromptSubmit before queuing, or before initial execution).
  // Always create a fresh abort controller — queryGuard guarantees no concurrent
  // executeUserInput call, so there's no prior controller to inherit.
  const abortController = createAbortController()
  setAbortController(abortController)

  function makeContext(): ProcessUserInputContext {
    return getToolUseContext(messages, [], abortController, mainLoopModel)
  }

  // densable w = (g??[]).flatMap(uuid) — captured before z4f so G4f sees
  // the original drain set (including a Jqn-stripped continuation).
  const rawQueued = queuedCommands ?? []
  const turnUuids = rawQueued.flatMap(cmd =>
    cmd.uuid === undefined ? [] : [cmd.uuid],
  )
  let turnClaim: QuotaTurnClaim | null = null

  // Wrap in try-finally so the guard is released even if processUserInput
  // throws or onQuery is skipped. onQuery's finally calls queryGuard.end(),
  // which transitions running→idle; cancelReservation() below is a no-op in
  // that case (only acts on dispatching state).
  try {
    // Reserve the guard BEFORE processUserInput — processBashCommand awaits
    // BashTool.call() and processSlashCommand awaits getMessagesForSlashCommand,
    // so the guard must be active during those awaits to ensure concurrent
    // handlePromptSubmit calls queue (via the isActive check above) instead
    // of starting a second executeUserInput. This call is a no-op if the
    // guard is already in dispatching (legacy queue-processor path).
    queryGuard.reserve()
    queryCheckpoint('query_process_user_input_start')

    const newMessages: Message[] = []
    let shouldQuery = false
    let allowedTools: string[] | undefined
    // densable 2.1.229 — command disallowedTools for the turn
    let disallowedTools: string[] | undefined
    let model: string | undefined
    let effort: EffortValue | undefined
    let nextInput: string | undefined
    let submitNextInput: boolean | undefined

    // Iterate all commands uniformly. First command gets attachments +
    // ideSelection + pastedContents, rest skip attachments to avoid
    // duplicating turn-level context (IDE selection, todos, diffs).
    // densable J=z4f(g??[]) — strip pending continuation only if Jqn.
    let commands = filterPendingQuotaContinuationIfRevoked(rawQueued)
    const queuedAutonomyClaim =
      await claimConsumableQueuedAutonomyCommands(commands)
    commands = queuedAutonomyClaim.attachmentCommands
    const claimedAutonomyCommands = queuedAutonomyClaim.claimedCommands
    if (commands.length === 0) {
      // Clear the abort controller published a few lines above so this turn's
      // stale controller does not leak into the next turn when every claimed
      // autonomy command was skipped as non-consumable.
      setAbortController(null)
      return
    }

    // densable WZe `Ln` wait then abort Rt. Gold skips known local slash.
    const drainGeneration = queryGuard.generation
    const shouldWaitSessionStart = queuedCommandsNeedSessionStartWait(
      commands,
      params.commands,
    )
    if (shouldWaitSessionStart && awaitSessionStartHooks) {
      try {
        await awaitSessionStartHooks()
      } catch (err) {
        logError(toError(err))
      }
      if (abortController.signal.aborted) {
        const generationChanged = queryGuard.generation !== drainGeneration
        const userCancel =
          generationChanged &&
          getAbortReasonMessage(abortController.signal.reason) === 'user-cancel'
        const historyInterrupted: QueuedCommand[] = []
        const resurrect: QueuedCommand[] = []
        for (const cmd of commands) {
          if (
            userCancel &&
            isDrainableQueuedCommand(cmd) &&
            typeof cmd.value === 'string'
          ) {
            restoreHandedBack(queuedCommandRestoreText(cmd), cmd)
            const restoredPastes = queuedPastedContentsToRestore(cmd)
            if (restoredPastes.length > 0) {
              setPastedContents?.(prev =>
                mergeHandedBackPastedContents(prev, restoredPastes),
              )
            }
          } else if (
            generationChanged &&
            cmd.mode === 'prompt' &&
            isDrainableQueuedCommand(cmd)
          ) {
            historyInterrupted.push(cmd)
          } else {
            resurrect.push(cmd)
          }
        }
        for (let i = resurrect.length - 1; i >= 0; i--) {
          const cmd = resurrect[i]
          if (!cmd) continue
          enqueueReportingAdmission(
            { ...cmd, admissionExempt: 'resurrected' },
            { ahead: true },
          )
        }
        if (historyInterrupted.length > 0) {
          setMessages?.(prev => [...prev, createUserInterruptionMessage({})])
          flushQueuedHistoryEntries(
            historyInterrupted.map(cmd => ({
              ...cmd,
              historyEntry: ensureQueuedCommandHistoryEntry(cmd),
            })),
          )
        }
        if (!generationChanged) {
          setAbortController(null)
        }
        return
      }
    }

    // densable JDr: flush historyEntry on drain — not at mid-turn enqueue (#20)
    flushQueuedHistoryEntries(commands)

    // Compute the workload tag for this turn. queueProcessor can batch a
    // cron prompt with a same-tick human prompt; only tag when EVERY
    // command agrees on the same non-undefined workload — a human in the
    // mix is actively waiting.
    const firstWorkload = commands[0]?.workload
    const turnWorkload =
      firstWorkload !== undefined &&
      commands.every(c => c.workload === firstWorkload)
        ? firstWorkload
        : undefined
    const deferredAutonomyRunIds = new Set<string>()

    // Wrap the entire turn (processUserInput loop + onQuery) in an
    // AsyncLocalStorage context. This is the ONLY way to correctly
    // propagate workload across await boundaries: void-detached bg agents
    // (executeForkedSlashCommand, AgentTool) capture the ALS context at
    // invocation time, and every await inside them resumes in that
    // context — isolated from the parent's continuation. A process-global
    // mutable slot would be clobbered at the detached closure's first
    // await by this function's synchronous return path. See state.ts.
    let turnError: unknown
    try {
      await runWithWorkload(turnWorkload, async () => {
        using _batch = batchPromptSubmitWaitGuard(commands)
        for (let i = 0; i < commands.length; i++) {
          const cmd = commands[i]!
          const isFirst = i === 0
          const runId = cmd.autonomy?.runId
          using promptSubmitEntries = createPromptSubmitEntries()
          const result = await processUserInput({
            input: cmd.value,
            preExpansionInput: cmd.preExpansionValue,
            mode: cmd.mode,
            setToolJSX,
            context: makeContext(),
            pastedContents: isFirst ? cmd.pastedContents : undefined,
            messages,
            setUserInputOnProcessing: isFirst
              ? setUserInputOnProcessing
              : undefined,
            isAlreadyProcessing: !isFirst,
            querySource,
            canUseTool,
            uuid: cmd.uuid,
            ideSelection: isFirst
              ? (cmd.ideSelection ?? ideSelection)
              : undefined,
            skipSlashCommands: cmd.skipSlashCommands,
            bridgeOrigin: cmd.bridgeOrigin,
            // densable 2.1.221 fire stamp: re-open model-invocable slash + /loop analytics gate
            modelScheduledOrigin: cmd.modelScheduledOrigin,
            wakeupSource: cmd.wakeupSource,
            isMeta: cmd.isMeta,
            skipAttachments:
              cmd.skipAttachments === true ||
              cmd.mode === 'poll-event' ||
              cmd.mode === 'task-notification' ||
              !isFirst,
            skipSubmissionHooks: cmd.skipSubmissionHooks,
            autonomy: cmd.autonomy,
            // densable Dfr: origin + suppressWorkflowKeyword for p2y gate.
            origin: cmd.origin,
            suppressWorkflowKeyword: cmd.suppressWorkflowKeyword,
            composerEnter: cmd.composerEnter,
            wait: cmd.wait === true,
            promptSubmitted: cmd.promptSubmitted as
              | PromptSubmittedStamp
              | undefined,
            aheadOfSessionStart: cmd.orphanedPermission !== undefined,
            entries: promptSubmitEntries,
          })
          promptSubmitEntries.handedOff()
          if (runId && result.deferAutonomyCompletion) {
            deferredAutonomyRunIds.add(runId)
          }
          // densable cun after Art: skip human-like (jy); fill origin only when
          // unset. Image metadata (Qt) must stay origin-less so IDd hides it.
          // densable Dfr/HXd runs Fws inside HXd; we Fws !isMeta users after
          // stamp so peer/observer prompts still get turn-start framing.
          // Derive origin from mode for task-notifications — mirrors the origin
          // derivation at messages.ts (case 'queued_command'); intentionally
          // does NOT mirror its isMeta:true so idle-dequeued notifications stay
          // visible in the transcript via UserAgentNotificationMessage.
          const origin =
            cmd.origin ??
            (cmd.mode === 'task-notification'
              ? ({ kind: 'task-notification' } as const)
              : undefined)
          if (origin) {
            stampQueueOriginOnUserMessages(result.messages, origin)
            if (!isHumanLikeOrigin(origin)) {
              for (const m of result.messages) {
                if (m.type === 'user' && !m.isMeta) {
                  applyTurnStartOriginFraming(
                    m,
                    origin as { kind?: string; from?: string },
                  )
                }
              }
            }
          }
          newMessages.push(...result.messages)
          if (isFirst) {
            shouldQuery = result.shouldQuery
            allowedTools = result.allowedTools
            disallowedTools = result.disallowedTools
            model = result.model
            effort = result.effort
            nextInput = result.nextInput
            submitNextInput = result.submitNextInput
          }
        }

        queryCheckpoint('query_process_user_input_end')
        if (fileHistoryEnabled()) {
          queryCheckpoint('query_file_history_snapshot_start')
          newMessages.filter(selectableUserMessagesFilter).forEach(message => {
            void fileHistoryMakeSnapshot(
              (updater: (prev: FileHistoryState) => FileHistoryState) => {
                setAppState(prev => ({
                  ...prev,
                  fileHistory: updater(prev.fileHistory),
                }))
              },
              message.uuid,
            )
          })
          queryCheckpoint('query_file_history_snapshot_end')
        }

        if (newMessages.length) {
          // History is now added in the caller (onSubmit) for direct user submissions.
          // This ensures queued command processing (notifications, already-queued user input)
          // doesn't add to history, since those either shouldn't be in history or were
          // already added when originally queued.
          resetHistory()
          setToolJSX({
            jsx: null,
            shouldHidePromptInput: false,
            clearLocalJSX: true,
          })

          const primaryCmd = commands[0]
          const primaryMode = primaryCmd?.mode ?? 'prompt'
          const primaryInput =
            primaryCmd && typeof primaryCmd.value === 'string'
              ? primaryCmd.value
              : undefined
          const shouldCallBeforeQuery = primaryMode === 'prompt'
          // Official: d=C.some(a=>a.stopHookActive)?!0:void 0,
          // r=C.find(a=>a.clientPlatform)?.clientPlatform
          const stopHookActive = commands.some(c => c.stopHookActive)
            ? true
            : undefined
          const clientPlatform = commands.find(
            c => c.clientPlatform,
          )?.clientPlatform
          // densable c8o: stamp verifiedSlackHumanTurn onto matching user msgs
          // by queue uuid so foreign_user_input guards treat Slack human turns.
          for (const cmd of commands) {
            if (!cmd.verifiedSlackHumanTurn || cmd.uuid === undefined) continue
            for (const msg of newMessages) {
              if (msg.type === 'user' && msg.uuid === cmd.uuid) {
                ;(
                  msg as { verifiedSlackHumanTurn?: boolean }
                ).verifiedSlackHumanTurn = true
              }
            }
          }
          // densable W4f — claim takeover vs continuation before onQuery.
          // Gold: z=Math.max(0,J.findIndex(Uft)); se=J[z]
          const firstUftIndex = Math.max(
            0,
            commands.findIndex(isQueuedCommandEditable),
          )
          const claimCmd = commands[firstUftIndex]
          const claimMode = claimCmd?.mode ?? 'prompt'
          const humanCommands = commands.filter(isQueuedCommandEditable)
          turnClaim = claimQuotaAutoResumeTurn({
            turnUuids,
            isHumanTakeover:
              shouldQuery &&
              (claimMode === 'prompt' || claimMode === 'bash') &&
              claimCmd !== undefined &&
              isQueuedCommandEditable(claimCmd),
            humanCommandUuids: humanCommands.map(cmd => cmd.uuid),
            willQuery: shouldQuery,
          })
          await onQuery(
            newMessages,
            abortController,
            shouldQuery,
            allowedTools ?? [],
            model
              ? resolveSkillModelOverride(model, mainLoopModel)
              : mainLoopModel,
            shouldCallBeforeQuery ? onBeforeQuery : undefined,
            primaryInput,
            effort,
            stopHookActive,
            clientPlatform,
            disallowedTools ?? [],
          )
        } else {
          // Local slash commands that skip messages (e.g., /model, /theme).
          // Release the guard BEFORE clearing toolJSX to prevent spinner flash —
          // the spinner formula checks: (!toolJSX || showSpinner) && isLoading.
          // If we clear toolJSX while the guard is still reserved, spinner briefly
          // shows. The finally below also calls cancelReservation (no-op if idle).
          queryGuard.cancelReservation()
          setToolJSX({
            jsx: null,
            shouldHidePromptInput: false,
            clearLocalJSX: true,
          })
          resetHistory()
          setAbortController(null)
        }

        // densable WZe: submitNextInput enqueues; else Rt(nextInput, cmd).
        if (nextInput) {
          if (submitNextInput) {
            enqueue({ value: nextInput, mode: 'prompt' })
          } else {
            restoreHandedBack(nextInput, commands[0] ?? {})
          }
        }
      }) // end runWithWorkload — ALS context naturally scoped, no finally needed
    } catch (error) {
      turnError = error
    }

    // Finalize claimed autonomy commands as `completed` only if the turn
    // body itself succeeded. Run the finalize call in its own try/catch so a
    // failure there does not double-finalize the same commands as `failed`
    // (which previously cancelled follow-up queue state after a successful
    // turn).
    if (claimedAutonomyCommands.length) {
      const finalizableCommands = claimedAutonomyCommands.filter(command => {
        const runId = command.autonomy?.runId
        return !runId || !deferredAutonomyRunIds.has(runId)
      })
      if (turnError) {
        try {
          await finalizeAutonomyCommandsForTurn({
            commands: finalizableCommands,
            outcome: { type: 'failed', error: turnError },
            currentDir: getCwd(),
            priority: 'later',
            workload: turnWorkload,
          })
        } catch (finalizeError) {
          logError(toError(finalizeError))
        }
      } else {
        try {
          const nextCommands = await finalizeAutonomyCommandsForTurn({
            commands: finalizableCommands,
            outcome: { type: 'completed' },
            currentDir: getCwd(),
            priority: 'later',
            workload: turnWorkload,
          })
          for (const nextCommand of nextCommands) {
            enqueue(nextCommand)
          }
        } catch (finalizeError) {
          logError(toError(finalizeError))
        }
      }
    }

    if (turnError) {
      throw turnError
    }
  } finally {
    // densable G4f(S,w) — release W4f claim after the turn (or on throw).
    releaseQuotaAutoResumeTurnClaim(turnClaim, turnUuids)
    // Safety net: release the guard reservation if processUserInput threw
    // or onQuery was skipped. No-op if onQuery already ran (guard is idle
    // via end(), or running — cancelReservation only acts on dispatching).
    // This is the single source of truth for releasing the reservation;
    // useQueueProcessor no longer needs its own .finally().
    queryGuard.cancelReservation()
    // Safety net: clear the placeholder if processUserInput produced no
    // messages or threw — otherwise it would stay visible until the next
    // turn's resetLoadingState. Harmless when onQuery ran: setMessages grew
    // displayedMessages past the baseline, so REPL.tsx already hid it.
    setUserInputOnProcessing(undefined)
  }
}
