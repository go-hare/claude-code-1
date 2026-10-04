// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import type { Theme } from './theme.js'
import { feature } from 'bun:bundle'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { resolveAntModel } from './model/antModels.js'
import { modelHasCatalogCapability } from './model/modelCatalogCapabilities.js'
import { firstPartyNameToCanonical } from './model/model.js'
import { get3PModelCapabilityOverride } from './model/modelSupportOverrides.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from './model/providers.js'
import { APIError } from '@anthropic-ai/sdk'
import {
  getInferenceProfileBackingModelCached,
  getThinkingResumptionRefused,
  getThinkingTypeOverride,
  markEffortUnsupported,
  markThinkingHighlightsRefused,
  markThinkingResumptionRefused,
  setThinkingTypeOverride,
  stickyRejectBeta,
} from '../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import {
  DANGEROUS_TOOL_USE_BETA_HEADER,
  THINKING_BINDING_CONTROLS_BETA_HEADER,
  THINKING_DISPLAY_UPDATES_BETA_HEADER,
  THINKING_RESUMPTION_BETA_HEADER,
  THINKING_TOKEN_COUNT_BETA_HEADER,
} from '../constants/betas.js'
import type { AssistantMessage, Message } from '../types/message.js'
import { logForDebugging } from './debug.js'
import { getSettingsWithErrors } from './settings/settings.js'
import { modelSupportsISP } from './betas.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { isHipaaPolicy } from './midConversationSystem.js'

/** densable `g$e` @177609369. */
export const THINKING_DISPLAY_CHOICES = [
  'summarized',
  'omitted',
  'highlights',
] as const

export type ThinkingDisplay = (typeof THINKING_DISPLAY_CHOICES)[number]

/** Wire-only gold `display:"updates"` @184957981 (not in g$e). */
export type ThinkingApiDisplay = ThinkingDisplay | 'updates'

/** densable `DAt` @184815660. */
export type ThinkingDisplayMode =
  | 'thinking_and_connector_text'
  | 'connector_text'
  | 'none'

/** densable `NMo`. */
export function isThinkingDisplay(e: unknown): e is ThinkingDisplay {
  return (
    typeof e === 'string' &&
    (THINKING_DISPLAY_CHOICES as readonly string[]).includes(e)
  )
}

export type ThinkingConfig =
  | { type: 'adaptive'; display?: ThinkingDisplay; displayExplicit?: boolean }
  | {
      type: 'enabled'
      budgetTokens: number
      display?: ThinkingDisplay
      displayExplicit?: boolean
    }
  | {
      type: 'disabled'
      /** densable `Vm` — `r.mechanical===true` clamps effort even off SJn. */
      mechanical?: boolean
      display?: ThinkingDisplay
      displayExplicit?: boolean
    }

/**
 * densable `aNr` @178430578.
 * Explicit flag wins. Interactive: summarized iff showThinkingSummaries.
 * Non-interactive text (or json without verbose) → omitted.
 */
export function resolveThinkingDisplay({
  explicitDisplay,
  isNonInteractive,
  outputFormat,
  verbose,
  showThinkingSummaries,
}: {
  explicitDisplay: ThinkingDisplay | undefined
  isNonInteractive: boolean
  outputFormat: string
  verbose: boolean
  showThinkingSummaries?: boolean
}): ThinkingDisplay | undefined {
  if (explicitDisplay) return explicitDisplay
  if (!isNonInteractive) return showThinkingSummaries ? 'summarized' : undefined
  if (
    isNonInteractive &&
    (outputFormat === 'text' || (outputFormat === 'json' && !verbose))
  ) {
    return 'omitted'
  }
  return undefined
}

/** densable `lNr`. */
export function isThinkingDisplayOmittedByDefault({
  isNonInteractive,
  outputFormat,
  verbose,
}: {
  isNonInteractive: boolean
  outputFormat: string
  verbose: boolean
}): boolean {
  return (
    isNonInteractive &&
    (outputFormat === 'text' || (outputFormat === 'json' && !verbose))
  )
}

/**
 * densable `cg` @177391739 = `UTe() && !Uce()`.
 * UTe: firstParty || anthropicAws || foundry. Uce: DISABLE_EXPERIMENTAL_BETAS || hipaa.
 */
export function densableExperimentalCapabilityBetas(): boolean {
  const provider = getAPIProvider()
  const ute =
    provider === 'firstParty' ||
    provider === 'anthropicAws' ||
    provider === 'foundry'
  const uce =
    isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS) ||
    isHipaaPolicy()
  return ute && !uce
}

/** densable `$Ln(e)` @184815883 = `cg() && Run(e)`. */
export function supportsThinkingDisplayOnWire(model: string): boolean {
  return densableExperimentalCapabilityBetas() && modelSupportsISP(model)
}

/**
 * densable `Zg` @184956900:
 * `!id ? void 0 : r.display==="highlights"&&j2t()?"omitted":r.display`
 */
export function resolveOutgoingThinkingDisplay(
  configDisplay: ThinkingDisplay | undefined,
  model: string,
  highlightsRefused = false,
): ThinkingDisplay | undefined {
  if (!supportsThinkingDisplayOnWire(model)) return undefined
  if (configDisplay === 'highlights' && highlightsRefused) {
    return 'omitted'
  }
  return configDisplay
}

/** densable `Sbo` @184815560 — `CLAUDE_CODE_THINKING_DISPLAY_UPDATES ?? true`. */
export function isThinkingDisplayUpdatesEnabled(): boolean {
  const raw = process.env.CLAUDE_CODE_THINKING_DISPLAY_UPDATES
  if (raw === undefined) return true
  if (isEnvDefinedFalsy(raw)) return false
  if (isEnvTruthy(raw)) return true
  return raw.trim() !== ''
}

/**
 * densable `DAt(e,n)` @184815660.
 * `n` is `displayExplicit ?? l2t()`.
 */
export function resolveThinkingDisplayMode(
  display: ThinkingDisplay | undefined,
  displayExplicit: boolean,
): ThinkingDisplayMode {
  if (display === 'summarized' || display === 'highlights') {
    return 'thinking_and_connector_text'
  }
  if (display === 'omitted' && !displayExplicit) return 'none'
  const summaries =
    getSettingsWithErrors().settings.showThinkingSummaries ?? false
  if (display !== 'omitted' && summaries) {
    return 'thinking_and_connector_text'
  }
  return isThinkingDisplayUpdatesEnabled() ? 'connector_text' : 'none'
}

/**
 * densable connector_text branch @184957900:
 * adaptive|enabled && $Ln && firstParty && Hs() && !xV() && !thinking-in-extraBody
 * && !$ce sticky-rejected && !SIMULATE_PROXY → display:"updates".
 */
export function shouldSendThinkingDisplayUpdates({
  thinkingType,
  model,
  extraBodyHasThinking,
  simulateProxy,
  oauthWithoutApiKey,
  displayUpdatesRejected,
}: {
  thinkingType: string | undefined
  model: string
  extraBodyHasThinking: boolean
  simulateProxy: boolean
  oauthWithoutApiKey: boolean
  displayUpdatesRejected: boolean
}): boolean {
  if (thinkingType !== 'adaptive' && thinkingType !== 'enabled') return false
  if (!supportsThinkingDisplayOnWire(model)) return false
  if (getAPIProvider() !== 'firstParty') return false
  if (!isFirstPartyAnthropicBaseUrl()) return false
  if (oauthWithoutApiKey) return false
  if (extraBodyHasThinking) return false
  if (displayUpdatesRejected) return false
  if (simulateProxy) return false
  return true
}

