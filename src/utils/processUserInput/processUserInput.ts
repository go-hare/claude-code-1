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
import { applyHookSessionTitle } from '../sessionStart.js'
import { processTextPrompt } from './processTextPrompt.js'
import {
  originIsTypedOrUnset,
  resolvePromptSource,
  resolveTurnOrigin,
  snapshotThreadState,
} from './artStamps.js'
import { isComposerEnter } from './composerEnter.js'
import {
  packPromptSubmitContext,
  promptScreenNeedsReplay,
  promptScreenPluginsChanged,
  rewritePromptSubmitUserMessage,
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
  /**
   * densable Art `I.expandedInput` (@195537000, @195547922) — expanded prompt
   * payload when base processing rewrites the input before submission hooks.
   */
  expandedInput?: string | Array<ContentBlockParam>
  /**
   * Official 2.1.325 (#731): pre-expansion UserPromptSubmit / prompt.submit
   * line check result from processSlashCommand.
   */
  lineCheck?: SlashLineCheckResult
  /**
   * Official 2.1.325 (#731): forked slash command already ran
   * UserPromptSubmit hooks before dispatch; skip duplicate runPromptSubmit.
   */
  forkDispatched?: boolean
}

export type SlashLineCheckResult = {
  ran: { name: string; args: string; argsRanWith: string }
  rows: ProcessUserInputBaseResult
  outcome?: Awaited<ReturnType<typeof runPromptSubmit>>
  threw?: { error: unknown }
}

export type SlashLineCheckFn = (ran: {
  name: string
  args: string
  argsRanWith: string
}) => Promise<SlashLineCheckResult>

/**
 * Official 2.1.323 `BN(e)` (#2194): mask claude.ai / Desktop picked file
 * references (`@[label](claude-ref:...)` and `@[label](https://docs.google.com/...)`)
 * — including text typed between two picked files or after a picked file and a
 * markdown link — so `/skill` or `@file` inside those spans no longer takes effect.
 */
const PICKED_FILE_REF_RE =
  /@\[[^[\]\n]{1,200}\]\((?:claude-ref:[A-Za-z0-9:_.=;-]{0,161} "[^"\n]{1,200}"|https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[\w-]{16,})\)/uy

function minPos(a: number, b: number): number {
  return a === -1 ? b : b === -1 ? a : Math.min(a, b)
}

function endOfLine(text: string, from: number): number {
  const nl = text.indexOf('\n', from)
  return nl === -1 ? text.length : nl
}

function isWordCharCode(text: string, idx: number): boolean {
  const code = text.charCodeAt(idx)
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    code === 95 ||
    (code >= 97 && code <= 122)
  )
}

function looksLikePathSegment(
  text: string,
  start: number,
  end: number,
): boolean {
  const after = text[end + 1]
  return (
    !/\s/.test(text.slice(start, end)) &&
    (after === '/' || (after === '.' && isWordCharCode(text, end + 2)))
  )
}

function pushMaskedSpan(
  spans: Array<{ start: number; end: number; closed: boolean }>,
  start: number,
  end: number,
  closed: boolean,
): void {
  while ((spans.at(-1)?.start ?? -1) >= start) {
    spans.pop()
  }
  const prev = spans.at(-1)
  if (prev !== undefined && prev.end > start) {
    if (end > prev.end) {
      prev.end = end
      prev.closed = closed
    }
    return
  }
  spans.push({ start, end, closed })
}

