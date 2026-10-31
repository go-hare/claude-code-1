/**
 * densable 2.1.289 ultraplan `jj` / `C$t` / `a5n` / `XS` / `S$r` / `k1e`.
 * Screening plus `/ultraplan` slash (`BZt`). Never `export function jj|C$t|XS|S$r|k1e|t7e|g`.
 */
import {
  isPolicyEnforcedOrHintedByRefusedCache,
  leftoverPolicyLimitsDu,
  REQUIRE_TRUSTED_DEVICES,
} from '../cli/leftoverTulip.js'
import { parseReferences } from '../history.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  getClaudeAIOAuthTokens,
  getOauthAccountInfo,
  hasProfileScope,
  isClaudeAISubscriber,
} from './auth.js'
import type { PastedContent } from './config.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from './model/providers.js'
import { getPrivacyLevel } from './privacyLevel.js'
import { getBootstrapSession } from './sessionRoot.js'
import {
  findKeywordTriggerPositions,
  type TriggerPosition,
} from './workflowKeyword.js'

export type { TriggerPosition }

const ULTRAPLAN_CCR_SUBS = new Set(['pro', 'max', 'team', 'enterprise'])

/** leftover `lRe` — unix-socket auth placeholder (JD / `_B`). */
const UNIX_SOCKET_AUTH_PLACEHOLDER = 'ssh-placeholder'

/** densable `j5e` — FWe skip when text shorter, unless ultraplan. */
const INLINE_GAP_MIN = 20
/** densable `uzn` — min gap length when stamping slashNameOnly. */
const SLASH_NAME_GAP_MIN = 1

/**
 * densable `kRe` — `/command` spans in typed text.
 */
function slashCommandSpans(
  text: string,
): Array<{ start: number; end: number }> {
  const re = /(^|[\s。、？！])(\/[a-zA-Z][a-zA-Z0-9.:\-_]*)/g
  const out: Array<{ start: number; end: number }> = []
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const prefix = match[1] ?? ''
    const cmd = (match[2] ?? '').replace(/\.+$/, '')
    const start = match.index + prefix.length
    out.push({ start, end: start + cmd.length })
  }
  return out
}

/**
 * densable `PMt` — next negative inline id.
 */
function nextNegativePasteId(pasted: Record<number, PastedContent>): number {
  const keys = Object.keys(pasted)
    .map(Number)
    .filter(n => Number.isSafeInteger(n) && n > -4_294_967_296)
  return Math.min(0, ...keys) - 1
}

/**
 * densable `pzn` — stamp one typed-gap as inline paste.
 */
function inlineGapPaste(
  gap: string,
  pasted: Record<number, PastedContent>,
  minLength = INLINE_GAP_MIN,
): PastedContent | undefined {
  const content = gap.trim()
  if (content.length < minLength) return undefined
  return {
    id: nextNegativePasteId(pasted),
    type: 'text',
    content,
    inline: true,
  }
}

/**
 * densable `FWe` — stamp typed gaps between `vd` placeholders as inline pastes.
 * `slashNameOnly` when `M`.
 */
function stampTypedGapsAsInline(
  pasted: Record<number, PastedContent>,
  text: string,
  slashNameOnly = false,
): Record<number, PastedContent> {
  if (
    text.trim().length < INLINE_GAP_MIN &&
    !/ultraplan/i.test(text) &&
    !slashNameOnly
  ) {
    return pasted
  }
  let next = pasted
  let cursor = 0
  const gaps: string[] = []
  for (const ref of pastePlaceholderRefs(text)) {
    if (pasted[ref.id] === undefined) continue
    gaps.push(text.slice(cursor, ref.index))
    cursor = ref.index + ref.match.length
  }
  gaps.push(text.slice(cursor))
  for (const gap of gaps) {
    const item = inlineGapPaste(
      gap,
      next,
      slashNameOnly ? SLASH_NAME_GAP_MIN : INLINE_GAP_MIN,
    )
    if (!item) continue
    next = {
      ...next,
      [item.id]: slashNameOnly ? { ...item, slashNameOnly: true } : item,
    }
  }
  return next
}

/**
 * densable `UG` — visual path stamps FWe; else slash-command text stamps
 * `slashNameOnly:!0`.
 */
export function stampSlashNameOnlyPastedGaps(
  pasted: Record<number, PastedContent>,
  text: string,
  visual = false,
): Record<number, PastedContent> {
  const stamped = visual ? stampTypedGapsAsInline(pasted, text) : pasted
  if (stamped === pasted && slashCommandSpans(text).length > 0) {
    return stampTypedGapsAsInline(pasted, text, true)
  }
  return stamped
}

/**
 * densable `vd` — paste placeholders; gold filters `id>0`.
 * Local `parseReferences` already matches gold `NO` + `id>0`.
 */
