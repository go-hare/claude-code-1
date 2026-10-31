/**
 * densable 2.1.289 workshop `authoringProgress` (`N`/`U`/`W`/`G`/`x`/`b`).
 * Spinner host is leftoverIhr `Uxe.setSpinnerMessage`.
 * Never `export function N|U|W|G|Rx|yQ|X`.
 */
import { FileEditTool } from '@claude-code/builtin-tools/tools/FileEditTool/FileEditTool.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FileWriteTool } from '@claude-code/builtin-tools/tools/FileWriteTool/FileWriteTool.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileWriteTool/prompt.js'
import {
  isPolicyLimitsAllowed,
  isPolicyLimitsEligible,
  leftoverPolicyLimitsHost,
  leftoverPolicyLimitsIe,
  leftoverPolicyLimitsRh,
  leftoverTaintsInclude,
} from '../../cli/leftoverTulip.js'
import {
  getArtifactSdkDefaultOffReason,
  isArtifactToolDisabled,
} from '../../utils/artifactGates.js'
import {
  getAnthropicApiKeyWithSource,
  getClaudeAIOAuthTokens,
  getConfiguredApiKeyHelper,
  getSubscriptionType,
  isClaudeAISubscriber,
  oauthScopesAcceptedByValidate,
} from '../../utils/auth.js'
import { leftoverIhrUxe } from '../../utils/collapseReadSearch.js'
import { isBareMode } from '../../utils/envUtils.js'
import { logError } from '../../utils/log.js'
import {
  getAnthropicProfileSource,
  isProfileImplicitUserOauth,
  noteImplicitProfileSkippedStoredLogin,
  noteUsingProfileAuth,
} from '../../utils/anthropicProfile.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { truncateToWidth } from '../../utils/truncate.js'
import { ensureDualInkCurrent } from '@anthropic/ink'
import { logEvent } from '../analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

/** densable DualInk `A().authoringProgress` slot. */
export type AuthoringProgressSlot = {
  raw: string
  flushedAt: number
  matched: boolean | null
  shown: boolean
  batch: boolean
}

/** densable DualInk `A().authoringProgress` bag. */
export type AuthoringProgressBag = {
  slotsByBlockIndex: Map<number, AuthoringProgressSlot>
  failureReported: boolean
}

/** densable DualInk `A().artifactPolicyFetchAnswer` — G_n fetch fail stash. */
export type ArtifactPolicyFetchAnswer = {
  success: boolean
  retrying?: boolean
  errorCode?: string
  httpStatus?: number | null
}

const FLUSH_MS = 100
const MAX_SLOTS = 8
const RAW_CAP = 131_072
const MATCH_CAP = 4096
const DECISION_ID_CLAMP = 40
const DECISION_ID_RE = /^[A-Za-z0-9._/-]+$/
const WORKSHOP_SUBS = new Set(['pro', 'max', 'team', 'enterprise'])

class WorkshopProgressGate {
  gate: (() => boolean) | null = null
  register(fn: () => boolean): void {
    this.gate = fn
  }
  isOpen(): boolean {
    return this.gate?.() === true
  }
}

const workshopProgressGate = new WorkshopProgressGate()

/** densable `tzo`. */
export function registerWorkshopProgressGate(fn: () => boolean): void {
  workshopProgressGate.register(fn)
}

/** densable `nzo`. */
export function isWorkshopProgressGateOpen(): boolean {
  return workshopProgressGate.isOpen()
}

/**
 * densable DualInk `X()` — `a().current??=A()`.
 */
function dualInkMint(): Record<string, unknown> {
  return ensureDualInkCurrent()
}

/**
 * densable DualInk `A().authoringProgress`.
 */
function authoringBag(): AuthoringProgressBag {
  return dualInkMint().authoringProgress as AuthoringProgressBag
}

/**
 * densable `yQ` — stream tool name → registered key in Map `_`.
 * Gold iterates live `_`; analog is `getAllBaseTools()` (Write/Edit fallback).
 */
