/**
 * Function hooks submodule: constants
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import { HOOK_EVENTS } from '../../../entrypoints/sdk/coreSchemas.js'
import { densableThinkingForceParams } from '../../thinking.js'
import type {
  AbortLike,
  AskedPaneRef,
  ClientFaultFold,
  FunctionHookBudget,
  HookOriginEntry,
  HookTraceEntry,
  HookTraceNode,
  HookedMergeState,
  LoadedFunctionHooksModule,
  ModelPromptBlock,
  PanesState,
  PluginPaneEntry,
  PromptChangeOrigin,
  StepBudgetTracker,
  UiNotifyChannelResult,
  WaitTimeoutOpts,
} from './types.js'

/** densable `u2e` — default origin when the engine raises an event. */
export const ENGINE_HOOK_ORIGIN = Object.freeze({
  plugin: 'engine',
  tier: 'core',
} as const)

/** densable `ut` — `.catch` grace budget on `next.error.budget`. */
export const HOOK_CATCH_GRACE_MS = 1000

export const EMPTY_HOOK_TRACE: readonly HookTraceEntry[] = Object.freeze([])

export function collectHookTrace(
  head: HookTraceNode | undefined,
): readonly HookTraceEntry[] {
  const out: HookTraceEntry[] = []
  for (let cur = head; cur !== undefined; cur = cur.beneath) {
    if (cur.entry !== undefined) out.push(cur.entry)
  }
  return out.length === 0 ? EMPTY_HOOK_TRACE : Object.freeze(out)
}

export function leftOutRegistrationsForModule(
  origin: readonly HookOriginEntry[] | undefined,
  pluginName: string,
): 'every' | number[] {
  if (origin === undefined || origin.length === 0) return []
  const regs = new Set<number>()
  for (const frame of origin) {
    const framePlugin = typeof frame === 'string' ? frame : frame.plugin
    if (framePlugin !== pluginName) continue
    if (typeof frame === 'string') return 'every'
    regs.add(frame.registration)
  }
  return [...regs].sort((a, b) => a - b)
}

export const MAX_HOOK_VALUE_DEPTH = 100_000

export const MAX_HOOK_VM_DEPTH = 28_000

export const HOOK_DEPTH_LIMIT_MESSAGE =
  'nesting deeper than 100000 levels is not supported'

export const HOOK_VM_DEPTH_LIMIT_MESSAGE =
  'nesting deeper than 28000 levels is not supported'

/**
 * #622/#623/#639: Iterative boundary sanitizer matching SEA `SBo` / `Zgn` / `l()`:
 * - Explicit work-stack traversal up to `MAX_HOOK_VALUE_DEPTH` (no stack overflow)
 * - Refuses `__proto__` own property (`protoKey: 'left-out'`) instead of silently stripping
 * - Per-key `RangeError` getter refusal: omits only the throwing key, keeps the rest
 */
export function sanitizeHookBoundaryValue<T>(
  value: T,
  maxDepth: number = MAX_HOOK_VALUE_DEPTH,
): { value: T; refusedKeys: string[] } {
  if (typeof value !== 'object' || value === null) {
    return { value, refusedKeys: [] }
  }
  const refusedKeys: string[] = []
  const seen = new WeakMap<object, unknown>()
  const cloneContainer = (src: object): object =>
    Array.isArray(src) ? [] : Object.create(null)

  const rootOut = cloneContainer(value)
  seen.set(value, rootOut)
  type Frame = { src: object; dst: object; depth: number }
  const stack: Frame[] = [{ src: value, dst: rootOut, depth: 1 }]

  while (stack.length > 0) {
    const { src, dst, depth } = stack.pop()!
    if (depth > maxDepth) {
      throw new RangeError(
        maxDepth === MAX_HOOK_VM_DEPTH
          ? HOOK_VM_DEPTH_LIMIT_MESSAGE
          : HOOK_DEPTH_LIMIT_MESSAGE,
      )
    }
    if (Array.isArray(src)) {
      const arrDst = dst as unknown[]
      for (let i = 0; i < src.length; i++) {
        let item: unknown
        try {
          item = src[i]
        } catch (err) {
          if (err instanceof RangeError) {
            refusedKeys.push(String(i))
            arrDst[i] = undefined
            continue
          }
          throw err
        }
        if (typeof item === 'object' && item !== null) {
          const proto = Object.getPrototypeOf(item)
          if (
            Array.isArray(item) ||
            proto === Object.prototype ||
            proto === null
          ) {
            const existing = seen.get(item)
            if (existing !== undefined) {
              arrDst[i] = existing
            } else {
              const childDst = cloneContainer(item)
              seen.set(item, childDst)
              arrDst[i] = childDst
              stack.push({ src: item, dst: childDst, depth: depth + 1 })
            }
            continue
          }
        }
        arrDst[i] = item
      }
      continue
    }

    if (Object.hasOwn(src, '__proto__')) {
      throw new Error('object contains disallowed __proto__ key')
    }
    const objDst = dst as Record<string, unknown>
    for (const key of Object.keys(src)) {
      if (key === '__proto__') {
        throw new Error('object contains disallowed __proto__ key')
      }
      let propVal: unknown
      try {
        propVal = (src as Record<string, unknown>)[key]
      } catch (err) {
        if (err instanceof RangeError) {
          refusedKeys.push(key)
          continue
        }
        throw err
      }
      if (typeof propVal === 'object' && propVal !== null) {
        const proto = Object.getPrototypeOf(propVal)
        if (
          Array.isArray(propVal) ||
          proto === Object.prototype ||
          proto === null
        ) {
          const existing = seen.get(propVal)
          if (existing !== undefined) {
            objDst[key] = existing
          } else {
            const childDst = cloneContainer(propVal)
            seen.set(propVal, childDst)
            objDst[key] = childDst
            stack.push({ src: propVal, dst: childDst, depth: depth + 1 })
          }
          continue
        }
      }
      objDst[key] = propVal
    }
  }
  return { value: rootOut as T, refusedKeys }
}

/**
 * Iterative depth check (`T7s` / `X5e` in SEA #381) so deeply nested tool
 * inputs never silently truncate or blow the JS stack.
 */
export function assertHookValueDepth(
  value: unknown,
  maxDepth: number = MAX_HOOK_VALUE_DEPTH,
): void {
  if (typeof value !== 'object' || value === null) return
  const seen = new WeakSet<object>()
  const stack: Array<{ val: object; depth: number }> = [
    { val: value, depth: 1 },
  ]
  while (stack.length > 0) {
    const { val, depth } = stack.pop()!
    if (depth > maxDepth) {
      throw new RangeError(
        maxDepth === MAX_HOOK_VM_DEPTH
          ? HOOK_VM_DEPTH_LIMIT_MESSAGE
          : HOOK_DEPTH_LIMIT_MESSAGE,
      )
    }
    if (seen.has(val)) continue
    seen.add(val)
    if (Array.isArray(val)) {
      for (let i = val.length - 1; i >= 0; i--) {
        const item = val[i]
        if (typeof item === 'object' && item !== null) {
          stack.push({ val: item, depth: depth + 1 })
        }
      }
    } else {
      const proto = Object.getPrototypeOf(val)
      if (proto === Object.prototype || proto === null) {
        for (const k of Object.keys(val)) {
          const child = (val as Record<string, unknown>)[k]
          if (typeof child === 'object' && child !== null) {
            stack.push({ val: child, depth: depth + 1 })
          }
        }
      }
    }
  }
}

