/**
 * densable 2.1.289 Artifact read-permission consent surfaces / mode helpers.
 *
 * chunk-cx175mfd: `Im` / `b_` / `vg` (`de` → getToolPermissionContextFromLayers).
 * chunk-ey40d6gf: `DW` (`Ce` → !getIsInteractive), `OW` (`ut` classifierRouted
 * → isClassifierRoutedSafetyCheck). chunk-7h50ka43: `qi` (`vf` →
 * isAutoModeActive). chunk-03h7hbtr: `Vqe` / `pr` (chunk-x2pwb441 `Lj` /
 * `lut`). chunk-aw8dyr84: `PN` / `B1n` / `xAr`. chunk-xwgfbhhb: `l0`
 * (chunk-fmsfw5my `ik`; chunk-vcty6483 `yE` / `Ju` / `_` / `W$` / `Eno`).
 * chunk-2vfztqzn: `Yw`. chunk-g005zav1: `Q6` (chunk-kyy8aykh `K0t`,
 * chunk-7w7dh6am `Yke`, chunk-88rhtpqe `X().frozenCopyFrom`).
 */
import { stringWidth } from '@anthropic/ink'
import { feature } from 'bun:bundle'
import { getIsInteractive } from '../../../bootstrap/state.js'
import { getToolPermissionContextFromLayers } from '../../../engine/permissionLayerReaders.js'
import type { ToolPermissionContext, ToolUseContext } from '../../../Tool.js'
import type { PermissionMode } from '../../../types/permissions.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../../../utils/envUtils.js'
import { isClassifierRoutedSafetyCheck } from '../../../utils/permissions/nhoGates.js'
import {
  truncateStartToWidth,
  truncateToWidth,
  truncateToWidthNoEllipsis,
} from '../../../utils/truncate.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../analytics/growthbook.js'
import { type ArtifactAutoReactStore, un } from '../store.js'

const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('../../../utils/permissions/autoModeState.js') as typeof import('../../../utils/permissions/autoModeState.js'))
  : null

export type ConsentSurfaceContext = Pick<
  ToolUseContext,
  'getAppState' | 'permissionLayers'
>

type SurfaceDeps = {
  isInteractive: () => boolean
  isAutoModeActive: () => boolean
  featureValue: <T>(name: string, fallback: T) => T
}

const defaultDeps: SurfaceDeps = {
  isInteractive: getIsInteractive,
  isAutoModeActive: () => autoModeStateModule?.isAutoModeActive() ?? false,
  featureValue: getFeatureValue_CACHED_MAY_BE_STALE,
}

let deps: SurfaceDeps = defaultDeps

export function setConsentSurfaceDepsForTests(
  next: Partial<SurfaceDeps> | null,
): void {
  deps = next === null ? defaultDeps : { ...defaultDeps, ...next }
}

/** densable `de` — effective permission context (permissionLayers last-wins). */
function permissionContextOf(
  context: ConsentSurfaceContext,
): ToolPermissionContext {
  return getToolPermissionContextFromLayers(context)
}

/**
 * densable `DW(mode, isBypassPermissionsModeAvailable)` — plan mode entered
 * from bypass in an interactive session behaves as bypass.
 */
export function isPlanModeBypassElevated(
  mode: PermissionMode,
  isBypassPermissionsModeAvailable: boolean | undefined,
): boolean {
  return (
    mode === 'plan' &&
    isBypassPermissionsModeAvailable === true &&
    deps.isInteractive()
  )
}

/**
 * densable `Im` — the effective mode asks for consent (not bypassPermissions
 * and not plan-elevated-from-bypass).
 */
export function isPromptingPermissionMode(
  context: ConsentSurfaceContext,
): boolean {
  const permissions = permissionContextOf(context)
  return (
    permissions.mode !== 'bypassPermissions' &&
    !isPlanModeBypassElevated(
      permissions.mode,
      permissions.isBypassPermissionsModeAvailable,
    )
  )
}

/**
 * densable `vg` — no permission prompt will surface: the mode does not prompt,
 * or the context sets `shouldAvoidPermissionPrompts`.
 */
export function arePermissionPromptsUnavailable(
  context: ConsentSurfaceContext,
): boolean {
  return (
    !isPromptingPermissionMode(context) ||
    permissionContextOf(context).shouldAvoidPermissionPrompts === true
  )
}