/** densable `eM` @182157383. */
const CAPABILITY_REJECTED_PREFIX = 'capability_rejected: '

/**
 * densable `vwe` @183941140.
 * Source-lock string: `thinking.(adaptive|enabled).display: Input should be `
 */
export const THINKING_DISPLAY_HIGHLIGHTS_REJECTED_RE =
  /thinking\.(adaptive|enabled)\.display: Input should be /

/** densable `Ewe` pydantic lock @77948666. */
export const THINKING_BLOCK_BINDING_EXTRA_INPUTS_RE =
  /thinking\.(adaptive|enabled)\.block_binding(\.prefix_mismatch_behavior)?: Extra inputs are not permitted/

/** densable `rI` @182157444 — bounded `capability_rejected:` token match. */
function messageHasCapabilityRejectedToken(
  message: string,
  token: string,
): boolean {
  const needle = `${CAPABILITY_REJECTED_PREFIX}${token}`
  let start = 0
  for (;;) {
    const at = message.indexOf(needle, start)
    if (at === -1) return false
    const next = message[at + needle.length]
    if (next === undefined || !/[A-Za-z0-9_:.-]/.test(next)) return true
    start = at + 1
  }
}

/** densable `ywo`/`Ny` @182160131 / @183943859. */
function errorMentionsBetaHeader(message: string, header: string): boolean {
  return (
    (message.includes(header) && message.includes('anthropic-beta')) ||
    messageHasCapabilityRejectedToken(message, `beta_header:${header}`)
  )
}

/** densable `vwe` — HTTP 400 whose message is the highlights `display` pydantic error. */
export function isThinkingDisplayHighlightsRejected(error: unknown): boolean {
  return (
    error instanceof APIError &&
    error.status === 400 &&
    THINKING_DISPLAY_HIGHLIGHTS_REJECTED_RE.test(error.message)
  )
}

/**
 * densable `Twe` @183941270 — `vwe` or 400 that names `$ce`
 * (`thinking-display-updates-2026-08-18`).
 */
export function isThinkingDisplayUpdatesRejected(error: unknown): boolean {
  return (
    isThinkingDisplayHighlightsRejected(error) ||
    (error instanceof APIError &&
      error.status === 400 &&
      errorMentionsBetaHeader(
        error.message,
        THINKING_DISPLAY_UPDATES_BETA_HEADER,
      ))
  )
}

/** densable `Kue` retry tokens @184975200 plus 283 siblings. */
export type ThinkingDisplayRetryToken =
  | 'retry:thinking-display-highlights'
  | 'retry:thinking-display-updates'
  | 'retry:thinking-binding-controls'
  | 'retry:thinking-token-count-beta'
  | 'retry:thinking-resumption-beta'
  | 'retry:thinking-type'
  | 'retry:effort-unsupported'
  | `retry:prefix-lock-strip-${number}`
  | `retry:prefix-lock-strip-all-${number}`
  | 'retry:safeguards'
  | 'retry:safeguards-unclaimed'

export type ThinkingRetryContext = {
  lastSentDisplay: string | undefined
  lastRequestBetas: readonly string[]
  model: string
  /** densable `ye` @zue — resolved/served model if distinct from `h.model`. */
  servedModel?: string
  /** densable `sT` — last request actually carried OL. */
  carriedBindingControls?: boolean
  /** densable `Hx` present on last request (`tw.includes(Hx.header)`). */
  carriedTokenCount?: boolean
  /** densable `m1e()` — 3P request that also carried OL. */
  bindingControlsOnThirdParty?: boolean
  /** densable `_t` / `h.resumeIncompleteThinking`. */
  resumeIncompleteThinking?: boolean
  /**
   * densable `LU` @184966566 — named-classifier bag (`aQ` included).
   * Guess-refuse (`dY` Jr) requires `!eM && !LU`. Local: pass true when
   * another onError arm already claimed this 400.
   */
  alreadyClassified?: boolean
  /** densable `dY(qn, rr=!1)` unnamed-guess enable. Default false (Kue-path). */
  allowUnnamedBindingGuess?: boolean
  messages?: Message[]
  /**
   * Mutate-and-retry after prefix-lock strip. Gold `_s=od(Ps.stripped,…)`.
   * Isolation: caller assigns `messagesForAPI`.
   */
  onMessagesHealed?: (next: Message[], kind?: 'error_recovery') => void
  /** densable `on({type:"thinking_stripped"})` after strip. */
  onThinkingStripped?: (att: ThinkingStrippedAttachment) => void
  /** densable `uO` @184977740 — prefix-lock attempt (1-based after increment). */
  prefixLockAttempt?: number
}

function isHttp400(error: unknown): error is APIError {
  return error instanceof APIError && error.status === 400
}

/** densable `QE` @183946200 — thinking signature 400 (prefix-lock sibling). */
export function isThinkingSignatureRejected(error: unknown): boolean {
  if (!isHttp400(error)) return false
  const n = error.message.toLowerCase().replaceAll('`', '')
  if (n.includes('signature in thinking block')) return true
  if (n.includes('invalid data in redacted_thinking block')) return true
  if (n.includes('thinking.signature') && n.includes('field required')) {
    return true
  }
  return (
    (n.includes('thinking block') || n.includes('redacted_thinking')) &&
    (n.includes('cannot be modified') || n.includes('invalid signature'))
  )
}

/** densable `MN` @183945981 — conversation-bound thinking 400. */
export function isThinkingBoundToOtherConversation(error: unknown): boolean {
  if (!isHttp400(error)) return false
  const n = error.message.toLowerCase()
  return (
    n.includes('not created in this conversation') ||
    n.includes('bound to a different conversation')
  )
}

/** densable `iut(e)` @183946513 — stamp prefixLockHealDeclined on the 400. */
export function markPrefixLockHealDeclined(error: unknown): void {
  if (error !== null && typeof error === 'object') {
    Object.assign(error, { prefixLockHealDeclined: true })
  }
}

/** densable `dut(e)` @183946574 — skip first minify dut @178421246 (foundry id). */
export function isPrefixLockHealDeclined(error: unknown): boolean {
  return (
    error instanceof APIError &&
    'prefixLockHealDeclined' in error &&
    (error as { prefixLockHealDeclined?: boolean }).prefixLockHealDeclined ===
      true
  )
}

export type ThinkingStrippedAttachment =
  | { type: 'thinking_stripped'; scope: 'all' }
  | {
      type: 'thinking_stripped'
      scope: 'partial'
      from: { messageId: string; thinkingIndex: number }
    }

/**
 * densable `Zue()` @184980379 — emit thinking_stripped when the relay already
 * decided a strip. Compact uses thinkingStrippedAttachment('all') when
 * densable `sdt`/`xPe` says strip.
 */