/**
 * densable `bY`. `*` matches every event, `<prefix>.*` matches that
 * prefix, `!` negates. A literal name matches only itself.
 */
export function functionHookPatternMatches(
  pattern: string,
  event: string,
): boolean {
  const negated = pattern.startsWith('!')
  const body = negated ? pattern.slice(1) : pattern
  let hit = false
  if (body === '*') hit = true
  else if (body.endsWith('.*')) hit = event.startsWith(`${body.slice(0, -1)}`)
  else hit = event === body
  return negated ? !hit : hit
}

export function isBuiltinTierMod(
  mod: Pick<LoadedFunctionHooksModule, 'tier'>,
): boolean {
  return mod.tier === 'builtin' || mod.tier === 'prepend' || mod.tier === 'core'
}

export const PROMPT_CHANGE_STALL_CAP = 8

export const PROMPT_CHANGE_CLEAR_ORIGIN: PromptChangeOrigin = Object.freeze({
  kind: 'clear',
})

export const PROMPT_CHANGE_ENGINE_ORIGIN: PromptChangeOrigin = Object.freeze({
  kind: 'engine',
})

/** densable `Twe` — hook budget before `hasOverrun`. */
export const HOOK_BUDGET_MS = 5000

/** densable `Rwe` — default per-hook budget (`next.budget.ms`). */
const HOOK_DEFAULT_STEP_BUDGET_MS = 10_000

/** densable `ki` — `prompt.edit` step budget. */
const HOOK_PROMPT_EDIT_BUDGET_MS = 50

export function budgetMsForHookEvent(event: string): number {
  if (event === 'prompt.edit') return HOOK_PROMPT_EDIT_BUDGET_MS
  return HOOK_DEFAULT_STEP_BUDGET_MS
}

export function createStepBudgetTracker(
  budgetMs: number,
  deadline: number,
): StepBudgetTracker {
  let pausedMs = 0
  let activePauses = 0
  let pauseStartedAt = 0
  const remaining = (): number => {
    const currentPause = activePauses > 0 ? Date.now() - pauseStartedAt : 0
    return Math.max(0, deadline + pausedMs + currentPause - Date.now())
  }
  return {
    pause: () => {
      if (activePauses === 0) pauseStartedAt = Date.now()
      activePauses += 1
    },
    resume: () => {
      if (activePauses === 0) return
      activePauses -= 1
      if (activePauses === 0) {
        pausedMs += Math.max(0, Date.now() - pauseStartedAt)
      }
    },
    budget: () =>
      Object.freeze({
        ms: budgetMs,
        get remainingMs(): number {
          return remaining()
        },
      }),
  }
}

export function makeStepBudget(
  budgetMs: number,
  deadline: number,
  tracker?: StepBudgetTracker,
): FunctionHookBudget {
  if (tracker) return tracker.budget()
  return Object.freeze({
    ms: budgetMs,
    get remainingMs(): number {
      return Math.max(0, deadline - Date.now())
    },
  })
}

/**
 * densable `Xae` — first unique skip English per gold `LLe` key
 * (`${plugin}#${environmentId ?? ''} ${event} ${kind}`).
 */

/**
 * densable `NLe` — persist skip English once per
 * `${plugin} ${event} ${hook|hook skipped}` (not per environmentId).
 */

/** densable `Aa` unapplied rewrite effect. */
export const UNAPPLIED_REWRITE_EFFECT = 'the rest of its rewrite went on'

export function prefixPluginReason(plugin: string, reason: string): string {
  return reason.startsWith(`${plugin}: `) ? reason : `${plugin}: ${reason}`
}

/**
 * densable `F0` / `r1` for one classic event.
 *
 * Matching function hooks run outside the settings hooks. `next` is the
 * rest of that chain, and the tail is the settings executor. `$` is
 * `{ plugin: { name, root } }`. A matcher object must equal the same
 * fields on the event. A hook that throws fails the chain.
 *
 * densable `u8e` `{only}`: when set, only that plugin's hooks run
 * (`N1t` `qP("ui.message", void 0, {only:e})` / `dO` `{only:r}`).
 */
export const MAX_PASSED_BY_SESSIONS = 16

export const MAX_PASSED_BY_ENTRIES_PER_SESSION = 256

export function emptyClientFaultFold(): ClientFaultFold {
  return {
    stale: new Set(),
    lastAt: Number.NEGATIVE_INFINITY,
    pending: undefined,
  }
}

export const UI_ASK_MAX_OPTIONS = 4

export const UI_ASK_HEADER_WIDTH = 12

export const UI_ASK_MIN_OPTIONS = 2

export const UI_ASK_DEFAULTS = ['Yes', 'No']

export const UI_ASK_NO_ANSWER_CAP = 120

const MODEL_COMPLETE_DEFAULT_MAX_TOKENS = 1024

/**
 * Official 2.1.327 (#406): Detect usage-limit / rate-limit API errors so
 * mod `$.model.complete` and `$.model.classify` calls surface the API error
 * immediately instead of hanging in retry backoff.
 */
export function isModModelUsageLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as {
    status?: unknown
    code?: unknown
    apiError?: unknown
    message?: unknown
    error?: { type?: unknown; message?: unknown }
  }
  if (
    err.status === 429 ||
    err.status === 529 ||
    err.apiError === 'rate_limit'
  ) {
    return true
  }
  const errType =
    typeof err.error?.type === 'string' ? err.error.type.toLowerCase() : ''
  if (
    errType === 'rate_limit_error' ||
    errType === 'overloaded_error' ||
    errType === 'usage_limit_error'
  ) {
    return true
  }
  const msg =
    `${typeof err.message === 'string' ? err.message : ''} ${typeof err.error?.message === 'string' ? err.error.message : ''}`.toLowerCase()
  return (
    msg.includes('rate limit') ||
    msg.includes('usage limit') ||
    msg.includes('too many requests') ||
    msg.includes('quota exceeded')
  )
}

export const MODEL_COMPLETE_DEADLINE = 'model.complete deadline reached'

/** densable `Sg` — setTimeout / AbortSignal ceiling. */
export const MODEL_COMPLETE_TIMEOUT_CAP_MS = 2_147_483_647