function pastePlaceholderRefs(
  text: string,
): Array<{ id: number; match: string; index: number }> {
  return parseReferences(text)
}

/**
 * densable `k1e` — inline text paste contents, longest first.
 * `slashNameOnly` skipped unless `includeSlashNameOnly`.
 */
function inlinePastedTexts(
  pasted: Record<number, PastedContent> | undefined,
  includeSlashNameOnly = false,
): string[] {
  if (pasted === undefined) return []
  const texts = new Set<string>()
  for (const item of Object.values(pasted)) {
    if (
      item.type === 'text' &&
      item.inline === true &&
      item.content !== '' &&
      (includeSlashNameOnly || item.slashNameOnly !== true)
    ) {
      texts.add(item.content)
    }
  }
  return [...texts].sort((a, b) => b.length - a.length)
}

/**
 * densable `S$r` — ranges where inline paste content sits in typed gaps
 * between `[Pasted text #N]` / `[Image #N]` placeholders (`vd`).
 */
function pastedPlaceholderGapRanges(
  text: string,
  pasted: Record<number, PastedContent> | undefined,
  includeSlashNameOnly = false,
): Array<[number, number]> {
  if (pasted === undefined) return []
  const contents = inlinePastedTexts(pasted, includeSlashNameOnly)
  if (contents.length === 0) return []
  const ranges: Array<[number, number]> = []
  const cover = (from: number, to: number): void => {
    let cursor = from
    for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
      if (end <= cursor || start >= to) continue
      if (start > cursor) ranges.push([cursor, start])
      cursor = Math.max(cursor, end)
    }
    if (cursor < to) ranges.push([cursor, to])
  }
  const scanGap = (from: number, to: number): void => {
    const slice = text.slice(from, to)
    for (const content of contents) {
      let at = slice.indexOf(content)
      while (at !== -1) {
        cover(from + at, from + at + content.length)
        at = slice.indexOf(content, at + 1)
      }
    }
  }
  let cursor = 0
  for (const ref of pastePlaceholderRefs(text)) {
    if (pasted[ref.id] === undefined) continue
    scanGap(cursor, ref.index)
    cursor = ref.index + ref.match.length
  }
  scanGap(cursor, text.length)
  return ranges.sort((a, b) => a[0] - b[0])
}

function overlaps(
  hit: TriggerPosition,
  ranges: Array<[number, number]>,
): boolean {
  return ranges.some(([start, end]) => hit.start < end && hit.end > start)
}

/**
 * densable `YS(e,"ultraplan")` / `XS`.
 */
export function findUltraplanTriggerPositions(text: string): TriggerPosition[] {
  return findKeywordTriggerPositions(text, 'ultraplan')
}

/**
 * densable `a5n` — keyword hits minus `S$r` paste-gap ranges.
 */
export function findUltraplanKeywordHits(
  text: string,
  pasted?: Record<number, PastedContent>,
): TriggerPosition[] {
  const pastedTexts = inlinePastedTexts(pasted)
  const hits = findUltraplanTriggerPositions(text)
  if (pastedTexts.length === 0) return hits
  if (pastedTexts.some(g => /ultraplan/i.test(g) && !text.includes(g))) {
    return []
  }
  const ranges = pastedPlaceholderGapRanges(text, pasted)
  return hits.filter(h => !overlaps(h, ranges))
}

/** densable `C$t`. */
export function hasUltraplanKeyword(
  text: string,
  pasted?: Record<number, PastedContent>,
): boolean {
  return findUltraplanKeywordHits(text, pasted).length > 0
}

/**
 * densable keyword rewrite — first hit becomes `plan` so CCR stays grammatical.
 */
export function replaceUltraplanKeyword(text: string): string {
  const [trigger] = findUltraplanTriggerPositions(text)
  if (!trigger) return text
  const before = text.slice(0, trigger.start)
  const after = text.slice(trigger.end)
  if (!(before + after).trim()) return ''
  return before + trigger.word.slice('ultra'.length) + after
}

/** densable `jn` — remote workspace (`he.caps().workspace`). */
export function isRemoteWorkspace(): boolean {
  return getBootstrapSession().surfaceCapabilities.caps().workspace === 'remote'
}

/**
 * densable `JD` — unix-socket tunnel when auth is the ssh placeholder.
 */
function isUnixSocketTunnelOpen(): boolean {
  const n = process.env.ANTHROPIC_UNIX_SOCKET
  if (!n) return false
  const oauth = process.env.CLAUDE_CODE_OAUTH_TOKEN
  const apiKey = process.env.ANTHROPIC_API_KEY
  return (
    !process.env.ANTHROPIC_AUTH_TOKEN &&
    ((oauth === UNIX_SOCKET_AUTH_PLACEHOLDER && !apiKey) ||
      (apiKey === UNIX_SOCKET_AUTH_PLACEHOLDER && !oauth))
  )
}