export function emitRelayThinkingStripped(
  hasThinking: boolean,
): ThinkingStrippedAttachment | undefined {
  const {
    getRelayThinkingStripRecorded,
    markRelayThinkingStripRecorded,
    relayStoppedInLastDispatch,
  } = require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
  if (getRelayThinkingStripRecorded() !== null) {
    return undefined
  }
  // densable Zue `qn=xi&&!NU&&(lq?.relayStoppedInLastDispatch()??!1)`
  if (!relayStoppedInLastDispatch()) {
    return undefined
  }
  if (!hasThinking) {
    markRelayThinkingStripRecorded('no_thinking')
    return thinkingStrippedAttachment('all')
  }
  markRelayThinkingStripRecorded('marker_same_request')
  return thinkingStrippedAttachment('all')
}

/** densable query-local `sk` / `Xue` pending until Zue yields. */
let pendingThinkingStripped: ThinkingStrippedAttachment | undefined

/** densable `Xue(Ps.from)` — stash until query yields the attachment. */
export function setPendingThinkingStripped(
  att: ThinkingStrippedAttachment,
): void {
  pendingThinkingStripped = att
}

/** densable `Zue()` consume — once, then NU. */
export function takePendingThinkingStripped():
  | ThinkingStrippedAttachment
  | undefined {
  const att = pendingThinkingStripped
  pendingThinkingStripped = undefined
  return att
}

/** densable `on({type:"thinking_stripped"})` @184764480 / @184980651. */
export function thinkingStrippedAttachment(
  scope: 'all' | 'partial',
  from?: { messageId: string; thinkingIndex: number },
): ThinkingStrippedAttachment {
  if (scope === 'partial' && from !== undefined) {
    return { type: 'thinking_stripped', scope: 'partial', from }
  }
  return { type: 'thinking_stripped', scope: 'all' }
}

/** densable `jNn` @186789045 — `e.scope==="all"?void 0:e.from`. */
function thinkingStripPartialFrom(att: {
  scope?: string
  from?: { messageId: string; thinkingIndex: number }
}): { messageId: string; thinkingIndex: number } | undefined {
  return att.scope === 'all' ? undefined : att.from
}

/**
 * densable `f9t` @186789891. Walk `[0, before)` accumulating thinking
 * blocks on `from.messageId`; first index where count exceeds thinkingIndex.
 */
function findAssistantIndexForThinkingFrom(
  messages: readonly Message[],
  before: number,
  from: { messageId: string; thinkingIndex: number },
): number | undefined {
  let seen = 0
  for (let i = 0; i < before; i++) {
    const msg = messages[i]
    if (msg?.type === 'assistant' && msg.message.id === from.messageId) {
      seen += thinkingBlockCount(msg)
      if (seen > from.thinkingIndex) return i
    }
  }
  return undefined
}

/**
 * densable `WNn` @186790941 — `from` compact carries a summarized
 * `thinking_stripped` onto the KEEP prefix. Scope `all` or unlocatable
 * `from` → `{scope:"all"}`. Marker whose target is still in summarized
 * (`w>=e.length`) is skipped. Earliest keep-index + lowest thinkingIndex wins.
 */
export function carryThinkingStripFromSummarized(
  keep: readonly Message[],
  summarized: readonly Message[],
): ThinkingStrippedAttachment | undefined {
  const concat = [...keep, ...summarized]
  let best:
    | {
        at: number
        from: { messageId: string; thinkingIndex: number }
      }
    | undefined
  for (let g = 0; g < summarized.length; g++) {
    const h = summarized[g]
    if (h?.type !== 'attachment' || h.attachment.type !== 'thinking_stripped') {
      continue
    }
    const from = thinkingStripPartialFrom(h.attachment)
    const at =
      from === undefined
        ? undefined
        : findAssistantIndexForThinkingFrom(concat, keep.length + g, from)
    if (from === undefined || at === undefined) {
      return thinkingStrippedAttachment('all')
    }
    if (at >= keep.length) continue
    if (
      best === undefined ||
      at < best.at ||
      (at === best.at && from.thinkingIndex < best.from.thinkingIndex)
    ) {
      best = { at, from }
    }
  }
  return best
    ? thinkingStrippedAttachment('partial', { ...best.from })
    : undefined
}

/**
 * densable `Ewe` @183941343 — 400 that names OL or the block_binding pydantic
 * extra-input string. Excludes QE/MN.
 */
export function isThinkingBindingControlsRejected(error: unknown): boolean {
  return (
    isHttp400(error) &&
    !isThinkingSignatureRejected(error) &&
    !isThinkingBoundToOtherConversation(error) &&
    (errorMentionsBetaHeader(
      error.message,
      THINKING_BINDING_CONTROLS_BETA_HEADER,
    ) ||
      THINKING_BLOCK_BINDING_EXTRA_INPUTS_RE.test(error.message))
  )
}

/**
 * densable `Zct` @183941649 — 400 whose message includes OL.header, excluding
 * QE/MN. Used for 3P named-header refuse.
 */
export function isThinkingBindingControlsHeaderInError(
  error: unknown,
): boolean {
  return (
    isHttp400(error) &&
    !isThinkingSignatureRejected(error) &&
    !isThinkingBoundToOtherConversation(error) &&
    error.message.includes(THINKING_BINDING_CONTROLS_BETA_HEADER)
  )
}

/** densable `rQ` @183941790 — 400 "invalid beta flag". */
export function isInvalidBetaFlagError(error: unknown): boolean {
  return (
    isHttp400(error) &&
    error.message.toLowerCase().includes('invalid beta flag')
  )
}

/**
 * densable `Cwe` @183941684 — 400 that names Hx (`Ny` or header+anthropic_beta).
 */
export function isThinkingTokenCountBetaRejected(error: unknown): boolean {
  if (!isHttp400(error)) return false
  return (
    errorMentionsBetaHeader(error.message, THINKING_TOKEN_COUNT_BETA_HEADER) ||
    (error.message.includes(THINKING_TOKEN_COUNT_BETA_HEADER) &&
      error.message.includes('anthropic_beta'))
  )
}

/** densable `bwe` @183940884 — 400 that names ipt via `Ny`. */
export function isThinkingResumptionBetaRejected(error: unknown): boolean {
  return (
    isHttp400(error) &&
    errorMentionsBetaHeader(error.message, THINKING_RESUMPTION_BETA_HEADER)
  )
}

/**
 * densable `xkr` @182158777 — `thinking.type … not supported` or
 * `adaptive thinking is not supported`.
 */
function parseThinkingTypeNotSupported(
  message: string,
): 'enabled' | 'adaptive' | undefined {
  const match =
    /thinking\.type[^a-z]{1,8}(enabled|adaptive)[\s\S]*?not supported/i.exec(
      message,
    ) ?? /\b(adaptive) thinking is not supported/i.exec(message)
  const kind = match?.[1]?.toLowerCase()
  return kind === 'enabled' || kind === 'adaptive' ? kind : undefined
}

/**
 * densable `aQ` @183947371 — HTTP 400 naming the rejected thinking.type.
 */
export function parseThinkingTypeRejection(
  error: unknown,
): 'enabled' | 'adaptive' | null {
  if (!isHttp400(error)) return null
  const parsed = parseThinkingTypeNotSupported(error.message)
  if (parsed) return parsed
  if (
    messageHasCapabilityRejectedToken(error.message, 'thinking_type:enabled')
  ) {
    return 'enabled'
  }
  if (
    messageHasCapabilityRejectedToken(error.message, 'thinking_type:adaptive')
  ) {
    return 'adaptive'
  }
  return null
}

/**
 * densable aggregator arm @184994206: aQ → d3r(opposite) → `retry:thinking-type`.
 * Gold runs this **before** zue/Kue/Vue/dY.
 */