/** densable `xVn` — model.complete maxTokens ceiling vs catalog upperLimit. */
export const MODEL_COMPLETE_MAX_TOKENS_CAP = 64_000

/**
 * densable BEe `Cae`/`Ee` token budget:
 *   let [ve, Ee] = Cae(ge)
 *   xe = Math.min((s ?? y9n) + Ee, _e)
 * Cae itself is `densableThinkingForceParams` (wMe/HQt twin).
 */
export function modelCompleteTokenBudget(
  model: string,
  maxTokens?: number,
  upperLimit: number = MODEL_COMPLETE_MAX_TOKENS_CAP,
): {
  thinkingOverride: boolean | undefined
  thinkingOverhead: number
  maxOutputTokens: number
} {
  const [thinkingOverride, thinkingOverhead] =
    densableThinkingForceParams(model)
  const maxOutputTokens = Math.min(
    (maxTokens ?? MODEL_COMPLETE_DEFAULT_MAX_TOKENS) + thinkingOverhead,
    upperLimit,
  )
  return { thinkingOverride, thinkingOverhead, maxOutputTokens }
}

export const EMPTY_MODEL_USAGE = Object.freeze({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
})

export const SETTINGS_READ_SOURCES = [
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
] as const

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export const PROMPT_FILL_MODES = ['replace', 'append', 'insert'] as const

export const STORE_JSON_LIMIT = 4_194_304

export const AUDIO_CLIP_BYTES = 26_214_400

export const AUDIO_GAIN_MAX = 4

export const AUDIO_PLAYS_AT_ONCE = 4

export const OSC52_WRITE_BOUND = 1_048_576

export const MODEL_FORK_MAX_TURNS = 2

/** densable ui.render `checkMatcher` — engine-alone component. */
export const ENGINE_ALONE_UI_RENDER = 'AskUserQuestion'

export const AGENT_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

export const AGENT_TOOL_NAME = 'Agent'

/** densable `Rat` — hook returned without calling next / core.perform. */
export const AGENT_SPAWN_HOOK_REFUSE =
  'agent.spawn: a hook answered without passing the spawn on'

export const AGENT_SPAWN_DESC_WORDS = 5

export const HOST_TEXT_LIMIT = 4096

export const DENY_AFTER_NEXT_EVENTS = new Set([
  'config.set',
  'state.set',
  'env.set',
  'agent.spawn',
])

export function truncateHostHookResultField(
  event: string,
  returned: unknown,
): unknown {
  if (!isEventRecord(returned)) return returned
  const field =
    event === 'prompt.submit'
      ? 'drop'
      : event === 'config.set'
        ? 'deny'
        : undefined
  if (field === undefined) return returned
  const val = returned[field]
  if (typeof val === 'string' && val.length > HOST_TEXT_LIMIT) {
    return {
      ...returned,
      [field]: `${val.slice(0, HOST_TEXT_LIMIT)}…`,
    }
  }
  return returned
}

export function isSignalAbortedNotInterrupt(
  signal: AbortSignal | undefined,
  isBackground = false,
): boolean {
  if (!signal?.aborted) return false
  if (!isBackground) return true
  const reason = signal.reason
  const kind =
    reason && typeof reason === 'object' && 'kind' in reason
      ? (reason as { kind?: unknown }).kind
      : reason
  return kind !== 'interrupt'
}

const AGENT_REGISTER_KEYS = [
  'name',
  'description',
  'prompt',
  'tools',
  'disallowedTools',
  'model',
  'effort',
  'permissionMode',
  'mcpServers',
  'hooks',
  'maxTurns',
  'skills',
  'initialPrompt',
  'memory',
  'background',
  'omitClaudeMd',
  'isolation',
] as const

/** densable kCe — tools that have their own $ door. */
export const RESERVED_HOST_TOOLS: Record<string, string> = {
  Agent: 'runs the Agent tool: that is $.agent.spawn',
  AskUserQuestion: 'runs the AskUserQuestion tool: that is $.ui.ask',
  Workflow:
    'runs the Workflow tool, whose agents run outside the at-once bound on spawns: $.agent.spawn is the door',
}

/** densable `be` — plugin store JSON under `<config>/plugins/store`. */
export const STORE_KEY_LIMIT = 256

export const STORE_NAME_MAX = 64

export const STORE_HASH = 12

export const STORE_PLUGIN_RE = /^[a-z0-9._-]+$/

export const STORE_DOS_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

/** densable `px()?.surface==="terminal"` — set when a composer is bound. */

export const SESSION_AUTHORIZE_ENDPOINT = 'https://api.anthropic.com'

export const SESSION_AUTHORIZE_PER_PLUGIN_CAP = 4

/** densable `dOt` — config.set value. */
export function configValueCheck(value: unknown): string | undefined {
  const scalar =
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    Number.isFinite(value)
  const list =
    Array.isArray(value) && value.every(item => typeof item === 'string')
  return scalar || list
    ? undefined
    : 'a value that is not a boolean, a string, a number or a list of strings'
}

/** densable `xrn` — ui.log destination. */
export function uiLogToCheck(value: unknown): string | undefined {
  return value === undefined || value === 'transcript' || value === 'debug'
    ? undefined
    : `to is "transcript" or "debug" (got ${JSON.stringify(value)})`
}

/** densable `qV` — short source names accepted by `$.settings.read({ source })`. */
const SETTINGS_READ_SOURCE_ALIASES: Readonly<
  Record<string, (typeof SETTINGS_READ_SOURCES)[number]>
> = {
  user: 'userSettings',
  project: 'projectSettings',
  local: 'localSettings',
  flag: 'flagSettings',
  policy: 'policySettings',
}

function resolveSettingsReadSource(
  source: unknown,
): (typeof SETTINGS_READ_SOURCES)[number] | undefined {
  if (typeof source !== 'string') return undefined
  if (
    SETTINGS_READ_SOURCES.includes(
      source as (typeof SETTINGS_READ_SOURCES)[number],
    )
  ) {
    return source as (typeof SETTINGS_READ_SOURCES)[number]
  }
  return Object.hasOwn(SETTINGS_READ_SOURCE_ALIASES, source)
    ? SETTINGS_READ_SOURCE_ALIASES[source]
    : undefined
}

export function settingsSourceCheck(
  source: unknown,
  op: string,
  plugin?: string,
): (typeof SETTINGS_READ_SOURCES)[number] | undefined {
  if (source === undefined) return undefined
  const resolved = resolveSettingsReadSource(source)
  if (resolved === undefined) {
    hostCheck(
      op,
      `takes { source } naming one of ${SETTINGS_READ_SOURCES.join(', ')} (got ${typeof source === 'string' ? source : typeof source})`,
      plugin,
    )
  }
  return resolved
}