/**
 * densable `S2` — `Jn() && (JD()!==void 0 || !ANTHROPIC_UNIX_SOCKET && ag())`.
 */
function isFirstPartyCcrSurface(): boolean {
  if (getAPIProvider() !== 'firstParty') return false
  if (isUnixSocketTunnelOpen()) return true
  if (process.env.ANTHROPIC_UNIX_SOCKET) return false
  return isFirstPartyAnthropicBaseUrl()
}

/**
 * densable `u` — non-firstParty unless `PROVIDER_MANAGED_BY_HOST` (JS-truthy).
 */
function isNonFirstPartyUnlessHostManaged(): boolean {
  if (process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST) return false
  return getAPIProvider() !== 'firstParty'
}

/**
 * densable `go()!=null` — gateway auth session.
 */
function hasGatewayAuthSession(): boolean {
  try {
    const { getGatewayAuth } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./gatewayEnv.js') as typeof import('./gatewayEnv.js')
    return getGatewayAuth() != null
  } catch {
    return false
  }
}

/**
 * densable `l` — custom OAuth URL set.
 */
function hasCustomOauthUrl(): boolean {
  return process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL !== undefined
}

/**
 * densable `Ih` — `u()||go()!=null||YL()||l()`. `YL=Ivt()!=="default"`.
 */
function isGrowthBookEvalIneligible(): boolean {
  return (
    isNonFirstPartyUnlessHostManaged() ||
    hasGatewayAuthSession() ||
    getPrivacyLevel() !== 'default' ||
    hasCustomOauthUrl()
  )
}

/**
 * densable `th` — `!DISABLE_GROWTHBOOK && Kz()`; `Kz=!Ih`.
 * JS-truthy `DISABLE_GROWTHBOOK` (including `"0"`).
 */
function isGrowthBookLive(): boolean {
  if (process.env.DISABLE_GROWTHBOOK) return false
  return !isGrowthBookEvalIneligible()
}

/**
 * densable `JXo` — `u()||go()!=null||l()`.
 */
function isNonFirstPartyOrCustomOauthSurface(): boolean {
  return (
    isNonFirstPartyUnlessHostManaged() ||
    hasGatewayAuthSession() ||
    hasCustomOauthUrl()
  )
}

/**
 * densable `z` — `C6t("require_trusted_devices")||DU()`, catch → true.
 * `DU` = `!C_() ? false : dS()===null || failOpenVerdict`.
 */
function isRequireTrustedDevicesBlocking(): boolean {
  try {
    if (isPolicyEnforcedOrHintedByRefusedCache(REQUIRE_TRUSTED_DEVICES)) {
      return true
    }
    return leftoverPolicyLimitsDu()
  } catch {
    return true
  }
}

/**
 * densable `g` — CCR subscription rollout (not the GB flag arm).
 * Fail closed on: `th()`, JS-truthy `DISABLE_GROWTHBOOK`, `Ivt()!=="no-telemetry"`,
 * `JXo`, `!S2`, `!p()`, missing `organizationUuid`, `z()`.
 */
function isCcrSubscriptionRollout(): boolean {
  if (isGrowthBookLive() || process.env.DISABLE_GROWTHBOOK) return false
  if (getPrivacyLevel() !== 'no-telemetry') return false
  if (isNonFirstPartyOrCustomOauthSurface()) return false
  if (!isFirstPartyCcrSurface()) return false
  try {
    if (!hasProfileScope()) return false
    if (!getOauthAccountInfo()?.organizationUuid) return false
    if (isRequireTrustedDevicesBlocking()) return false
    const tokens = getClaudeAIOAuthTokens()
    const sub = tokens?.refreshToken ? (tokens.subscriptionType ?? null) : null
    return sub !== null && ULTRAPLAN_CCR_SUBS.has(sub)
  } catch {
    return false
  }
}

/**
 * densable `t7e` — `S2()&&c()&&(k("tengu_ccr_bridge")||g())`.
 */
export function isUltraplanCcrEligible(): boolean {
  if (!isFirstPartyCcrSurface() || !isClaudeAISubscriber()) return false
  if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_ccr_bridge', false) === true) {
    return true
  }
  return isCcrSubscriptionRollout()
}

/**
 * densable `jj` — GB ultraplan_config.enabled && t7e && !jn.
 */
export function isUltraplanProductEnabled(): boolean {
  const cfg = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_ultraplan_config',
    null as { enabled?: boolean } | null,
  )
  return (
    cfg !== null &&
    typeof cfg === 'object' &&
    cfg.enabled === true &&
    isUltraplanCcrEligible() &&
    !isRemoteWorkspace()
  )
}