export function classifyThinkingTypeRetry(
  error: unknown,
  ctx: Pick<ThinkingRetryContext, 'model'>,
): ThinkingDisplayRetryToken | null {
  const rejected = parseThinkingTypeRejection(error)
  if (rejected === null) return null
  const next = rejected === 'enabled' ? 'adaptive' : 'enabled'
  setThinkingTypeOverride(ctx.model, next)
  logForDebugging(
    `[thinking] model rejected thinking.type=${rejected}; retrying with ${next}. For Bedrock application-inference-profile ARNs with bearer-token auth, granting bedrock:GetInferenceProfile to the token avoids this round-trip.`,
    { level: 'warn' },
  )
  return 'retry:thinking-type'
}

/**
 * densable `PN` @183945981 — effort-unsupported 400.
 * `effort parameter`+`not support` OR `output_config`+`effort`+extra inputs
 * OR `capability_rejected: effort_unsupported`. Gold: `aQ(e)!==null` → false.
 */
export function isEffortUnsupportedRejected(error: unknown): boolean {
  if (!isHttp400(error)) return false
  if (parseThinkingTypeRejection(error) !== null) return false
  const n = error.message.toLowerCase()
  if (n.includes('effort parameter') && n.includes('not support')) return true
  if (
    n.includes('output_config') &&
    n.includes('effort') &&
    n.includes('extra inputs are not permitted')
  ) {
    return true
  }
  return messageHasCapabilityRejectedToken(error.message, 'effort_unsupported')
}

/** densable `vMt` @184858156 — env/GB `drop`/`block` → wire enum. */
export type PrefixMismatchBehavior = 'drop_block' | 'error'

export function mapPrefixMismatchBehavior(
  raw: string | undefined,
): PrefixMismatchBehavior | undefined {
  switch (raw) {
    case 'drop':
      return 'drop_block'
    case 'block':
      return 'error'
    default:
      return undefined
  }
}

/**
 * densable `TMt` @184858254:
 * `$l()` (firstParty && Hs()) then env `CLAUDE_CODE_POLISHED_DEWDROP` else
 * GB `tengu_polished_dewdrop` default `""`.
 */
export function resolvePrefixMismatchBehavior():
  | PrefixMismatchBehavior
  | undefined {
  if (getAPIProvider() !== 'firstParty' || !isFirstPartyAnthropicBaseUrl()) {
    return undefined
  }
  const env = process.env.CLAUDE_CODE_POLISHED_DEWDROP
  if (env !== undefined) return mapPrefixMismatchBehavior(env)
  return mapPrefixMismatchBehavior(
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_polished_dewdrop', ''),
  )
}

/** densable `EMt(JR)` @184858372 — send OL if JR set or firstParty+Hs(). */
export function shouldSendThinkingBindingControls(
  behavior: PrefixMismatchBehavior | undefined,
): boolean {
  return (
    behavior !== undefined ||
    (getAPIProvider() === 'firstParty' && isFirstPartyAnthropicBaseUrl())
  )
}

const THINKING_REMOVED_PLACEHOLDER = '[Thinking removed]'

/** densable `LZ` @186782497 — thinking or redacted_thinking. */
export function isThinkingContentBlock(block: { type?: string }): boolean {
  return block.type === 'thinking' || block.type === 'redacted_thinking'
}

/** densable `Qoe` @184911735. */
function thinkingBlockKey(block: unknown): string | undefined {
  if (typeof block !== 'object' || block === null) return undefined
  const n = block as { type?: string; signature?: unknown; data?: unknown }
  const r =
    n.type === 'thinking'
      ? n.signature
      : n.type === 'redacted_thinking'
        ? n.data
        : undefined
  return typeof r === 'string' && r.length > 0 ? `${n.type}:${r}` : undefined
}

/** densable `tIe` @184911900. */
function thinkingBlockCount(message: Message | undefined): number {
  const content =
    message?.type === 'assistant' ? message.message?.content : undefined
  if (!Array.isArray(content)) {
    return 0
  }
  let n = 0
  for (const block of content) {
    if (isThinkingContentBlock(block)) n++
  }
  return n
}

/** densable `ROt` @184911960. */
export function countThinkingBlocksSentVsStripped(
  sent: readonly Message[],
  stripped: readonly Message[],
): {
  blocksSent: number
  turnsSent: number
  blocksStripped: number
  turnsStripped: number
} {
  const r = {
    blocksSent: 0,
    turnsSent: 0,
    blocksStripped: 0,
    turnsStripped: 0,
  }
  const len = Math.max(sent.length, stripped.length)
  for (let s = 0; s < len; s++) {
    const g = thinkingBlockCount(sent[s])
    const h = g - thinkingBlockCount(stripped[s])
    r.blocksSent += g
    r.turnsSent += g > 0 ? 1 : 0
    r.blocksStripped += h
    r.turnsStripped += h > 0 ? 1 : 0
  }
  return r
}

/** densable `Xwr` @186791482. */
function isThinkingOrEmptyTextBlock(block: {
  type?: string
  text?: unknown
}): boolean {
  return (
    isThinkingContentBlock(block) ||
    (block.type === 'text' &&
      !(typeof block.text === 'string' && block.text.trim() !== ''))
  )
}

function thinkingRemovedPlaceholder(): {
  type: 'text'
  text: string
  citations: never[]
} {
  return { type: 'text', text: THINKING_REMOVED_PLACEHOLDER, citations: [] }
}

/** densable `Cxt` @186791621. */
export function stripThinkingBlocksFromAssistant(
  message: Message,
  fromThinkingIndex = 0,
): Message {
  const content =
    message.type === 'assistant' ? message.message?.content : undefined
  if (message.type !== 'assistant' || !Array.isArray(content)) {
    return message
  }
  const r = content
  let s = -1
  let g = 0
  for (let b = 0; b < r.length; b++) {
    const w = r[b]!.type
    if (w === 'thinking' || w === 'redacted_thinking') {
      if (g === fromThinkingIndex) {
        s = b
        break
      }
      g++
    }
  }
  if (s === -1) return message
  const h = r.filter(
    (block, w) =>
      (fromThinkingIndex > 0 && w < s) || !isThinkingOrEmptyTextBlock(block),
  )
  if (h.length === 0) h.push(thinkingRemovedPlaceholder())
  return {
    ...message,
    message: { ...message.message, content: h },
  } as AssistantMessage
}

/** densable `ere` @186788795 — strip all thinking from every assistant. */
export function stripAllThinkingBlocks(messages: Message[]): Message[] {
  let n = false
  const r = messages.map(s => {
    const g = stripThinkingBlocksFromAssistant(s)
    if (g !== s) n = true
    return g
  })
  return n ? r : messages
}

/** densable `nIe` @186788885 — strip from messageIndex/thinkingIndex onward. */
export function stripThinkingBlocksFrom(
  messages: Message[],
  from: { messageIndex: number; thinkingIndex: number },
): Message[] {
  let r = false
  const s = messages.map((g, h) => {
    if (h < from.messageIndex) return g
    const b = stripThinkingBlocksFromAssistant(
      g,
      h === from.messageIndex ? from.thinkingIndex : 0,
    )
    if (b !== g) r = true
    return b
  })
  return r ? s : messages
}