/** densable `n9e` + `q(e)` — unwrap `{ value }` or throw `${plugin}: $.${op}: ${deny}`. */
export function unwrapOpHookResult(
  op: string,
  out: unknown,
  plugin?: string,
): unknown {
  const prefix = plugin !== undefined && plugin !== '' ? `${plugin}: ` : ''
  if (!isEventRecord(out)) {
    throw new Error(`${prefix}$.${op}: hook returned a non-object`)
  }
  if (out.deny !== undefined) {
    if (typeof out.deny !== 'string') {
      throw new Error(`${prefix}$.${op}: hook returned a non-string deny`)
    }
    throw new Error(`${prefix}$.${op}: ${out.deny}`)
  }
  if (!Object.hasOwn(out, 'value')) {
    throw new Error(`${prefix}$.${op}: hook returned no { value }`)
  }
  return out.value
}

export function createInitialHookedMergeState(): HookedMergeState {
  return {
    answers: null,
    computed: null,
    pass: Promise.resolve(),
    queuedFor: undefined,
    isAnnouncing: false,
    askedOf: '',
    askedAbout: null,
    visited: [],
    unsettled: new Set<string>(),
  }
}

export function pickAgentRegister(
  input: unknown,
): Record<string, unknown> | undefined {
  if (!isEventRecord(input)) return undefined
  const picked: Record<string, unknown> = {}
  for (const key of AGENT_REGISTER_KEYS) {
    const value = input[key]
    if (value === undefined) continue
    picked[key] = Array.isArray(value) ? [...value] : value
  }
  return picked
}

export function agentRegisterId(plugin: string, name: string): string {
  return `${plugin}:${name}`
}

export function hostTextCheck(value: unknown): string | undefined {
  if (typeof value !== 'string') return 'takes a string text'
  if (value.length > HOST_TEXT_LIMIT) {
    return `text over ${HOST_TEXT_LIMIT} characters`
  }
  return undefined
}

export function agentRegisterNameCheck(
  input: Record<string, unknown>,
): string | undefined {
  const name = input.name
  const description = input.description
  const badName = typeof name !== 'string' || !AGENT_NAME_RE.test(name)
  const hasDescription =
    typeof description === 'string' && description.trim() !== ''
  return (
    (badName ? 'name is letters, digits, _ or - (up to 64)' : undefined) ??
    (hasDescription ? undefined : 'needs a description')
  )
}

const SESSION_SEND_CHECK =
  'takes { to, text }: to a name, an agent id or an address (a non-empty string), { sessionId } or { agentId }; text a non-empty string'

export function sessionSendAddress(to: unknown): string | undefined {
  if (typeof to === 'string') return to
  if (!isEventRecord(to)) return undefined
  const hasSession = Object.hasOwn(to, 'sessionId')
  const hasAgent = Object.hasOwn(to, 'agentId')
  if (hasSession === hasAgent) return undefined
  const value = hasSession ? to.sessionId : to.agentId
  return typeof value === 'string' ? value : undefined
}

export function sessionSendCheck(input: unknown): string | undefined {
  if (!isEventRecord(input)) return SESSION_SEND_CHECK
  const text = input.text
  const to = sessionSendAddress(input.to)
  const textOk = typeof text === 'string' && text.trim() !== ''
  const toOk = typeof to === 'string' && to.trim() !== ''
  return textOk && toOk ? undefined : SESSION_SEND_CHECK
}

export function sessionSendPayload(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const to = input.to
  const text = input.text
  if (typeof to === 'string') return { to, text }
  if (!isEventRecord(to)) return { to, text }
  return {
    to: Object.hasOwn(to, 'sessionId')
      ? { sessionId: to.sessionId }
      : { agentId: to.agentId },
    text,
  }
}

export function sessionMessagesCheck(input: unknown): string | undefined {
  if (input === undefined) return undefined
  if (!isEventRecord(input)) return 'takes { agentId, as } or nothing'
  const extra = Object.keys(input).filter(
    key => key !== 'agentId' && key !== 'as',
  )
  if (extra.length > 0) {
    return `takes { agentId, as } or nothing (not ${extra.join(', ')})`
  }
  const agentId = input.agentId
  const as = input.as
  const agentOk =
    agentId === undefined || (typeof agentId === 'string' && agentId !== '')
  const asOk = as === undefined || as === 'api'
  if (!agentOk)
    return `takes agentId, a non-empty string (got ${String(agentId)})`
  return asOk ? undefined : `takes as "api" or none (got ${String(as)})`
}

export function sessionMessagesPayload(
  input: unknown,
): Record<string, unknown> {
  const rec = isEventRecord(input) ? input : {}
  return {
    ...(typeof rec.agentId === 'string' && { agentId: rec.agentId }),
    ...(rec.as === 'api' && { as: 'api' }),
  }
}

/**
 * densable `_t`: `$.prompt.*` takes `{ text }` as a string (trim is the
 * caller's job — submit rejects the empty prompt after this).
 */
export function _t(
  input: unknown,
  plugin: string,
  op: string,
): Promise<string> {
  const text = isEventRecord(input) ? input.text : undefined
  return typeof text === 'string'
    ? Promise.resolve(text)
    : Promise.reject(new Error(`${plugin}: $.${op} takes { text } (a string)`))
}

export function isPromptFillMode(
  value: unknown,
): value is (typeof PROMPT_FILL_MODES)[number] {
  return (
    typeof value === 'string' &&
    (PROMPT_FILL_MODES as readonly string[]).includes(value)
  )
}

/** densable `Wa` — fill payload after `_t`. */
export function promptFillPayload(
  input: unknown,
  plugin: string,
): Promise<{ text: string; mode?: string }> {
  return _t(input, plugin, 'prompt.fill').then(text => {
    const mode = isEventRecord(input) ? input.mode : undefined
    if (mode !== undefined && !isPromptFillMode(mode)) {
      return Promise.reject(
        new Error(
          `${plugin}: $.prompt.fill takes { mode } of ${PROMPT_FILL_MODES.join(', ')}`,
        ),
      )
    }
    return { text, ...(mode !== undefined ? { mode } : {}) }
  })
}