/** densable `b_` — plan mode and no permission prompt can surface. */
export function isPlanWithoutConsentSurface(
  context: ConsentSurfaceContext,
): boolean {
  if (permissionContextOf(context).mode !== 'plan') return false
  return arePermissionPromptsUnavailable(context)
}

/**
 * densable `ik` — Cowork-frame session: local-agent entrypoint, not a child
 * session, not nested under CLAUDECODE, CLAUDE_CODE_COWORK_FRAME_ARTIFACTS on.
 */
export function isCoworkFrameSession(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.CLAUDE_CODE_ENTRYPOINT === 'local-agent' &&
    !isEnvTruthy(env.CLAUDE_CODE_CHILD_SESSION) &&
    !isEnvTruthy(env.CLAUDECODE) &&
    isEnvTruthy(env.CLAUDE_CODE_COWORK_FRAME_ARTIFACTS)
  )
}

/** densable `l0` — Cowork-frame session and no permission prompt can surface. */
export function isCoworkFrameWithoutConsentSurface(
  context: ConsentSurfaceContext,
): boolean {
  return isCoworkFrameSession() && arePermissionPromptsUnavailable(context)
}

/**
 * densable `pi = b_(n) || l0(n)` — no one can answer a permission prompt in
 * this session.
 */
export function noOneCanAnswerPrompt(context: ConsentSurfaceContext): boolean {
  return (
    isPlanWithoutConsentSurface(context) ||
    isCoworkFrameWithoutConsentSurface(context)
  )
}

/** densable `B1n` */
const PLAN_MODE_SKIPS_FIVE_CLASS_ASKS = true

/** densable `PN` — plan mode bypasses the five-class artifact ask ruling. */
export function isPlanModeArtifactAsk(context: ConsentSurfaceContext): boolean {
  return (
    PLAN_MODE_SKIPS_FIVE_CLASS_ASKS &&
    permissionContextOf(context).mode === 'plan'
  )
}

/**
 * densable `qi(mode, servedCall=false)` — the auto-mode classifier decides
 * asks: auto, or plan while auto mode is active (unless served).
 */
export function isClassifierDecidingMode(
  mode: PermissionMode,
  servedCall = false,
): boolean {
  return (
    mode === 'auto' ||
    (mode === 'plan' && !servedCall && deps.isAutoModeActive())
  )
}

/**
 * Inline gold composite `Im(n) && te.shouldAvoidPermissionPrompts===!0 &&
 * !qi(te.mode)` — the mode prompts, but prompts are avoided and no classifier
 * stands in.
 */
export function arePromptsAvoidedWithoutClassifier(
  context: ConsentSurfaceContext,
): boolean {
  const permissions = permissionContextOf(context)
  return (
    isPromptingPermissionMode(context) &&
    permissions.shouldAvoidPermissionPrompts === true &&
    !isClassifierDecidingMode(permissions.mode)
  )
}

/** densable `te.servedCall===!0` */
export function isServedCall(permissions: ToolPermissionContext): boolean {
  return permissions.servedCall === true
}

export type AutoModeClassifierTransport =
  | 'arbiter'
  | 'arbiterWithLocalFallback'
  | 'off'

/**
 * densable `Lj(mode)` — server-side classifier transport. This build has no
 * server-side (arbiter) classifier, so every mode resolves to gold's `"off"`.
 */
export function resolveAutoModeClassifierTransport(
  _mode: PermissionMode,
): AutoModeClassifierTransport {
  return 'off'
}

/** densable `lut` */
export function isServerClassifierTransport(
  transport: AutoModeClassifierTransport,
): boolean {
  return transport === 'arbiter' || transport === 'arbiterWithLocalFallback'
}

/** densable `pr` */
function isServerClassifierForced(): boolean {
  return false
}

/** densable `Vqe(mode)` — asks in this mode route to the server classifier. */
export function isServerClassifierMode(mode: PermissionMode): boolean {
  return (
    isServerClassifierTransport(resolveAutoModeClassifierTransport(mode)) ||
    isServerClassifierForced()
  )
}

/** densable `Yw` — `tengu_cobalt_plinth_sedge` (default false). */
export function isArtifactUserOnlyConsentGateOn(): boolean {
  return deps.featureValue('tengu_cobalt_plinth_sedge', false)
}

