/**
 * Official `El` / `Mht` / `Gp` / `RJr` / `_pr` / `ASe` fail arm (densable 2.1.239).
 *
 * Official Artifact tool name is `Artifact` (capital A). Tip's upload tool is
 * `artifact` — RJr / registered gates stay on the official name so they do
 * not lie about claude.ai read.
 *
 * densable `ASe` chain is ported: X4n disable → S$ stub → opi (Xwp) → eEp
 * (tengu_cobalt_plinth) → enableArtifact. Tip has no cobalt host / plinth
 * default ON, so eEp stays false and registration remains false unless GB
 * `tengu_cobalt_plinth` is explicitly opened (still requires firstParty Xwp).
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { getAPIProvider } from './model/providers.js'
import { isEnvTruthy } from './envUtils.js'

/** Official `bv`. */
export const OFFICIAL_ARTIFACT_TOOL_NAME = 'Artifact'

/** Official `q2r`. */
const ARTIFACT_SLUG =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** Official `Hya`. */
const ARTIFACT_PATH = `/code/(?:artifact|frame)/(?:[A-Za-z0-9_-]*-)?(${ARTIFACT_SLUG})(?:[/?#]|$)`

export type ParsedArtifactUrl = {
  slug: string
  env: 'prod' | 'staging'
}

/** Official `mFn` — empty. */
function artifactCustomHost(): string | undefined {
  return undefined
}

/** Official `S$` — tip has no publish stub dir. */
export function getArtifactPublishStubDir(): string | null {
  return null
}

/** Official `X4n` — env or settings disable. */
function isArtifactHardDisabled(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_ARTIFACT)) return true
  try {
    const { getInitialSettings } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./settings/settings.js') as typeof import('./settings/settings.js')
    return getInitialSettings().disableArtifact === true
  } catch {
    return false
  }
}

/**
 * Official `Xwp` — firstParty surface eligible for Artifact registration.
 * Not a cobalt CDN host check; entrypoint/env short-circuits apply.
 */
function isArtifactFirstPartySurfaceOpen(): boolean {
  try {
    if (getAPIProvider() !== 'firstParty') return false
  } catch {
    return false
  }
  // densable fa() / jp(CLAUDE_CODE_ARTIFACT) — tip: explicit falsy force-off
  const art = process.env.CLAUDE_CODE_ARTIFACT
  if (art !== undefined && !isEnvTruthy(art) && art !== '') {
    // densable jp = defined-falsy style
    if (
      art === '0' ||
      art.toLowerCase() === 'false' ||
      art.toLowerCase() === 'off'
    ) {
      return false
    }
  }
  return true
}

/** Official `Ywp` — local-agent / coworker entrypoints exclude opi. */
function isArtifactEntrypointExcluded(): boolean {
  const e = process.env.CLAUDE_CODE_ENTRYPOINT
  return e === 'local-agent' || e?.startsWith('claude-coworker') === true
}

/** Official `opi` — !Ywp && Xwp. */
function isArtifactOpiOpen(): boolean {
  return !isArtifactEntrypointExcluded() && isArtifactFirstPartySurfaceOpen()
}

/**
 * Official `Zwp` / `tengu_cobalt_plinth`.
 * densable default is pxv() (prosumer/no_auth); tip defaults false so ASe
 * stays closed without an explicit GrowthBook open (no invent cobalt).
 */
function isCobaltPlinthOpen(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_plinth', false)
}

/** Official `eEp` — cobalt plinth gate (ipi/K4n collapsed to Zwp for tip). */
function isArtifactEepOpen(): boolean {
  return isCobaltPlinthOpen()
}

/** Official `zNt` — first enableArtifact across settings sources. */
function resolveEnableArtifactSetting(): boolean | undefined {
  try {
    const { getSettingsForSource } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./settings/settings.js') as typeof import('./settings/settings.js')
    const { SETTING_SOURCES } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./settings/constants.js') as typeof import('./settings/constants.js')
    for (const source of SETTING_SOURCES) {
      const v = getSettingsForSource(source)?.enableArtifact
      if (v !== undefined) return v
    }
  } catch {
    /* densable optional */
  }
  return undefined
}

/**
 * Official `ASe` — Artifact tool registration.
 * densable: X4n → S$ stub → opi → eEp(tengu_cobalt_plinth) → zNt??true.
 * Without cobalt plinth this stays false — do not invent cobalt ON.
 */
export function isArtifactToolRegistered(): boolean {
  if (isArtifactHardDisabled()) return false
  if (getArtifactPublishStubDir() !== null) {
    return resolveEnableArtifactSetting() ?? true
  }
  if (!isArtifactOpiOpen()) return false
  if (!isArtifactEepOpen()) return false
  return resolveEnableArtifactSetting() ?? true
}

/** densable `ASe` alias. */
export const ASe = isArtifactToolRegistered

/**
 * densable `nDa` — once-per-session log when Artifact is disabled.
 * Tip: no GrowthBook event bus required; marks evaluated on the autoReact store.
 */
export function maybeLogArtifactDisabledSession(): void {
  try {
    const { un } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/artifactAutoReact/store.js') as typeof import('../services/artifactAutoReact/store.js')
    const s = un() as { artifactDisabledSessionEvaluated?: boolean }
    if (s.artifactDisabledSessionEvaluated) return
    s.artifactDisabledSessionEvaluated = true
    if (isArtifactToolRegistered()) return
    // densable N("tengu_artifact_disabled_session", …) — tip: debug only
  } catch {
    /* densable optional when store not loaded */
  }
}