/** densable `Hn` — JSON round-trip for store/state values. */
export function storeJsonValue(
  value: unknown,
  plugin: string,
  op = 'store.set',
): unknown {
  let raw: string
  try {
    raw = JSON.stringify(value)
  } catch (err) {
    throw new Error(
      `${plugin}: $.${op}: value is not JSON data (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  if (typeof raw !== 'string') {
    throw new Error(
      `${plugin}: $.${op}: value is not JSON data (${value === undefined ? 'undefined' : `a ${typeof value}`})`,
    )
  }
  if (raw.length > STORE_JSON_LIMIT) {
    throw new Error(
      `${plugin}: $.${op}: the value is ${raw.length} characters, over the ${STORE_JSON_LIMIT} limit`,
    )
  }
  return JSON.parse(raw) as unknown
}

/**
 * densable `SNo` / `$at`: abort reason if Error, else `new Error($at(signal,"wait aborted"))`.
 */
function waitAbortedError(signal: AbortLike): Error {
  const { reason } = signal
  if (reason instanceof Error) return reason
  const message = reason === undefined ? 'wait aborted' : String(reason)
  return new Error(message)
}

/**
 * densable `Z` — abortable timeout.
 * Start aborted / abort event: reject via abortError (or Error("aborted")), else resolve.
 * Timer fire: removeEventListener then resolve. `timer.unref?.()` like gold `r?.unref`.
 */
function waitTimeoutMs(
  ms: number,
  signal?: AbortLike | null,
  opts?: WaitTimeoutOpts,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      if (opts?.throwOnAbort || opts?.abortError) {
        reject(opts.abortError?.() ?? new Error('aborted'))
      } else {
        resolve()
      }
      return
    }
    // densable Z: setTimeout extra-args (signal, onAbort, resolve); function m hoisted
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      (
        sig: AbortLike | null | undefined,
        abortHandler: () => void,
        done: () => void,
      ) => {
        sig?.removeEventListener?.('abort', abortHandler)
        done()
      },
      ms,
      signal,
      onAbort,
      resolve,
    )
    function onAbort(): void {
      clearTimeout(timer)
      if (opts?.throwOnAbort || opts?.abortError) {
        reject(opts.abortError?.() ?? new Error('aborted'))
      } else {
        resolve()
      }
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
    // gold `r?.unref && i.unref()` — IWn does not pass unref
    if (opts?.unref) {
      ;(timer as { unref?: () => void }).unref?.()
    }
  })
}

/** densable `IWn` — `Z(e.ms, n, {...n && {abortError:()=>SNo(n)}})`. */
export function waitClockMs(ms: number, signal: unknown): Promise<void> {
  const abort = signal ? (signal as AbortLike) : undefined
  return waitTimeoutMs(ms, abort, {
    ...(abort && { abortError: () => waitAbortedError(abort) }),
  })
}

export function clockMs(value: unknown, plugin: string, op: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `${plugin}: $.clock.${op} takes a non-negative number of milliseconds`,
    )
  }
  return value
}

export function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AbortSignal).aborted === 'boolean' &&
    typeof (value as AbortSignal).addEventListener === 'function'
  )
}

/** densable `kV` / `uOe` — `$.fs.read` and `$.fs.write` 4 MiB byte cap. */
export const FS_BYTE_LIMIT = 4_194_304

export function hostCheck(op: string, reason: string, plugin?: string): never {
  throw new Error(
    `${plugin !== undefined && plugin !== '' ? `${plugin}: ` : ''}${op}: ${reason} (host check)`,
  )
}

export function firstRecord(
  args: unknown[],
): Record<string, unknown> | undefined {
  return args.length === 1 && isEventRecord(args[0]) ? args[0] : undefined
}

export function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function argvFrom(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean)
  return []
}

/** densable `tLe` — `$.process.run` stdout/stderr capture cap. */
export const PROCESS_RUN_CAPTURE_BYTES = 4_194_304

/** densable `b$t` — default `$.process.run` timeout. */
export const PROCESS_RUN_DEFAULT_TIMEOUT_MS = 30_000

/** densable `wpn` — hard cap on `$.process.run` timeout. */
export const PROCESS_RUN_TIMEOUT_CAP_MS = 600_000

/** densable `k$t` — SIGTERM→SIGKILL grace. */
export const PROCESS_RUN_KILL_GRACE_MS = 2000

export const PROCESS_SPAWN_HIGH_WATER = 1_048_576 // 1 MiB (pRt)

/** densable `UB` — `$.http.fetch` 4 MiB request/response body cap. */
export const HTTP_FETCH_BODY_LIMIT = 4_194_304

/** densable `jse` — `$.http.fetch` 30s timeout. */
export const HTTP_FETCH_TIMEOUT_MS = 30_000

export function pathFrom(args: unknown[], key = 'path'): string | undefined {
  const rec = firstRecord(args)
  if (rec && typeof rec[key] === 'string') return rec[key] as string
  return typeof args[0] === 'string' ? args[0] : undefined
}

export const PROMPT_MEDIA_MAX_CHUNK = 4 * 1024 * 1024

export const PROMPT_MEDIA_B64_ALIGN = 3

export const PROMPT_MEDIA_ABSENT = Object.freeze({
  deny: 'no prompt.submit in flight carries an attachment under that id',
})

function isPromptBlockList(value: unknown): value is ModelPromptBlock[] {
  return (
    Array.isArray(value) &&
    Array.from(value).every(
      item =>
        typeof item === 'object' &&
        item !== null &&
        'text' in item &&
        typeof (item as { text: unknown }).text === 'string' &&
        Object.entries(item as Record<string, unknown>).every(
          ([key, val]) =>
            key === 'text' ||
            (key === 'cache' &&
              (val === undefined || typeof val === 'boolean')),
        ),
    )
  )
}

export function normalizeModelCompleteInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const { prompt, system, ...rest } = input
  const normalizedPrompt = isPromptBlockList(prompt)
    ? { prompt: prompt.map(b => b.text).join(''), promptBlocks: prompt }
    : { prompt }
  const normalizedSystem = isPromptBlockList(system)
    ? { system: system.map(b => b.text).join(''), systemBlocks: system }
    : { system }
  const hasSystem = Boolean(system)
  return {
    ...rest,
    ...normalizedPrompt,
    ...(hasSystem && normalizedSystem),
  }
}

export function validateModelCompleteInput(input: {
  model?: unknown
  prompt?: unknown
  system?: unknown
  promptBlocks?: unknown
  systemBlocks?: unknown
}): string | undefined {
  if (!(typeof input?.model === 'string' && typeof input.prompt === 'string')) {
    return 'takes { model, prompt }, the prompt a string or a list of blocks, each { text } and at most `cache: true`'
  }
  if (!(typeof input.system === 'string' || !input.system)) {
    return 'takes a system that is a string or a list of blocks, each { text } and at most `cache: true`'
  }
  return [input.promptBlocks, input.systemBlocks].every(
    blocks => blocks === undefined || isPromptBlockList(blocks),
  )
    ? undefined
    : 'takes promptBlocks and systemBlocks that are lists of blocks, each { text } and at most `cache: true`'
}

export function toolResultTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap(block => {
      if (
        isEventRecord(block) &&
        block.type === 'text' &&
        typeof block.text === 'string'
      ) {
        return [block.text]
      }
      return []
    })
    .join('\n')
}

/** densable yG — keepalive reason that alone means idle-window hold. */
export const PLUGIN_AGENT_IDLE_WINDOW_REASON = 'flag:idle-window'

export function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export const PINNED_AGENT_SPAWN_KEYS = [
  'tool_use_id',
  'name',
  'fork',
  'isTeammate',
  'workflow',
  'resume',
  'parentModel',
  'permissionMode',
  'parentAgentId',
  'provider',
] as const

export const RESTORE_AGENT_SPAWN_KEYS = [
  'isTeammate',
  'workflow',
  'resume',
  'parentAgentId',
  'provider',
] as const

export const UNAPPLIED_RESUME_KEYS = [
  'prompt',
  'description',
  'subagentType',
  'model',
  'background',
  'cwd',
] as const

export const UNAPPLIED_TEAMMATE_KEYS = ['background', 'cwd'] as const

export const UNAPPLIED_WORKFLOW_KEYS = [
  'description',
  'subagentType',
  'background',
  'cwd',
] as const

// #969 (official `qbs` / `Xae` / `Vgt` / `wO` / `mus`): background-ceiling and
// Stop/inputClosed refusal helpers for plugin subagent spawns & inputs.
export const DEFAULT_PLUGIN_INPUT_SESSION_KEY = {}

export const SESSION_MESSAGES_CAP = 500

export function plainInputClone(value: unknown): Record<string, unknown> {
  if (!isEventRecord(value)) return {}
  try {
    const parsed: unknown = JSON.parse(JSON.stringify(value))
    return isEventRecord(parsed) ? parsed : {}
  } catch {
    return { ...value }
  }
}

const UI_PANE_ID_RE = /^[A-Za-z0-9_-]+$/

const UI_PANE_ID_MAX = 64

export const UI_SURFACES = {
  terminal: [
    'Box',
    'Text',
    'Button',
    'Input',
    'Select',
    'Link',
    'Code',
    'Markdown',
    'Client',
    'Raster',
    'Image',
  ],
  desktop: [
    'Box',
    'Text',
    'Button',
    'Input',
    'Select',
    'Svg',
    'Link',
    'Code',
    'Markdown',
    'Client',
  ],
  mobile: ['Box', 'Text', 'Button', 'Svg', 'Link', 'Code', 'Markdown'],
  vscode: [
    'Box',
    'Text',
    'Button',
    'Input',
    'Select',
    'Svg',
    'Link',
    'Code',
    'Markdown',
  ],
} as const

/** densable `et` — union of `Tj` surface tables (`ivo` / `$.ui.resolve`). */
export const UI_RESOLVE_ELEMENT_NAMES = [
  'Box',
  'Text',
  'Button',
  'Input',
  'Select',
  'Link',
  'Code',
  'Markdown',
  'Client',
  'Raster',
  'Image',
  'Svg',
] as const

export const UI_RENDER_COMPONENTS = {
  AskUserQuestion: 'AskUserQuestionPermissionDialog',
  UserMessage: 'UserPromptMessage',
  AssistantMessage: 'AssistantTextMessage',
  ToolUse: 'AssistantToolUseMessage',
  ToolResult: 'UserToolResultMessage',
  ToolGroup: 'CollapsedReadSearchContent',
  ToolProgress: 'ToolProgressHint',
  CommandOutput: 'CommandOutputSite',
  Spinner: 'SpinnerWithVerb',
  TurnDuration: 'TurnDurationMessage',
  InfoNotice: 'InfoNoticeLine',
  SessionMode: 'SessionStateRow',
  PromptHint: 'PromptHintSite',
  AbovePrompt: 'AbovePromptSite',
  Pane: 'PaneSite',
  Backdrop: 'BackdropSite',
} as const

/** densable `ye` — every surface name (`Object.keys(Nz)`). */
export const UI_SURFACE_NAMES = Object.freeze(Object.keys(UI_SURFACES))

/**
 * densable `ze` — which surfaces raise each ui.render component.
 * `ye` = every surface; ToolProgress/TurnDuration/InfoNotice = terminal only;
 * Spinner/SessionMode/PromptHint/AbovePrompt = terminal+desktop; Pane = ye.
 */
export const UI_RENDER_COMPONENT_SURFACES: Readonly<
  Record<keyof typeof UI_RENDER_COMPONENTS, readonly string[]>
> = Object.freeze({
  AskUserQuestion: UI_SURFACE_NAMES,
  UserMessage: UI_SURFACE_NAMES,
  AssistantMessage: UI_SURFACE_NAMES,
  ToolUse: UI_SURFACE_NAMES,
  ToolResult: UI_SURFACE_NAMES,
  ToolGroup: UI_SURFACE_NAMES,
  ToolProgress: ['terminal'],
  CommandOutput: UI_SURFACE_NAMES,
  Spinner: ['terminal', 'desktop'],
  TurnDuration: ['terminal'],
  InfoNotice: ['terminal'],
  SessionMode: ['terminal', 'desktop'],
  PromptHint: ['terminal', 'desktop'],
  AbovePrompt: ['terminal', 'desktop'],
  Pane: UI_SURFACE_NAMES,
  Backdrop: ['desktop', 'mobile'],
})

export const UI_INVALIDATE_EVENTS = [
  'ui.render',
  'prompt.section',
  'prompt.context',
  'prompt.attachment',
  'tool.describe',
  'tool.list',
  'command.describe',
  'config.describe',
] as const

/** densable `JSn` EMPTY_PANES — reset seed for the semantic panes store. */
export const EMPTY_PANES: PanesState = Object.freeze({
  open: Object.freeze([]) as unknown as PluginPaneEntry[],
  unplaced: Object.freeze([]) as unknown as PluginPaneEntry[],
  asked: Object.freeze([]) as unknown as AskedPaneRef[],
  shownId: null,
  focusedId: null,
  focusRequest: null,
  placements: 0,
  closing: Object.freeze([]) as unknown as string[],
})

/** densable `closing` — `aTt` re-entry while the ui.close chain runs. */
/** densable `unplaced` — waiters placed by `placeWaitingPanes` / remote. */
/** densable `asked` — ask latch (+ soft persist via pluginPanes.asked). */
/**
 * densable askedLatch `H` — one-shot seed gate. Soft persist via
 * `GlobalConfig.pluginPanes.asked` (`mL` / `keptAsked` / `keepAsked`).
 */
/** densable `ASKED_MAX` / `G` — soft-persist asked rows cap. */
export const PANE_ASKED_MAX = 64

/** densable `focusRequest` — pending id for `settleFocusRequest` (`a4n`). */
/** densable `placements` — refcount from `offerPlacement` (`QFt`). */

/** densable `D9` — openFloor when the person has asked this pane before. */
export const PANE_OPEN_FLOOR_ASKED = 110

/** densable `C8e` — openFloor for unasked panes. */
export const PANE_OPEN_FLOOR_DEFAULT = 144

/** densable `c9` — AbovePrompt `xI` requestId. */
export const ABOVE_PROMPT_REQUEST_ID = 'above-prompt'

/** densable `sMe` — engine draws its own when no plugin tree. */
export const UI_RENDER_ENGINE_FALLBACK = Object.freeze({
  type: 'engine',
  ref: 0,
})

/** densable `BBr`. */
export const UI_RENDER_EVAL_CAP = 500

export function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function paneIdCheck(id: unknown): string | undefined {
  return typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= UI_PANE_ID_MAX &&
    UI_PANE_ID_RE.test(id)
    ? undefined
    : `id is 1 to ${UI_PANE_ID_MAX} of letters, digits, _ or -`
}

/** densable xxr — keep the object when isError is true, else drop isError. */
export function stripHostIsError(value: unknown): unknown {
  if (!isEventRecord(value)) return value
  if (value.isError === true) return value
  const { isError: _isError, ...rest } = value
  return rest
}

export const TOOL_CALL_WITHHELD_SUFFIX = {
  nothing: '',
  started: ' started, and a plugin withheld its result',
  ran: ' ran, and a plugin withheld its result',
} as const

export const PLUGIN_REGISTER_REFUSE_CAP = HOST_TEXT_LIMIT

/** densable `K$t` — lSo/X$t wait budget for ui.focus site draws. */
export const FOCUS_SITE_WAIT_MS = 3000

export function osc52Payload(text: string): string {
  const encoded = Buffer.from(text, 'utf8').toString('base64')
  return `\x1b]52;c;${encoded}\x07`
}

/** densable `iU` — prompt.fill / prompt.suggest refuse past this length. */
export const UI_HOST_TEXT_MAX = 1_000_000

export function paneTitleHoldsControl(title: string): boolean {
  for (const ch of title) {
    const cp = ch.codePointAt(0) ?? 0
    if (
      cp <= 0x1f ||
      (cp >= 0x7f && cp <= 0x9f) ||
      (cp >= 0xd800 && cp <= 0xdfff) ||
      cp === 0x10eeee
    ) {
      return true
    }
  }
  return false
}

/** densable `Oa` / `wo` — Proxy method names that are not interface ops. */
export const SUPPRESSED_PROXY_SKIP = new Set([
  'then',
  'toJSON',
  'constructor',
  'valueOf',
  'toString',
  'inspect',
  'nodeType',
  '$$typeof',
  'asymmetricMatch',
])

/** densable `Jxr` — `$.noun.method: removed by plugin \`who\``. */
export function suppressedRemovedMessage(
  nounMethod: string,
  by: string,
): string {
  return `$.${nounMethod}: removed by plugin \`${by}\``
}

/** densable `$xr` / `yi` — `${surface}:${component}` → answer. */

export function resolvedKey(surface: string, component: string): string {
  return `${surface}:${component}`
}

/** densable same-thread `cloneIn` is identity for plain data. */
export function cloneIn(value: unknown): unknown {
  return value
}

const UI_NOTIFY_KEY_MAX = 64

const UI_NOTIFY_DELAY_MAX_MS = 604_800_000

export function validateNotifyKey(key: unknown): string | undefined {
  if (
    typeof key === 'string' &&
    key.length > 0 &&
    key.length <= UI_NOTIFY_KEY_MAX &&
    key.trim() === key &&
    !/[\r\n\t\0]/.test(key) &&
    !(key in Object.prototype)
  ) {
    return undefined
  }
  return `key is a string of 1 to ${UI_NOTIFY_KEY_MAX} characters, with no hidden characters or stray spaces, and not a name every object has, such as constructor`
}

function isNotifyWindowMs(value: unknown, max: number): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max)
  )
}