export function maskPickedFileReferences(text: string): string {
  if (!text.includes('@[')) return text
  const spans: Array<{ start: number; end: number; closed: boolean }> = []
  let openBracketStart = -1
  let lastValidRefStart = -1
  let parenDepth = 0
  let bracketDepth = 0
  let multilineOpenStart = -1
  let firstAtBracketOnLine = -1
  let outermostAtBracket = -1
  let sawPickedRef = false
  let innerAtBracket = -1
  let i = 0

  while (i < text.length) {
    const ch = text[i]
    if (ch === '\n') {
      multilineOpenStart =
        bracketDepth > 0 ? minPos(multilineOpenStart, openBracketStart) : -1
      openBracketStart = -1
      outermostAtBracket = -1
      innerAtBracket = -1
      lastValidRefStart = -1
      parenDepth = 0
      i++
      continue
    }
    const next = text[i + 1]
    if (
      ch === '\\' &&
      (next === '(' ||
        next === ')' ||
        next === '\\' ||
        next === '[' ||
        (next === ']' && text[i + 2] !== '('))
    ) {
      if (next === ']' && multilineOpenStart !== -1) {
        pushMaskedSpan(spans, multilineOpenStart, i + 2, true)
      }
      if (next === ']' && innerAtBracket !== -1) {
        pushMaskedSpan(spans, innerAtBracket, i + 2, true)
        innerAtBracket = -1
      }
      i += 2
      continue
    }
    if (ch === '@' && next === '[') {
      firstAtBracketOnLine = minPos(firstAtBracketOnLine, i)
      PICKED_FILE_REF_RE.lastIndex = i
      const match = PICKED_FILE_REF_RE.exec(text)
      const pendingOpen = minPos(multilineOpenStart, openBracketStart)
      if (match !== null && pendingOpen === -1) {
        pushMaskedSpan(spans, firstAtBracketOnLine, i + match[0].length, true)
        lastValidRefStart = minPos(lastValidRefStart, i)
        sawPickedRef = true
        i += match[0].length
        continue
      }
      if (match !== null) {
        i = endOfLine(text, i)
        pushMaskedSpan(spans, firstAtBracketOnLine, i, false)
        sawPickedRef = true
        continue
      }
      if (openBracketStart === -1 && multilineOpenStart === -1) {
        openBracketStart = firstAtBracketOnLine
        outermostAtBracket = i
      }
      innerAtBracket = i
      bracketDepth++
      i += 2
      continue
    }
    if (ch === '[' && bracketDepth > 0) {
      bracketDepth++
    } else if (ch === ']' && bracketDepth > 0) {
      bracketDepth--
      if (multilineOpenStart !== -1 && next !== '(') {
        pushMaskedSpan(spans, multilineOpenStart, i + 1, true)
      }
      if (
        innerAtBracket !== -1 &&
        next !== '(' &&
        !looksLikePathSegment(text, innerAtBracket + 2, i)
      ) {
        pushMaskedSpan(spans, innerAtBracket, i + 1, true)
      }
      innerAtBracket = -1
      if (bracketDepth === 0 && next !== '(') {
        if (
          outermostAtBracket !== -1 &&
          !looksLikePathSegment(text, outermostAtBracket + 2, i)
        ) {
          pushMaskedSpan(spans, outermostAtBracket, i + 1, true)
        }
        openBracketStart = -1
        multilineOpenStart = -1
        outermostAtBracket = -1
      }
    }
    const isClaudeRefLink = ch === ']' && text.startsWith('](claude-ref:', i)
    if (
      firstAtBracketOnLine !== -1 &&
      (isClaudeRefLink ||
        (ch === ']' && text.startsWith('](https://docs.google.com/', i)))
    ) {
      const closeIdx = text.indexOf(isClaudeRefLink ? '")' : ')', i)
      i = endOfLine(text, closeIdx === -1 ? text.length : closeIdx)
      pushMaskedSpan(spans, firstAtBracketOnLine, i, false)
      sawPickedRef = true
      continue
    }
    const unmatchedCloseParen = ch === ')' && parenDepth === 0
    if (
      (ch === ']' && next === '(') ||
      (ch === '"' && next === ')') ||
      unmatchedCloseParen
    ) {
      let spanStart = minPos(
        minPos(multilineOpenStart, openBracketStart),
        unmatchedCloseParen ? -1 : lastValidRefStart,
      )
      if (spanStart === -1 && sawPickedRef && ch === '"') {
        spanStart = firstAtBracketOnLine
      }
      if (spanStart !== -1) {
        const from = i
        i = endOfLine(text, i)
        pushMaskedSpan(spans, spanStart, i, false)
        if (text.slice(from, i).includes('](claude-ref:')) {
          sawPickedRef = true
        }
        continue
      }
    }
    if (ch === '(') {
      parenDepth++
    } else if (ch === ')' && parenDepth > 0) {
      parenDepth--
    }
    i++
  }

  let out = ''
  let cursor = 0
  for (const { start, end, closed } of spans) {
    const masked = text
      .slice(start + 1, closed ? end - 1 : end)
      .replace(/[^\n]/g, ' ')
    out +=
      text.slice(cursor, start) + '@' + masked + (closed ? text[end - 1] : '')
    cursor = end
  }
  return out + text.slice(cursor)
}

