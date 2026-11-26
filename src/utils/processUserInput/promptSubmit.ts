/**
 * densable 2.1.289 `Unn` / `yUn` / `CLt` / `vLt` / `Ios` / `RNe`.
 *
 * Plugin `prompt.submit` races managed UserPromptSubmit. Never export densable
 * ids. Do not invent a second hook engine — tail is the existing UPS loop.
 */
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { randomUUID } from 'crypto'
import { getRegisteredHooks, getSessionId } from '../../bootstrap/state.js'
import type { ToolUseContext } from '../../Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  ProgressMessage,
  SystemMessage,
  UserMessage,
} from '../../types/message.js'
import { createAttachmentMessage } from '../attachments.js'
import type { PastedContent } from '../config.js'
import { logForDebugging } from '../debug.js'
import {
  executeUserPromptSubmitHooks,
  getUserPromptSubmitHookBlockingMessage,
  hasHookForEvent,
  shouldSkipHookDueToTrust,
} from '../hooks.js'
import { formatCloudUserPromptSubmitBlockError } from '../hooks/hookErrorDisplay.js'
import { getHooksConfigFromSnapshot } from '../hooks/hooksConfigSnapshot.js'
import {
  getSessionFunctionHooks,
  getSessionHooks,
} from '../hooks/sessionHooks.js'
import {
  createSystemMessage,
  createUserMessage,
  getContentText,
  uiRenderUserMessageOrigin,
  wrapPluginOriginText,
} from '../messages.js'
import {
  getLoadedFunctionHooksModules,
  hasMatchingFunctionHook,
  runFunctionHookChain,
} from '../plugins/functionHooksModules.js'
import { getSettingsForSource } from '../settings/settings.js'
import { getBootstrapSession, RootSessionSlot } from '../sessionHost.js'
import type {
  PromptInputMode,
  QueuedCommand,
} from '../../types/textInputTypes.js'
import {
  listOfContextTexts,
  packToolCallContext,
} from '../hooks/toolCallContextPack.js'
import {
  getPromptSubmitLatch,
  registerPromptSubmitEntry,
  type PromptSubmitEntries,
} from './promptSubmitEntries.js'

const NOT_SUBMITTED =
  'Prompt not submitted: the prompt did not go through prompt.submit (a command, bash mode, an input that did not query, or a failed pass)'

const HOOKS_DID_NOT_RUN =
  'Prompt blocked: the UserPromptSubmit hooks did not run over the submitted text.'

export type PromptScreen = {
  permissionMode: string
  hooks: string
  plugins: string
  hooksSkippedByTrust: boolean
}

type SubmitMessages = Array<
  | UserMessage
  | AssistantMessage
  | AttachmentMessage
  | SystemMessage
  | ProgressMessage
>

export type PromptSubmittedStamp = {
  text: string
  under: PromptScreen
  context?: string[]
  sessionTitle?: string
  stopped?: string
  messages?: SubmitMessages
}

type SubmitResult = {
  messages: SubmitMessages
  shouldQuery: boolean
  allowedTools?: string[]
  resultText?: string
}

type ArrivedValue = { text: string; context?: string[] }

export function createArrivedLatch(reason: string): {
  perform(value: ArrivedValue): Promise<unknown>
  arrived: Promise<ArrivedValue>
  hasArrived(): boolean
  done(value: unknown): void
  failed(err: unknown): void
  [Symbol.dispose](): void
} {
  const arrived = Promise.withResolvers<ArrivedValue>()
  const finished = Promise.withResolvers<unknown>()
  finished.promise.catch(() => {
    return
  })
  let didArrive = false
  let didFinish = false
  function fail(err: unknown): void {
    if (!didFinish) {
      didFinish = true
      finished.reject(err)
    }
  }
  return {
    perform(value) {
      if (!didArrive) {
        didArrive = true
        arrived.resolve(value)
      }
      return finished.promise
    },
    arrived: arrived.promise,
    hasArrived: () => didArrive,
    done(value) {
      if (!didFinish) {
        didFinish = true
        finished.resolve(value)
      }
    },
    failed: fail,
    [Symbol.dispose]() {
      fail(new Error(reason))
    },
  }
}