export function validateUiNotifyInput(
  input: Record<string, unknown>,
): string | undefined {
  const textErr = hostTextCheck(input.text)
  if (textErr !== undefined) return textErr
  if (input.title !== undefined && typeof input.title !== 'string') {
    return 'title is a string, when given'
  }
  if (input.key !== undefined) {
    const keyErr = validateNotifyKey(input.key)
    if (keyErr !== undefined) return keyErr
  }
  const timingOk =
    isNotifyWindowMs(input.delayMs, UI_NOTIFY_DELAY_MAX_MS) &&
    isNotifyWindowMs(input.at, Date.now() + UI_NOTIFY_DELAY_MAX_MS) &&
    (input.delayMs === undefined || input.at === undefined)
  if (!timingOk) {
    return 'give delayMs or at, not both. Each is a whole number of 0 or more: delayMs in milliseconds, up to 7 days, and at in epoch milliseconds, up to 7 days from now'
  }
  if (input.untilBack !== undefined && typeof input.untilBack !== 'boolean') {
    return 'untilBack is a boolean, when given'
  }
  return undefined
}

export function mapUiNotifyChannel(
  channel: UiNotifyChannelResult,
  plugin: string,
):
  | { isSent: true; channel: string }
  | { isSent: false; reason: 'no-surface' | 'disabled' | 'no-channel' } {
  switch (channel) {
    case 'no_surface':
      return { isSent: false, reason: 'no-surface' }
    case 'iterm2':
    case 'iterm2_with_bell':
    case 'kitty':
    case 'ghostty':
    case 'terminal_bell':
    case 'client':
      return { isSent: true, channel }
    case 'disabled':
      return { isSent: false, reason: 'disabled' }
    case 'none':
    case 'no_method_available':
      return { isSent: false, reason: 'no-channel' }
    case 'error': {
      const prefix = plugin !== '' ? `${plugin}: ` : ''
      throw new Error(`${prefix}$.ui.notify: the channel's write failed`)
    }
  }
}