/**
 * Official `UQ` — enabled for model when registered + (stub or cobalt allow).
 * Tip: collapses to ASe (no separate Jsr/ipi host).
 */
export function isOfficialArtifactToolEnabled(): boolean {
  return isArtifactToolRegistered()
}

export function isArtifactReadEnabled(): boolean {
  // densable oDa / gable — tip keeps closed without cobalt
  return false
}

export function isArtifactReadOnlySurface(): boolean {
  return false
}

/** Official `Mht`. */
export function canonicalizeArtifactUrlInput(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:') parsed.protocol = 'https:'
    if (parsed.hostname.endsWith('.')) {
      parsed.hostname = parsed.hostname.slice(0, -1)
    }
    return parsed.href
  } catch {
    return url
  }
}

/** Official `El`. `mFn()` is empty so the custom-host arm never matches. */
export function parseArtifactUrl(url: string): ParsedArtifactUrl | null {
  const prod = url.match(
    new RegExp(`^https://(?:[a-z0-9-]+\\.)?claude\\.ai${ARTIFACT_PATH}`),
  )
  if (prod?.[1]) return { slug: prod[1], env: 'prod' }
  const staging = url.match(
    new RegExp(
      `^https://(?:preview\\.)?claude-ai\\.staging\\.ant\\.dev${ARTIFACT_PATH}`,
    ),
  )
  if (staging?.[1]) return { slug: staging[1], env: 'staging' }
  const frame = url.match(
    new RegExp(
      `^https://(${ARTIFACT_SLUG})\\.frame\\.(staging\\.)?claudeusercontent\\.com(?:[/?#]|$)`,
    ),
  )
  if (frame?.[1]) {
    return { slug: frame[1], env: frame[2] ? 'staging' : 'prod' }
  }
  const custom = artifactCustomHost()
  if (custom) {
    const match = url.match(new RegExp(`^https?://([^/?#]+)${ARTIFACT_PATH}`))
    if (match?.[2] && match[1] === new URL(custom).host) {
      return { slug: match[2], env: 'prod' }
    }
  }
  return null
}

/** Official `UCe`. */
export function parseArtifactUrlInput(url: unknown): ParsedArtifactUrl | null {
  return typeof url === 'string'
    ? parseArtifactUrl(canonicalizeArtifactUrlInput(url))
    : null
}

/** Official `Gp`. */
export function artifactViewerUrlFor(parsed: ParsedArtifactUrl): string {
  const custom = artifactCustomHost()
  if (custom) return `${custom}/code/artifact/${parsed.slug}`
  return parsed.env === 'prod'
    ? `https://claude.ai/code/artifact/${parsed.slug}`
    : `https://claude-ai.staging.ant.dev/code/artifact/${parsed.slug}`
}

function toolsListHas(
  tools: readonly { name: string }[] | undefined,
  name: string,
): boolean {
  return tools?.some(tool => tool.name === name) ?? false
}

/**
 * Official `RJr(tools, permissionContext, opts)`.
 */
export async function isWebFetchArtifactExceptionEnabled(
  tools: readonly { name: string }[] | undefined,
): Promise<boolean> {
  const denyHit = (): boolean => false
  if (
    toolsListHas(tools, OFFICIAL_ARTIFACT_TOOL_NAME) &&
    isOfficialArtifactToolEnabled() &&
    getArtifactPublishStubDir() === null
  ) {
    return true
  }
  if (!(isArtifactReadOnlySurface() && isArtifactReadEnabled())) {
    return false
  }
  return !denyHit()
}

/** Official `ipw` — parse only when RJr admits. */
export async function parseAdmittedArtifactUrl(
  url: string,
  tools: readonly { name: string }[] | undefined,
): Promise<ParsedArtifactUrl | null> {
  if (await isWebFetchArtifactExceptionEnabled(tools)) {
    return parseArtifactUrl(url)
  }
  return null
}

export type ArtifactWebFetchFail = {
  data: {
    bytes: number
    code: number
    codeText: string
    result: string
    durationMs: number
    url: string
  }
}

/**
 * Official `spw` when `ipw` is null: `_pr` + parse + registered → fail copy.
 */
export async function tryArtifactWebFetchFail(
  url: string,
  tools: readonly { name: string }[] | undefined,
  isWebFetchAgent: boolean,
  startedAt: number,
  artifactDenied: boolean,
): Promise<ArtifactWebFetchFail | null> {
  const canonical = canonicalizeArtifactUrlInput(url)
  const admitted = await parseAdmittedArtifactUrl(canonical, tools)
  if (admitted) return null
  if (!isWebFetchAgent) return null
  const parsed = parseArtifactUrl(canonical)
  if (parsed === null || !isArtifactToolRegistered()) return null
  const viewer = artifactViewerUrlFor(parsed)
  const hint = artifactDenied
    ? ''
    : ` Tell the caller to read it with the ${OFFICIAL_ARTIFACT_TOOL_NAME} tool (action: "read", url) in its own session instead.`
  const result = `${viewer} is a claude.ai artifact. Its content is not fetchable from here — a plain fetch returns only the viewer shell.${hint}`
  return {
    data: {
      bytes: Buffer.byteLength(result),
      code: 0,
      codeText: 'Not Fetched',
      result,
      durationMs: Date.now() - startedAt,
      url,
    },
  }
}