/** densable `cut` @183946330 — `anthropic-thinking-prefix-mismatch` header. */
export function parseThinkingPrefixMismatch(error: unknown):
  | {
      block?: { messageIndex: number; blockIndex: number }
      kind?: string
    }
  | undefined {
  if (!(error instanceof APIError)) return undefined
  let n: string | null | undefined
  try {
    n = error.headers?.get?.('anthropic-thinking-prefix-mismatch')
  } catch {
    return undefined
  }
  if (typeof n !== 'string' || n.length === 0 || n.length > 2048) {
    return undefined
  }
  const r = new Map<string, string>()
  for (const b of n.split(';')) {
    const w = b.indexOf('=')
    if (w <= 0) continue
    const D = b.slice(0, w).trim()
    if (!r.has(D)) r.set(D, b.slice(w + 1).trim())
  }
  const s = /^messages\.(\d{1,6})\.content\.(\d{1,6})$/.exec(
    r.get('block') ?? '',
  )
  const g = r.get('kind')
  const h = g !== undefined && /^[a-z_]{1,40}$/.test(g) ? g : undefined
  if (!s && h === undefined) return undefined
  return {
    block: s
      ? { messageIndex: Number(s[1]), blockIndex: Number(s[2]) }
      : undefined,
    kind: h,
  }
}

/** densable `TXt` @184977720 — prefix-lock 400 (`QN instanceof Ht && MN`). */
export function isPrefixLockThinkingRejection(error: unknown): boolean {
  return isThinkingBoundToOtherConversation(error)
}

const PREFIX_LOCK_PARTIAL_ATTEMPT_CAP = 2

/**
 * densable `dGe` @184978548 — strip thinking and retry, or surface.
 * Attempt counter is per classifier invocation (isolation: no query-local uO).
 */
export function classifyPrefixLockStripRetry(
  error: unknown,
  messages: Message[] | undefined,
  onMessagesHealed:
    | ((next: Message[], kind?: 'error_recovery') => void)
    | undefined,
  model: string,
  attempt = 1,
  onThinkingStripped?: (att: ThinkingStrippedAttachment) => void,
): ThinkingDisplayRetryToken | null {
  try {
    if (!isPrefixLockThinkingRejection(error)) return null
    const ur = parseThinkingPrefixMismatch(error)
    const Jr = messages
    const Ps = (():
      | { scope: 'partial' | 'all'; stripped: Message[] }
      | undefined => {
      if (!Jr) return undefined
      const sl =
        ur?.block !== undefined && attempt <= PREFIX_LOCK_PARTIAL_ATTEMPT_CAP
          ? locateThinkingBlockForPrefixLock(Jr, ur.block)
          : undefined
      if (sl !== undefined) {
        const yl = stripThinkingBlocksFrom(Jr, {
          messageIndex: sl.messageIndex,
          thinkingIndex: sl.indexInMessage,
        })
        if (yl !== Jr) return { scope: 'partial', stripped: yl }
      }
      const ul = stripAllThinkingBlocks(Jr)
      return ul !== Jr ? { scope: 'all', stripped: ul } : undefined
    })()
    const Hi = Ps?.scope ?? 'none'
    const Ii = countThinkingBlocksSentVsStripped(
      Jr ?? [],
      Ps?.stripped ?? Jr ?? [],
    )
    if (Ps === undefined) markPrefixLockHealDeclined(error)
    if (Ps !== undefined) {
      // densable `_s=od(Ps.stripped,"error_recovery",!0)` @184979101
      onMessagesHealed?.(Ps.stripped, 'error_recovery')
      onThinkingStripped?.(thinkingStrippedAttachment(Ps.scope))
    }
    logForDebugging(
      Ps === undefined
        ? '[thinking] prefix-lock rejection: nothing to strip; the error is returned.'
        : `[thinking] prefix-lock rejection: stripped ${Ii.blocksStripped} of ${Ii.blocksSent} thinking block(s) (${Hi}) and retrying.`,
      { level: 'warn' },
    )
    logEvent('tengu_strict_prefix_lock_400_surfaced', {
      model:
        model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      strip_scope:
        Hi as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      stripped_block_count: Ii.blocksStripped,
      thinking_blocks_sent: Ii.blocksSent,
      attempt,
    })
    if (Ps === undefined) return null
    return Ps.scope === 'partial'
      ? `retry:prefix-lock-strip-${attempt}`
      : `retry:prefix-lock-strip-all-${attempt}`
  } catch (rr) {
    logForDebugging(`[thinking] prefix-lock classifier threw: ${String(rr)}`, {
      level: 'error',
    })
    return null
  }
}

/** densable `EXt` @184977850 — locate thinking block by Qoe key. */
function locateThinkingBlockForPrefixLock(
  messages: Message[],
  block: { messageIndex: number; blockIndex: number },
): { messageIndex: number; indexInMessage: number } | undefined {
  const rr = messages[block.messageIndex]
  const rrContent = rr?.type === 'assistant' ? rr.message?.content : undefined
  if (rr?.type !== 'assistant' || !Array.isArray(rrContent)) {
    return undefined
  }
  const ur = thinkingBlockKey(rrContent[block.blockIndex])
  if (ur === undefined) return undefined
  let Jr: { messageIndex: number; indexInMessage: number } | undefined
  const Ps = new Map<string, number>()
  for (let Hi = 0; Hi < messages.length; Hi++) {
    const Ii = messages[Hi]
    const IiContent = Ii?.type === 'assistant' ? Ii.message?.content : undefined
    if (Ii?.type !== 'assistant' || !Array.isArray(IiContent)) continue
    const Oi = Ii.message?.id
    if (typeof Oi !== 'string') continue
    let sl = Ps.get(Oi) ?? 0
    for (const ul of IiContent) {
      if (!isThinkingContentBlock(ul)) continue
      if (thinkingBlockKey(ul) === ur) {
        if (Jr !== undefined) return undefined
        Jr = {
          messageIndex: Hi,
          indexInMessage: sl - (Ps.get(Oi) ?? 0),
        }
      }
      sl++
    }
    Ps.set(Oi, sl)
  }
  return Jr
}

/**
 * densable `Kue` @184975200 plus siblings `zue`/`dY`/`Vue`/`Yue`/`dGe`
 * on the same unique-token onError path.
 */
export function classifyThinkingDisplayRetry(
  error: unknown,
  lastSentDisplay: string | undefined,
  lastRequestBetas: readonly string[],
  model: string,
  extras: Omit<
    ThinkingRetryContext,
    'lastSentDisplay' | 'lastRequestBetas' | 'model'
  > = {},
): ThinkingDisplayRetryToken | null {
  const ctx: ThinkingRetryContext = {
    lastSentDisplay,
    lastRequestBetas,
    model,
    ...extras,
  }
  return classifyThinkingRetryExtras(error, ctx)
}

/**
 * densable stream onError @184994206:
 * Yue → aQ (`retry:thinking-type`) → zue → Kue → Vue → dY → dGe.
 */