/** densable `dLe` — ui.toast timeoutMs upper bound. */
export const UI_TOAST_TIMEOUT_MS_MAX = 60_000

/** densable `yIe` — per-plugin `budgets.toasts` cooldown (`Goo`). */
export const UI_TOAST_COOLDOWN_MS = 2000

/** densable `I9e(plugin, text)` — status/toast text prefix. */
export function formatPluginStatusText(plugin: string, text: string): string {
  const cleanPlugin = plugin.replace(/[\r\n\t]+/g, ' ').trim() || 'unnamed'
  const cleanText = text.replace(/[\r\n\t]+/g, ' ')
  return `${cleanPlugin}: ${cleanText}`
}

export const CLAUDE_CODE_EXPORTS = [
  'atom',
  'derive',
  'memberOf',
  'read',
  'update',
] as const

export const ATOM_BRAND = Symbol.for('claude-code.state.atom')

export const DERIVED_BRAND = Symbol.for('claude-code.state.derived')

export const UPDATE_TRIES_MAX = 64

/** densable `dTo`. */
export const HOOKS_WORKER_OVERRUN_CAP = 2

export function isEventRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * densable `Q_()` / `HD()` / `lO=4096` / `uO` / `cO` / `sO` / `BC` / `kS` / `Rh`.
 * `Fv` is `"ui.render"` (`getRenderVersion`). `Qc` writes `${MD}\0state` into HD.
 * `Rh`/`Lue` skip `HC` (`\0state`), `_Y` (` live`), and `Tmn` (`ui.render viewport`).
 * `xS` = Qc + bumpRasterFrames (staleListeners); does not bump Fv. Evict `kS`
 * deletes `\0state` only when the site is not in `Q_().mounted`.
 */