export const PROMPT_CHECK_INTERRUPTED =
  'the turn was interrupted while the prompt was checked'

export async function raceArrived<T>(
  latch: ReturnType<typeof createArrivedLatch>,
  answered: Promise<T>,
  signal?: AbortSignal,
): Promise<{ arrived: ArrivedValue } | { answered: T } | undefined> {
  if (signal?.aborted && !latch.hasArrived()) {
    latch[Symbol.dispose]()
    return undefined
  }
  let onAbort: (() => void) | undefined
  const abortPromise = signal
    ? new Promise<void>(resolve => {
        if (signal.aborted) {
          resolve()
          return
        }
        onAbort = () => resolve()
        signal.addEventListener('abort', onAbort, { once: true })
      })
    : undefined

  try {
    await Promise.race([
      latch.arrived,
      answered.then(
        () => {
          return
        },
        () => {
          return
        },
      ),
      ...(abortPromise ? [abortPromise] : []),
    ])
  } finally {
    if (signal && onAbort) {
      signal.removeEventListener('abort', onAbort)
    }
  }
  if (latch.hasArrived()) return { arrived: await latch.arrived }
  latch[Symbol.dispose]()
  if (signal?.aborted) return undefined
  return { answered: await answered }
}

export function wrapQueuedSettle(handle?: {
  origin?: unknown
  settle: (result: unknown) => void
}): {
  origin: unknown
  settle: (result: unknown) => void
  settleWhen: (result: Promise<unknown>) => void
  [Symbol.dispose](): void
} {
  let settled = false
  const drop = { drop: NOT_SUBMITTED }
  return {
    origin: handle?.origin,
    settle(result) {
      settled = true
      handle?.settle(result)
    },
    settleWhen(result) {
      settled = true
      result.then(
        value => handle?.settle(value),
        () => handle?.settle(drop),
      )
    },
    [Symbol.dispose]() {
      if (!settled) {
        settled = true
        handle?.settle(drop)
      }
    },
  }
}

type PromptSubmitTokenSessionState = {
  objectTokens: WeakMap<object, number>
  functionTokens: WeakMap<Function, number>
  nextObjectToken: number
  nextFunctionToken: number
}

const promptSubmitTokenSessionSlot =
  new RootSessionSlot<PromptSubmitTokenSessionState>(() => ({
    objectTokens: new WeakMap<object, number>(),
    functionTokens: new WeakMap<Function, number>(),
    nextObjectToken: 0,
    nextFunctionToken: 0,
  }))

function getPromptSubmitTokenState(): PromptSubmitTokenSessionState {
  return promptSubmitTokenSessionSlot.of(getBootstrapSession())
}

function tokenForObject(obj: object): number {
  const state = getPromptSubmitTokenState()
  let token = state.objectTokens.get(obj)
  if (token === undefined) {
    state.nextObjectToken += 1
    token = state.nextObjectToken
    state.objectTokens.set(obj, token)
  }
  return token
}

function tokenForFunction(fn: Function): number {
  const state = getPromptSubmitTokenState()
  let token = state.functionTokens.get(fn)
  if (token === undefined) {
    state.nextFunctionToken += 1
    token = state.nextFunctionToken
    state.functionTokens.set(fn, token)
  }
  return token
}

function snapshotUserPromptSubmitHooks(
  appState: ReturnType<ToolUseContext['getAppState']>,
  sessionId: string,
): string {
  if (!hasHookForEvent('UserPromptSubmit', appState, sessionId)) {
    return ''
  }
  const policy =
    getSettingsForSource('policySettings')?.hooks?.UserPromptSubmit ?? []
  const snapshot = getHooksConfigFromSnapshot()?.UserPromptSubmit ?? []
  const registered = getRegisteredHooks()?.UserPromptSubmit ?? []
  const sessionCfg = appState
    ? (getSessionHooks(appState, sessionId, 'UserPromptSubmit').get(
        'UserPromptSubmit',
      ) ?? [])
    : []
  const sessionFns = appState
    ? (getSessionFunctionHooks(appState, sessionId, 'UserPromptSubmit').get(
        'UserPromptSubmit',
      ) ?? [])
    : []
  const loadedClassic = getLoadedFunctionHooksModules()
    .filter(
      mod =>
        mod.status !== 'unloaded' &&
        hasMatchingFunctionHook('UserPromptSubmit', undefined, [mod]),
    )
    .map(mod => [mod.name, tokenForObject(mod)])
  if (
    policy.length === 0 &&
    snapshot.length === 0 &&
    registered.length === 0 &&
    sessionCfg.length === 0 &&
    sessionFns.length === 0 &&
    loadedClassic.length === 0
  ) {
    return ''
  }
  return JSON.stringify(
    [policy, snapshot, registered, sessionCfg, sessionFns, loadedClassic],
    (_key, value) =>
      typeof value === 'function'
        ? `function#${tokenForFunction(value)}`
        : value,
  )
}

