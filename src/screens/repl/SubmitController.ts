import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { feature } from 'bun:bundle'
import type * as React from 'react'
import { logEvent } from 'src/services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/metadata.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import {
  type Command,
  getCommandName,
  isCommandEnabled,
} from '../../commands.js'
import { prependModeCharacterToInput } from '../../components/PromptInput/inputModes.js'
import { viewedAgentForInput } from '../../components/PromptInput/viewedAgent.js'
import type { SpinnerMode } from '../../components/Spinner/types.js'
import type { QuerySource } from '../../constants/querySource.js'
import { LOCAL_COMMAND_STDOUT_TAG } from '../../constants/xml.js'
import type { Notification } from '../../context/notifications.js'
import {
  addToHistory,
  expandPastedTextRefs,
  parseReferences,
} from '../../history.js'
import type { IDESelection } from '../../hooks/useIdeSelection.js'
import {
  type ActiveSpeculationState,
  handleSpeculationAccept,
} from '../../services/PromptSuggestion/speculation.js'
import type { AppStateStore } from '../../state/AppStateStore.js'
import type { SetToolJSXFn } from '../../Tool.js'
import type { CommandResultDisplay } from '../../types/command.js'
import type { Message } from '../../types/message.js'
import type {
  PromptInputMode,
  QueuedCommand,
} from '../../types/textInputTypes.js'
import { createAbortController } from '../../utils/abortController.js'
import {
  claimConsumableQueuedAutonomyCommands,
  finalizeAutonomyCommandsForTurn,
} from '../../utils/autonomyQueueLifecycle.js'
import { clearHeldClearedDraft } from '../../utils/clearedDraftHold.js'
import { incrementPromptCount } from '../../utils/commitAttribution.js'
import type { PastedContent } from '../../utils/config.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { toError } from '../../utils/errors.js'
import type { FileStateCache } from '../../utils/fileStateCache.js'
import {
  isVelvetPandaEnabled,
  type QueuedNowLowLatency,
  trySendQueuedNowKey,
} from '../../utils/foregroundToolCalls.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import {
  type HandlePromptSubmitParams,
  handlePromptSubmit,
  type PromptInputHelpers,
} from '../../utils/handlePromptSubmit.js'
import { isCommandImmediate } from '../../utils/immediateCommand.js'
import { logError } from '../../utils/log.js'
import {
  isQueuedCommandEditable,
  type MessageQueueInstance,
  type SetAppState,
} from '../../utils/messageQueueManager.js'
import {
  applyTurnStartOriginFraming,
  createCommandInputMessage,
  createUserMessage,
  formatCommandInputTags,
} from '../../utils/messages.js'
import {
  hasMatchingFunctionHook,
  runFunctionHookChain,
} from '../../utils/plugins/functionHooksModules.js'
import { isEndedByModelCommandBlocked } from '../../utils/processUserInput/processUserInput.js'
import type { QueryGuard } from '../../utils/QueryGuard.js'
import { recordAttributionSnapshot } from '../../utils/sessionStorage.js'
import { prependToShellHistoryCache } from '../../utils/suggestions/shellHistoryCompletion.js'
import type { RemoteMessageContent } from '../../utils/teleport/api.js'
import { escapeXml } from '../../utils/xml.js'
import type { TurnController } from './TurnController.js'

export type SubmitControllerOptions = {
  store: AppStateStore
  turnController: TurnController
  messageQueue: MessageQueueInstance
  queryGuard: QueryGuard
}

export type StashedPrompt = {
  text: string
  cursorOffset: number
  pastedContents: Record<number, PastedContent>
}

export type SpeculationAcceptArg = {
  state: ActiveSpeculationState
  speculationSessionTimeSavedMs: number
  setAppState: SetAppState
}

export type SubmitPromptOptions = {
  fromKeybinding?: boolean
  pastedContentsOverride?: Record<number, PastedContent>
  resumesStaleQuotaWait?: boolean
  sendNow?: boolean
  queueSubmit?: boolean
  composerEnter?: unknown
  inputModeOverride?: PromptInputMode
}