export function classifyThinkingRetryExtras(
  error: unknown,
  ctx: ThinkingRetryContext,
): ThinkingDisplayRetryToken | null {
  const yue = classifyThinkingResumptionRetry(
    error,
    ctx.lastRequestBetas,
    ctx.resumeIncompleteThinking === true,
  )
  if (yue === 'surface:resume-prefill') return null
  if (yue !== null) return yue

  const aQ = classifyThinkingTypeRetry(error, ctx)
  if (aQ !== null) return aQ

  const effort = classifyEffortUnsupportedRetry(error, ctx)
  if (effort !== null) return effort

  const kue = classifyKueOnly(error, ctx)
  if (kue !== null) return kue

  const vue = classifyThinkingTokenCountRetry(error, ctx)
  if (vue !== null) return vue

  const dY = classifyThinkingBindingControlsRetry(error, ctx)
  if (dY !== null) return dY

  const gue = classifySafeguardsUnclaimedRetry(error, ctx)
  if (gue !== null) return gue

  return classifyPrefixLockStripRetry(
    error,
    ctx.messages,
    ctx.onMessagesHealed,
    ctx.model,
    ctx.prefixLockAttempt ?? 1,
    ctx.onThinkingStripped,
  )
}

/**
 * densable `gue` @184948820 — `dY(qn,!0)` then unnamed 400 while Gv is on
 * the request → drop Gv, `retry:safeguards-unclaimed`.
 */
export function classifySafeguardsUnclaimedRetry(
  error: unknown,
  ctx: ThinkingRetryContext,
): ThinkingDisplayRetryToken | null {
  const named = classifyThinkingBindingControlsRetry(error, {
    ...ctx,
    allowUnnamedBindingGuess: true,
  })
  if (named !== null) return named
  if (!ctx.lastRequestBetas.includes(DANGEROUS_TOOL_USE_BETA_HEADER)) {
    return null
  }
  // densable `p1e()` @184947750 — unnamed gue only on 3P.
  if (getAPIProvider() === 'firstParty') {
    return null
  }
  if (
    !isHttp400(error) ||
    ctx.alreadyClassified ||
    isThinkingSignatureRejected(error) ||
    isThinkingBoundToOtherConversation(error) ||
    isThinkingDisplayUpdatesRejected(error)
  ) {
    return null
  }
  stickyRejectBeta(DANGEROUS_TOOL_USE_BETA_HEADER)
  logForDebugging(
    '[server-classifier] an unrecognised HTTP 400 arrived while the dangerous-tool-use beta was on the request; retrying once without it, and auto mode decides with the local classifier for the rest of this conversation',
    { level: 'warn' },
  )
  logEvent('tengu_server_classifier_beta_rejected_retry', {
    provider:
      getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    unnamed: false,
    foundryFeature: false,
    unclaimed: true,
  })
  return 'retry:safeguards-unclaimed'
}