function snapshotPromptSubmitPlugins(): string {
  const loaded = getLoadedFunctionHooksModules()
  const matching = loaded.filter(
    mod =>
      mod.status !== 'unloaded' &&
      hasMatchingFunctionHook('prompt.submit', undefined, [mod]),
  )
  if (matching.length === 0) return ''
  return JSON.stringify([
    tokenForObject(loaded),
    matching.map(mod => [mod.name, tokenForObject(mod)]),
  ])
}

/** densable `RNe`. */
export function snapshotPromptScreen(context: ToolUseContext): PromptScreen {
  const appState = context.getAppState()
  const sessionId = context.agentId ?? getSessionId()
  return {
    permissionMode: appState.toolPermissionContext.mode,
    hooks: snapshotUserPromptSubmitHooks(appState, sessionId),
    plugins: snapshotPromptSubmitPlugins(),
    // densable RNe `hooksSkippedByTrust: Nde()` — Nde is !mM() (trust not accepted).
    hooksSkippedByTrust: shouldSkipHookDueToTrust(),
  }
}

/** densable `Pos` — plugins field changed. */
export function promptScreenPluginsChanged(
  previous: PromptScreen,
  next: PromptScreen,
): boolean {
  return previous.plugins !== next.plugins
}

/**
 * densable `$nn` — hooks / trust-skip / plugins changed, or permissionMode
 * changed while hooks are nonempty.
 */
export function promptScreenNeedsReplay(
  previous: PromptScreen,
  next: PromptScreen,
): boolean {
  return (
    previous.hooks !== next.hooks ||
    previous.hooksSkippedByTrust !== next.hooksSkippedByTrust ||
    previous.plugins !== next.plugins ||
    (previous.permissionMode !== next.permissionMode && next.hooks !== '')
  )
}

/**
 * densable `FAo` — cache snapshotPromptScreen; latch:true keeps the first
 * read (or a latch-scoped failure). latch:false re-reads each call.
 */
export function latchPromptScreen(
  getContext: () => ToolUseContext,
  opts: { latch: boolean },
): () => PromptScreen | undefined {
  let cached: PromptScreen | undefined
  let failed = false
  return () => {
    if (failed || (opts.latch && cached)) return cached
    try {
      cached = snapshotPromptScreen(getContext())
    } catch (err) {
      cached = undefined
      failed = opts.latch
      logForDebugging(`could not read what screens a prompt now: ${err}`, {
        level: 'error',
      })
    }
    return cached
  }
}

/**
 * densable `mp` — true means drop from the mid-turn snapshot. drainOnly /
 * screeningPending always drop; unstamped prompts keep; stamped prompts drop
 * when the screen cannot be read or needs replay.
 */
export function queuedCommandDropsForChangedScreen(
  command: QueuedCommand,
  readScreen: () => PromptScreen | undefined,
): boolean {
  if (command.drainOnly === true || command.screeningPending === true) {
    return true
  }
  if (command.promptSubmitted === undefined) return false
  const screen = readScreen()
  return (
    screen === undefined ||
    promptScreenNeedsReplay(command.promptSubmitted.under, screen)
  )
}

/**
 * densable `zl` — keep until the first dropped command; after that, drop
 * remaining prompt-mode commands.
 */
export function keepQueuedCommandsUntilFirstDroppedPrompt(
  readScreen: () => PromptScreen | undefined,
): (command: QueuedCommand) => boolean {
  let dropped = false
  return command => {
    if (dropped && command.mode === 'prompt') return false
    if (!queuedCommandDropsForChangedScreen(command, readScreen)) return true
    dropped = true
    return false
  }
}