export type SubmitPromptDeps = {
  isLoading: boolean
  isExternalLoading: boolean
  inputMode: PromptInputMode
  commands: Command[]
  mainLoopModel: string
  pastedContents: Record<number, PastedContent>
  ideSelection: IDESelection | undefined
  stashedPrompt: StashedPrompt | undefined
  abortController: AbortController | null
  getAbortController: () => AbortController | null
  getCurrentInput: () => string
  getMessages: () => Message[]
  getStreamMode: () => SpinnerMode
  getHasInterruptibleToolInProgress: () => boolean
  onResetTipPickedThisTurn: () => void
  queuedNowLowLatencyHost: QueuedNowLowLatency
  activeRemote: {
    isRemoteMode: boolean
    sendMessage: (
      content: RemoteMessageContent,
      options?: { uuid?: string },
    ) => Promise<unknown>
  }
  querySource: QuerySource
  readFileState: { current: FileStateCache }
  setAppState: SetAppState
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setInputValue: (value: string) => void
  setInputMode: (mode: PromptInputMode) => void
  setPastedContents: React.Dispatch<
    React.SetStateAction<Record<number, PastedContent>>
  >
  setIDESelection: React.Dispatch<
    React.SetStateAction<IDESelection | undefined>
  >
  setSubmitCount: React.Dispatch<React.SetStateAction<number>>
  setUserInputOnProcessing: (value: string | undefined) => void
  setStashedPrompt: React.Dispatch<
    React.SetStateAction<StashedPrompt | undefined>
  >
  setToolJSX: SetToolJSXFn
  setAbortControllerForQuery: (ac: AbortController | null) => void
  addNotification: (notif: Notification) => void
  getToolUseContext: HandlePromptSubmitParams['getToolUseContext']
  onQuery: HandlePromptSubmitParams['onQuery']
  onBeforeQuery: HandlePromptSubmitParams['onBeforeQuery']
  canUseTool: HandlePromptSubmitParams['canUseTool']
  awaitPendingHooks: () => Promise<void>
  repinScroll: (force?: boolean, reason?: string) => void
  routeToSelectedPipes: (input: string) => boolean
  onClearSubmitted: () => void
  resetTimingRefs: () => void
  consumeIdeSelection: (uuid: string | undefined) => void
  recordIdeSelectionConsumedBy: (
    uuid: string,
    selection: IDESelection | undefined,
  ) => void
  restoreIdeSelectionConsumedBy: (
    uuid: string,
    selection: IDESelection | undefined,
  ) => void
  restoreHandedBackPrompt: HandlePromptSubmitParams['restoreHandedBackPrompt']
  onResumeProactive?: () => void
}

export type ExecuteQueuedInputDeps = {
  commands: Command[]
  mainLoopModel: string
  ideSelection: IDESelection | undefined
  querySource: QuerySource
  getCurrentInput: () => string
  getMessages: () => Message[]
  setAppState: SetAppState
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setInputValue: (value: string) => void
  setPastedContents: React.Dispatch<
    React.SetStateAction<Record<number, PastedContent>>
  >
  setUserInputOnProcessing: (value: string | undefined) => void
  setToolJSX: SetToolJSXFn
  setAbortControllerForQuery: (ac: AbortController | null) => void
  addNotification: (notif: Notification) => void
  getToolUseContext: HandlePromptSubmitParams['getToolUseContext']
  onQuery: HandlePromptSubmitParams['onQuery']
  onBeforeQuery: HandlePromptSubmitParams['onBeforeQuery']
  canUseTool: HandlePromptSubmitParams['canUseTool']
  awaitPendingHooks: () => Promise<void>
  consumeIdeSelection: (uuid: string | undefined) => void
  recordIdeSelectionConsumedBy: (
    uuid: string,
    selection: IDESelection | undefined,
  ) => void
  restoreIdeSelectionConsumedBy: (
    uuid: string,
    selection: IDESelection | undefined,
  ) => void
  restoreHandedBackPrompt: HandlePromptSubmitParams['restoreHandedBackPrompt']
}

export type IncomingPromptDeps = {
  mainLoopModel: string
  setAbortControllerForQuery: (ac: AbortController | null) => void
  onQuery: HandlePromptSubmitParams['onQuery']
}

/**
 * REPL SubmitController owning prompt-submission orchestration, submission
 * locking, incoming prompt dispatch, and queued-command draining helpers.
 */
export class SubmitController {
  readonly #store: AppStateStore
  readonly #turnController: TurnController
  readonly #messageQueue: MessageQueueInstance
  readonly #queryGuard: QueryGuard
  #submitDepth = 0
  #isDraining = false
  #disposed = false

  constructor(options: SubmitControllerOptions) {
    this.#store = options.store
    this.#turnController = options.turnController
    this.#messageQueue = options.messageQueue
    this.#queryGuard = options.queryGuard
  }

  get isSubmitting(): boolean {
    return this.#submitDepth > 0
  }

  get isDraining(): boolean {
    return this.#isDraining
  }

  get isLoading(): boolean {
    return this.#turnController.isLoading
  }

  getQueuedCommands(): QueuedCommand[] {
    return this.#messageQueue.getCommands()
  }

  getMainThreadQueueLength(): number {
    return this.#messageQueue.getMainThreadLength()
  }