/** densable `Kue` @184975511. */
function classifyKueOnly(
  error: unknown,
  ctx: ThinkingRetryContext,
): ThinkingDisplayRetryToken | null {
  if (
    ctx.lastSentDisplay === 'highlights' &&
    isThinkingDisplayHighlightsRejected(error)
  ) {
    markThinkingHighlightsRefused()
    logForDebugging(
      '[thinking] server rejected thinking.display highlights; asking for omitted for the rest of this process and retrying.',
      { level: 'warn' },
    )
    logEvent('tengu_thinking_display_highlights_rejected_retry', {
      model:
        ctx.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return 'retry:thinking-display-highlights'
  }
  if (
    ctx.lastRequestBetas.includes(THINKING_DISPLAY_UPDATES_BETA_HEADER) &&
    isThinkingDisplayUpdatesRejected(error)
  ) {
    stickyRejectBeta(THINKING_DISPLAY_UPDATES_BETA_HEADER)
    logForDebugging(
      '[thinking] server rejected thinking.display updates; dropping the value and its beta header for this conversation and retrying.',
      { level: 'warn' },
    )
    logEvent('tengu_thinking_display_rejected_retry', {
      model:
        ctx.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return 'retry:thinking-display-updates'
  }
  return null
}

/** densable `zue` @184975211. */
export function classifyEffortUnsupportedRetry(
  error: unknown,
  ctx: Pick<ThinkingRetryContext, 'model' | 'servedModel'>,
): ThinkingDisplayRetryToken | null {
  if (!isEffortUnsupportedRejected(error)) return null
  markEffortUnsupported(ctx.model)
  if (ctx.servedModel !== undefined && ctx.servedModel !== ctx.model) {
    markEffortUnsupported(ctx.servedModel)
  }
  logForDebugging(
    `[effort] model ${ctx.model} rejected output_config.effort; latching unsupported and retrying without it.`,
    { level: 'warn' },
  )
  logEvent('tengu_effort_unsupported_retry', {
    model:
      ctx.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return 'retry:effort-unsupported'
}

/**
 * densable `dY` @184976154.
 * Named refuse (`Ewe` or 3P `Zct`) vs unnamed 400 guess (`rQ` or `rr&&400&&!eM&&!LU`).
 */
export function classifyThinkingBindingControlsRetry(
  error: unknown,
  ctx: ThinkingRetryContext,
): ThinkingDisplayRetryToken | null {
  if (
    !ctx.carriedBindingControls &&
    !ctx.lastRequestBetas.includes(THINKING_BINDING_CONTROLS_BETA_HEADER)
  ) {
    return null
  }
  const named =
    isThinkingBindingControlsRejected(error) ||
    (getAPIProvider() !== 'firstParty' &&
      isThinkingBindingControlsHeaderInError(error))
  const unnamed =
    getAPIProvider() !== 'firstParty' &&
    (isInvalidBetaFlagError(error) ||
      (ctx.allowUnnamedBindingGuess === true &&
        isHttp400(error) &&
        !ctx.alreadyClassified &&
        !isThinkingSignatureRejected(error) &&
        !isThinkingBoundToOtherConversation(error) &&
        !isThinkingDisplayUpdatesRejected(error) &&
        !isThinkingTokenCountBetaRejected(error) &&
        !isThinkingResumptionBetaRejected(error) &&
        !isEffortUnsupportedRejected(error) &&
        parseThinkingTypeRejection(error) === null))
  if (!named && !unnamed) return null
  stickyRejectBeta(THINKING_BINDING_CONTROLS_BETA_HEADER)
  logForDebugging(
    named
      ? '[thinking] server rejected the thinking-binding-controls beta; dropping the header and the block_binding value for this conversation and retrying.'
      : `[thinking] an HTTP 400 that does not name the thinking-binding-controls beta arrived on a request that carried it; guessing the platform refuses that beta, so retrying once without it and leaving it off for this conversation. The only loss is the API's list of the thinking blocks it dropped.`,
    { level: 'warn' },
  )
  logEvent('tengu_thinking_binding_rejected_retry', {
    model:
      ctx.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return 'retry:thinking-binding-controls'
}

/** densable `Vue` @184976971. */
export function classifyThinkingTokenCountRetry(
  error: unknown,
  ctx: ThinkingRetryContext,
): ThinkingDisplayRetryToken | null {
  if (
    !ctx.carriedTokenCount &&
    !ctx.lastRequestBetas.includes(THINKING_TOKEN_COUNT_BETA_HEADER)
  ) {
    return null
  }
  const unnamed =
    !ctx.bindingControlsOnThirdParty && isInvalidBetaFlagError(error)
  if (!unnamed && !isThinkingTokenCountBetaRejected(error)) return null
  stickyRejectBeta(THINKING_TOKEN_COUNT_BETA_HEADER)
  logForDebugging(
    '[thinking-token-count] server rejected the beta; dropping it for this conversation and retrying.',
    { level: 'warn' },
  )
  logEvent('tengu_thinking_token_count_rejected_retry', {
    model:
      ctx.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    provider:
      getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    unnamed,
  })
  return 'retry:thinking-token-count-beta'
}

/**
 * densable `Yue` @184977366.
 * Returns `surface:resume-prefill` (do not unique-retry) when `_t`.
 */
export function classifyThinkingResumptionRetry(
  error: unknown,
  lastRequestBetas: readonly string[],
  resumeIncompleteThinking: boolean,
): ThinkingDisplayRetryToken | 'surface:resume-prefill' | null {
  if (
    !lastRequestBetas.includes(THINKING_RESUMPTION_BETA_HEADER) ||
    !isThinkingResumptionBetaRejected(error)
  ) {
    return null
  }
  markThinkingResumptionRefused()
  logForDebugging(
    '[thinking-resumption] server rejected the thinking-resumption beta header; disabled for this process',
    { level: 'warn' },
  )
  logEvent('query_thinking_block_resumption', {
    reason:
      'header_rejected' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return resumeIncompleteThinking
    ? 'surface:resume-prefill'
    : 'retry:thinking-resumption-beta'
}

/** densable `JPe` @184832026 — header gate. */
export function shouldSendThinkingResumptionBeta(model: string): boolean {
  try {
    return (
      checkThinkingResumptionGate() &&
      densableExperimentalCapabilityBetas() &&
      modelSupportsISP(model) &&
      !getThinkingResumptionRefused()
    )
  } catch {
    logEvent('query_thinking_block_resumption', {
      reason:
        'header_gate_threw' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return false
  }
}

function checkThinkingResumptionGate(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_thinking_block_resumption',
    false,
  )
}

/** densable `Qx` @178435854 — Hx when() for bedrock/mantle. */
export function modelSupportsThinkingTokenCountOn3P(model: string): boolean {
  const r = firstPartyNameToCanonical(
    model
      .replace(/\[1m\]/gi, '')
      .trim()
      .toLowerCase(),
  )
  return r !== 'claude-opus-4-7'
}

/** densable eP Hx.when. */
export function shouldSendThinkingTokenCountBeta(model: string): boolean {
  if (!modelSupportsISP(model)) return false
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS)) {
    return false
  }
  if (isHipaaPolicy()) return false
  const provider = getAPIProvider()
  if (provider === 'firstParty') return true
  if (provider === 'bedrock' || provider === 'mantle') {
    return modelSupportsThinkingTokenCountOn3P(model)
  }
  return false
}

/** densable `_Oo` @178435904. */
export function providerSupportsThinkingBindingOn3P(
  provider: string,
  model: string,
): boolean {
  if (provider === 'vertex') return true
  if (provider !== 'bedrock' && provider !== 'mantle') return false
  const r = firstPartyNameToCanonical(
    model
      .replace(/\[1m\]/gi, '')
      .trim()
      .toLowerCase(),
  )
  return !(
    r.includes('claude-3-') ||
    r === 'claude-opus-4-0' ||
    r === 'claude-opus-4-1' ||
    r === 'claude-opus-4-5' ||
    r === 'claude-opus-4-6' ||
    r === 'claude-sonnet-4-0' ||
    r === 'claude-sonnet-4-5' ||
    r === 'claude-sonnet-4-6' ||
    r === 'claude-haiku-4-5'
  )
}

/**
 * Build-time gate (feature) + runtime gate (GrowthBook). The build flag
 * controls code inclusion in external builds; the GB flag controls rollout.
 */
export function isUltrathinkEnabled(): boolean {
  if (!feature('ULTRATHINK')) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_turtle_carbon', true)
}

/**
 * Check if text contains the "ultrathink" keyword.
 */
export function hasUltrathinkKeyword(text: string): boolean {
  return /\bultrathink\b/i.test(text)
}

/**
 * Find positions of "ultrathink" keyword in text (for UI highlighting/notification)
 */
export function findThinkingTriggerPositions(text: string): Array<{
  word: string
  start: number
  end: number
}> {
  const positions: Array<{ word: string; start: number; end: number }> = []
  // Fresh /g literal each call — String.prototype.matchAll copies lastIndex
  // from the source regex, so a shared instance would leak state from
  // hasUltrathinkKeyword's .test() into this call on the next render.
  const matches = text.matchAll(/\bultrathink\b/gi)

  for (const match of matches) {
    if (match.index !== undefined) {
      positions.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  return positions
}

const RAINBOW_COLORS: Array<keyof Theme> = [
  'rainbow_red',
  'rainbow_orange',
  'rainbow_yellow',
  'rainbow_green',
  'rainbow_blue',
  'rainbow_indigo',
  'rainbow_violet',
]

const RAINBOW_SHIMMER_COLORS: Array<keyof Theme> = [
  'rainbow_red_shimmer',
  'rainbow_orange_shimmer',
  'rainbow_yellow_shimmer',
  'rainbow_green_shimmer',
  'rainbow_blue_shimmer',
  'rainbow_indigo_shimmer',
  'rainbow_violet_shimmer',
]

export function getRainbowColor(
  charIndex: number,
  shimmer: boolean = false,
): keyof Theme {
  const colors = shimmer ? RAINBOW_SHIMMER_COLORS : RAINBOW_COLORS
  return colors[charIndex % colors.length]!
}

/**
 * densable `lo`/QO short id for capability probes (IQt/HQt/T5i).
 * Prefer firstPartyNameToCanonical so bare/dated ids match EHl catalog ids
 * (e.g. claude-opus-4-… → claude-opus-4-0).
 */
function densableLoCanonical(model: string): string {
  return firstPartyNameToCanonical(
    model
      .replace(/\[1m\]/gi, '')
      .trim()
      .toLowerCase(),
  )
}

/**
 * densable hj(e) — unknown-model capability default.
 * densable: firstParty || anthropicAws || anthropicGoogleCloud || foundry || mantle.
 * Local provider enum has firstParty/foundry (c5/mantle not separate API providers).
 */
function densableUnknownModelCapabilityDefault(): boolean {
  const provider = getAPIProvider()
  return provider === 'firstParty' || provider === 'foundry'
}

// TODO(inigo): add support for probing unknown models via API error detection
// densable T5i(e): Tde(e,"thinking") ?? !lo(e).includes("claude-3-")
export function modelSupportsThinking(model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(model, 'thinking')
  if (supported3P !== undefined) {
    return supported3P
  }
  if (process.env.USER_TYPE === 'ant') {
    if (resolveAntModel(model.toLowerCase())) {
      return true
    }
  }
  // IMPORTANT: Do not change thinking support without notifying the model
  // launch DRI and research. This can greatly affect model quality and bashing.
  // densable T5i: any non-claude-3 model supports thinking (all providers).
  return !densableLoCanonical(model).includes('claude-3-')
}

/**
 * densable HQt(e) — model rejects disabled thinking (must send thinking).
 * Known Claude catalog ids return false; ON(rejects_disabled_thinking) or
 * unknown → provider default. Only fable-5 has the cap in 2.1.219 EHl.
 */
export function modelRejectsDisabledThinking(model: string): boolean {
  const r = densableLoCanonical(model)
  if (
    r.includes('claude-3-') ||
    r === 'claude-opus-4-0' ||
    r === 'claude-opus-4-1' ||
    r === 'claude-opus-4-5' ||
    r === 'claude-opus-4-6' ||
    r === 'claude-opus-4-7' ||
    r === 'claude-opus-4-8' ||
    r === 'claude-opus-5' ||
    r === 'claude-sonnet-4-0' ||
    r === 'claude-sonnet-4-5' ||
    r === 'claude-sonnet-4-6' ||
    r === 'claude-sonnet-5' ||
    r === 'claude-haiku-4-5'
  ) {
    return false
  }
  if (modelHasCatalogCapability(r, 'rejects_disabled_thinking') === true) {
    return true
  }
  return densableUnknownModelCapabilityDefault()
}

/**
 * densable kQt(e) — [thinkingOverride, budgetHint].
 * HQt → [undefined, 2048]; else [false, 0].
 *
 * Local shape: used by side-query classifiers (yolo auto_mode) that want to
 * disable thinking. Main claude.ts path does not use this tuple — it builds
 * ThinkingConfig → Beta thinking and historically omits the field when off
 * rather than densable's explicit `{type:'disabled'}` firstParty branch.
 */
export function densableThinkingForceParams(
  model: string,
): [boolean | undefined, number] {
  if (modelRejectsDisabledThinking(model)) {
    return [undefined, 2048]
  }
  return [false, 0]
}

/**
 * densable ur for tool_choice demotion:
 *   Bo.type in {enabled,adaptive} || (Bo === undefined && HQt(model))
 *
 * Local: pass assembled wire `thinking` (or undefined). When HQt and the
 * field is omitted, treat as thinking-active so tool_choice:{type:'tool'}
 * is demoted to auto (API rejects tool forcing with thinking).
 */
export function isThinkingActiveForToolChoice(
  thinking: { type?: string } | undefined,
  model: string,
): boolean {
  if (thinking?.type === 'enabled' || thinking?.type === 'adaptive') {
    return true
  }
  return thinking === undefined && modelRejectsDisabledThinking(model)
}

/**
 * Whether callers may send `{ type: 'disabled' }` for this model.
 * densable HQt models reject it (400). Local residual env DISABLE_THINKING
 * is handled by callers separately — this is model capability only.
 */
export function maySendDisabledThinking(model: string): boolean {
  return !modelRejectsDisabledThinking(model)
}

/**
 * densable IQt(e) — adaptive thinking support.
 *   Tde(e,"adaptive_thinking") 3P override
 *   deny: claude-3-* | opus-4-0|4-1|4-5 | sonnet-4-0|4-5 | haiku-4-5
 *   ON(adaptive_thinking) || mythos-5 → true
 *   else hj(ny(e))
 */
export function modelSupportsAdaptiveThinking(model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(model, 'adaptive_thinking')
  if (supported3P !== undefined) {
    return supported3P
  }
  const r = densableLoCanonical(model)
  if (
    r.includes('claude-3-') ||
    r === 'claude-opus-4-0' ||
    r === 'claude-opus-4-1' ||
    r === 'claude-opus-4-5' ||
    r === 'claude-sonnet-4-0' ||
    r === 'claude-sonnet-4-5' ||
    r === 'claude-haiku-4-5'
  ) {
    return false
  }
  // densable: ON(r,"adaptive_thinking") || r==="claude-mythos-5"
  if (
    modelHasCatalogCapability(r, 'adaptive_thinking') === true ||
    r === 'claude-mythos-5'
  ) {
    return true
  }
  // IMPORTANT: Do not change adaptive thinking support without notifying the
  // model launch DRI and research. densable falls through to hj(ny) for unknown.
  return densableUnknownModelCapabilityDefault()
}

export type AdaptiveThinkingType = 'adaptive' | 'enabled'

/**
 * densable `p3n` @178432937.
 * `if (e !== void 0) return e;` then DISABLE_ADAPTIVE only when canonical
 * includes opus-4-6|sonnet-4-6; capability probe is `cNr(resolved)`.
 */
export function resolveAdaptiveThinkingType({
  runtimeOverride,
  resolvedModel,
  canonicalModel,
  disableAdaptiveEnv,
}: {
  runtimeOverride: unknown
  resolvedModel: string
  canonicalModel?: string
  disableAdaptiveEnv?: boolean
}): AdaptiveThinkingType {
  if (runtimeOverride !== undefined) {
    return runtimeOverride === 'adaptive' ? 'adaptive' : 'enabled'
  }
  const canonical = canonicalModel ?? densableLoCanonical(resolvedModel)
  const disable =
    (disableAdaptiveEnv ??
      isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING)) &&
    (canonical.includes('opus-4-6') || canonical.includes('sonnet-4-6'))
  return modelSupportsAdaptiveThinking(resolvedModel) && !disable
    ? 'adaptive'
    : 'enabled'
}

export type CompactThinkingStripSource = 'env' | 'thinking_type' | 'flag'

export type CompactThinkingStrip = {
  strip: boolean
  source?: CompactThinkingStripSource
  thinkingBlockCount: number
  thinkingType?: AdaptiveThinkingType
}

/**
 * densable `sdt` @183906925.
 * env `CLAUDE_CODE_WISE_COMET` wins when defined; non-adaptive never strips;
 * adaptive uses GB `tengu_wise_comet` default false.
 */
export function resolveCompactThinkingStripFlag(
  thinkingType: AdaptiveThinkingType,
): { strip: boolean; source: CompactThinkingStripSource } {
  const env = process.env.CLAUDE_CODE_WISE_COMET
  if (env !== undefined) {
    return { strip: isEnvTruthy(env), source: 'env' }
  }
  if (thinkingType !== 'adaptive') {
    return { strip: false, source: 'thinking_type' }
  }
  return {
    strip: getFeatureValue_CACHED_MAY_BE_STALE('tengu_wise_comet', false),
    source: 'flag',
  }
}

/**
 * densable `xPe` @184763949. Count tail thinking blocks (`B(content, LZ)`);
 * zero → no marker. Else `p3n` then `sdt`. Gold `qde` is the cached AIP latch.
 */
export function resolveCompactThinkingStrip(
  messages: readonly Message[],
  model: string,
): CompactThinkingStrip {
  let blocks = 0
  for (const message of messages) {
    blocks += thinkingBlockCount(message)
  }
  if (blocks === 0) {
    return { strip: false, thinkingBlockCount: 0 }
  }
  const resolvedModel = model.includes('application-inference-profile')
    ? ((getInferenceProfileBackingModelCached(model) as string | undefined) ??
      model)
    : model
  const thinkingType = resolveAdaptiveThinkingType({
    runtimeOverride: getThinkingTypeOverride(model),
    resolvedModel,
    canonicalModel: firstPartyNameToCanonical(resolvedModel),
  })
  const flag = resolveCompactThinkingStripFlag(thinkingType)
  return {
    strip: flag.strip,
    source: flag.source,
    thinkingBlockCount: blocks,
    thinkingType,
  }
}

export function shouldEnableThinkingByDefault(): boolean {
  if (process.env.MAX_THINKING_TOKENS) {
    return parseInt(process.env.MAX_THINKING_TOKENS, 10) > 0
  }

  const { settings } = getSettingsWithErrors()
  if (settings.alwaysThinkingEnabled === false) {
    return false
  }

  // IMPORTANT: Do not change default thinking enabled value without notifying
  // the model launch DRI and research. This can greatly affect model quality and
  // bashing.

  // Enable thinking by default unless explicitly disabled.
  return true
}