type UpsOutcome =
  | { kind: 'ok'; sessionTitle?: string }
  | { kind: 'blocking'; messages: SubmitMessages; allowedTools?: string[] }
  | { kind: 'stop'; sessionTitle?: string }

/**
 * densable `W` (@195141083) — frame between-turn plugin prompts with `VLr(..., { midTurn: false })`
 * unless `origin.asUser === true`.
 */
export function framePluginPromptSubmitText(
  text: string,
  origin: unknown,
): string {
  if (origin && typeof origin === 'object') {
    const rec = origin as {
      kind?: unknown
      asUser?: unknown
      name?: unknown
      plugin?: unknown
    }
    if (rec.kind === 'plugin' && rec.asUser !== true) {
      return wrapPluginOriginText(text, rec.name ?? rec.plugin, {
        midTurn: false,
      })
    }
  }
  return text
}

/**
 * densable `yUn` — settings UserPromptSubmit over `result`.
 */
export async function runUserPromptSubmit(
  text: string,
  result: SubmitResult,
  context: ToolUseContext,
  _originalInput?: string | unknown,
  options?: {
    isCloudMidTurn?: boolean
    isCodeModeScriptOutput?: boolean
  },
): Promise<UpsOutcome> {
  const appState = context.getAppState()
  let suppressOriginalPrompt = false
  let sessionTitle: string | undefined
  for await (const hookResult of executeUserPromptSubmitHooks(
    text,
    appState.toolPermissionContext.mode,
    context,
    context.requestPrompt,
    options?.isCodeModeScriptOutput
      ? { isCodeModeScriptOutput: true }
      : undefined,
  )) {
    if (hookResult.message?.type === 'progress') {
      continue
    }
    if (hookResult.sessionTitle) {
      sessionTitle = hookResult.sessionTitle
    }
    if (hookResult.suppressOriginalPrompt) {
      suppressOriginalPrompt = true
    }
    if (hookResult.blockingError) {
      const blockingMessage = options?.isCloudMidTurn
        ? formatCloudUserPromptSubmitBlockError(
            hookResult.blockingError.blockingError,
          )
        : getUserPromptSubmitHookBlockingMessage(hookResult.blockingError)
      const blockText = suppressOriginalPrompt
        ? blockingMessage
        : `${blockingMessage}\n\nOriginal prompt: ${text}`
      return {
        kind: 'blocking',
        messages: [createSystemMessage(blockText, 'warning', undefined, true)],
        allowedTools: result.allowedTools,
      }
    }
    if (hookResult.preventContinuation) {
      // densable yUn: X(f) meta user + q(f) warning system (P preventContinuation).
      const message = hookResult.stopReason
        ? `Operation stopped by hook: ${hookResult.stopReason}`
        : 'Operation stopped by hook'
      result.messages.push(
        createUserMessage({
          content: message,
          isMeta: true,
        }),
        createSystemMessage(message, 'warning', undefined, true),
      )
      result.shouldQuery = false
      result.resultText = message
      result.allowedTools = undefined
      return { kind: 'stop', sessionTitle }
    }
    if (
      hookResult.additionalContexts &&
      hookResult.additionalContexts.length > 0
    ) {
      result.messages.push(
        createAttachmentMessage({
          type: 'hook_additional_context',
          content: hookResult.additionalContexts,
          hookName: 'UserPromptSubmit',
          toolUseID: `hook-${randomUUID()}`,
          hookEvent: 'UserPromptSubmit',
        }),
      )
    }
    if (hookResult.message) {
      const attachment = hookResult.message.attachment!
      if (attachment.type !== 'hook_success' || attachment.content) {
        result.messages.push(hookResult.message as AttachmentMessage)
      }
    }
  }
  return { kind: 'ok', sessionTitle }
}

function endedMessages(text: string): SubmitResult {
  return {
    messages: [createSystemMessage(text, 'warning', undefined, true)],
    shouldQuery: false,
    resultText: text,
  }
}

/**
 * densable `Jun` — rewrite a user-message content payload to `next`.
 * Empty next drops text blocks; string content is replaced; last text block
 * is updated, keeping prior text blocks when `next` still carries their prefix.
 */
