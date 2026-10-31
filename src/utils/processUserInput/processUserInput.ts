import type {
  Base64ImageSource,
  ContentBlockParam,
  ImageBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import type { QuerySource } from 'src/constants/querySource.js'
import { logEvent } from 'src/services/analytics/index.js'
import { getContentText } from 'src/utils/messages.js'
import {
  findCommand,
  getBridgeCommandSafety,
  getCommandName,
  type LocalJSXCommandContext,
} from '../../commands.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { IDESelection } from '../../hooks/useIdeSelection.js'
import type { SetToolJSXFn, ToolUseContext } from '../../Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  ProgressMessage,
  SystemMessage,
  UserMessage,
} from '../../types/message.js'
import type { PermissionMode } from '../../types/permissions.js'
import {
  isValidImagePaste,
  type QueuedCommand,
  type PromptInputMode,
} from '../../types/textInputTypes.js'
import {
  type AgentMentionAttachment,
  createAttachmentMessage,
  getAttachmentMessages,
} from '../attachments.js'
import type { PastedContent } from '../config.js'
import type { EffortValue } from '../effort.js'
import { toArray } from '../generators.js'
import {
  createImageMetadataText,
  maybeResizeAndDownsampleImageBlock,
} from '../imageResizer.js'
import { storeImages } from '../imageStore.js'
import {
  createCommandInputMessage,
  createSystemMessage,
  createUserMessage,
} from '../messages.js'
import { logForDebugging } from '../debug.js'
import { queryCheckpoint } from '../queryProfiler.js'
import { parseSlashCommand } from '../slashCommandParsing.js'
import {
  hasUltraplanKeyword,
  isUltraplanProductEnabled,
  replaceUltraplanKeyword,
} from '../ultraplanKeyword.js'
import { processTextPrompt } from './processTextPrompt.js'
import {
  originIsTypedOrUnset,
  resolvePromptSource,
  resolveTurnOrigin,
  snapshotThreadState,
} from './artStamps.js'
import { isComposerEnter } from './composerEnter.js'
import {
  promptScreenNeedsReplay,
  promptScreenPluginsChanged,
  runPromptSubmit,
  runUserPromptSubmit,
  snapshotPromptScreen,
  wrapQueuedSettle,
  type PromptSubmittedStamp,
} from './promptSubmit.js'
import {
  isAheadOfSessionStart,
  registerPromptSubmitEntry,
  type PromptSubmitEntries,
} from './promptSubmitEntries.js'
import { takePromptSubmitWait } from './promptSubmitWaits.js'
export type ProcessUserInputContext = ToolUseContext &
  LocalJSXCommandContext & {
    /** densable yn slash context `submissionVerifiedSlackHumanTurn`. */
    submissionVerifiedSlackHumanTurn?: boolean
    /** densable yn slash context `submittedOnLocalStdin`. */
    submittedOnLocalStdin?: boolean
    /** densable yn slash context `submittedBySessionChannelPerson`. */
    submittedBySessionChannelPerson?: boolean
    /** densable yn slash context `submittedFromComposer`. */
    submittedFromComposer?: boolean
  }

export type ProcessUserInputBaseResult = {
  messages: (
    | UserMessage
    | AssistantMessage
    | AttachmentMessage
    | SystemMessage
    | ProgressMessage
  )[]
  shouldQuery: boolean
  allowedTools?: string[]
  /**
   * densable 2.1.229 — slash/skill disallowedTools applied to
   * alwaysDenyRules.command for the turn (commit-push-pr dangerous flags).
   */
  disallowedTools?: string[]
  model?: string
  effort?: EffortValue
  // Output text for non-interactive mode (e.g., forked commands)
  // When set, this is used as the result in -p mode instead of empty string
  resultText?: string
  // When set, prefills or submits the next input after command completes
  // Used by /discover to chain into the selected feature's command
  nextInput?: string
  submitNextInput?: boolean
  // When true, the command started detached work that will finalize its
  // autonomy run after the background work completes.
  deferAutonomyCompletion?: boolean
  /**
   * densable ambientAttachmentsOwed — skipAttachments "mentions" deferred
   * Ys getAttachmentMessages(null, ...) on early-return.
   */
  ambientAttachmentsOwed?: boolean
}

/**
 * densable Byw — slash names that escape endedByModel (aQr).
 * Gold: `new Set(["clear","resume","help","exit","feedback"])`.
 */
export const ENDED_BY_MODEL_ALLOWED_COMMANDS = new Set([
  'clear',
  'resume',
  'help',
  'exit',
  'feedback',
  'bug',
])

const ENDED_BY_MODEL_ALIAS_TO_NAME: Record<string, string> = {
  reset: 'clear',
  new: 'clear',
  quit: 'exit',
  continue: 'resume',
  bug: 'feedback',
}

