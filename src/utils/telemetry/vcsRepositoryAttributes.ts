import type { Attributes } from '@opentelemetry/api'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { getCwd } from '../cwd.js'
import { isEnvTruthy } from '../envUtils.js'
import { gitExe } from '../git.js'

/**
 * Official 2.1.321 (#1873): OTEL semantic convention VCS repository attribute keys.
 */
export const VCS_REPOSITORY_URL_FULL = 'vcs.repository.url.full'
export const VCS_REPOSITORY_NAME = 'vcs.repository.name'
export const VCS_OWNER_NAME = 'vcs.owner.name'
export const VCS_PROVIDER_NAME = 'vcs.provider.name'
export const VCS_REF_HEAD_REVISION = 'vcs.ref.head.revision'
export const VCS_REF_HEAD_NAME = 'vcs.ref.head.name'
export const VCS_REF_HEAD_TYPE = 'vcs.ref.head.type'

export const VCS_REPOSITORY_ATTRIBUTE_KEYS = [
  VCS_REPOSITORY_URL_FULL,
  VCS_OWNER_NAME,
  VCS_REPOSITORY_NAME,
  VCS_PROVIDER_NAME,
] as const

/**
 * Official 2.1.321 `cTt("OTEL_METRICS_INCLUDE_REPOSITORY")` (#1873):
 * Defaults to `false`; enabled when `OTEL_METRICS_INCLUDE_REPOSITORY` is truthy.
 */
export function shouldIncludeRepositoryMetrics(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.OTEL_METRICS_INCLUDE_REPOSITORY
  if (raw === undefined) return false
  return isEnvTruthy(raw)
}