export function rewritePromptSubmitContent(
  content: string | ContentBlockParam[],
  next: string,
): string | ContentBlockParam[] {
  if (next.trim() === '') {
    if (typeof content === 'string') return ''
    const kept = content.filter(block => block.type !== 'text')
    return kept.length > 0 ? kept : ''
  }
  if (typeof content === 'string') return next
  const lastText = content.findLast(block => block.type === 'text')
  if (lastText?.type !== 'text') {
    return [...content, { type: 'text', text: next }]
  }
  const prefix = content
    .flatMap(block =>
      block.type === 'text' && block !== lastText ? [block.text] : [],
    )
    .join('\n')
  const stripPrefix =
    prefix !== '' &&
    next.startsWith(`${prefix}\n`) &&
    next.slice(prefix.length + 1).trim() !== ''
  const rewritten: ContentBlockParam[] = []
  for (const block of content) {
    if (block === lastText) {
      rewritten.push({
        ...block,
        text: stripPrefix ? next.slice(prefix.length + 1) : next,
      })
    } else if (block.type !== 'text' || stripPrefix) {
      rewritten.push(block)
    }
  }
  return rewritten
}

/**
 * densable `mn` — mutate the first non-meta user message that still carries
 * `original`. Warns when a hook rewrote the prompt but no message matched.
 */
export function rewritePromptSubmitUserMessage(
  messages: SubmitMessages,
  original: string,
  next: string,
): UserMessage | undefined {
  for (const message of messages) {
    if (message.type !== 'user' || message.isMeta) continue
    const { content } = message.message
    if (content === original) {
      message.message.content = rewritePromptSubmitContent(content, next)
      return message
    }
    if (Array.isArray(content)) {
      const blocks = content as ContentBlockParam[]
      const lastText = blocks.findLast(
        (b): b is Extract<ContentBlockParam, { type: 'text' }> =>
          b.type === 'text',
      )
      const hasNonText = blocks.some(b => b.type !== 'text')
      if (
        getContentText(blocks) === original ||
        lastText?.text === original ||
        (original === '' && hasNonText && lastText === undefined)
      ) {
        message.message.content = rewritePromptSubmitContent(blocks, next)
        return message
      }
    }
  }
  logForDebugging(
    'prompt.submit: a hook rewrote the prompt but no user message carried the original text; the model sees the prompt as typed',
    { level: 'warn' },
  )
  return undefined
}

/**
 * densable `Fnn` — packed prompt.submit context as a hook_additional_context
 * attachment. Default hookName is UserPromptSubmit; Art packs as "prompt.submit".
 */
export function createPromptSubmitContextAttachment(
  content: string[],
  hookName = 'UserPromptSubmit',
): AttachmentMessage {
  return createAttachmentMessage({
    type: 'hook_additional_context',
    content: [...content],
    hookName,
    toolUseID: `hook-${randomUUID()}`,
    hookEvent: 'UserPromptSubmit',
  })
}

/** densable `kcn` then `Fnn(Me, "prompt.submit")`. */
export async function packPromptSubmitContext(
  context: string[] | undefined,
): Promise<AttachmentMessage | undefined> {
  const packed = await packToolCallContext(context ?? [], 'prompt.submit')
  if (packed.length === 0) return undefined
  return createPromptSubmitContextAttachment(packed, 'prompt.submit')
}

type PromptSubmitAttachment = {
  type: 'image' | 'document'
  mediaType?: string
  filename?: string
  unreadable?: string
}

/**
 * densable `oe` — prompt.submit payload attachments from content blocks and
 * pasted image slots.
 */