type EndedByModelCommand = {
  name: string
  type?: string
  aliases?: string[]
}

/**
 * densable aQr(cmd, endedByModel) — true ⇒ block (toast / refuse).
 * `if(!t)return!1; return!(e&&e.type!=="prompt"&&Byw.has(e.name))`
 */
export function isEndedByModelCommandBlocked(
  command: EndedByModelCommand | null | undefined,
  endedByModel: boolean,
): boolean {
  if (!endedByModel) return false
  return !(
    command != null &&
    command.type !== 'prompt' &&
    ENDED_BY_MODEL_ALLOWED_COMMANDS.has(command.name)
  )
}

/**
 * Typed-input escape for endedByModel. Resolves first token via command
 * name/alias when a list is given; otherwise Byw names + known aliases.
 */
export function isEndedByModelClearEscape(
  input: string | null | undefined,
  commands?: readonly EndedByModelCommand[],
): boolean {
  if (typeof input !== 'string') return false
  const t = input.trim()
  if (!t.startsWith('/')) return false
  const first = t.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  if (!first) return false
  if (commands && commands.length > 0) {
    const cmd = commands.find(
      c => c.name === first || c.aliases?.includes(first),
    )
    return !isEndedByModelCommandBlocked(cmd, true)
  }
  const canonical = ENDED_BY_MODEL_ALIAS_TO_NAME[first] ?? first
  return ENDED_BY_MODEL_ALLOWED_COMMANDS.has(canonical)
}

/** densable `Ys` @195539942 — splice ambient attachments at index 1. */
async function deliverOwedAmbientAttachments(
  result: ProcessUserInputBaseResult,
  context: ProcessUserInputContext,
  history: Message[] | undefined,
  querySource: QuerySource | undefined,
): Promise<void> {
  const owed = result.ambientAttachmentsOwed === true
  delete result.ambientAttachmentsOwed
  if (!owed) return
  const ambient = await toArray(
    getAttachmentMessages(null, context, null, [], history, querySource),
  )
  result.messages.splice(1, 0, ...ambient)
}