export const FAULT_RUNS_CAP = 4096

/** densable `kh`. */
export const FAULT_RENDER_STATE_SUFFIX = '\0state'

/** densable `Fv`. */
export const FAULT_RENDER_FV = 'ui.render'

/** densable `Tmn`. */
const FAULT_RENDER_VIEWPORT = `${FAULT_RENDER_FV} viewport`

/** densable `Sh`. */
export const FAULT_RENDER_LIVE = ' live'

/** densable `eh`. */
export const FAULT_RENDER_LIVE_MS = 34

/** densable `Cmt`. */
export const FAULT_RENDER_STEADY_MS = 100

/** densable `WP` — abort cooldown threshold for `W2`. */
export const FAULT_RENDER_ABORT_MS = 16

/** densable `UP`. */
export const PLUGIN_RENDER_COOLDOWN_MS = 1000

/** densable `RS`. */
export const FAULT_RENDER_FOLD_MS = {
  steady: FAULT_RENDER_STEADY_MS,
  live: FAULT_RENDER_LIVE_MS,
} as const

export const DRAWING_READERS_CAP = 4000

/** densable `Vh` — 16ms coalesce window for `Wbr` (`Je`). */
export const CLIENT_MESSAGE_COALESCE_MS = 16

export const REGISTER_FILE = 'hooks/register.ts'

/** densable `uQe` + `WEn` tails after `classic.<HookEvent>` (gold 2.1.289). */
export const FUNCTION_HOOK_EVENTS = [
  'tool.call',
  'tool.check',
  'ui.render',
  'ui.resolve',
  'ui.press',
  'ui.input',
  'ui.select',
  'ui.message',
  'ui.fault',
  'ui.scroll',
  'ui.focus',
  'agent.offer',
  'agent.spawn',
  'prompt.submit',
  'prompt.fill',
  'prompt.suggest',
  'prompt.edit',
  'prompt.change',
  'prompt.autocomplete',
  'prompt.section',
  'prompt.context',
  'prompt.attachment',
  'prompt.mention',
  'prompt.compose',
  'tool.describe',
  'command.run',
  'command.describe',
  'config.set',
  'config.describe',
  'telemetry.log',
  'telemetry.mark',
  'skill.prompt',
  'attribution.text',
  'session.start',
  'session.receive',
  'session.append',
  'session.send',
  'session.compact',
  'session.attach',
  'session.detach',
  'session.measure',
  'session.end',
  'plugin.register',
  'turn.start',
  'turn.step',
  'turn.complete',
  'engine.create',
  'model.complete',
  'model.classify',
  'model.fork',
  'audio.play',
  'audio.speak',
  'mcp.call',
  'mcp.connect',
  'session.cwd',
  'session.root',
  'session.model',
  'session.turns',
  'session.id',
  'session.messages',
  'session.repo',
  'session.surface',
  'session.surfaces',
  'session.authorize',
  'session.identity',
  'session.usage',
  'session.version',
  'turn.abort',
  'prompt.read',
  'prompt.media',
  'flag.value',
  'tool.list',
  'tool.register',
  'command.list',
  'command.register',
  'config.list',
  'agent.list',
  'agent.register',
  'ui.toast',
  'ui.notify',
  'ui.cancelNotify',
  'ui.status',
  'ui.log',
  'ui.notice',
  'ui.invalidate',
  'ui.open',
  'ui.close',
  'ui.panes',
  'theme.set',
  'theme.clear',
  'ui.selection',
  'ui.copy',
  'ui.view',
  'ui.blit',
  'fs.read',
  'fs.write',
  'fs.list',
  'fs.exists',
  'fs.stat',
  'fs.ancestors',
  'store.get',
  'store.set',
  'store.delete',
  'store.keys',
  'state.get',
  'state.set',
  'clock.now',
  'clock.sleep',
  'clock.after',
  'clock.every',
  'http.fetch',
  'process.run',
  'process.spawn',
  'settings.read',
  'env.get',
  'env.set',
] as const

const KNOWN_EVENTS = new Set<string>([
  ...HOOK_EVENTS.map(event => `classic.${event}`),
  ...FUNCTION_HOOK_EVENTS,
])

const RESERVED_PREFIXES = new Set(
  [...KNOWN_EVENTS]
    .filter(event => event.includes('.'))
    .map(event => event.slice(0, event.indexOf('.'))),
)

const IDENT = String.raw`(?!\p{Default_Ignorable_Code_Point})[\p{ID_Start}$_](?:(?!\p{Default_Ignorable_Code_Point})[\p{ID_Continue}$])*`

const IDENT_RE = new RegExp(`^${IDENT}$`, 'u')

const DOTTED_RE = new RegExp(`^${IDENT}\\.${IDENT}$`, 'u')

/**
 * densable `Ke`. A string means the name is rejected. An object is a
 * pattern `on()` will record.
 */
export function parseFunctionHookPattern(
  pattern: string,
): { ok: true } | { ok: false; reason: string } {
  if (pattern.startsWith('!') && pattern.slice(1) === '*') {
    return {
      ok: false,
      reason: `"${pattern}" is not a pattern: it selects no event`,
    }
  }
  if (pattern.startsWith('!!')) {
    return {
      ok: false,
      reason: `"${pattern}" is not a pattern: "!" negates once`,
    }
  }
  const body = pattern.startsWith('!') ? pattern.slice(1) : pattern
  if (body === '*' || body.endsWith('.*')) {
    const prefix = body === '*' ? '' : body.slice(0, -2)
    if (
      prefix !== '' &&
      !prefix.split('.').every(part => IDENT_RE.test(part))
    ) {
      return {
        ok: false,
        reason: `"${pattern}" is not an event name or a pattern ("*", "<prefix>.*", or "!" before either)`,
      }
    }
    return { ok: true }
  }
  if (!IDENT_RE.test(body) && !DOTTED_RE.test(body)) {
    return {
      ok: false,
      reason: `"${pattern}" is not an event name or a pattern ("*", "<prefix>.*", or "!" before either)`,
    }
  }
  if (KNOWN_EVENTS.has(body)) return { ok: true }
  if (
    DOTTED_RE.test(body) &&
    !RESERVED_PREFIXES.has(body.slice(0, body.indexOf('.')))
  ) {
    return { ok: true }
  }
  return { ok: false, reason: `"${body}" is not an event` }
}

/**
 * densable scan-before-load: `on("` literals must parse as events.
 * Prefer an AST walk of `on(...)` CallExpressions; fall back to a regex
 * when the source is not parseable as a module.
 */
export const MAX_SCAN_SCOPE_DEPTH = 2000

export const GLOBAL_FRAGMENT_SYMBOL = Symbol.for('claude-code.ui.fragment')