export function collectPromptSubmitAttachments(
  input: string | unknown,
  pastedContents?: Record<number, PastedContent>,
): PromptSubmitAttachment[] {
  const attachments: PromptSubmitAttachment[] = []
  if (Array.isArray(input)) {
    for (const block of input) {
      if (block === null || typeof block !== 'object' || !('type' in block)) {
        continue
      }
      const typed = block as ContentBlockParam
      if (typed.type === 'image') {
        const source =
          typed.source !== null && typeof typed.source === 'object'
            ? typed.source
            : undefined
        const mediaType =
          source &&
          'type' in source &&
          source.type === 'base64' &&
          'media_type' in source &&
          typeof source.media_type === 'string'
            ? source.media_type
            : undefined
        attachments.push({
          type: 'image',
          ...(mediaType !== undefined && { mediaType }),
        })
      } else if (typed.type === 'document') {
        attachments.push({ type: 'document' })
      }
    }
  }
  for (const pasted of Object.values(pastedContents ?? {})) {
    if (pasted.type === 'image') {
      const isEmpty = !pasted.content
      attachments.push({
        type: pasted.type,
        ...(pasted.mediaType !== undefined && { mediaType: pasted.mediaType }),
        ...(pasted.filename !== undefined && { filename: pasted.filename }),
        ...(isEmpty && { unreadable: 'the pasted image is empty' }),
      })
    }
  }
  return attachments
}

const KNOWN_PROMPT_ORIGIN_KINDS = new Set([
  'human',
  'plugin',
  'channel',
  'peer',
  'coordinator',
  'observer',
  'observer-activity',
  'task-notification',
  'auto-continuation',
  'scheduled-trigger',
  'slack-ping',
  'bridge',
  'sdk',
  'unclassified',
])

/**
 * densable `iOo` — prompt.submit payload origin from queued origin /
 * wakeup / mode / promptSource (via `YQ` / `uiRenderUserMessageOrigin`).
 */
export function resolvePromptSubmitPayloadOrigin(opts: {
  origin?: unknown
  bridgeOrigin?: boolean
  wakeupSource?: unknown
  mode?: PromptInputMode
  promptSource?: unknown
}): Record<string, unknown> | undefined {
  if (opts.origin !== undefined) {
    if (opts.origin && typeof opts.origin === 'object') {
      const rec = opts.origin as { kind?: unknown }
      if (
        typeof rec.kind === 'string' &&
        KNOWN_PROMPT_ORIGIN_KINDS.has(rec.kind)
      ) {
        if (opts.bridgeOrigin === true && rec.kind === 'human') {
          return { kind: 'bridge' }
        }
        return uiRenderUserMessageOrigin(opts.origin)
      }
    }
    return undefined
  }
  if (opts.mode === 'task-notification') {
    return { kind: 'task-notification' }
  }
  if (opts.wakeupSource) {
    return { kind: 'scheduled-trigger' }
  }
  switch (opts.promptSource) {
    case 'sdk':
      return { kind: 'sdk' }
    default:
      return { kind: 'unclassified' }
  }
}

/** densable `oe` — plugin prompt.submit event payload. */
export function buildPromptSubmitPayload(opts: {
  text: string
  input?: string | unknown
  pastedContents?: Record<number, PastedContent>
  origin?: unknown
  bridgeOrigin?: boolean
  wakeupSource?: unknown
  mode?: PromptInputMode
  promptSource?: unknown
  turnId?: string
  shouldWait?: boolean
}): Record<string, unknown> {
  const attachments = collectPromptSubmitAttachments(
    opts.input ?? opts.text,
    opts.pastedContents,
  )
  const origin = resolvePromptSubmitPayloadOrigin(opts)
  return {
    text: opts.text,
    wait: opts.shouldWait === true,
    ...(attachments.length > 0 && { attachments }),
    ...(origin !== undefined && { origin }),
    ...(opts.turnId !== undefined && { turnId: opts.turnId }),
  }
}

/** densable Unn `Ce` return — Enter `wn` / plugin `enter` argument. */
export type PromptSubmitEnterValue =
  | {
      proceeds: {
        text: string
        sessionTitle?: string
        context?: string[]
      }
      wasCancelled?: boolean
    }
  | {
      ended: SubmitResult
      stopped?: string
      text?: string
      context?: string[]
      wasCancelled?: boolean
    }
  | {
      wasCancelled: true
    }

export type PromptSubmitOutcome =
  | {
      kind: 'proceed'
      stamp: PromptSubmittedStamp
      value: PromptSubmitEnterValue
    }
  | { kind: 'return'; result: SubmitResult; value: PromptSubmitEnterValue }

type QueuedSettle = ReturnType<typeof wrapQueuedSettle>

/**
 * densable `re(e,o)` — call `enter` only when plugin `prompt.submit` exists.
 */
