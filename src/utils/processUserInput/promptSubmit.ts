/**
 * densable 2.1.289 `Unn` / `yUn` / `CLt` / `vLt` / `Ios` / `RNe`.
 *
 * Plugin `prompt.submit` races managed UserPromptSubmit. Never export densable
 * ids. Do not invent a second hook engine — tail is the existing UPS loop.
 */
import { randomUUID } from 'crypto'
import { getSessionId } from '../../bootstrap/state.js'
import type { ToolUseContext } from '../../Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  ProgressMessage,
  SystemMessage,
  UserMessage,
} from '../../types/message.js'
import { createAttachmentMessage } from '../attachments.js'
import { logForDebugging } from '../debug.js'
import {
  executeUserPromptSubmitHooks,
  getUserPromptSubmitHookBlockingMessage,
  hasHookForEvent,
} from '../hooks.js'
import { createSystemMessage, createUserMessage } from '../messages.js'
import {
  hasMatchingFunctionHook,
  runFunctionHookChain,
} from '../plugins/functionHooksModules.js'
import { applyHookSessionTitle } from '../sessionStart.js'
import type { QueuedCommand } from '../../types/textInputTypes.js'
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

export async function raceArrived<T>(
  latch: ReturnType<typeof createArrivedLatch>,
  answered: Promise<T>,
): Promise<{ arrived: ArrivedValue } | { answered: T }> {
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
  ])
  if (latch.hasArrived()) return { arrived: await latch.arrived }
  latch[Symbol.dispose]()
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

/** densable `RNe`. */
export function snapshotPromptScreen(context: ToolUseContext): PromptScreen {
  const appState = context.getAppState()
  const sessionId = context.agentId ?? getSessionId()
  return {
    permissionMode: appState.toolPermissionContext.mode,
    hooks: hasHookForEvent('UserPromptSubmit', appState, sessionId)
      ? 'UserPromptSubmit'
      : '',
    plugins: hasMatchingFunctionHook('prompt.submit') ? 'prompt.submit' : '',
    hooksSkippedByTrust: false,
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
  | { kind: 'ok' }
  | { kind: 'blocking'; messages: SubmitMessages; allowedTools?: string[] }
  | { kind: 'stop' }

/**
 * densable `yUn` — settings UserPromptSubmit over `result`.
 */
export async function runUserPromptSubmit(
  text: string,
  result: SubmitResult,
  context: ToolUseContext,
  originalInput: string | unknown,
): Promise<UpsOutcome> {
  const appState = context.getAppState()
  let suppressOriginalPrompt = false
  for await (const hookResult of executeUserPromptSubmitHooks(
    text,
    appState.toolPermissionContext.mode,
    context,
    context.requestPrompt,
  )) {
    if (hookResult.message?.type === 'progress') {
      continue
    }
    if (hookResult.sessionTitle) {
      applyHookSessionTitle(hookResult.sessionTitle)
    }
    if (hookResult.suppressOriginalPrompt) {
      suppressOriginalPrompt = true
    }
    if (hookResult.blockingError) {
      const blockingMessage = getUserPromptSubmitHookBlockingMessage(
        hookResult.blockingError,
      )
      const blockText = suppressOriginalPrompt
        ? blockingMessage
        : `${blockingMessage}\n\nOriginal prompt: ${originalInput}`
      return {
        kind: 'blocking',
        messages: [createSystemMessage(blockText, 'warning')],
        allowedTools: result.allowedTools,
      }
    }
    if (hookResult.preventContinuation) {
      const message = hookResult.stopReason
        ? `Operation stopped by hook: ${hookResult.stopReason}`
        : 'Operation stopped by hook'
      result.messages.push(
        createUserMessage({
          content: message,
        }),
      )
      result.shouldQuery = false
      result.resultText = message
      return { kind: 'stop' }
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
  return { kind: 'ok' }
}

function endedMessages(text: string): SubmitResult {
  return {
    messages: [createSystemMessage(text, 'warning')],
    shouldQuery: false,
    resultText: text,
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
}): Promise<PromptSubmitOutcome> {
  if (!isStartInput) {
    const latch = getPromptSubmitLatch()
    if (latch) await latch
  }

  const arrivedLatch = createArrivedLatch(NOT_SUBMITTED)
  const screen = snapshotPromptScreen(context)
  let lastUps: UpsOutcome | undefined
  let ranUps = false
  const enterFn =
    enter ??
    (entries
      ? () => registerPromptSubmitEntry(entries, result.messages)
      : undefined)

  const tail = async (event: Record<string, unknown>) => {
    const nextText = typeof event.text === 'string' ? event.text : text
    lastUps = await runUserPromptSubmit(
      nextText,
      result,
      context,
      originalInput,
    )
    ranUps = true
    if (lastUps.kind !== 'ok') {
      return { drop: lastUps.kind }
    }
    return arrivedLatch.perform({ text: nextText })
  }

  const payload: Record<string, unknown> = {
    text,
    wait: shouldWait === true,
    origin: promptSource,
    ...(wakeupSource !== undefined && { wakeupSource }),
  }

  const answered = runFunctionHookChain('prompt.submit', payload, tail)
  const raced = await raceArrived(arrivedLatch, answered)

  if ('arrived' in raced) {
    const arrived = raced.arrived
    if (arrived.text !== text) {
      logForDebugging(
        `prompt.submit: text rewritten by a hook (${text.length} -> ${arrived.text.length} chars)`,
      )
    }
    let value: PromptSubmitEnterValue
    if (!ranUps) {
      value = { ended: endedMessages(HOOKS_DID_NOT_RUN) }
    } else if (lastUps && lastUps.kind === 'blocking') {
      value = {
        ended: {
          messages: lastUps.messages,
          shouldQuery: false,
          allowedTools: lastUps.allowedTools,
        },
        text: arrived.text,
      }
    } else if (lastUps && lastUps.kind === 'stop') {
      value = {
        ended: result,
        stopped: result.resultText,
        text: arrived.text,
      }
    } else {
      value = {
        proceeds: {
          text: arrived.text,
          context: arrived.context,
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
      text: arrived.text,
      under: screen,
      context: arrived.context,
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
  if (lastUps?.kind === 'blocking') {
    const ended = {
      messages: lastUps.messages,
      shouldQuery: false,
      allowedTools: lastUps.allowedTools,
    }
    return {
      kind: 'return',
      result: ended,
      value: { ended, text },
    }
  }
  if (lastUps?.kind === 'stop') {
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