function inferVcsProvider(host: string, rawUrl: string): string | undefined {
  const lower = host.toLowerCase()
  if (
    lower === 'github.com' ||
    lower.endsWith('.github.com') ||
    lower.includes('github')
  ) {
    return 'github'
  }
  if (
    lower === 'gitlab.com' ||
    lower.endsWith('.gitlab.com') ||
    lower.includes('gitlab')
  ) {
    return 'gitlab'
  }
  if (
    lower === 'bitbucket.org' ||
    lower.endsWith('.bitbucket.org') ||
    lower.includes('bitbucket') ||
    /^ssh:\/\/[^/?#]*:7999(?=[/?#]|$)/i.test(rawUrl)
  ) {
    return 'bitbucket'
  }
  if (lower === 'dev.azure.com' || lower.endsWith('.visualstudio.com')) {
    return 'azure_devops'
  }
  if (lower === 'gitea.com' || lower.includes('gitea')) {
    return 'gitea'
  }
  return undefined
}

/**
 * Parse a git remote URL (HTTPS, SSH, or SCP-like `git@host:owner/repo.git`)
 * into OTEL `vcs.*` attributes, stripping any embedded credentials.
 */
export function parseVcsRepositoryAttributes(
  remoteUrl: string | undefined,
  head?: { revision?: string; name?: string; type?: 'branch' | 'tag' },
): Record<string, string> {
  const attrs: Record<string, string> = {}
  if (remoteUrl) {
    const trimmed = remoteUrl.trim()
    let host = ''
    let pathPart = ''
    let cleanUrl = ''
    const scpMatch = /^(?:[^@\s]+@)?([a-zA-Z0-9.-]+):([^/].*)$/.exec(trimmed)
    if (scpMatch && !trimmed.includes('://')) {
      host = scpMatch[1] ?? ''
      pathPart = (scpMatch[2] ?? '')
        .replace(/\.git$/i, '')
        .replace(/^\/+|\/+$/g, '')
      cleanUrl = `https://${host}/${pathPart}`
    } else {
      try {
        const parsed = new URL(trimmed)
        host = parsed.hostname
        pathPart = parsed.pathname
          .replace(/\.git$/i, '')
          .replace(/^\/+|\/+$/g, '')
        const portSuffix = parsed.port ? `:${parsed.port}` : ''
        cleanUrl = `https://${host}${portSuffix}/${pathPart}`
      } catch {
        // unparseable remote URL
      }
    }
    if (host && pathPart) {
      attrs[VCS_REPOSITORY_URL_FULL] = cleanUrl
      const segments = pathPart.split('/').filter(Boolean)
      const repoName = segments.at(-1)
      const owner =
        segments.length >= 2 ? segments.slice(0, -1).join('/') : undefined
      if (repoName) attrs[VCS_REPOSITORY_NAME] = repoName
      if (owner) attrs[VCS_OWNER_NAME] = owner
      const provider = inferVcsProvider(host, trimmed)
      if (provider) attrs[VCS_PROVIDER_NAME] = provider
    }
  }
  if (head?.revision) attrs[VCS_REF_HEAD_REVISION] = head.revision
  if (head?.name) attrs[VCS_REF_HEAD_NAME] = head.name
  if (head?.type) attrs[VCS_REF_HEAD_TYPE] = head.type
  return attrs
}

let cachedCwd: string | undefined
let cachedVcsAttributes: Record<string, string> = {}
let inFlightResolve: Promise<Record<string, string>> | null = null

export function invalidateVcsRepositoryAttributesCache(): void {
  cachedCwd = undefined
  cachedVcsAttributes = {}
  inFlightResolve = null
}

/**
 * Official 2.1.321 (#1873): resolve `vcs.*` attributes for `cwd`, automatically
 * re-resolving when the working directory changes (e.g. when a pre-started
 * Claude Desktop spare process is claimed into a repository directory).
 */
export async function resolveVcsRepositoryAttributesForCwd(
  cwd: string = getCwd(),
): Promise<Record<string, string>> {
  if (cachedCwd === cwd && inFlightResolve === null) {
    return cachedVcsAttributes
  }
  if (cachedCwd === cwd && inFlightResolve !== null) {
    return inFlightResolve
  }
  cachedCwd = cwd
  let currentPromise: Promise<Record<string, string>> | null = null
  currentPromise = (async () => {
    try {
      const [remoteRes, revRes, refRes] = await Promise.all([
        execFileNoThrow(
          gitExe(),
          ['-C', cwd, 'config', '--get', 'remote.origin.url'],
          { preserveOutputOnError: false },
        ),
        execFileNoThrow(gitExe(), ['-C', cwd, 'rev-parse', 'HEAD'], {
          preserveOutputOnError: false,
        }),
        execFileNoThrow(
          gitExe(),
          ['-C', cwd, 'symbolic-ref', '--short', 'HEAD'],
          { preserveOutputOnError: false },
        ),
      ])
      const remoteUrl =
        remoteRes.code === 0 ? remoteRes.stdout.trim() : undefined
      const revision = revRes.code === 0 ? revRes.stdout.trim() : undefined
      const branch = refRes.code === 0 ? refRes.stdout.trim() : undefined
      const resolved = parseVcsRepositoryAttributes(remoteUrl, {
        ...(revision ? { revision } : {}),
        ...(branch ? { name: branch, type: 'branch' as const } : {}),
      })
      if (cachedCwd === cwd) {
        cachedVcsAttributes = resolved
      }
      return resolved
    } catch {
      if (cachedCwd === cwd) {
        cachedVcsAttributes = {}
      }
      return {}
    } finally {
      if (inFlightResolve === currentPromise) {
        inFlightResolve = null
      }
    }
  })()
  inFlightResolve = currentPromise
  return currentPromise
}

/**
 * Synchronous reader for metric emission; kicks off background resolution if
 * cwd has changed since last resolve.
 */
export function getVcsRepositoryTelemetryAttributes(
  env: NodeJS.ProcessEnv = process.env,
): Attributes {
  if (!shouldIncludeRepositoryMetrics(env)) {
    return {}
  }
  const cwd = getCwd()
  if (cachedCwd !== cwd) {
    void resolveVcsRepositoryAttributesForCwd(cwd)
  }
  return { ...cachedVcsAttributes }
}