  hasPendingUserCommands(): boolean {
    return this.#messageQueue
      .getCommands()
      .some(cmd => cmd.mode === 'prompt' || cmd.mode === 'bash')
  }

  enqueue(command: QueuedCommand): void {
    if (this.#disposed) return
    this.#messageQueue.enqueue(command)
  }

  dequeue(filter?: (cmd: QueuedCommand) => boolean): QueuedCommand | undefined {
    if (this.#disposed) return undefined
    return this.#messageQueue.dequeue(filter)
  }

  dequeueAll(): QueuedCommand[] {
    if (this.#disposed) return []
    return this.#messageQueue.dequeueAll()
  }

  removeByFilter(predicate: (cmd: QueuedCommand) => boolean): QueuedCommand[] {
    if (this.#disposed) return []
    return this.#messageQueue.removeByFilter(predicate)
  }

  popAllEditable(
    currentInput: string,
    cursorOffset = 0,
  ): ReturnType<MessageQueueInstance['popAllEditable']> {
    if (this.#disposed) return undefined
    return this.#messageQueue.popAllEditable(currentInput, cursorOffset)
  }

  async submit(
    input: string,
    helpers: PromptInputHelpers,
    deps: SubmitPromptDeps,
    speculationAccept?: SpeculationAcceptArg,
    options?: SubmitPromptOptions,
  ): Promise<void> {
    if (this.#disposed) return
    this.#submitDepth++
    try {
      await this.#submitInternal(
        input,
        helpers,
        deps,
        speculationAccept,
        options,
      )
    } finally {
      this.#submitDepth--
    }
  }

  async #submitInternal(
    input: string,
    helpers: PromptInputHelpers,
    deps: SubmitPromptDeps,
    speculationAccept?: SpeculationAcceptArg,
    options?: SubmitPromptOptions,
  ): Promise<void> {
    const effectivePastedContents =
      options?.pastedContentsOverride != null
        ? { ...deps.pastedContents, ...options.pastedContentsOverride }
        : deps.pastedContents

    const interruptForSubmit = (): boolean => {
      const ac = deps.getAbortController()
      if (!ac || ac.signal.aborted) return false
      ac.abort('interrupt')
      return true
    }

    if (options?.sendNow && input.trim() === '') {
      trySendQueuedNowKey(() => this.#store.getState(), deps.setAppState, {
        mode: 'prompt',
        isTurnRunning: () => this.#queryGuard.isRunning,
        isTurnActive: () => this.#queryGuard.isActive,
        isDispatchingForModel: () =>
          this.#queryGuard.isActive && !this.#queryGuard.isRunning,
        abortSignal: deps.getAbortController(),
        lowLatency: deps.queuedNowLowLatencyHost,
        interruptForSubmit,
      })
      return
    }

    // Official 2.1.309 (#1131): key-bound slash commands run in 'prompt' mode
    // even when the composer is in 'bash' (!) mode.
    const effectiveInputMode: PromptInputMode =
      options?.inputModeOverride ??
      (options?.fromKeybinding && input.trim().startsWith('/')
        ? 'prompt'
        : deps.inputMode)

    deps.repinScroll(true, 'submit')

    if (feature('PROACTIVE') || feature('KAIROS')) {
      deps.onResumeProactive?.()
    }

    if (deps.routeToSelectedPipes(input)) {
      const userMessage = createUserMessage({ content: input })
      deps.setMessages(prev => [...prev, userMessage])

      if (!options?.fromKeybinding) {
        addToHistory({
          display: prependModeCharacterToInput(input, deps.inputMode),
          pastedContents: effectivePastedContents,
        })
      }
      deps.setInputValue('')
      helpers.setCursorOffset(0)
      helpers.clearBuffer()
      deps.setPastedContents({})
      deps.setInputMode('prompt')
      deps.setIDESelection(undefined)
      clearHeldClearedDraft()
      return
    }

    if (!speculationAccept && input.trim().startsWith('/')) {
      const handledImmediate = this.#tryExecuteImmediateCommand(
        input,
        helpers,
        deps,
        effectivePastedContents,
        options,
      )
      if (handledImmediate) {
        return
      }
    }

    if (deps.activeRemote.isRemoteMode && !input.trim()) {
      return
    }

    const isSlashCommand = !speculationAccept && input.trim().startsWith('/')
    const submitsNow = options?.queueSubmit
      ? false
      : options?.sendNow
        ? !(deps.isLoading || this.#queryGuard.isActive)
        : !deps.isLoading || speculationAccept || deps.activeRemote.isRemoteMode
    const historyEntry =
      options?.fromKeybinding || speculationAccept
        ? undefined
        : {
            display: prependModeCharacterToInput(input, effectiveInputMode),
            pastedContents: effectivePastedContents,
          }
    if (submitsNow && historyEntry) {
      addToHistory(historyEntry)
      if (effectiveInputMode === 'bash') {
        prependToShellHistoryCache(input.trim())
      }
    }

    if (deps.stashedPrompt !== undefined && !isSlashCommand && submitsNow) {
      this.#restoreStashedPrompt(deps.stashedPrompt, helpers, deps)
    } else if (submitsNow) {
      if (!options?.fromKeybinding) {
        deps.setInputValue('')
        helpers.setCursorOffset(0)
        clearHeldClearedDraft()
      }
      deps.setPastedContents({})
    }

    if (submitsNow) {
      if (effectiveInputMode === deps.inputMode) {
        deps.setInputMode('prompt')
      }
      deps.setIDESelection(undefined)
      deps.setSubmitCount(_ => _ + 1)
      helpers.clearBuffer()
      deps.onResetTipPickedThisTurn()

      if (
        !isSlashCommand &&
        effectiveInputMode === 'prompt' &&
        !speculationAccept &&
        !deps.activeRemote.isRemoteMode
      ) {
        deps.setUserInputOnProcessing(input)
        deps.resetTimingRefs()
      }

      if (feature('COMMIT_ATTRIBUTION')) {
        deps.setAppState(prev => ({
          ...prev,
          attribution: incrementPromptCount(prev.attribution, snapshot => {
            void recordAttributionSnapshot(snapshot).catch((error: unknown) => {
              logForDebugging(`Attribution: Failed to save snapshot: ${error}`)
            })
          }),
        }))
      }
    }

    if (speculationAccept) {
      const { queryRequired } = await handleSpeculationAccept(
        speculationAccept.state,
        speculationAccept.speculationSessionTimeSavedMs,
        speculationAccept.setAppState,
        input,
        {
          setMessages: deps.setMessages,
          readFileState: deps.readFileState,
          cwd: getOriginalCwd(),
        },
      )
      if (queryRequired) {
        const newAbortController = createAbortController()
        deps.setAbortControllerForQuery(newAbortController)
        void deps.onQuery([], newAbortController, true, [], deps.mainLoopModel)
      }
      return
    }

    if (
      deps.activeRemote.isRemoteMode &&
      !(
        isSlashCommand &&
        deps.commands.find(c => {
          const name = input.trim().slice(1).split(/\s/)[0]
          return (
            isCommandEnabled(c) &&
            (c.name === name ||
              c.aliases?.includes(name!) ||
              getCommandName(c) === name)
          )
        })?.type === 'local-jsx'
      )
    ) {
      await this.#handleRemoteSubmit(input, effectivePastedContents, deps)
      return
    }

    await deps.awaitPendingHooks()

    const abortBeforeSubmit = deps.getAbortController()
    await handlePromptSubmit({
      input,
      helpers,
      queryGuard: this.#queryGuard,
      isExternalLoading: deps.isExternalLoading,
      mode: effectiveInputMode,
      commands: deps.commands,
      onInputChange: deps.setInputValue,
      setPastedContents: deps.setPastedContents,
      setToolJSX: deps.setToolJSX,
      getToolUseContext: deps.getToolUseContext,
      messages: deps.getMessages(),
      mainLoopModel: deps.mainLoopModel,
      pastedContents: effectivePastedContents,
      ideSelection: deps.ideSelection,
      setUserInputOnProcessing: deps.setUserInputOnProcessing,
      setAbortController: deps.setAbortControllerForQuery,
      abortController: deps.abortController,
      onQuery: deps.onQuery,
      setAppState: deps.setAppState,
      querySource: deps.querySource,
      onBeforeQuery: deps.onBeforeQuery,
      canUseTool: deps.canUseTool,
      addNotification: deps.addNotification,
      setMessages: deps.setMessages,
      streamMode: deps.getStreamMode(),
      hasInterruptibleToolInProgress: deps.getHasInterruptibleToolInProgress(),
      historyEntry,
      onSubmitProceed: submitsNow
        ? undefined
        : () => deps.setInputMode('prompt'),
      queuePriority: options?.sendNow
        ? 'now'
        : options?.queueSubmit
          ? 'next'
          : undefined,
      forceQueue: Boolean(
        options?.queueSubmit ||
          (options?.sendNow && (deps.isLoading || this.#queryGuard.isActive)),
      ),
      resumesStaleQuotaWait: options?.resumesStaleQuotaWait,
      composerEnter: options?.composerEnter,
      takeIdeSelectionForQueue:
        effectiveInputMode !== 'bash' &&
        Boolean(deps.ideSelection?.text || deps.ideSelection?.filePath) &&
        (deps.ideSelection?.source !== 'diff' || !isSlashCommand)
          ? () => {
              if (!submitsNow) {
                deps.consumeIdeSelection(undefined)
              }
              return deps.ideSelection
            }
          : undefined,
      recordIdeSelectionConsumedBy: deps.recordIdeSelectionConsumedBy,
      onPromptHandedBack: deps.restoreIdeSelectionConsumedBy,
      getCurrentInput: deps.getCurrentInput,
      restoreHandedBackPrompt: deps.restoreHandedBackPrompt,
      awaitSessionStartHooks: deps.awaitPendingHooks,
    })

    const viewed = viewedAgentForInput({
      viewingAgentTaskId: this.#store.getState().viewingAgentTaskId,
      tasks: this.#store.getState().tasks,
    })
    const namedTaskId =
      viewed.type === 'named_agent' ? viewed.task.id : undefined
    const currentAc = deps.getAbortController()
    const sameAbort =
      abortBeforeSubmit !== null && currentAc === abortBeforeSubmit
    const leaderEmptyKey =
      effectiveInputMode === 'prompt' && viewed.type === 'leader' && sameAbort
    const namedAgentSendNow =
      effectiveInputMode === 'prompt' && namedTaskId !== undefined
    if (leaderEmptyKey) {
      trySendQueuedNowKey(() => this.#store.getState(), deps.setAppState, {
        mode: 'prompt',
        isTurnRunning: () => this.#queryGuard.isRunning,
        isTurnActive: () => this.#queryGuard.isActive,
        isDispatchingForModel: () =>
          this.#queryGuard.isActive && !this.#queryGuard.isRunning,
        abortSignal: currentAc,
        lowLatency: deps.queuedNowLowLatencyHost,
        interruptForSubmit,
      })
    } else if (namedAgentSendNow && isVelvetPandaEnabled()) {
      deps.queuedNowLowLatencyHost.sendQueuedNow(namedTaskId)
    }

    if (
      (isSlashCommand || deps.isLoading) &&
      deps.stashedPrompt !== undefined
    ) {
      this.#restoreStashedPrompt(deps.stashedPrompt, helpers, deps)
    }
  }

  #tryExecuteImmediateCommand(
    input: string,
    helpers: PromptInputHelpers,
    deps: SubmitPromptDeps,
    effectivePastedContents: Record<number, PastedContent>,
    options?: SubmitPromptOptions,
  ): boolean {
    const trimmedInput = expandPastedTextRefs(
      input,
      effectivePastedContents,
    ).trim()
    const spaceIndex = trimmedInput.indexOf(' ')
    const commandName =
      spaceIndex === -1
        ? trimmedInput.slice(1)
        : trimmedInput.slice(1, spaceIndex)
    const commandArgs =
      spaceIndex === -1 ? '' : trimmedInput.slice(spaceIndex + 1).trim()

    const matchingCommand = deps.commands.find(
      cmd =>
        isCommandEnabled(cmd) &&
        (cmd.name === commandName ||
          cmd.aliases?.includes(commandName) ||
          getCommandName(cmd) === commandName),
    )
    if (matchingCommand?.name === 'clear') {
      deps.onClearSubmitted()
    }

    const presentationMode: 'fullscreen' | 'inline' = isFullscreenEnvEnabled()
      ? 'fullscreen'
      : 'inline'
    const isImmediateNow = isCommandImmediate(
      matchingCommand,
      commandArgs,
      presentationMode,
    )
    const shouldTreatAsImmediate =
      this.#queryGuard.isActive && (isImmediateNow || options?.fromKeybinding)
    const isImmediatePluginLocal =
      this.#queryGuard.isActive &&
      isImmediateNow &&
      matchingCommand?.type === 'local' &&
      matchingCommand.loadedFrom === 'plugin' &&
      matchingCommand.immediate === true

    if (
      !matchingCommand ||
      !(
        (shouldTreatAsImmediate && matchingCommand.type === 'local-jsx') ||
        isImmediatePluginLocal
      )
    ) {
      return false
    }

    if (
      isEndedByModelCommandBlocked(
        matchingCommand,
        this.#store.getState().endedByModel,
      )
    ) {
      deps.addNotification({
        key: 'immediate-ended-by-model',
        kind: 'feedback',
        text: 'Claude ended this conversation. Start a new session (or /clear) to continue.',
        priority: 'immediate',
      })
      return true
    }

    if (input.trim() === deps.getCurrentInput().trim()) {
      deps.setInputValue('')
      helpers.setCursorOffset(0)
      helpers.clearBuffer()
      deps.setPastedContents({})
      clearHeldClearedDraft()
    }

    const pastedTextRefs = parseReferences(input).filter(
      r => effectivePastedContents[r.id]?.type === 'text',
    )
    const pastedTextCount = pastedTextRefs.length
    const pastedTextBytes = pastedTextRefs.reduce(
      (sum, r) => sum + (effectivePastedContents[r.id]?.content.length ?? 0),
      0,
    )
    logEvent('tengu_paste_text', { pastedTextCount, pastedTextBytes })
    logEvent('tengu_immediate_command_executed', {
      commandName:
        matchingCommand.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      fromKeybinding: options?.fromKeybinding ?? false,
    })

    const executeImmediateCommand = async (): Promise<void> => {
      let doneWasCalled = false
      const onDone = (
        result?: string,
        doneOptions?: {
          display?: CommandResultDisplay
          metaMessages?: string[]
          displayArgs?: string
        },
      ): void => {
        doneWasCalled = true
        deps.setToolJSX({
          jsx: null,
          shouldHidePromptInput: false,
          clearLocalJSX: true,
        })
        const newMessages: Message[] = []
        if (result && doneOptions?.display !== 'skip') {
          deps.addNotification({
            key: `immediate-${matchingCommand.name}`,
            text: result,
            priority: 'immediate',
          })
          if (!isFullscreenEnvEnabled()) {
            const breadcrumbArgs = doneOptions?.displayArgs ?? commandArgs
            const commandRun = {
              command: getCommandName(matchingCommand),
              args: breadcrumbArgs,
            }
            newMessages.push(
              createCommandInputMessage(
                formatCommandInputTags(
                  getCommandName(matchingCommand),
                  breadcrumbArgs,
                ),
                { commandRun },
              ),
              createCommandInputMessage(
                `<${LOCAL_COMMAND_STDOUT_TAG}>${escapeXml(result)}</${LOCAL_COMMAND_STDOUT_TAG}>`,
                { commandRun },
              ),
            )
          }
        }
        if (doneOptions?.metaMessages?.length) {
          newMessages.push(
            ...doneOptions.metaMessages.map(content =>
              createUserMessage({ content, isMeta: true }),
            ),
          )
        }
        if (newMessages.length) {
          deps.setMessages(prev => [...prev, ...newMessages])
        }
        if (deps.stashedPrompt !== undefined) {
          this.#restoreStashedPrompt(deps.stashedPrompt, helpers, deps)
        }
      }

      const context = deps.getToolUseContext(
        deps.getMessages(),
        [],
        createAbortController(),
        deps.mainLoopModel,
      )
      const canonicalName = getCommandName(matchingCommand)
      const stdoutColumns = process.stdout.columns
      const commandPresentation = {
        isFullscreen: presentationMode === 'fullscreen',
        columns:
          typeof stdoutColumns === 'number' && stdoutColumns > 0
            ? stdoutColumns
            : 80,
      }
      const commandOrigin = options?.fromKeybinding
        ? { kind: 'keybinding' }
        : { kind: 'composer' }
      const hasCmdRunHook =
        hasMatchingFunctionHook('command.run', { command: canonicalName }) ||
        (canonicalName !== matchingCommand.name &&
          hasMatchingFunctionHook('command.run', {
            command: matchingCommand.name,
          }))

      if (matchingCommand.type === 'local') {
        const mod = await matchingCommand.load()
        const callCtx = {
          ...context,
          isMidTurn: true,
          dispatchedAsImmediate: true,
          presentation: presentationMode,
          submissionOrigin: commandOrigin,
        }
        if (hasCmdRunHook) {
          let coreText: string | undefined
          let coreRan = false
          const chainOut = await runFunctionHookChain(
            'command.run',
            {
              command: canonicalName,
              args: commandArgs,
              origin: commandOrigin,
              presentation: commandPresentation,
            },
            async (event: Record<string, unknown>) => {
              const nextArgs =
                typeof event.args === 'string' ? event.args : commandArgs
              const res = await mod.call(nextArgs, callCtx)
              coreRan = true
              coreText = res.type === 'text' ? res.value : undefined
              return { ref: 1, text: coreText ?? '' }
            },
            undefined,
            undefined,
            { signal: context.abortController.signal },
          )
          const outRec =
            typeof chainOut === 'object' &&
            chainOut !== null &&
            !Array.isArray(chainOut)
              ? (chainOut as Record<string, unknown>)
              : {}
          const answeredText =
            typeof outRec.text === 'string' ? outRec.text : undefined
          const answeredContext = Array.isArray(outRec.context)
            ? outRec.context.filter(
                (item): item is string =>
                  typeof item === 'string' && item !== '',
              )
            : []
          const finalText = !coreRan ? answeredText : (answeredText ?? coreText)
          onDone(finalText || undefined, {
            ...(answeredContext.length > 0 && {
              metaMessages: answeredContext,
            }),
          })
          return
        }
        const res = await mod.call(commandArgs, callCtx)
        if (res.type === 'text') {
          onDone(res.value || undefined)
        } else {
          onDone(undefined, { display: 'skip' })
        }
        return
      }

      const mod = await matchingCommand.load()
      let jsx: React.ReactNode = null
      if (hasCmdRunHook) {
        let coreRan = false
        const chainOut = await runFunctionHookChain(
          'command.run',
          {
            command: canonicalName,
            args: commandArgs,
            origin: commandOrigin,
            presentation: commandPresentation,
          },
          async (event: Record<string, unknown>) => {
            const nextArgs =
              typeof event.args === 'string' ? event.args : commandArgs
            jsx = await mod.call(
              onDone,
              { ...context, dispatchedAsImmediate: true },
              nextArgs,
            )
            coreRan = true
            return { ref: 1, text: '' }
          },
          undefined,
          undefined,
          { signal: context.abortController.signal },
        )
        if (!coreRan) {
          const outRec =
            typeof chainOut === 'object' &&
            chainOut !== null &&
            !Array.isArray(chainOut)
              ? (chainOut as Record<string, unknown>)
              : {}
          const answeredText =
            typeof outRec.text === 'string' ? outRec.text : undefined
          const answeredContext = Array.isArray(outRec.context)
            ? outRec.context.filter(
                (item): item is string =>
                  typeof item === 'string' && item !== '',
              )
            : []
          onDone(
            answeredText,
            answeredContext.length > 0
              ? { metaMessages: answeredContext }
              : undefined,
          )
          return
        }
      } else {
        jsx = await mod.call(
          onDone,
          { ...context, dispatchedAsImmediate: true },
          commandArgs,
        )
      }

      if (jsx && !doneWasCalled) {
        deps.setToolJSX({
          jsx,
          shouldHidePromptInput: false,
          isLocalJSXCommand: true,
        })
      }
    }

    void executeImmediateCommand().catch(err => {
      // Prevent unhandled promise rejection on immediate local/JSX command failures
      logForDebugging(`Immediate command execution failed: ${err}`)
    })
    return true
  }

  async #handleRemoteSubmit(
    input: string,
    effectivePastedContents: Record<number, PastedContent>,
    deps: SubmitPromptDeps,
  ): Promise<void> {
    const pastedValues = Object.values(effectivePastedContents)
    const imageContents = pastedValues.filter(c => c.type === 'image')
    const imagePasteIds =
      imageContents.length > 0 ? imageContents.map(c => c.id) : undefined

    let messageContent: string | ContentBlockParam[] = input.trim()
    let remoteContent: RemoteMessageContent = input.trim()
    if (pastedValues.length > 0) {
      const contentBlocks: ContentBlockParam[] = []
      const remoteBlocks: Array<{ type: string; [key: string]: unknown }> = []

      const trimmedInput = input.trim()
      if (trimmedInput) {
        contentBlocks.push({ type: 'text', text: trimmedInput })
        remoteBlocks.push({ type: 'text', text: trimmedInput })
      }

      for (const pasted of pastedValues) {
        if (pasted.type === 'image') {
          const source = {
            type: 'base64' as const,
            media_type: (pasted.mediaType ?? 'image/png') as
              | 'image/jpeg'
              | 'image/png'
              | 'image/gif'
              | 'image/webp',
            data: pasted.content,
          }
          contentBlocks.push({ type: 'image', source })
          remoteBlocks.push({ type: 'image', source })
        } else {
          contentBlocks.push({ type: 'text', text: pasted.content })
          remoteBlocks.push({ type: 'text', text: pasted.content })
        }
      }

      messageContent = contentBlocks
      remoteContent = remoteBlocks
    }

    const userMessage = createUserMessage({
      content: messageContent,
      imagePasteIds,
    })
    deps.setMessages(prev => [...prev, userMessage])

    await deps.activeRemote.sendMessage(remoteContent, {
      uuid: userMessage.uuid,
    })
  }

  #restoreStashedPrompt(
    stashedPrompt: StashedPrompt,
    helpers: PromptInputHelpers,
    deps: SubmitPromptDeps,
  ): void {
    deps.setInputValue(stashedPrompt.text)
    helpers.setCursorOffset(stashedPrompt.cursorOffset)
    deps.setPastedContents(stashedPrompt.pastedContents)
    deps.setStashedPrompt(undefined)
    deps.addNotification({
      key: 'stash-restored',
      kind: 'feedback',
      text: 'Draft restored',
      priority: 'high',
      timeoutMs: 5000,
    })
  }

  async executeQueuedInput(
    queuedCommands: QueuedCommand[],
    deps: ExecuteQueuedInputDeps,
  ): Promise<void> {
    if (this.#disposed || this.#isDraining) return
    this.#isDraining = true
    try {
      const firstEditable = queuedCommands.find(isQueuedCommandEditable)
      const consumeLive =
        firstEditable !== undefined &&
        firstEditable.ideSelection === undefined &&
        (deps.ideSelection?.source !== 'diff' ||
          (firstEditable.mode !== 'bash' &&
            !(
              typeof firstEditable.value === 'string' &&
              firstEditable.value.trim().startsWith('/')
            )))
      if (consumeLive) {
        deps.consumeIdeSelection(firstEditable.uuid)
      } else if (firstEditable?.ideSelection && firstEditable.uuid) {
        deps.recordIdeSelectionConsumedBy(
          firstEditable.uuid,
          firstEditable.ideSelection,
        )
      }
      await handlePromptSubmit({
        helpers: {
          setCursorOffset: () => {},
          clearBuffer: () => {},
          resetHistory: () => {},
        },
        queryGuard: this.#queryGuard,
        commands: deps.commands,
        setPastedContents: deps.setPastedContents,
        setToolJSX: deps.setToolJSX,
        getToolUseContext: deps.getToolUseContext,
        messages: deps.getMessages(),
        mainLoopModel: deps.mainLoopModel,
        ideSelection: consumeLive ? deps.ideSelection : undefined,
        setUserInputOnProcessing: deps.setUserInputOnProcessing,
        setAbortController: deps.setAbortControllerForQuery,
        onQuery: deps.onQuery,
        setAppState: deps.setAppState,
        querySource: deps.querySource,
        onBeforeQuery: deps.onBeforeQuery,
        canUseTool: deps.canUseTool,
        addNotification: deps.addNotification,
        setMessages: deps.setMessages,
        queuedCommands,
        onPromptHandedBack: deps.restoreIdeSelectionConsumedBy,
        onInputChange: deps.setInputValue,
        getCurrentInput: deps.getCurrentInput,
        restoreHandedBackPrompt: deps.restoreHandedBackPrompt,
        awaitSessionStartHooks: deps.awaitPendingHooks,
      })
    } finally {
      this.#isDraining = false
    }
  }

  handleIncomingPrompt(
    input: string | QueuedCommand,
    deps: IncomingPromptDeps,
    options?: { isMeta?: boolean },
  ): boolean {
    if (this.#disposed || this.#queryGuard.isActive || this.#isDraining) {
      return false
    }

    if (this.hasPendingUserCommands()) {
      return false
    }

    const queuedCommand =
      typeof input === 'string'
        ? ({
            value: input,
            mode: 'prompt',
            isMeta: options?.isMeta ? true : undefined,
          } satisfies QueuedCommand)
        : input

    void (async () => {
      const claim = await claimConsumableQueuedAutonomyCommands([queuedCommand])
      if (this.#disposed) return
      const command = claim.attachmentCommands[0]
      if (!command) return

      const newAbortController = createAbortController()
      deps.setAbortControllerForQuery(newAbortController)

      const userMessage = createUserMessage({
        content: command.value,
        isMeta: command.isMeta ? true : undefined,
        origin: command.origin,
      })
      if (command.origin) {
        applyTurnStartOriginFraming(
          userMessage,
          command.origin as { kind?: string; from?: string },
        )
      }

      let executed = false
      try {
        executed =
          (await deps.onQuery(
            [userMessage],
            newAbortController,
            true,
            [],
            deps.mainLoopModel,
          )) !== false
      } catch (error: unknown) {
        try {
          await finalizeAutonomyCommandsForTurn({
            commands: claim.claimedCommands,
            outcome: { type: 'failed', error },
            currentDir: getCwd(),
            priority: 'later',
          })
        } catch (finalizeError: unknown) {
          logError(toError(finalizeError))
        }
        logError(toError(error))
        return
      }

      if (!executed) {
        return
      }
      try {
        const nextCommands = await finalizeAutonomyCommandsForTurn({
          commands: claim.claimedCommands,
          outcome: { type: 'completed' },
          currentDir: getCwd(),
          priority: 'later',
        })
        for (const nextCommand of nextCommands) {
          this.#messageQueue.enqueue(nextCommand)
        }
      } catch (finalizeError: unknown) {
        logError(toError(finalizeError))
      }
    })().catch((error: unknown) => {
      logError(toError(error))
    })
    return true
  }

  dispose(): void {
    this.#disposed = true
  }
}