/** densable `Yke` — `tengu_cobalt_plinth_samphire` (default false). */
export function isArtifactCopyFromGateOn(): boolean {
  return deps.featureValue('tengu_cobalt_plinth_samphire', false)
}

/**
 * densable `K0t` — CLAUDE_CODE_ARTIFACT_ASSETS (tri-bool) wins; otherwise the
 * frame roster declared `assets`. Gold's frame-agent branch (`LFe`) has no
 * local producer.
 */
export function isArtifactAssetsOn(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.CLAUDE_CODE_ARTIFACT_ASSETS
  if (isEnvTruthy(raw)) return true
  if (isEnvDefinedFalsy(raw)) return false
  return un().assetsOnRoster
}

const frozenCopyFrom = new WeakMap<ArtifactAutoReactStore, boolean>()

/**
 * densable `Q6` — copy-from (copying asset files into other artifacts) on,
 * latched once per artifact session store (`X().frozenCopyFrom ??=`).
 */
export function isArtifactCopyFromOn(): boolean {
  const store = un()
  let on = frozenCopyFrom.get(store)
  if (on === undefined) {
    on = isArtifactAssetsOn() && isArtifactCopyFromGateOn()
    frozenCopyFrom.set(store, on)
  }
  return on
}

/** densable `xAr(copyFrom)` — hint appended to first-read asks. */
export function artifactApprovalCoversFilesHint(copyFrom: boolean): string {
  return `Approving covers its files${copyFrom ? ', and copying them into other artifacts,' : ''} for the rest of the conversation.`
}

/**
 * densable `OW(decisionReason)` — the safetyCheck's circuitBreaker is
 * classifier-routed, so the read ask drops it (sets `circuitBreaker: void 0`).
 */
export function shouldDropCircuitBreaker(decisionReason: {
  circuitBreaker?: string
}): boolean {
  return isClassifierRoutedSafetyCheck(decisionReason)
}

// Ask-text formatting helpers: Artifact chunk `Tp` / `bv`; chunk-zj27z8c8
// `Op`; chunk-5dqn2crz `sc`; chunk-63av4j33 `cC` (+ `lC` / `Zd` / `Zx` / `EM`
// / `Qx` / `wM` / `jls` / `K` / `We` / `see` / `sOe` / `W` / `uy`);
// chunk-2cbqa7wn `Mwt`.

/** densable `Tp` — read_file on-line rule count above which the ask is not classifier-approvable. */
export const READ_FILE_ON_LINE_RULE_LIMIT = 64

/** densable `bv` — `"a"`, `"a" and "b"`, `"a", "b", and "c"`. */
export function quotedList(items: readonly string[]): string {
  const quoted = items.map(s => `"${s}"`)
  return quoted.length <= 2
    ? quoted.join(' and ')
    : `${quoted.slice(0, -1).join(', ')}, and ${quoted.at(-1)}`
}

function escapeCodeUnits(match: string): string {
  return match
    .split('')
    .map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .join('')
}

/** densable `Op` — JSON-quote with non-printable-ASCII and `<>` as `\uXXXX`. */
export function jsonQuoteAscii(value: string): string {
  return JSON.stringify(value).replace(/[^\x20-\x7e]|[<>]/gu, escapeCodeUnits)
}

/**
 * densable `sc` (truncatePathMiddle) — keeps the last `/` (else `\`) segment
 * and middle-elides the directory to `maxWidth` columns.
 */
export function truncateAskPathMiddle(path: string, maxWidth: number): string {
  if (stringWidth(path) <= maxWidth) return path
  if (maxWidth <= 0) return '…'
  if (maxWidth < 5) return truncateToWidth(path, maxWidth)
  const slash = path.lastIndexOf('/')
  const sepIdx = slash >= 0 ? slash : path.lastIndexOf('\\')
  const tail = sepIdx >= 0 ? path.slice(sepIdx) : path
  const head = sepIdx >= 0 ? path.slice(0, sepIdx) : ''
  const tailWidth = stringWidth(tail)
  if (tailWidth >= maxWidth - 1) return truncateStartToWidth(path, maxWidth)
  return `${truncateToWidthNoEllipsis(head, maxWidth - 1 - tailWidth)}…${tail}`
}