const WRITE_EDIT_BY_NAME = new Map<string, { name: string }>([
  [FileWriteTool.name, FileWriteTool],
  [FileEditTool.name, FileEditTool],
])

function registeredToolMap(): Iterable<[string, { name: string }]> {
  try {
    const { getAllBaseTools } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../tools.js') as typeof import('../../tools.js')
    return getAllBaseTools().map(t => [t.name, t] as [string, { name: string }])
  } catch {
    return WRITE_EDIT_BY_NAME
  }
}

function registeredWriteEditKey(streamName: string): string | undefined {
  for (const [key, tool] of registeredToolMap()) {
    if (tool.name === streamName) return key
  }
}

/**
 * densable `Jc` — eval stub dir.
 */
function evalArtifactStubDir(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const dir = env.CLAUDE_CODE_EVAL_ARTIFACT_STUB_DIR
  return typeof dir === 'string' && dir.length > 0 ? dir : null
}

/**
 * densable `ee` / `O` — local-agent / coworker surfaces.
 */
function isWorkshopSurfaceExcluded(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const entry = env.CLAUDE_CODE_ENTRYPOINT
  return (
    entry === 'local-agent' || entry?.startsWith('claude-coworker') === true
  )
}

const WORKSHOP_DESKTOP_ENTRYPOINTS = new Set([
  'claude-desktop',
  'claude-desktop-3p',
  'local-agent',
])

/**
 * densable `_d` — desktop / local-agent entrypoints.
 */
function isWorkshopDesktopEntrypoint(): boolean {
  const entry = process.env.CLAUDE_CODE_ENTRYPOINT
  return entry !== undefined && WORKSHOP_DESKTOP_ENTRYPOINTS.has(entry)
}

/**
 * densable `mO` — OAuth token file descriptor.
 */
function hasOauthTokenFileDescriptor(): boolean {
  try {
    const { getOAuthTokenFromFileDescriptor } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/authFileDescriptor.js') as typeof import('../../utils/authFileDescriptor.js')
    return Boolean(getOAuthTokenFromFileDescriptor())
  } catch {
    return Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR)
  }
}

/**
 * densable `Hnr` — `oW||unix||pr||nc||AUTH_TOKEN||OAUTH_TOKEN||mO||Ph||!Jn`.
 * `pr` = CLAUDE_CODE_REMOTE || `_d`. `Ph` skipped when `skipApiKeyHelper`.
 */
function isWorkshopHnr(skipApiKeyHelper = false): boolean {
  if (isBareMode()) return true
  if (process.env.ANTHROPIC_UNIX_SOCKET) return true
  if (process.env.CLAUDE_CODE_REMOTE || isWorkshopDesktopEntrypoint()) {
    return true
  }
  if (process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST) return true
  if (process.env.ANTHROPIC_AUTH_TOKEN) return true
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return true
  if (hasOauthTokenFileDescriptor()) return true
  if (!skipApiKeyHelper && Boolean(getConfiguredApiKeyHelper())) return true
  try {
    if (getAPIProvider() !== 'firstParty') return true
  } catch {
    return true
  }
  return false
}

/**
 * densable `gd` — `nJo() && !Hnr()`; profile-implicit + szt + eqt → YH skip.
 */
function isWorkshopGd(skipApiKeyHelper = false): boolean {
  if (getAnthropicProfileSource() === null) return false
  if (isWorkshopHnr(skipApiKeyHelper)) return false
  if (isProfileImplicitUserOauth() && isWorkshopOzt()) {
    noteImplicitProfileSkippedStoredLogin()
    return false
  }
  if (!skipApiKeyHelper) noteUsingProfileAuth()
  return true
}

/**
 * densable `cM` — `qZ()===null && gd()`.
 */
function isWorkshopCm(): boolean {
  try {
    const { key } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    })
    if (key !== null) return false
  } catch {
    return false
  }
  try {
    return isWorkshopGd()
  } catch {
    return false
  }
}