function callPromptSubmitEnter(
  enter: ((value: PromptSubmitEnterValue) => unknown) | undefined,
  value: PromptSubmitEnterValue,
): Promise<unknown> {
  if (!enter || !hasMatchingFunctionHook('prompt.submit')) {
    return Promise.resolve()
  }
  return Promise.resolve(enter(value))
}

/**
 * densable `Unn` — jq wait, CLt/vLt race, plugin `prompt.submit` then UPS.
 */
export async function runPromptSubmit({
  text,
  originalInput,
  result,
  context,
  isStartInput,
  shouldWait,
  promptSource,
  wakeupSource,
  entries,
  queued,
  enter,
  pastedContents,
  origin,
  bridgeOrigin,
  mode,
  turnId,
}: {
  text: string
  originalInput: string | unknown
  result: SubmitResult
  context: ToolUseContext
  isStartInput: boolean
  shouldWait?: boolean
  promptSource?: unknown
  wakeupSource?: unknown
  entries?: PromptSubmitEntries
  queued?: QueuedSettle
  enter?: (value: PromptSubmitEnterValue) => unknown
  pastedContents?: Record<number, PastedContent>
  origin?: unknown
  bridgeOrigin?: boolean
  mode?: PromptInputMode
  turnId?: string
}): Promise<PromptSubmitOutcome> {
  if (!isStartInput) {
    const latch = getPromptSubmitLatch()
    if (latch) await latch
  }

  const signal = context.abortController.signal
  const screen = snapshotPromptScreen(context)
  const hasScreener =
    screen.hooks !== '' ||
    screen.plugins !== '' ||
    hasMatchingFunctionHook('prompt.submit')
  if (hasScreener && signal.aborted) {
    queued?.settle({ drop: PROMPT_CHECK_INTERRUPTED })
    return {
      kind: 'return',
      result: { messages: [], shouldQuery: false },
      value: { wasCancelled: true },
    }
  }
  const arrivedLatch = createArrivedLatch(NOT_SUBMITTED)
  const cloneResult = (base: SubmitResult): SubmitResult => ({
    ...base,
    messages: [...base.messages],
    allowedTools: base.allowedTools && [...base.allowedTools],
  })
  const passes = new Map<
    string,
    { scratch: SubmitResult; outcome: UpsOutcome }
  >()
  let lastPass: { scratch: SubmitResult; outcome: UpsOutcome } | undefined
  let ranUps = false
  const enterFn =
    enter ??
    (entries
      ? () => registerPromptSubmitEntry(entries, result.messages)
      : undefined)

  const commitScratch = (scratch: SubmitResult): void => {
    result.messages = scratch.messages
    result.allowedTools = scratch.allowedTools
    result.shouldQuery = scratch.shouldQuery
    result.resultText = scratch.resultText
  }

  const isCloudMidTurn =
    Boolean(bridgeOrigin) ||
    (typeof origin === 'object' &&
      origin !== null &&
      'kind' in origin &&
      ((origin as { kind?: unknown }).kind === 'bridge' ||
        (origin as { kind?: unknown }).kind === 'cloud'))
  const isCodeModeScriptOutput =
    typeof origin === 'object' &&
    origin !== null &&
    'kind' in origin &&
    (origin as { kind?: unknown }).kind === 'code-mode-script-output'

  const tail = async (event: Record<string, unknown>) => {
    const nextText = typeof event.text === 'string' ? event.text : text
    const scratch = cloneResult(result)
    const upsOutcome = await runUserPromptSubmit(
      nextText,
      scratch,
      context,
      originalInput,
      { isCloudMidTurn, isCodeModeScriptOutput },
    )
    const pass = { scratch, outcome: upsOutcome }
    passes.set(nextText, pass)
    lastPass = pass
    ranUps = true
    if (upsOutcome.kind !== 'ok') {
      return { drop: upsOutcome.kind }
    }
    const eventContext = listOfContextTexts(event.context)
    return arrivedLatch.perform({
      text: nextText,
      ...(eventContext !== undefined && { context: eventContext }),
    })
  }

  const payload = buildPromptSubmitPayload({
    text,
    input: originalInput,
    pastedContents,
    origin,
    bridgeOrigin,
    wakeupSource,
    mode,
    promptSource,
    turnId,
    shouldWait,
  })

  const answered = runFunctionHookChain('prompt.submit', payload, tail)
  const raced = await raceArrived(arrivedLatch, answered, signal)

  if (raced === undefined) {
    if (lastPass?.outcome.kind === 'blocking') {
      commitScratch(lastPass.scratch)
      const ended = {
        messages: lastPass.outcome.messages,
        shouldQuery: false,
        allowedTools: lastPass.outcome.allowedTools,
      }
      logForDebugging(
        'prompt.submit: interrupted while a hook checked the prompt: the block given beneath it stands',
      )
      queued?.settle({ drop: 'blocking' })
      return {
        kind: 'return',
        result: ended,
        value: { ended, text, wasCancelled: true },
      }
    }
    logForDebugging(
      'prompt.submit: interrupted while a hook checked the prompt: no verdict',
    )
    queued?.settle({ drop: PROMPT_CHECK_INTERRUPTED })
    return {
      kind: 'return',
      result: { messages: [], shouldQuery: false },
      value: { wasCancelled: true },
    }
  }

  if ('arrived' in raced) {
    const arrived = raced.arrived
    if (arrived.text !== text) {
      logForDebugging(
        `prompt.submit: text rewritten by a hook (${text.length} -> ${arrived.text.length} chars)`,
      )
    }
    const committed = passes.get(arrived.text) ?? lastPass
    if (committed) {
      commitScratch(committed.scratch)
    }
    const committedUps = committed?.outcome
    const framedText = framePluginPromptSubmitText(arrived.text, origin)
    let value: PromptSubmitEnterValue
    if (!ranUps) {
      value = { ended: endedMessages(HOOKS_DID_NOT_RUN) }
    } else if (committedUps && committedUps.kind === 'blocking') {
      value = {
        ended: {
          messages: committedUps.messages,
          shouldQuery: false,
          allowedTools: committedUps.allowedTools,
        },
        text: arrived.text,
      }
    } else if (committedUps && committedUps.kind === 'stop') {
      value = {
        ended: result,
        stopped: result.resultText,
        text: arrived.text,
      }
    } else {
      value = {
        proceeds: {
          text: framedText,
          context: arrived.context,
          sessionTitle:
            committedUps?.kind === 'ok' ? committedUps.sessionTitle : undefined,
        },
      }
    }
    const enterP = callPromptSubmitEnter(enterFn, value)
    queued?.settleWhen(enterP.then(() => arrived))
    void enterP.then(
      () => arrivedLatch.done(arrived),
      err => arrivedLatch.failed(err),
    )
    if ('ended' in value) {
      return { kind: 'return', result: value.ended, value }
    }
    const stamp: PromptSubmittedStamp = {
      text: framedText,
      under: screen,
      context: arrived.context,
      sessionTitle:
        committedUps?.kind === 'ok' ? committedUps.sessionTitle : undefined,
    }
    return { kind: 'proceed', stamp, value }
  }

  const answeredValue = raced.answered as { drop?: unknown } | undefined
  const drop =
    answeredValue &&
    typeof answeredValue === 'object' &&
    answeredValue.drop !== undefined
      ? answeredValue.drop
      : NOT_SUBMITTED
  logForDebugging(`prompt.submit: dropped (${String(drop)})`)
  queued?.settle({ drop })
  if (lastPass?.outcome.kind === 'blocking') {
    const ended = {
      messages: lastPass.outcome.messages,
      shouldQuery: false,
      allowedTools: lastPass.outcome.allowedTools,
    }
    return {
      kind: 'return',
      result: ended,
      value: { ended, text },
    }
  }
  if (lastPass?.outcome.kind === 'stop') {
    commitScratch(lastPass.scratch)
    return {
      kind: 'return',
      result,
      value: { ended: result, stopped: result.resultText, text },
    }
  }
  const message =
    drop === 'blocking' || drop === 'stop'
      ? NOT_SUBMITTED
      : typeof drop === 'string' && drop !== NOT_SUBMITTED
        ? `Prompt dropped by a hook: ${drop}`
        : `Prompt not submitted: ${NOT_SUBMITTED}`
  const ended = endedMessages(message)
  return { kind: 'return', result: ended, value: { ended } }
}