export async function processUserInput({
  input,
  preExpansionInput,
  mode,
  setToolJSX,
  context,
  pastedContents,
  ideSelection,
  messages,
  setUserInputOnProcessing,
  uuid,
  isAlreadyProcessing,
  querySource,
  canUseTool,
  skipSlashCommands,
  bridgeOrigin,
  modelScheduledOrigin,
  wakeupSource,
  isMeta,
  skipAttachments,
  skipSubmissionHooks,
  shouldQuery: shouldQueryInput,
  queryHeldForNextTurn,
  autonomy,
  origin,
  suppressWorkflowKeyword,
  localStdinOrigin,
  sessionChannelPersonTyped,
  hostInitiator,
  artifactCommentTurn,
  verifiedSlackHumanTurn,
  inlinedImagePaths,
  stampThreadState,
  pollEventDelivery,
  pollEventProvenance,
  pollEventDeclared,
  composerEnter,
  aheadOfSessionStart,
  entries,
  wait,
  promptSubmitted,
}: {
  input: string | Array<ContentBlockParam>
  /**
   * Input before [Pasted text #N] expansion. Used for ultracode/ultrareview
   * keyword detection so pasted content containing the word cannot trigger.
   * Falls back to the string `input` when unset.
   */
  preExpansionInput?: string
  mode: PromptInputMode
  setToolJSX: SetToolJSXFn
  context: ProcessUserInputContext
  pastedContents?: Record<number, PastedContent>
  ideSelection?: IDESelection
  messages?: Message[]
  setUserInputOnProcessing?: (prompt?: string) => void
  uuid?: string
  isAlreadyProcessing?: boolean
  querySource?: QuerySource
  canUseTool?: CanUseToolFn
  /**
   * When true, input starting with `/` is treated as plain text.
   * Used for remotely-received messages (bridge/CCR) that should not
   * trigger local slash commands or skills.
   */
  skipSlashCommands?: boolean
  /**
   * When true, slash commands matching isBridgeSafeCommand() execute even
   * though skipSlashCommands is set. See QueuedCommand.bridgeOrigin.
   */
  bridgeOrigin?: boolean
  /**
   * densable modelScheduledOrigin — cron/loop fire. Re-opens slash for
   * model-invocable commands when skipSlashCommands is also set.
   */
  modelScheduledOrigin?: boolean
  /**
   * densable wakeupSource — loop_wakeup | schedule_wakeup | c2o-derived.
   * Threaded into processUserInputBase as intentional dead param (densable Qjt
   * UserPromptSubmit source still `...!1`). Slash re-open does not read this.
   */
  wakeupSource?: string
  /**
   * When true, the resulting UserMessage gets `isMeta: true` (user-hidden,
   * model-visible). Propagated from `QueuedCommand.isMeta` for queued
   * system-generated prompts.
   */
  isMeta?: boolean
  skipAttachments?: boolean | 'all' | 'mentions'
  /** densable skipSubmissionHooks — attachment-only poll empty prompt. */
  skipSubmissionHooks?: boolean
  /**
   * densable 2.1.289 print task-notification coalesce — force no model query.
   * Gold Fe: with isMeta and queryHeldForNextTurn!==true, also skip attachments.
   */
  shouldQuery?: boolean
  queryHeldForNextTurn?: boolean
  autonomy?: QueuedCommand['autonomy']
  /**
   * densable Dfr origin — Wzn(origin) gates ultracode keyword (p2y).
   * undefined is treated as non-human for keyword (must be kind==="human").
   */
  origin?: QueuedCommand['origin']
  /** densable suppressWorkflowKeyword — skip p2y for this turn. */
  suppressWorkflowKeyword?: boolean
  localStdinOrigin?: boolean
  sessionChannelPersonTyped?: boolean
  hostInitiator?: unknown
  artifactCommentTurn?: unknown
  verifiedSlackHumanTurn?: boolean
  inlinedImagePaths?: string[]
  stampThreadState?: boolean
  pollEventDelivery?: boolean
  pollEventProvenance?: unknown[]
  pollEventDeclared?: unknown
  /** densable Art `composerEnter` — REPL Enter only; print/QE omit. */
  composerEnter?: unknown
  /**
   * densable Art `aheadOfSessionStart` — QE sets when orphanedPermission
   * is present. Unn skips `jq.get()` for this start input.
   */
  aheadOfSessionStart?: boolean
  /** densable Art `entries` — QE `Cpr` latch. */
  entries?: PromptSubmitEntries
  /** densable Art `wait` → Unn `shouldWait`. */
  wait?: boolean
  /** densable Art `promptSubmitted` — REPL Enter screening reuse. */
  promptSubmitted?: PromptSubmittedStamp
}): Promise<ProcessUserInputBaseResult> {
  // densable Art `using V=Ios(hss(k))` — wrap the whole turn so a skip-Unn
  // path still dispose-drops the plugin waiter.
  using queuedSettle = wrapQueuedSettle(takePromptSubmitWait(uuid))
  const inputString = typeof input === 'string' ? input : null
  // Immediately show the user input prompt while we are still processing the input.
  // Skip for isMeta (system-generated prompts like scheduled tasks) and slash
  // commands (they produce their own system message echo via createCommandInputMessage).
  const isSlashInput = inputString?.startsWith('/') && !skipSlashCommands
  if (mode === 'prompt' && inputString !== null && !isMeta && !isSlashInput) {
    setUserInputOnProcessing?.(inputString)
  }

  queryCheckpoint('query_process_user_input_base_start')

  const appState = context.getAppState()

  // densable aQr / Byw: after EndConversation, only clear|resume|help|exit|
  // feedback (plus their aliases) reach processSlashCommand.
  if (
    appState.endedByModel &&
    !isEndedByModelClearEscape(inputString, context.options.commands)
  ) {
    const { END_CONVERSATION_SESSION_ENDED_MESSAGE } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@claude-code/builtin-tools/tools/EndConversationTool/prompt.js') as typeof import('@claude-code/builtin-tools/tools/EndConversationTool/prompt.js')
    return {
      messages: [
        createSystemMessage(END_CONVERSATION_SESSION_ENDED_MESSAGE, 'warning'),
      ],
      shouldQuery: false,
      resultText: END_CONVERSATION_SESSION_ENDED_MESSAGE,
    }
  }

  // densable Fe: shouldQuery===false && isMeta && queryHeldForNextTurn!==true
  // → treat as skipAttachments (no turn-level attachment assembly).
  const skipFromCaller: 'all' | 'mentions' | undefined =
    skipAttachments === true || skipAttachments === 'all'
      ? 'all'
      : skipAttachments === 'mentions'
        ? 'mentions'
        : undefined
  const skipFromFe =
    shouldQueryInput === false &&
    isMeta === true &&
    queryHeldForNextTurn !== true
      ? ('all' as const)
      : undefined
  const effectiveSkipAttachments = skipFromFe ?? skipFromCaller

  const result = await processUserInputBase(
    input,
    mode,
    setToolJSX,
    context,
    pastedContents,
    ideSelection,
    messages,
    uuid,
    isAlreadyProcessing,
    querySource,
    canUseTool,
    appState.toolPermissionContext.mode,
    skipSlashCommands,
    bridgeOrigin,
    modelScheduledOrigin,
    isMeta,
    effectiveSkipAttachments,
    preExpansionInput,
    autonomy,
    origin,
    suppressWorkflowKeyword,
    wakeupSource,
    inlinedImagePaths,
    verifiedSlackHumanTurn,
    localStdinOrigin,
    sessionChannelPersonTyped,
    stampThreadState,
    hostInitiator,
    artifactCommentTurn,
    shouldQueryInput,
    composerEnter,
  )
  queryCheckpoint('query_process_user_input_base_end')

  // densable Art after yn: Fe = e9e unless skip-query meta (gold H===!1 && ue && be!==!0).
  const promptSource =
    shouldQueryInput === false &&
    isMeta === true &&
    queryHeldForNextTurn !== true
      ? undefined
      : resolvePromptSource({
          isNonInteractive: context.options.isNonInteractiveSession,
          isMeta,
          callerSource: originIsTypedOrUnset(origin) ? undefined : 'system',
        })
  try {
    // gold: Fe!==void 0 && shouldQuery && (H!==!1 || be===!0). R9e last-user
    // index KEEP (needs IX/Rvt/zye host).
    if (
      promptSource !== undefined &&
      result.shouldQuery &&
      (shouldQueryInput !== false || queryHeldForNextTurn === true)
    ) {
      const firstUser = result.messages.find(message => message.type === 'user')
      if (
        firstUser?.type === 'user' &&
        (firstUser as { turnOrigin?: string }).turnOrigin === undefined
      ) {
        ;(firstUser as { turnOrigin?: string }).turnOrigin = resolveTurnOrigin({
          origin,
          isMeta,
          wakeupSource,
          promptSource,
          hostInitiator,
        })
      }
    }
  } catch {
    // gold Art wraps KOo in try/catch
  }

  // densable Art poll_events value_dispatch marker (not model-facing).
  if (pollEventDelivery === true && result.messages.length > 0) {
    result.messages.push(
      createAttachmentMessage({
        type: 'poll_events',
        deliveredVia: 'value_dispatch',
        envelopes: [],
        kinds: [],
        remainingWakeCount: 0,
        ...(pollEventProvenance !== undefined && {
          provenance: pollEventProvenance,
        }),
        ...(pollEventDeclared !== undefined && { declared: pollEventDeclared }),
      }),
    )
  }

  // densable: input shouldQuery===false forces result.shouldQuery=false
  // (override processTextPrompt default true for plain notifications).
  if (shouldQueryInput === false) {
    result.shouldQuery = false
    // Local analog of gold uun transcript-only stamp — use existing field.
    if (queryHeldForNextTurn !== true) {
      for (const msg of result.messages) {
        if (msg.type === 'user' && msg.isMeta) {
          ;(
            msg as { isVisibleInTranscriptOnly?: true }
          ).isVisibleInTranscriptOnly = true
        }
      }
    }
  }

  if (!result.shouldQuery) {
    await deliverOwedAmbientAttachments(result, context, messages, querySource)
    return result
  }

  if (skipSubmissionHooks) {
    await deliverOwedAmbientAttachments(result, context, messages, querySource)
    return result
  }

  // densable Art Unn / yUn / Pos / $nn. skip jq.get() when ahead of
  // session start (orphanedPermission or uuid in pG).
  queryCheckpoint('query_hooks_start')
  const inputMessage = getContentText(input) || ''
  const isStartInput =
    aheadOfSessionStart === true || isAheadOfSessionStart(uuid)
  const screenNow = snapshotPromptScreen(context)
  if (
    promptSubmitted === undefined ||
    promptScreenPluginsChanged(promptSubmitted.under, screenNow)
  ) {
    const outcome = await runPromptSubmit({
      text: inputMessage,
      originalInput: input,
      result,
      context,
      isStartInput,
      shouldWait: wait === true,
      promptSource,
      wakeupSource,
      entries,
      queued: queuedSettle,
      enter: entries
        ? () => registerPromptSubmitEntry(entries, result.messages)
        : undefined,
    })
    if (outcome.kind === 'return') {
      queryCheckpoint('query_hooks_end')
      return outcome.result
    }
  } else if (promptScreenNeedsReplay(promptSubmitted.under, screenNow)) {
    const replay = await runUserPromptSubmit(
      promptSubmitted.text,
      result,
      context,
      input,
    )
    if (replay.kind === 'blocking') {
      queryCheckpoint('query_hooks_end')
      return {
        messages: replay.messages,
        shouldQuery: false,
        allowedTools: replay.allowedTools,
      }
    }
    if (replay.kind === 'stop') {
      queryCheckpoint('query_hooks_end')
      return result
    }
    if (entries) {
      void registerPromptSubmitEntry(entries, result.messages)
    }
  } else if (promptSubmitted.stopped !== undefined) {
    result.messages.push(...(promptSubmitted.messages ?? []))
    result.shouldQuery = false
    result.resultText = promptSubmitted.stopped
    queryCheckpoint('query_hooks_end')
    return result
  } else if (entries) {
    void registerPromptSubmitEntry(entries, result.messages)
  }
  queryCheckpoint('query_hooks_end')

  // densable 2.1.248 #40 wl — autoload workflow-authoring on keyword / ultracode.
  if (result.shouldQuery) {
    try {
      const { getWorkflowAuthoringAutoloadMessages } = await import(
        '../../skills/bundled/workflowAuthoring.js'
      )
      result.messages.push(
        ...(await getWorkflowAuthoringAutoloadMessages(
          result.messages,
          messages,
          context.options.tools,
        )),
      )
    } catch (err) {
      logForDebugging(
        `workflow-authoring autoload failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // Happy path: onQuery will clear userInputOnProcessing via startTransition
  // so it resolves in the same frame as deferredMessages (no flicker gap).
  // Error paths are handled by handlePromptSubmit's finally block.
  return result
}

async function processUserInputBase(
  input: string | Array<ContentBlockParam>,
  mode: PromptInputMode,
  setToolJSX: SetToolJSXFn,
  context: ProcessUserInputContext,
  pastedContents?: Record<number, PastedContent>,
  ideSelection?: IDESelection,
  messages?: Message[],
  uuid?: string,
  isAlreadyProcessing?: boolean,
  querySource?: QuerySource,
  canUseTool?: CanUseToolFn,
  permissionMode?: PermissionMode,
  skipSlashCommands?: boolean,
  bridgeOrigin?: boolean,
  modelScheduledOrigin?: boolean,
  isMeta?: boolean,
  skipAttachments?: boolean | 'all' | 'mentions',
  preExpansionInput?: string,
  autonomy?: QueuedCommand['autonomy'],
  origin?: QueuedCommand['origin'],
  suppressWorkflowKeyword?: boolean,
  /**
   * densable 2.1.221: fire stamps wakeupSource through the stack. Qjt
   * UserPromptSubmit still does not expose `source` (`...!1`); ELt/KOo consume
   * this for telemetry and turnOrigin.
   */
  wakeupSource?: string,
  inlinedImagePaths?: string[],
  verifiedSlackHumanTurn?: boolean,
  localStdinOrigin?: boolean,
  sessionChannelPersonTyped?: boolean,
  stampThreadState?: boolean,
  hostInitiator?: unknown,
  artifactCommentTurn?: unknown,
  shouldQuery?: boolean,
  composerEnter?: unknown,
): Promise<ProcessUserInputBaseResult> {
  let inputString: string | null = null
  let precedingInputBlocks: ContentBlockParam[] = []

  // Collect image metadata texts for isMeta message
  const imageMetadataTexts: string[] = []

  // densable 2.1.229 #19 (Z4v / YAm) — non-interactive whitespace-only prompt
  // must not hit the API (stream-json 400). densable:
  //   t==="prompt" && typeof e==="string" && e!=="" && e.trim()===""
  //   && isNonInteractiveSession && !isMeta && w!==!1
  // densable YAm string 1:1.
  if (
    mode === 'prompt' &&
    typeof input === 'string' &&
    input !== '' &&
    input.trim() === '' &&
    context.options.isNonInteractiveSession &&
    !isMeta &&
    shouldQuery !== false
  ) {
    const BLANK_PROMPT_MESSAGE =
      'Blank prompt — the message was only whitespace, so nothing was sent to the model.'
    logEvent('prompt_submit_empty', {})
    return {
      messages: [createSystemMessage(BLANK_PROMPT_MESSAGE, 'warning')],
      shouldQuery: false,
      resultText: BLANK_PROMPT_MESSAGE,
    }
  }

  // Normalized view of `input` with image blocks resized. For string input
  // this is just `input`; for array input it's the processed blocks. We pass
  // this (not raw `input`) to processTextPrompt so resized/normalized image
  // blocks actually reach the API — otherwise the resize work above is
  // discarded for the regular prompt path. Also normalizes bridge inputs
  // where iOS may send `mediaType` instead of `media_type` (mobile-apps#5825).
  let normalizedInput: string | ContentBlockParam[] = input

  if (typeof input === 'string') {
    inputString = input
  } else if (input.length > 0) {
    queryCheckpoint('query_image_processing_start')
    const processedBlocks: ContentBlockParam[] = []
    for (const block of input) {
      if (block.type === 'image') {
        const resized = await maybeResizeAndDownsampleImageBlock(block)
        // Collect image metadata for isMeta message
        if (resized.dimensions) {
          const metadataText = createImageMetadataText(resized.dimensions)
          if (metadataText) {
            imageMetadataTexts.push(metadataText)
          }
        }
        processedBlocks.push(resized.block)
      } else {
        processedBlocks.push(block)
      }
    }
    normalizedInput = processedBlocks
    queryCheckpoint('query_image_processing_end')
    // Extract the input string from the last content block if it is text,
    // and keep track of the preceding content blocks
    const lastBlock = processedBlocks[processedBlocks.length - 1]
    if (lastBlock?.type === 'text') {
      inputString = lastBlock.text
      precedingInputBlocks = processedBlocks.slice(0, -1)
    } else {
      precedingInputBlocks = processedBlocks
    }
  }

  if (inputString === null && mode !== 'prompt') {
    throw new Error(`Mode: ${mode} requires a string input.`)
  }

  // Extract and convert image content to content blocks early
  // Keep track of IDs in order for message storage
  const imageContents = pastedContents
    ? Object.values(pastedContents).filter(isValidImagePaste)
    : []

  // Store images to disk so Claude can reference the path in context
  // (for manipulation with CLI tools, uploading to PRs, etc.)
  // densable j9d: write disk + stamp AppState so UserImageMessage is clickable
  const storedImagePaths = pastedContents
    ? await storeImages(pastedContents, context.setAppState)
    : new Map<number, string>()

  // Resize pasted images to ensure they fit within API limits (parallel processing)
  queryCheckpoint('query_pasted_image_processing_start')
  const imageProcessingResults = await Promise.all(
    imageContents.map(async pastedImage => {
      const imageBlock: ImageBlockParam = {
        type: 'image',
        source: {
          type: 'base64',
          media_type: (pastedImage.mediaType ||
            'image/png') as Base64ImageSource['media_type'],
          data: pastedImage.content,
        },
      }
      logEvent('tengu_pasted_image_resize_attempt', {
        original_size_bytes: pastedImage.content.length,
      })
      // densable I3: ImageResizeError degrades to a text block (not throw)
      const resized = await maybeResizeAndDownsampleImageBlock(imageBlock)
      return {
        id: pastedImage.id,
        resized,
        originalDimensions: pastedImage.dimensions,
        sourcePath:
          pastedImage.sourcePath ?? storedImagePaths.get(pastedImage.id),
      }
    }),
  )
  // Collect results preserving order. densable: only real image blocks keep
  // paste ids / dimension metadata; degraded text placeholders still go in
  // content so the user message is not empty after a failed resize.
  const imageContentBlocks: ContentBlockParam[] = []
  const imagePasteIds: number[] = []
  for (const {
    id,
    resized,
    originalDimensions,
    sourcePath,
  } of imageProcessingResults) {
    imageContentBlocks.push(resized.block)
    if (resized.block.type !== 'image') {
      continue
    }
    imagePasteIds.push(id)
    // Collect image metadata for isMeta message (prefer resized dimensions)
    if (resized.dimensions) {
      const metadataText = createImageMetadataText(
        resized.dimensions,
        sourcePath,
      )
      if (metadataText) {
        imageMetadataTexts.push(metadataText)
      }
    } else if (originalDimensions) {
      // Fall back to original dimensions if resize didn't provide them
      const metadataText = createImageMetadataText(
        originalDimensions,
        sourcePath,
      )
      if (metadataText) {
        imageMetadataTexts.push(metadataText)
      }
    } else if (sourcePath) {
      // If we have a source path but no dimensions, still add source info
      imageMetadataTexts.push(`[Image source: ${sourcePath}]`)
    }
  }
  queryCheckpoint('query_pasted_image_processing_end')

  // Bridge-safe slash command override: mobile/web clients set bridgeOrigin
  // with skipSlashCommands still true (defense-in-depth against exit words and
  // immediate-command fast paths). Resolve the command here — if it passes
  // isBridgeSafeCommand, clear the skip so the gate below opens. If it's a
  // known-but-unsafe command (local-jsx UI or terminal-only), short-circuit
  // with a helpful message rather than letting the model see raw "/config".
  let effectiveSkipSlash = skipSlashCommands
  if (bridgeOrigin && inputString !== null && inputString.startsWith('/')) {
    const parsed = parseSlashCommand(inputString)
    const cmd = parsed
      ? findCommand(parsed.commandName, context.options.commands)
      : undefined
    if (cmd) {
      const safety = getBridgeCommandSafety(cmd, parsed?.args ?? '')
      if (safety.ok) {
        effectiveSkipSlash = false
      } else {
        const msg =
          safety.reason ??
          `/${getCommandName(cmd)} isn't available over Remote Control.`
        return {
          messages: [
            createUserMessage({ content: inputString, uuid }),
            createCommandInputMessage(
              `<local-command-stdout>${msg}</local-command-stdout>`,
            ),
          ],
          shouldQuery: false,
          resultText: msg,
        }
      }
    }
    // Unknown /foo or unparseable — fall through to plain text, same as
    // pre-#19134. A mobile user typing "/shrug" shouldn't see "Unknown skill".
  }

  // densable 2.1.221: modelScheduledOrigin + skipSlashCommands + leading `/`
  // re-opens slash when the resolved command is model-invocable
  // (`!disableModelInvocation`). Fire stamps both flags so scheduled
  // `/loop …` re-enters the skill path while plain-text scheduled
  // prompts stay non-slash.
  // Local prepare may wrap RZn / autonomy_authority around the bare fire
  // body — extract the slash candidate without requiring value overwrite.
  let slashInputForProcess = inputString
  if (modelScheduledOrigin && skipSlashCommands && inputString !== null) {
    const { extractModelScheduledSlashInput } = await import(
      '../scheduledTaskDisclaimer.js'
    )
    const slashCandidate =
      extractModelScheduledSlashInput(inputString) ??
      (inputString.startsWith('/') ? inputString : null)
    if (slashCandidate) {
      const parsed = parseSlashCommand(slashCandidate)
      let cmd = parsed
        ? findCommand(parsed.commandName, context.options.commands)
        : undefined
      // densable: try `name:firstArg` subcommand form when bare name misses
      if (!cmd && parsed?.commandName && parsed.args.trim()) {
        const rest = parsed.args.trimStart()
        const sp = rest.search(/\s/)
        const first = sp === -1 ? rest : rest.slice(0, sp)
        cmd = findCommand(
          `${parsed.commandName}:${first}`,
          context.options.commands,
        )
      }
      if (cmd && !cmd.disableModelInvocation) {
        effectiveSkipSlash = false
        slashInputForProcess = slashCandidate
      }
    }
  }

  // For slash commands, attachments will be extracted within getMessagesForSlashCommand.
  // Use slashInputForProcess so prepared RZn/authority wrappers that re-open
  // `/loop…` still skip attachment extraction (same as bare leading `/`).
  const slashLooksLikeCommand =
    (slashInputForProcess?.startsWith('/') ?? false) ||
    (inputString?.startsWith('/') ?? false)
  // densable yn Le/Pe: L!=="all" && (skipSlash || !startsWith("/")); Pe=L===void 0
  const skipMode: 'all' | 'mentions' | undefined =
    skipAttachments === true || skipAttachments === 'all'
      ? 'all'
      : skipAttachments === 'mentions'
        ? 'mentions'
        : origin?.kind === 'plugin'
          ? 'all'
          : undefined
  const canExtractThisPrompt = effectiveSkipSlash || !slashLooksLikeCommand
  const shouldExtractAttachments =
    skipMode !== 'all' &&
    skipMode === undefined &&
    canExtractThisPrompt &&
    mode !== 'poll-event' &&
    mode !== 'task-notification' &&
    inputString !== null

  // densable: isRegularUserPrompt = !isMeta && prompt mode && shouldQuery!==false.
  const isRegularUserPrompt =
    mode === 'prompt' && !isMeta && shouldQuery !== false
  const isHumanTypedPrompt = isRegularUserPrompt && origin?.kind === 'human'
  queryCheckpoint('query_attachment_loading_start')
  const attachmentMessages = shouldExtractAttachments
    ? await toArray(
        getAttachmentMessages(
          inputString,
          context,
          ideSelection ?? null,
          [], // queuedCommands - handled by query.ts for mid-turn attachments
          messages,
          querySource,
          {
            isRegularUserPrompt,
            isHumanTypedPrompt,
            preExpansionInput,
            suppressWorkflowKeyword,
          },
        ),
      )
    : []
  queryCheckpoint('query_attachment_loading_end')

  const inlinedImageAttachment =
    inlinedImagePaths && inlinedImagePaths.length > 0
      ? createAttachmentMessage({
          type: 'inlined_image_paths',
          paths: inlinedImagePaths,
        })
      : null
  const threadSnapshot = stampThreadState ? snapshotThreadState() : undefined
  const threadStateAttachment = threadSnapshot
    ? createAttachmentMessage({
        type: 'thread_state',
        ...threadSnapshot,
      })
    : null

  // Bash commands
  if (inputString !== null && mode === 'bash') {
    const { processBashCommand } = await import('./processBashCommand.js')
    return addImageMetadataMessage(
      await processBashCommand(
        inputString,
        precedingInputBlocks,
        attachmentMessages,
        context,
        setToolJSX,
      ),
      imageMetadataTexts,
    )
  }

  // densable BZt keyword — route through /ultraplan. Detect on the
  // pre-expansion input so pasted content containing the word cannot
  // trigger a CCR session; replace with "plan" in the expanded input so
  // the CCR prompt receives paste contents and stays grammatical.
  // Interactive prompt mode + non-slash-prefixed only: headless/print
  // filters local-jsx commands out of context.options.
  if (
    isUltraplanProductEnabled() &&
    mode === 'prompt' &&
    !context.options.isNonInteractiveSession &&
    inputString !== null &&
    !effectiveSkipSlash &&
    !inputString.startsWith('/') &&
    !context.getAppState().ultraplanSessionUrl &&
    !context.getAppState().ultraplanLaunching &&
    hasUltraplanKeyword(preExpansionInput ?? inputString)
  ) {
    logEvent('tengu_ultraplan_keyword', {})
    const rewritten = replaceUltraplanKeyword(inputString).trim()
    const { processSlashCommand } = await import('./processSlashCommand.js')
    const slashResult = await processSlashCommand(
      `/ultraplan ${rewritten}`,
      precedingInputBlocks,
      imageContentBlocks,
      [],
      context,
      setToolJSX,
      uuid,
      isAlreadyProcessing,
      canUseTool,
      autonomy,
      modelScheduledOrigin,
      origin,
    )
    return addImageMetadataMessage(slashResult, imageMetadataTexts)
  }

  // Slash commands
  // Skip for remote bridge messages — input from CCR clients is plain text
  const slashBody =
    slashInputForProcess !== null && slashInputForProcess.startsWith('/')
      ? slashInputForProcess
      : inputString !== null && inputString.startsWith('/')
        ? inputString
        : null
  if (slashBody !== null && !effectiveSkipSlash) {
    const { processSlashCommand } = await import('./processSlashCommand.js')
    const slashResult = await processSlashCommand(
      slashBody,
      precedingInputBlocks,
      imageContentBlocks,
      attachmentMessages,
      {
        ...context,
        submissionVerifiedSlackHumanTurn: verifiedSlackHumanTurn,
        submittedOnLocalStdin: localStdinOrigin,
        submittedBySessionChannelPerson: sessionChannelPersonTyped,
        submittedFromComposer: isComposerEnter(composerEnter),
      },
      setToolJSX,
      uuid,
      isAlreadyProcessing,
      canUseTool,
      autonomy,
      modelScheduledOrigin,
      origin,
      wakeupSource,
      hostInitiator,
    )
    if (inlinedImageAttachment) {
      slashResult.messages.push(inlinedImageAttachment)
    }
    if (threadStateAttachment) {
      slashResult.messages.push(threadStateAttachment)
    }
    return addImageMetadataMessage(slashResult, imageMetadataTexts)
  }

  // Log agent mention queries for analysis
  if (inputString !== null && mode === 'prompt') {
    const trimmedInput = inputString.trim()

    const agentMention = attachmentMessages.find(
      (m): m is AttachmentMessage<AgentMentionAttachment> =>
        m.attachment.type === 'agent_mention',
    )

    if (agentMention) {
      const agentMentionString = `@agent-${agentMention.attachment.agentType}`
      const isSubagentOnly = trimmedInput === agentMentionString
      const isPrefix =
        trimmedInput.startsWith(agentMentionString) && !isSubagentOnly

      // Log whenever users use @agent-<name> syntax
      logEvent('tengu_subagent_at_mention', {
        is_subagent_only: isSubagentOnly,
        is_prefix: isPrefix,
      })
    }
  }

  // Regular user prompt
  const promptAttachments = [...attachmentMessages]
  if (inlinedImageAttachment) {
    promptAttachments.push(inlinedImageAttachment)
  }
  if (threadStateAttachment) {
    promptAttachments.push(threadStateAttachment)
  }
  const promptResult = addImageMetadataMessage(
    processTextPrompt(
      normalizedInput,
      imageContentBlocks,
      imagePasteIds,
      promptAttachments,
      uuid,
      permissionMode,
      isMeta,
      origin,
      wakeupSource,
      hostInitiator,
      artifactCommentTurn,
    ),
    imageMetadataTexts,
  )
  // densable Le&&!Pe → ambientAttachmentsOwed
  if (skipMode === 'mentions' && canExtractThisPrompt) {
    promptResult.ambientAttachmentsOwed = true
  }
  return promptResult
}

// densable Qt — isMeta + turnCompanion, no origin (cun fills origin later).
function addImageMetadataMessage(
  result: ProcessUserInputBaseResult,
  imageMetadataTexts: string[],
): ProcessUserInputBaseResult {
  if (imageMetadataTexts.length > 0) {
    result.messages.push(
      createUserMessage({
        content: imageMetadataTexts.map(text => ({ type: 'text', text })),
        isMeta: true,
        turnCompanion: true,
      }),
    )
  }
  return result
}