/**
 * densable `ozt`/`szt` — `WU(scopes)&&accessToken`. `WU` analog: validate scopes.
 */
function isWorkshopOzt(): boolean {
  const tokens = getClaudeAIOAuthTokens()
  return (
    oauthScopesAcceptedByValidate(tokens?.scopes) &&
    Boolean(tokens?.accessToken)
  )
}

/**
 * densable `de` — `mw()==="env-quad"` then `cM()&&ozt()`.
 */
function isWorkshopEnvQuadArm(): boolean {
  if (getAnthropicProfileSource() !== 'env-quad') return false
  try {
    return isWorkshopCm() && isWorkshopOzt()
  } catch {
    return false
  }
}

/**
 * densable `Vht` — `ft()||de()`. `ft` = Claude.ai subscriber (`Rl`+scopes).
 */
function isWorkshopVht(): boolean {
  return isClaudeAISubscriber() || isWorkshopEnvQuadArm()
}

/**
 * densable `qht` — `!ft()&&de()`.
 */
function isWorkshopQht(): boolean {
  return !isClaudeAISubscriber() && isWorkshopEnvQuadArm()
}

/**
 * densable `Y` — qht withhold reasons; null means Fht open.
 * `plan_unreadable` / `org_policy_unverifiable` / `policy_unavailable` /
 * `org_denied` / `latched` / `cache_miss` / `policy_route_missing`.
 */
function workshopY(): string | null {
  if (!isWorkshopQht()) return null
  const sub = getClaudeAIOAuthTokens()?.subscriptionType ?? null
  if (sub === null) return 'plan_unreadable'
  if (sub !== 'pro' && sub !== 'max') return 'org_policy_unverifiable'
  if (!isPolicyLimitsEligible()) return 'policy_unavailable'
  if (isPolicyLimitsAllowed('allow_cobalt_plinth')) return null
  const n = leftoverPolicyLimitsRh('allow_cobalt_plinth') ?? 'org_denied'
  switch (n) {
    case 'org_denied':
    case 'latched':
    case 'cache_miss':
      return n
    case 'route_missing':
      return 'policy_route_missing'
    default:
      return 'org_denied'
  }
}

/**
 * densable `Fht` / `ce` — qht → `Y()===null`; else `E(ar())` && `sn()`.
 */
function isWorkshopFht(): boolean {
  if (isWorkshopQht()) return workshopY() === null
  const sub = getSubscriptionType()
  if (sub !== null && !WORKSHOP_SUBS.has(sub)) return false
  return isPolicyLimitsAllowed('allow_cobalt_plinth')
}

/**
 * densable `G_n` — qht skip; else eligible-sub + cache_miss/route_missing
 * unless `der` (org_denied). Analog: getPolicyDenyKind cache_miss.
 */
function workshopGn(): {
  cause: string
  outcome?: ArtifactPolicyFetchAnswer
} | null {
  if (isWorkshopQht()) return null
  const sub = getSubscriptionType()
  if (sub !== null && !WORKSHOP_SUBS.has(sub)) return null
  const n = leftoverPolicyLimitsRh('allow_cobalt_plinth')
  const mint = dualInkMint()
  if (n !== 'cache_miss' && n !== 'route_missing') {
    mint.artifactPolicyFetchAnswer = null
    return null
  }
  const policyHost = leftoverPolicyLimitsHost()
  if (
    isPolicyLimitsEligible() &&
    (policyHost.hintedDeniedKeys.includes('allow_cobalt_plinth') ||
      leftoverTaintsInclude('allow_cobalt_plinth'))
  ) {
    return null
  }
  const cause =
    n === 'route_missing' ? 'policy_route_missing' : 'policy_fetch_failed'
  const outcome = policyHost.lastFetchOutcome
  if (outcome !== null && !outcome.success && leftoverPolicyLimitsIe(outcome)) {
    mint.artifactPolicyFetchAnswer = outcome
    return { cause, outcome }
  }
  const stashed =
    mint.artifactPolicyFetchAnswer as ArtifactPolicyFetchAnswer | null
  if (stashed !== null) {
    return { cause, outcome: stashed }
  }
  return { cause }
}

