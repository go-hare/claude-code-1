/**
 * densable 2.1.234 #7 — sandbox network ask decision helpers.
 *
 * Gold:
 * - `wkr(mode, bypassAvailable)` → allow | deny | classify | ask
 * - `lVr(host, port, messages, tools, ctx, signal, opts)` → auto-mode classifier
 * - `Jvr` / `getOrClassify` → per-host:port verdict cache with transcript watermark
 * - `bun(messages)` → `{messageCount, lastMessageUuid}` watermark
 */
import { feature } from 'bun:bundle'
import type { Tool, ToolPermissionContext, Tools } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import type { PermissionMode } from '../../types/permissions.js'
import { isSessionBypassClass } from '../permissions/planBypass.js'
import { count } from '../array.js'
import { logForDebugging } from '../debug.js'
import { SANDBOX_NETWORK_ACCESS_TOOL_NAME } from '../../cli/structuredIO.js'
import {
  classifyYoloAction,
  formatActionForClassifier,
} from '../permissions/yoloClassifier.js'

export type SandboxNetworkAskDecision = 'allow' | 'deny' | 'classify' | 'ask'

/** densable `wkr` — plan inherits bypass only when entered from bypass. */
export function resolveSandboxNetworkAskDecision(
  mode: PermissionMode,
  _isBypassPermissionsModeAvailable: boolean,
  prePlanMode?: PermissionMode,
): SandboxNetworkAskDecision {
  if (mode === 'auto') return 'classify'
  if (isSessionBypassClass({ mode, prePlanMode })) {
    return 'allow'
  }
  if (mode === 'dontAsk') return 'deny'
  return 'ask'
}

export type SandboxNetworkClassifierResult = {
  allow: boolean
  unavailable: boolean
  transcriptTooLong: boolean
}

/** densable `bun` — watermark for Jvr reuse */
export function sandboxNetworkTranscriptWatermark(
  messages: readonly Message[],
): {
  messageCount: number
  lastMessageUuid: string | undefined
} {
  return {
    messageCount: count(messages, m => m.type !== 'progress'),
    lastMessageUuid: messages.findLast(m => m.type !== 'progress')?.uuid,
  }
}

type VerdictReuse = 'always' | 'same-transcript'

type CachedVerdict = {
  promise: Promise<boolean>
  watermark: { messageCount: number; lastMessageUuid: string | undefined }
  reuse: VerdictReuse | undefined
}

/**
 * densable `Jvr` — caches classifier allow/deny per host:port.
 * Allow / transcriptTooLong → reuse across transcript; deny → always;
 * unavailable (non-PTL) → drop so next ask retries.
 */
export class SandboxNetworkVerdictCache {
  private readonly verdicts = new Map<string, CachedVerdict>()

  getOrClassify(
    host: string,
    port: number | undefined,
    watermark: { messageCount: number; lastMessageUuid: string | undefined },
    run: () => Promise<SandboxNetworkClassifierResult>,
  ): Promise<boolean> {
    const key = `${host}:${port ?? '*'}`
    const existing = this.verdicts.get(key)
    if (
      existing &&
      (existing.reuse === 'always' ||
        (existing.watermark.messageCount === watermark.messageCount &&
          existing.watermark.lastMessageUuid === watermark.lastMessageUuid))
    ) {
      return existing.promise
    }

    const resultPromise = run()
    const entry: CachedVerdict = {
      promise: resultPromise.then(r => r.allow),
      watermark,
      reuse: undefined,
    }
    this.verdicts.set(key, entry)
    resultPromise.then(
      r => {
        if (r.unavailable && !r.transcriptTooLong) {
          if (this.verdicts.get(key) === entry) this.verdicts.delete(key)
          return
        }
        entry.reuse =
          r.allow || r.transcriptTooLong ? 'same-transcript' : 'always'
      },
      () => {
        if (this.verdicts.get(key) === entry) this.verdicts.delete(key)
      },
    )
    return entry.promise
  }

  clear(): void {
    this.verdicts.clear()
  }
}

/**
 * densable `lVr` — classify SandboxNetworkAccess via auto-mode classifier.
 * Fail-closed when unavailable; warn on block.
 */
/**
 * densable `W4g` — wrap an ask callback with wkr allow/deny/classify.
 * Used by print/SDK so auto/bypass/dontAsk don't always hit the host UI.
 */
export function wrapSandboxAskCallbackWithPermissionMode(params: {
  ask: (hostPattern: { host: string; port?: number }) => Promise<boolean>
  getPermissionContext: () => ToolPermissionContext
  getMessages: () => Message[]
  getTools: () => Tools
}): (hostPattern: { host: string; port?: number }) => Promise<boolean> {
  const cache = new SandboxNetworkVerdictCache()
  let lastContext: ToolPermissionContext | undefined
  return async hostPattern => {
    const ctx = params.getPermissionContext()
    if (lastContext !== ctx) {
      cache.clear()
      lastContext = ctx
    }
    switch (
      resolveSandboxNetworkAskDecision(
        ctx.mode,
        ctx.isBypassPermissionsModeAvailable,
        ctx.prePlanMode,
      )
    ) {
      case 'allow':
        return true
      case 'deny':
        return false
      case 'classify': {
        const messages = params.getMessages()
        return cache.getOrClassify(
          hostPattern.host,
          hostPattern.port,
          sandboxNetworkTranscriptWatermark(messages),
          () =>
            classifySandboxNetworkAccess(
              hostPattern.host,
              hostPattern.port,
              messages,
              params.getTools(),
              ctx,
              new AbortController().signal,
            ),
        )
      }
      case 'ask':
        return params.ask(hostPattern)
    }
  }
}

export async function classifySandboxNetworkAccess(
  host: string,
  port: number | undefined,
  messages: Message[],
  tools: Tools,
  context: ToolPermissionContext,
  signal: AbortSignal,
): Promise<SandboxNetworkClassifierResult> {
  if (!feature('TRANSCRIPT_CLASSIFIER')) {
    // Without classifier feature, densable still has wkr→classify only when
    // auto mode is product-available; treat as unavailable fail-closed.
    logForDebugging(
      `Sandbox network classifier unavailable for ${host}; failing closed (deny)`,
      { level: 'warn' },
    )
    return { allow: false, unavailable: true, transcriptTooLong: false }
  }

  const input: { host: string; port?: number } = { host }
  if (port !== undefined) input.port = port

  // densable: synthetic tool `{name:fgt,toAutoClassifierInput:(f)=>f}` appended
  // so SandboxNetworkAccess encodes even when not in the live tool registry.
  const syntheticTool = {
    name: SANDBOX_NETWORK_ACCESS_TOOL_NAME,
    toAutoClassifierInput: (value: unknown) => value,
  } as Tool
  const action = formatActionForClassifier(
    SANDBOX_NETWORK_ACCESS_TOOL_NAME,
    input,
  )
  const result = await classifyYoloAction(
    messages,
    action,
    [...tools, syntheticTool],
    context,
    signal,
  )
  const unavailable = result.unavailable ?? false
  const transcriptTooLong = result.transcriptTooLong ?? false
  const allow = unavailable ? false : !result.shouldBlock
  if (unavailable) {
    logForDebugging(
      `Sandbox network classifier unavailable for ${host}; failing closed (deny)`,
      { level: 'warn' },
    )
  }
  if (!allow) {
    logForDebugging(
      `Auto mode classifier blocked sandbox network access to ${host}: ${result.reason}`,
      { level: 'warn' },
    )
  }
  return { allow, unavailable, transcriptTooLong }
}