/** densable `Qx` */
const DOUBLE_QUOTE_LOOKALIKES =
  /[\u201C\u201D\u201E\u201F\u2E42\uFF02\u02F5\u02F6\u2033\u2034\u2036\u2037\u02BA\u02DD\u02EE\u05F4\u3003\u301D-\u301F\u275D\u275E\u2760\u{1F676}-\u{1F678}]/gu
/** densable `wM` */
const SINGLE_QUOTE_RUNS =
  /['\u0060\u00B4\u02B9\u02BB\u02BC\u02BD\u02BE\u02BF\u02C8\u02CA\u02CB\u0374\u0384\u055A\u05F3\u07F4\u07F5\u1FBD\u1FBF\u1FEF\u1FFD\u1FFE\u2018\u2019\u201A\u201B\u2032\u2035\u275B\u275C\u275F\uA78B\uA78C\uFF07\uFF40]{2,}/g
/** densable `EM` */
const BLANK_RENDERING =
  /[\p{Default_Ignorable_Code_Point}\u2800\u{1D159}\u{13441}\u{13442}\uFFFC]/gu

/** densable `Zx` */
function isInvisibleCodePoint(e: number): boolean {
  return (
    e <= 31 ||
    (e >= 127 && e <= 159) ||
    e === 173 ||
    e === 1564 ||
    (e >= 8203 && e <= 8207) ||
    e === 8232 ||
    e === 8233 ||
    (e >= 8234 && e <= 8238) ||
    (e >= 8288 && e <= 8297) ||
    (e >= 65024 && e <= 65039) ||
    e === 65279 ||
    (e >= 65529 && e <= 65531) ||
    e === 94180 ||
    (e >= 917504 && e <= 917999)
  )
}

/** densable `Zd` */
function foldInvisiblesAndQuotes(e: string): string | null {
  return (
    Array.from(e, n => (isInvisibleCodePoint(n.codePointAt(0) ?? 0) ? ' ' : n))
      .join('')
      .replace(BLANK_RENDERING, ' ')
      .replace(/"/g, "'")
      .replace(DOUBLE_QUOTE_LOOKALIKES, "'")
      .replace(SINGLE_QUOTE_RUNS, "'")
      .replace(/\s+/g, ' ')
      .trim() || null
  )
}

/** densable `jls` */
const ARROW_SHAFT_SYMBOLS = String.raw`\u002b\u003d\u005e\u007c\u007e\u00a2-\u00a5\u00a8\u00ac\u00af\u00b1\u00b4\u00b8\u00d7\u00f7\u02c2-\u02c5\u02d2-\u02df\u02e5-\u02eb\u02ed\u02ef-\u02ff\u0375\u0384\u0385\u03f6\u058f\u0606-\u0608\u060b\u07fe\u07ff\u0888\u09f2\u09f3\u09fb\u0af1\u0bf9\u0e3f\u17db\u1fbd\u1fbf-\u1fc1\u1fcd-\u1fcf\u1fdd-\u1fdf\u1fed-\u1fef\u1ffd\u1ffe\u2044\u2052\u207a-\u207c\u208a-\u208c\u20a0-\u20c1\u2118\u2140-\u2144\u214b\u2190-\u2194\u219a\u219b\u21a0\u21a3\u21a6\u21ae\u21ce\u21cf\u21d2\u21d4\u21f4-\u22ff\u2320\u2321\u237c\u239b-\u23b3\u23dc-\u23e1\u25b7\u25c1\u25f8-\u25ff\u266f\u27c0-\u27c4\u27c7-\u27e5\u27f0-\u27ff\u2900-\u2982\u2999-\u29d7\u29dc-\u29fb\u29fe-\u2aff\u2b30-\u2b44\u2b47-\u2b4c\u309b\u309c\ua700-\ua716\ua720\ua721\ua789\ua78a\ua838\uab5b\uab6a\uab6b\ufb29\ufbb2-\ufbc2\ufdfc\ufe62\ufe64-\ufe66\ufe69\uff04\uff0b\uff1c-\uff1e\uff3e\uff40\uff5c\uff5e\uffe0-\uffe3\uffe5\uffe6\uffe9-\uffec\u{10d8e}\u{10d8f}\u{11fdd}-\u{11fe0}\u{1cef0}\u{1d6c1}\u{1d6db}\u{1d6fb}\u{1d715}\u{1d735}\u{1d74f}\u{1d76f}\u{1d789}\u{1d7a9}\u{1d7c3}\u{1e2ff}\u{1ecb0}\u{1eef0}\u{1eef1}\u{1f3fb}-\u{1f3ff}\u{1f8d0}-\u{1f8d8}`
/** densable `Mwt` */
const DASH_LOOKALIKES =
  '\\p{Pd}\\u2212\\u207b\\u208b\\u02d7\\u2796\\u2043\\u30fc\\uff70'
/** densable `K` */
const ARROW_SHAFT = `[\\p{So}${ARROW_SHAFT_SYMBOLS}\\p{Pd}\\p{Pc}\\p{Mn}\\p{Me}${DASH_LOOKALIKES}\\u02c9\\u02cd\\u2017\\u2053\\u203e\\ufe49-\\ufe4c\\u0640\\u07fa\\u1173\\u1428\\u180a\\u2e0f\\u2f00\\u3127\\u3161\\u3192\\u31d0\\u4e00\\ua4ff\\ua7f7\\ua8fb\\uffda]`
/** densable `We` */
const DRAWN_ARROW = new RegExp(`(?<!${ARROW_SHAFT})${ARROW_SHAFT}+>`, 'gu')

/** densable `lC` */
function maskArrowGlyphs(e: string): string {
  return e
    .replace(
      // biome-ignore lint/suspicious/noMisleadingCharacterClass: gold lC @180501039 matches combining marks singly
      /[\u00bb\u02c2-\u02c5\u02ef-\u02ff\u1405\u1406\u1409\u1433\u1434\u1450\u1451\u15d2\u2023\u203a\u204d\u20d0-\u20ef\u2044\u2190-\u21ff\u2215\u226b\u227b\u227d\u227f\u2283\u22b1\u22b3\u22d7\u22d9\u2571\u2572\u2303-\u2304\u232a\u2344\u2348\u23e9-\u23ef\u23f5\u25b6-\u25bb\u261b\u261e\u276d\u276f\u2771\u2794-\u27bf\u27e9\u27eb\u27f0-\u27ff\u2900-\u297f\u29a8-\u29af\u2992\u2994\u29c1\u29d0\u29f5\u29f8\u29fd\u2a20\u2a7a\u2aa2\u2aa7\u2aa9\u2aab\u2aad\u2ab0\u2ab2\u2ab4\u2ab6\u2ab8\u2aba\u2abc\u2af8\u2b00-\u2bff\u3009\u300b\ue000-\uf8ff\ufe65\ufe68\uff0f\uff1e\uff3c\uffe9-\uffec\u{1f449}\u{1f599}\u{1f59b}\u{1f59d}\u{1f782}\u{1f800}-\u{1f8ff}\u{1faf1}\u{1fbc1}-\u{1fbc3}\u{1fbb0}-\u{1fbb8}\u{f0000}-\u{ffffd}\u{100000}-\u{10fffd}]/gu,
      '?',
    )
    .replace(DRAWN_ARROW, '?')
}

/** densable `see` */
const ANGLE_BRACKET_RUNS = /[<>\uFE64\uFE65\uFF1C\uFF1E]+/gu
/** densable `sOe` */
const BRACKET_PIECES =
  '\u02F9-\u02FC\u230C-\u230F\u231C-\u231F\u239B-\u23CC\u23DC-\u23E1\u2E00-\u2E0D\u2E1C\u2E1D\u2500-\u257F'
/** densable `W` */
const NON_ASCII_BRACKET = `(?![(){}])[\\p{Ps}\\p{Pe}${BRACKET_PIECES}]`
/** densable `uy` */
const BRACKET_RUNS = new RegExp(
  `(?<!\\s)\\s*${NON_ASCII_BRACKET}(?:\\s|${NON_ASCII_BRACKET})*`,
  'gu',
)

/** densable `cC` (sweptAskPath) — single-line display-safe text for ask copy. */
export function sweptAskText(text: string): string {
  return maskArrowGlyphs(foldInvisiblesAndQuotes(text) ?? '')
    .replace(BRACKET_RUNS, ' ')
    .replace(ANGLE_BRACKET_RUNS, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}