/**
 * densable `W` — `!U()→growthbook_off`; `qht||Fht→null`; `G_n()!=null→null`;
 * else `admin_policy`. `U` analog: CLAUDE_CODE_ARTIFACT force or GB plinth.
 */
function workshopW(env: NodeJS.ProcessEnv = process.env): string | null {
  const artifactForce =
    env.CLAUDE_CODE_ARTIFACT !== undefined &&
    env.CLAUDE_CODE_ARTIFACT !== '' &&
    env.CLAUDE_CODE_ARTIFACT !== '0' &&
    env.CLAUDE_CODE_ARTIFACT.toLowerCase() !== 'false' &&
    env.CLAUDE_CODE_ARTIFACT.toLowerCase() !== 'off'
  const u =
    artifactForce ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_plinth', false) === true
  if (!u) return 'growthbook_off'
  if (isWorkshopQht() || isWorkshopFht()) return null
  if (workshopGn() !== null) return null
  return 'admin_policy'
}

/**
 * densable `M7n` — `g()→switched_off`; stub → null; else `I()??W()`.
 * `g` here is artifact `!Lht().enabled` (not t7e `g`).
 * `I` = surface_excluded || `D()`.
 */
function workshopM7n(env: NodeJS.ProcessEnv = process.env): string | null {
  if (isArtifactToolDisabled(env)) return 'switched_off'
  if (evalArtifactStubDir(env) !== null) return null
  if (isWorkshopSurfaceExcluded(env)) return 'surface_excluded'
  const withhold = getArtifactSdkDefaultOffReason(env)
  if (withhold !== null) return withhold
  return workshopW(env)
}

/**
 * densable `OT` — `M7n()===null`.
 */
function isWorkshopOt(env: NodeJS.ProcessEnv = process.env): boolean {
  return workshopM7n(env) === null
}

/**
 * densable `Rx` — eval stub → OT(); else Vht && OT && Fht.
 */
export function isWorkshopArtifactEligible(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (evalArtifactStubDir(env) !== null) return isWorkshopOt(env)
  return isWorkshopVht() && isWorkshopOt(env) && isWorkshopFht()
}

function runHook(fn: () => void, label: string): void {
  try {
    fn()
  } catch (err) {
    logError(err)
    void label
    const bag = authoringBag()
    if (!bag.failureReported) {
      bag.failureReported = true
      logEvent('workshop_authoring_progress', {
        reason: 'hook_failed' as never,
      })
    }
  }
}

/** densable `x` — `CLAUDE_WORKSHOP_PROGRESS!==false` AND nzo. */
export function isWorkshopProgressEnabled(): boolean {
  return (
    process.env.CLAUDE_WORKSHOP_PROGRESS !== 'false' &&
    isWorkshopProgressGateOpen()
  )
}

/** densable `P`. */
export function extractFilePaths(raw: string): string[] {
  const paths: string[] = []
  for (const match of raw
    .slice(0, MATCH_CAP)
    .matchAll(/"(?:file_path|path)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    if (match[1] !== undefined) paths.push(match[1])
  }
  return paths
}

/** densable `b`. */
export function deriveAuthoringProgress(raw: string, batch = false): string {
  let lastContent = -1
  for (const match of raw.matchAll(
    /"(?:new_string|new_str|content)"\s*:\s*"/g,
  )) {
    lastContent = (match.index ?? 0) + match[0].length
  }
  if (lastContent < 0) return ''
  const rest = raw.slice(lastContent)
  if (batch && /"path"\s*:/.test(rest)) return ''
  if (
    rest.includes('id=\\"ws-decisions\\"') ||
    rest.includes('id="ws-decisions"')
  ) {
    return 'wiring up the decisions'
  }
  let n = 0
  let lastId = ''
  let lastIdAt = -1
  const idRe = /data-decision-id=\\?"([^"\\]+)\\?"/g
  for (const match of rest.matchAll(idRe)) {
    n += 1
    lastId = match[1] ?? ''
    lastIdAt = match.index ?? -1
  }
  const figRe = /<figure\b/g
  let figures = 0
  let lastFigAt = -1
  for (const match of rest.matchAll(figRe)) {
    figures += 1
    lastFigAt = match.index ?? -1
  }
  if (lastFigAt > lastIdAt) return `drawing figure ${figures}`
  if (n > 0) {
    return DECISION_ID_RE.test(lastId)
      ? `drawing decision ${n} — ${truncateToWidth(lastId, DECISION_ID_CLAMP)}`
      : `drawing decision ${n}`
  }
  return 'authoring the design page'
}