function rewriteSlashArgs(
  text: string,
  ran?: { name: string; args: string; argsRanWith: string },
): string | undefined {
  if (ran === undefined || ran.argsRanWith === ran.args) return undefined
  return ran.args !== '' && text.endsWith(ran.args)
    ? text.slice(0, text.length - ran.args.length) + ran.argsRanWith
    : `/${ran.name} ${ran.argsRanWith}`
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

const PROMPT_SUBMIT_MENTION_TYPES = new Set([
  'file',
  'already_read_file',
  'at_mention_reference',
  'pdf_reference',
  'directory',
  'mcp_resource',
  'agent_mention',
  'peer_mention',
  'skill_mention',
  'nested_memory',
])

const AT_MENTION_RE =
  /(?:^|[\s。、？！])@(?:"[^"]+"|\S+?\b(?=[ \t]*\[[0-9a-fA-F]{6,12}\])|\S+\b)(?:[ \t]*\[[0-9a-fA-F]{6,12}\])?/g

function atMentionsIn(text: string): string[] {
  return [...text.matchAll(AT_MENTION_RE)].map(match =>
    match[0].slice(match[0].indexOf('@')),
  )
}

/** densable `Vs` — @mentions that appear in both rewritten and original text. */
function sharedAtMentionText(rewritten: string, original: string): string {
  const previous = atMentionsIn(original)
  return atMentionsIn(rewritten)
    .filter(token => previous.includes(token))
    .join(' ')
}

/**
 * densable Art after Unn: kcn pack proceeds.context as prompt.submit, mn
 * rewrite the original user message, gn mention re-expand, Qut sessionTitle.
 */
async function applyPromptSubmitProceeds(
  result: ProcessUserInputBaseResult,
  proceeded: {
    originalText: string
    rawInputText?: string
    text: string
    context?: string[]
    sessionTitle?: string
  },
  extras?: {
    skipAttachments?: boolean | 'all' | 'mentions'
    toolUseContext?: ProcessUserInputContext
    history?: Message[]
    querySource?: QuerySource
    typed?: string
    ambientTriggers?: string[]
  },
): Promise<void> {
  const packed = await packPromptSubmitContext(proceeded.context)
  if (packed) {
    result.messages.push(packed)
  }
  let rewrittenUser: ReturnType<typeof rewritePromptSubmitUserMessage>
  if (proceeded.text !== proceeded.originalText) {
    rewrittenUser = rewritePromptSubmitUserMessage(
      result.messages,
      proceeded.originalText,
      proceeded.text,
    )
  }
  if (
    rewrittenUser !== undefined &&
    extras?.skipAttachments === undefined &&
    extras?.toolUseContext !== undefined
  ) {
    const kept: ProcessUserInputBaseResult['messages'] = []
    let hadPeerMention = false
    for (const message of result.messages) {
      if (
        message.type !== 'attachment' ||
        !PROMPT_SUBMIT_MENTION_TYPES.has(message.attachment.type)
      ) {
        kept.push(message)
        continue
      }
      if (message.attachment.type === 'file') {
        extras.toolUseContext.readFileState.delete(
          String((message.attachment as { filename?: string }).filename ?? ''),
        )
      }
      if (message.attachment.type === 'nested_memory') {
        extras.toolUseContext.readFileState.delete(
          String((message.attachment as { path?: string }).path ?? ''),
        )
      }
      if (message.attachment.type === 'peer_mention') {
        hadPeerMention = true
      }
    }
    if (
      extras.ambientTriggers &&
      extras.toolUseContext.nestedMemoryAttachmentTriggers
    ) {
      for (const trigger of extras.ambientTriggers) {
        extras.toolUseContext.nestedMemoryAttachmentTriggers.add(trigger)
      }
    }
    const mentionText = sharedAtMentionText(
      proceeded.text,
      proceeded.rawInputText ?? proceeded.originalText,
    )
    const typedMentions =
      extras.typed === undefined
        ? undefined
        : sharedAtMentionText(proceeded.text, extras.typed)
    const mentions = await toArray(
      getAttachmentMessages(
        mentionText,
        extras.toolUseContext,
        null,
        [],
        extras.history,
        extras.querySource,
        {
          inputMentionsOnly: true,
          isHumanTypedPrompt: hadPeerMention,
          ...(hadPeerMention && typedMentions !== undefined
            ? { preExpansionInput: typedMentions }
            : {}),
        },
      ),
    )
    const insertAt = kept.indexOf(rewrittenUser)
    kept.splice(insertAt + 1, 0, ...mentions)
    result.messages = kept
  }
  if (proceeded.sessionTitle) {
    applyHookSessionTitle(proceeded.sessionTitle)
  }
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
  taskDelivery,
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
  /** densable BX `taskDelivery` — GetTask snapshot on As. */
  taskDelivery?: unknown
}): Promise<ProcessUserInputBaseResult> {
  // densable Art `using V=Ios(hss(k))` — wrap the whole turn so a skip-Unn
  // path still dispose-drops the plugin waiter.
  using queuedSettle = wrapQueuedSettle(takePromptSubmitWait(uuid))
  const inputString = typeof input === 'string' ? input : null
  // Immediately show the user input prompt while we are still processing the input.
  // Skip for isMeta (system-generated prompts like scheduled tasks) and slash
  // commands (they produce their own system message echo via createCommandInputMessage).
  const isSlashInput =
    inputString?.trimStart().startsWith('/') && !skipSlashCommands
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
  const effectiveSkipAttachments: 'all' | 'mentions' | undefined =
    skipFromFe ??
    skipFromCaller ??
    (origin?.kind === 'plugin' ? 'all' : undefined)

  const initialNestedMemoryTriggers = context.nestedMemoryAttachmentTriggers
    ? [...context.nestedMemoryAttachmentTriggers]
    : []

  // Official 2.1.325 (#731): checkLine (`ut`) runs prompt.submit +
  // UserPromptSubmit BEFORE skill/slash expansion in processSlashCommand.
  const checkLine: SlashLineCheckFn | undefined =
    (shouldQueryInput === false && queryHeldForNextTurn !== true) ||
    skipSubmissionHooks ||
    promptSubmitted !== undefined
      ? undefined
      : async ran => {
          const rows: ProcessUserInputBaseResult = {
            messages: [],
            shouldQuery: true,
          }
          if (context.abortController?.signal.aborted) {
            return { ran, rows, outcome: undefined }
          }
          const rawText = getContentText(input) || ''
          const lineText = rewriteSlashArgs(rawText, ran) ?? rawText
          const isStartInput =
            aheadOfSessionStart === true || isAheadOfSessionStart(uuid)
          const linePromptSource = resolvePromptSource({
            isNonInteractive: context.options.isNonInteractiveSession,
            isMeta,
            callerSource: originIsTypedOrUnset(origin) ? undefined : 'system',
          })
          try {
            const outcome = await runPromptSubmit({
              text: lineText,
              originalInput: input,
              result: rows,
              context,
              isStartInput,
              shouldWait: wait === true,
              promptSource: linePromptSource,
              wakeupSource,
              entries,
              queued: queuedSettle,
              pastedContents,
              origin,
              bridgeOrigin,
              mode,
              turnId: uuid,
            })
            return { ran, rows, outcome }
          } catch (error) {
            logForDebugging(
              `processUserInput checkLine error: ${error instanceof Error ? error.message : String(error)}`,
            )
            return { ran, rows, outcome: undefined, threw: { error } }
          }
        }

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
    taskDelivery,
    checkLine,
  )
  const lineCheck = result.lineCheck
  delete result.lineCheck
  if (lineCheck?.threw !== undefined) {
    throw lineCheck.threw.error
  }
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

  if (!result.shouldQuery || result.forkDispatched) {
    await deliverOwedAmbientAttachments(result, context, messages, querySource)
    return result
  }

  if (skipSubmissionHooks) {
    await deliverOwedAmbientAttachments(result, context, messages, querySource)
    return result
  }

  // Official 2.1.325 (#731): reuse lineCheck.outcome when UserPromptSubmit /
  // prompt.submit already ran before skill/slash expansion.
  if (promptSubmitted === undefined && lineCheck !== undefined) {
    if (lineCheck.outcome === undefined) {
      queryCheckpoint('query_hooks_end')
      return { messages: [], shouldQuery: false }
    }
    queryCheckpoint('query_hooks_start')
    const submissionInput = result.expandedInput ?? input
    const inputMessage = getContentText(submissionInput) || ''
    const rawInputText = getContentText(input) || ''
    const typedInput =
      preExpansionInput ?? (typeof input === 'string' ? input : undefined)
    const consumedNestedTriggers = (
      context as { consumedNestedMemoryTriggers?: Iterable<string> }
    ).consumedNestedMemoryTriggers
    const ambientTriggers =
      consumedNestedTriggers !== undefined
        ? [...initialNestedMemoryTriggers, ...consumedNestedTriggers]
        : initialNestedMemoryTriggers
    if (lineCheck.outcome.kind === 'return') {
      if (
        lineCheck.outcome.value &&
        'stopped' in lineCheck.outcome.value &&
        lineCheck.outcome.value.stopped !== undefined
      ) {
        result.messages.push(...lineCheck.outcome.result.messages)
        result.shouldQuery = false
        result.resultText = lineCheck.outcome.result.resultText
        queryCheckpoint('query_hooks_end')
        return result
      }
      queryCheckpoint('query_hooks_end')
      return lineCheck.outcome.result
    }
    result.messages.push(...lineCheck.rows.messages)
    await applyPromptSubmitProceeds(
      result,
      {
        originalText: inputMessage,
        rawInputText,
        text: lineCheck.outcome.stamp.text,
        context: lineCheck.outcome.stamp.context,
        sessionTitle: lineCheck.outcome.stamp.sessionTitle,
      },
      {
        skipAttachments: effectiveSkipAttachments,
        toolUseContext: context,
        history: messages,
        querySource,
        typed: typedInput,
        ambientTriggers,
      },
    )
    queryCheckpoint('query_hooks_end')
    return result
  }

  // densable Art Unn / yUn / Pos / $nn. skip jq.get() when ahead of
  // session start (orphanedPermission or uuid in pG).
  queryCheckpoint('query_hooks_start')
  const submissionInput = result.expandedInput ?? input
  const inputMessage = getContentText(submissionInput) || ''
  const rawInputText = getContentText(input) || ''
  const typedInput =
    preExpansionInput ?? (typeof input === 'string' ? input : undefined)
  const consumedNestedTriggers = (
    context as { consumedNestedMemoryTriggers?: Iterable<string> }
  ).consumedNestedMemoryTriggers
  const ambientTriggers =
    consumedNestedTriggers !== undefined
      ? [...initialNestedMemoryTriggers, ...consumedNestedTriggers]
      : initialNestedMemoryTriggers
  const isStartInput =
    aheadOfSessionStart === true || isAheadOfSessionStart(uuid)
  let screenNow: ReturnType<typeof snapshotPromptScreen> | undefined
  if (promptSubmitted !== undefined) {
    try {
      screenNow = snapshotPromptScreen(context)
    } catch (err) {
      logForDebugging(
        `the drain could not read what screens a prompt now: ${err instanceof Error ? err.message : String(err)}`,
        { level: 'error' },
      )
    }
  }
  if (
    promptSubmitted === undefined ||
    screenNow === undefined ||
    promptScreenPluginsChanged(promptSubmitted.under, screenNow)
  ) {
    const outcome = await runPromptSubmit({
      text: inputMessage,
      originalInput: submissionInput,
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
      pastedContents,
      origin,
      bridgeOrigin,
      mode,
      turnId: uuid,
    })
    if (outcome.kind === 'return') {
      queryCheckpoint('query_hooks_end')
      return outcome.result
    }
    await applyPromptSubmitProceeds(
      result,
      {
        originalText: inputMessage,
        rawInputText,
        text: outcome.stamp.text,
        context: outcome.stamp.context,
        sessionTitle: outcome.stamp.sessionTitle,
      },
      {
        skipAttachments: effectiveSkipAttachments,
        toolUseContext: context,
        history: messages,
        querySource,
        typed: typedInput,
        ambientTriggers,
      },
    )
  } else if (promptScreenNeedsReplay(promptSubmitted.under, screenNow)) {
    const replay = await runUserPromptSubmit(
      promptSubmitted.text,
      result,
      context,
      submissionInput,
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
      void registerPromptSubmitEntry(entries, result.messages).catch(error => {
        logForDebugging(
          `prompt.submit entry ended before handoff: ${String(error)}`,
        )
      })
    }
    await applyPromptSubmitProceeds(
      result,
      {
        originalText: inputMessage,
        rawInputText,
        text: promptSubmitted.text,
        context: promptSubmitted.context,
        sessionTitle: replay.sessionTitle ?? promptSubmitted.sessionTitle,
      },
      {
        skipAttachments: effectiveSkipAttachments,
        toolUseContext: context,
        history: messages,
        querySource,
        typed: typedInput,
        ambientTriggers,
      },
    )
  } else if (promptSubmitted.stopped !== undefined) {
    result.messages.push(...(promptSubmitted.messages ?? []))
    result.shouldQuery = false
    result.resultText = promptSubmitted.stopped
    queryCheckpoint('query_hooks_end')
    return result
  } else {
    result.messages.push(...(promptSubmitted.messages ?? []))
    if (entries) {
      void registerPromptSubmitEntry(entries, result.messages).catch(error => {
        logForDebugging(
          `prompt.submit entry ended before handoff: ${String(error)}`,
        )
      })
    }
    await applyPromptSubmitProceeds(
      result,
      {
        originalText: inputMessage,
        rawInputText,
        text: promptSubmitted.text,
        context: promptSubmitted.context,
        sessionTitle: promptSubmitted.sessionTitle,
      },
      {
        skipAttachments: effectiveSkipAttachments,
        toolUseContext: context,
        history: messages,
        querySource,
        typed: typedInput,
        ambientTriggers,
      },
    )
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
  taskDelivery?: unknown,
  checkLine?: SlashLineCheckFn,
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
  if (
    bridgeOrigin &&
    inputString !== null &&
    inputString.trimStart().startsWith('/')
  ) {
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
      (inputString.trimStart().startsWith('/') ? inputString.trimStart() : null)
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
    (slashInputForProcess?.trimStart().startsWith('/') ?? false) ||
    (inputString?.trimStart().startsWith('/') ?? false)
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
  // Official 2.1.323 BN (#2194): mask picked file references (`@[...](claude-ref:...)`
  // / Google Docs links and spans between two picked files or after a picked file
  // and a link) before extracting @file / /skill mentions and keywords.
  const maskedInputForMentions =
    inputString !== null ? maskPickedFileReferences(inputString) : null
  const maskedPreExpansion =
    preExpansionInput !== undefined
      ? maskPickedFileReferences(preExpansionInput)
      : undefined
  const attachmentMessages = shouldExtractAttachments
    ? await toArray(
        getAttachmentMessages(
          maskedInputForMentions,
          context,
          ideSelection ?? null,
          [], // queuedCommands - handled by query.ts for mid-turn attachments
          messages,
          querySource,
          {
            isRegularUserPrompt,
            isHumanTypedPrompt,
            preExpansionInput: maskedPreExpansion,
            suppressWorkflowKeyword,
          },
        ),
      )
    : shouldQuery !== false
      ? await toArray(
          getAttachmentMessages(
            null,
            context,
            null,
            [],
            messages,
            querySource,
            {
              deliveredTurnStart: true,
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
    !inputString.trimStart().startsWith('/') &&
    !context.getAppState().ultraplanSessionUrl &&
    !context.getAppState().ultraplanLaunching &&
    hasUltraplanKeyword(
      maskedPreExpansion ?? maskedInputForMentions ?? inputString,
    )
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
      wakeupSource,
      hostInitiator,
      checkLine,
    )
    return addImageMetadataMessage(slashResult, imageMetadataTexts)
  }

  // Slash commands
  // Skip for remote bridge messages — input from CCR clients is plain text
  const slashBody =
    slashInputForProcess !== null &&
    slashInputForProcess.trimStart().startsWith('/')
      ? slashInputForProcess.trimStart()
      : inputString !== null && inputString.trimStart().startsWith('/')
        ? inputString.trimStart()
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
      checkLine,
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
      taskDelivery,
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
