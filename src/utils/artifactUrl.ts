/**
 * Official `El` / `Mht` / `Gp` / `RJr` / `_pr` fail arm (densable 2.1.239).
 *
 * Official Artifact tool name is `Artifact` (capital A). Tip's upload tool is
 * `artifact` — RJr / registered gates stay on the official name so they do
 * not lie about claude.ai read.
 *
 * `mFn()` is official empty (`return`). `S$()` stub dir is not hosted here.
 * `ASe` / `UQ` / `fxv` / `J4n` cobalt hosts are not present → registered and
 * read-enabled stay false. The `_pr` fail copy still runs when a parsed
 * artifact URL meets a registered official tool.
 */

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

/**
 * Official `ASe` without cobalt hosts: disable/stub short-circuit, then
 * `opi`/`eEp` are false so registration is false.
 */
export function isArtifactToolRegistered(): boolean {
  return false
}

/** Official `UQ` / `fxv` / `J4n` — no cobalt host. */
export function isOfficialArtifactToolEnabled(): boolean {
  return false
}

export function isArtifactReadEnabled(): boolean {
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
 * `permissionContext === null` (WebFetch `prompt`) makes the deny-rule probe
 * false. Without official Artifact + UQ, the first admit arm is false; without
 * read-only+read-enabled the second arm is false.
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
 * The cobalt `readArtifactForModel` arm is not hosted.
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