function flushSlot(slot: {
  raw: string
  flushedAt: number
  matched: boolean | null
  shown: boolean
  batch: boolean
}): void {
  if (slot.raw.length < RAW_CAP) {
    /* keep */
  }
  if (slot.matched === null) {
    const paths = extractFilePaths(slot.raw)
    if (paths.some(p => p.endsWith('.workshop.html'))) {
      slot.matched = true
    } else if (
      slot.raw.length >= MATCH_CAP ||
      (paths.length > 0 && !slot.batch)
    ) {
      slot.matched = false
      slot.raw = ''
      return
    } else {
      return
    }
  }
  const now = Date.now()
  if (now - slot.flushedAt < FLUSH_MS) return
  slot.flushedAt = now
  const message = deriveAuthoringProgress(slot.raw, slot.batch)
  if (!message) return
  slot.shown = true
  leftoverIhrUxe.setSpinnerMessage(
    truncateToWidth(message, Math.max(1, (process.stdout.columns || 80) - 2)),
  )
}

/** densable `N`. */
export function resetAuthoringProgress(): void {
  runHook(() => {
    const { slotsByBlockIndex } = authoringBag()
    let shown = false
    for (const slot of slotsByBlockIndex.values()) shown = shown || slot.shown
    slotsByBlockIndex.clear()
    if (shown) leftoverIhrUxe.setSpinnerMessage(null)
  }, 'reset')
}

/** densable `U`. */
export function onToolUseStart(index: number, name: string): void {
  const mapped = registeredWriteEditKey(name)
  const key = mapped ?? name
  if (key !== FILE_WRITE_TOOL_NAME && key !== FILE_EDIT_TOOL_NAME) return
  runHook(() => {
    const { slotsByBlockIndex } = authoringBag()
    if (slotsByBlockIndex.size >= MAX_SLOTS || !isWorkshopProgressEnabled()) {
      return
    }
    slotsByBlockIndex.set(index, {
      raw: '',
      flushedAt: 0,
      matched: null,
      shown: false,
      // gold `batch:e!==void 0` — yQ resolved a registered key
      batch: mapped !== undefined,
    })
  }, 'start')
}

/** densable `W`. */
export function onInputJsonDelta(index: number, delta: string): void {
  const slot = authoringBag().slotsByBlockIndex.get(index)
  if (!slot || slot.matched === false) return
  runHook(() => {
    if (slot.raw.length < RAW_CAP) slot.raw += delta
    flushSlot(slot)
  }, 'delta')
}

/** densable `G`. */
export function onToolUseStop(index: number): void {
  const { slotsByBlockIndex } = authoringBag()
  const slot = slotsByBlockIndex.get(index)
  if (!slot) return
  runHook(() => {
    slotsByBlockIndex.delete(index)
    if (slot.shown) {
      leftoverIhrUxe.setSpinnerMessage(null)
      logEvent('workshop_authoring_progress', {})
    }
  }, 'stop')
}

/** densable `UQ` — `Rx() && tengu_gable_onyx_sluice`. */
export function isWorkshopProgressFeatureOn(): boolean {
  return (
    isWorkshopArtifactEligible() &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_gable_onyx_sluice', false) ===
      true
  )
}

registerWorkshopProgressGate(isWorkshopProgressFeatureOn)
