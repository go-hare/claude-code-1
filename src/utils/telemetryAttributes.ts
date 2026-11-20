import type { Attributes } from '@opentelemetry/api'
import { getSessionId } from 'src/bootstrap/state.js'
import {
  getOauthAccountInfo,
  getSubscriptionType,
  isClaudeAISubscriber,
} from './auth.js'
import { getOrCreateUserID } from './config.js'
import { logForDebugging } from './debug.js'
import { envDynamic } from './envDynamic.js'
import { isEnvTruthy } from './envUtils.js'
import { type APIProvider, getAPIProvider } from './model/providers.js'
import { toTaggedId } from './taggedId.js'
import {
  getVcsRepositoryTelemetryAttributes,
  VCS_REPOSITORY_ATTRIBUTE_KEYS,
  VCS_REPOSITORY_URL_FULL,
} from './telemetry/vcsRepositoryAttributes.js'

// Default configuration for metrics cardinality
const METRICS_CARDINALITY_DEFAULTS = {
  OTEL_METRICS_INCLUDE_SESSION_ID: true,
  OTEL_METRICS_INCLUDE_VERSION: false,
  OTEL_METRICS_INCLUDE_ACCOUNT_UUID: true,
  OTEL_METRICS_INCLUDE_REPOSITORY: false,
}

const OTEL_ATTR_MAX_LEN = 255
const OTEL_RESOURCE_ATTR_MAX_NOTICES = 5

/**
 * Official 2.1.323 (#2123, `qms`/`ofo` @299245800):
 * Resource attributes managed by Claude Code itself. While any entry in
 * `OTEL_RESOURCE_ATTRIBUTES` is malformed and left off, Claude Code withholds
 * overrides of these keys from the partial parse so built-in resource metadata
 * stays intact.
 */
export const DEFAULT_MANAGED_RESOURCE_ATTRIBUTE_KEYS = new Set<string>([
  'service.name',
  'service.version',
  'os.type',
  'os.version',
  'host.arch',
  'wsl.version',
])

export type OtelResourceAttributesParseResult = {
  attributes: Record<string, string>
  notices: string[]
  droppedEntries: Array<{ index: number; raw: string; reason: string }>
  isEveryEntryRead: boolean
}

function isValidOtelResourceAttrKey(key: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(key)
}

function isValidOtelResourceAttrToken(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 33 || code === 44 || code === 59 || code === 92 || code > 126) {
      return false
    }
  }
  return true
}

function countChar(str: string, ch: string): number {
  let count = 0
  for (let i = 0; i < str.length; i++) {
    if (str[i] === ch) count++
  }
  return count
}

/**
 * Official 2.1.325 `y5n` (#1873) + 2.1.328 `gio` (#624): parse comma-separated
 * `OTEL_RESOURCE_ATTRIBUTES` `key=value` pairs entry-by-entry so one malformed
 * entry drops only itself instead of wiping out all other valid labels on
 * metric points, events, and spans.
 */
export function parseOtelResourceAttributes(
  raw: string | undefined,
): Record<string, string> {
  if (!raw) return {}
  const parsed: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const trimmedPair = pair.trim()
    if (trimmedPair === '') continue
    const [rawKey, rawVal, ...rest] = pair.split('=')
    if (rawKey === undefined || rawVal === undefined || rest.length > 0) {
      continue
    }
    const key = rawKey.trim()
    const val = rawVal.trim().split(/^"|"$/).join('')
    if (
      key.length === 0 ||
      key.length > OTEL_ATTR_MAX_LEN ||
      !isValidOtelResourceAttrKey(key)
    ) {
      continue
    }
    if (val.length > OTEL_ATTR_MAX_LEN || !isValidOtelResourceAttrToken(val)) {
      continue
    }
    try {
      parsed[key] = decodeURIComponent(val)
    } catch {}
  }
  return parsed
}

/**
 * Official 2.1.323 (#2123, `g` / `XSr` @299245800):
 * Parse `OTEL_RESOURCE_ATTRIBUTES` entry-by-entry so a single malformed entry
 * does NOT drop all other valid attributes from the OpenTelemetry resource.
 * Returns the parsed valid attributes plus user-facing notices naming every
 * dropped entry (for debug logging and `/status`).
 */
export function parseOtelResourceAttributesDetailed(
  raw: string | undefined,
  includeResourceAttributes = true,
  opts?: { logWarnings?: boolean },
): OtelResourceAttributesParseResult {
  const parts = (raw ?? '').split(',')
  const attributes: Record<string, string> = {}
  const rawNotices: string[] = []
  const droppedEntries: Array<{ index: number; raw: string; reason: string }> =
    []

  for (let idx = 0; idx < parts.length; idx++) {
    const entry = parts[idx]!
    if (entry.trim() === '') continue
    const entryNum = idx + 1
    const prefix = `OTEL_RESOURCE_ATTRIBUTES: Entry ${entryNum} of ${parts.length} (counting every part between commas) was left off the OpenTelemetry resource because`
    const split = entry.split('=')
    const rawKey = (split[0] ?? '').trim()
    const rawVal = (split[1] ?? '').trim()

    if (split.length === 1) {
      const reason =
        'it has no "=". Write each entry as key=value, and a comma inside a value as %2C.'
      rawNotices.push(`${prefix} ${reason}`)
      droppedEntries.push({ index: entryNum, raw: entry, reason })
      continue
    }
    if (split.length > 2) {
      const reason =
        'it has more than one "=". Write an "=" inside a key or value as %3D.'
      rawNotices.push(`${prefix} ${reason}`)
      droppedEntries.push({ index: entryNum, raw: entry, reason })
      continue
    }
    if (rawKey === '') {
      const reason =
        'it has no key before its "=". You can put a key before the "=", or remove the entry.'
      rawNotices.push(`${prefix} ${reason}`)
      droppedEntries.push({ index: entryNum, raw: entry, reason })
      continue
    }

    let decodedKey: string
    let decodedVal: string
    try {
      decodedKey = decodeURIComponent(rawKey)
      decodedVal = decodeURIComponent(rawVal)
    } catch {
      const reason =
        'its percent-encoding is invalid. Each "%" must start a code such as %2C, and the codes must decode to UTF-8 text. To write a "%" itself, use %25.'
      rawNotices.push(`${prefix} ${reason}`)
      droppedEntries.push({ index: entryNum, raw: entry, reason })
      continue
    }

    if (
      decodedKey.length > OTEL_ATTR_MAX_LEN ||
      decodedVal.length > OTEL_ATTR_MAX_LEN
    ) {
      const reason = `its key or value is over ${OTEL_ATTR_MAX_LEN} characters once decoded. Shorten it.`
      rawNotices.push(`${prefix} ${reason}`)
      droppedEntries.push({ index: entryNum, raw: entry, reason })
      continue
    }

    attributes[decodedKey] = decodedVal
  }

  const notices = rawNotices.slice(0, OTEL_RESOURCE_ATTR_MAX_NOTICES)
  const overflow = rawNotices.length - OTEL_RESOURCE_ATTR_MAX_NOTICES
  if (overflow > 0) {
    notices.push(
      `OTEL_RESOURCE_ATTRIBUTES: ${overflow} more ${overflow === 1 ? 'entry was' : 'entries were'} left off the OpenTelemetry resource.`,
    )
  }

  const withheldManaged = [...DEFAULT_MANAGED_RESOURCE_ATTRIBUTE_KEYS].filter(
    k => Object.hasOwn(attributes, k),
  )
  if (rawNotices.length > 0 && withheldManaged.length > 0) {
    notices.push(
      `OTEL_RESOURCE_ATTRIBUTES: While an entry is left off, the value sets none of these OpenTelemetry resource attributes: ${withheldManaged.join(', ')}.`,
    )
  }
  if (rawNotices.length > 0) {
    notices.push(
      `OTEL_RESOURCE_ATTRIBUTES: After you fix ${rawNotices.length === 1 ? 'that entry' : 'those entries'}, restart Claude Code. The OpenTelemetry resource is built only at startup.`,
    )
  }

  // Official 2.1.328 (#624): only malformed entries are left off metric points,
  // events, and spans; valid entries remain active.
  const strictBlockedIndices = parts.flatMap((part, i) =>
    includeResourceAttributes &&
    countChar(part, '=') === 1 &&
    Object.keys(parseOtelResourceAttributes(part)).length === 0
      ? [i + 1]
      : [],
  )
  if (strictBlockedIndices.length > 0) {
    const extra = strictBlockedIndices.length - OTEL_RESOURCE_ATTR_MAX_NOTICES
    let label = `Entry ${strictBlockedIndices[0]}`
    if (extra > 0) {
      label = `Entries ${strictBlockedIndices.slice(0, OTEL_RESOURCE_ATTR_MAX_NOTICES).join(', ')}, and ${extra} ${extra === 1 ? 'other' : 'others'}`
    } else if (strictBlockedIndices.length > 2) {
      label = `Entries ${strictBlockedIndices.slice(0, -1).join(', ')}, and ${strictBlockedIndices.at(-1)}`
    } else if (strictBlockedIndices.length === 2) {
      label = `Entries ${strictBlockedIndices[0]} and ${strictBlockedIndices[1]}`
    }
    notices.push(
      `OTEL_RESOURCE_ATTRIBUTES: ${label} of ${parts.length} (counting every part between commas) ${strictBlockedIndices.length === 1 ? 'was' : 'were'} left off metric points, events, and spans. Write ${strictBlockedIndices.length === 1 ? 'it' : 'them'} with a key of letters, digits, dots, dashes, or underscores, and a value in printable ASCII without spaces, semicolons, or backslashes. In a value, percent-encode anything else: a space as %20, a "%" as %25. Keep the key and the value to ${OTEL_ATTR_MAX_LEN} characters each as written, where %20 counts as three.`,
    )
  }

  if (opts?.logWarnings !== false) {
    for (const notice of notices) {
      logForDebugging(`[3P telemetry] ${notice}`, { level: 'warn' })
    }
  }

  return {
    attributes,
    notices,
    droppedEntries,
    isEveryEntryRead: rawNotices.length === 0,
  }
}

/**
 * Official 2.1.323 (#2123, `XSr`): current `OTEL_RESOURCE_ATTRIBUTES` parse
 * result & `/status` notices for the running process.
 */
export function getOtelResourceAttributeStatus(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { logWarnings?: boolean },
): OtelResourceAttributesParseResult {
  const includeAttrEnv = env.OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES
  const includeResourceAttributes =
    includeAttrEnv === undefined ? true : isEnvTruthy(includeAttrEnv)
  return parseOtelResourceAttributesDetailed(
    env.OTEL_RESOURCE_ATTRIBUTES,
    includeResourceAttributes,
    opts,
  )
}

function shouldIncludeAttribute(
  envVar: keyof typeof METRICS_CARDINALITY_DEFAULTS,
): boolean {
  const defaultValue = METRICS_CARDINALITY_DEFAULTS[envVar]
  const envValue = process.env[envVar]

  if (envValue === undefined) {
    return defaultValue
  }

  return isEnvTruthy(envValue)
}

const TELEMETRY_PLANS = new Set(['pro', 'max', 'team', 'enterprise'])

const SEAT_TIER_TO_TYPE = new Map<string, string>([
  ['team_tier_1', 'premium'],
  ['team_bendep_nonprofit_premium', 'premium'],
  ['team_labs_premium', 'premium'],
  ['enterprise_tier_1', 'premium'],
  ['enterprise_bendep_premium', 'premium'],
  ['team_standard', 'standard'],
  ['team_bendep_nonprofit_standard', 'standard'],
  ['team_labs_standard', 'standard'],
  ['enterprise_standard', 'standard'],
  ['enterprise_nonprofit', 'standard'],
  ['enterprise_higher_ed', 'standard'],
  ['enterprise_usage_based', 'usage_based'],
  ['enterprise_usage_based_chat', 'usage_based'],
  ['enterprise_hipaa_chat', 'usage_based'],
  ['enterprise_hipaa_chat_and_code', 'usage_based'],
  ['enterprise_lite', 'other'],
  ['enterprise_bendep_global_access', 'other'],
])

const AWS_REGION_PART = '[a-z]{2,4}(?:-[a-z]{2,5})?-[a-z]+-\\d+'
const AWS_DOMAINS_PART =
  'amazonaws\\.com|api\\.aws|amazonaws\\.com\\.cn|amazonaws\\.eu|c2s\\.ic\\.gov|sc2s\\.sgov\\.gov|cloud\\.adc-e\\.uk|csp\\.hci\\.ic\\.gov'
const awsOwnHost = (service: string): RegExp =>
  new RegExp(
    `^(?:vpce-[a-z0-9-]+\\.)?${service}(?:-fips)?\\.${AWS_REGION_PART}\\.(?:vpce\\.)?(?:${AWS_DOMAINS_PART})$`,
  )

type ProviderBaseUrlSpec = {
  variables: Array<{ name: string; urlOf?: (val: string) => string }>
  ownHost: RegExp
}

const PROVIDER_BASE_URL_SPECS: Partial<
  Record<APIProvider, ProviderBaseUrlSpec>
> = {
  bedrock: {
    variables: [
      { name: 'ANTHROPIC_BEDROCK_BASE_URL' },
      { name: 'AWS_ENDPOINT_URL_BEDROCK_RUNTIME' },
      { name: 'AWS_ENDPOINT_URL_BEDROCK' },
      { name: 'AWS_ENDPOINT_URL' },
    ],
    ownHost: awsOwnHost('bedrock(?:-runtime)?'),
  },
  mantle: {
    variables: [{ name: 'ANTHROPIC_BEDROCK_MANTLE_BASE_URL' }],
    ownHost: awsOwnHost('bedrock-mantle'),
  },
  anthropicAws: {
    variables: [{ name: 'ANTHROPIC_AWS_BASE_URL' }],
    ownHost: awsOwnHost('aws-external-anthropic'),
  },
  vertex: {
    variables: [{ name: 'ANTHROPIC_VERTEX_BASE_URL' }],
    ownHost: new RegExp(
      `^(?:aiplatform|${AWS_REGION_PART}-aiplatform|aiplatform\\.${AWS_REGION_PART}\\.rep|[a-z0-9-]+\\.p)\\.googleapis\\.com$`,
    ),
  },
  anthropicGoogleCloud: {
    variables: [{ name: 'ANTHROPIC_GOOGLE_CLOUD_BASE_URL' }],
    ownHost: new RegExp(
      `^(?:claude|claude\\.${AWS_REGION_PART}\\.rep|[a-z0-9-]+\\.p)\\.googleapis\\.com$`,
    ),
  },
  foundry: {
    variables: [
      { name: 'ANTHROPIC_FOUNDRY_BASE_URL' },
      {
        name: 'ANTHROPIC_FOUNDRY_RESOURCE',
        urlOf: (res: string) => `https://${res}.services.ai.azure.com`,
      },
    ],
    ownHost:
      /^[a-z0-9-]{2,64}\.(?:services\.ai|cognitiveservices|openai)\.azure\.(?:com|us|cn)$/,
  },
}

function hasCustomFirstPartyBaseUrl(env: NodeJS.ProcessEnv): boolean {
  const baseUrl = env.ANTHROPIC_BASE_URL
  if (!baseUrl || env.ANTHROPIC_UNIX_SOCKET !== undefined) return false
  try {
    const host = new URL(baseUrl).host
    return Boolean(host) && host !== 'api.anthropic.com'
  } catch {
    return false
  }
}

function hasCustomProviderBaseUrl(
  provider: APIProvider,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (provider === 'gateway') return true
  if (provider === 'firstParty') return hasCustomFirstPartyBaseUrl(env)
  const spec = PROVIDER_BASE_URL_SPECS[provider]
  if (!spec) return false
  for (const { name, urlOf } of spec.variables) {
    if (name.startsWith('AWS_ENDPOINT_URL')) continue
    const raw = env[name]
    if (!raw) continue
    const targetUrl = urlOf ? urlOf(raw) : raw
    try {
      const parsed = new URL(targetUrl)
      const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
      if (parsed.protocol !== 'https:' || !spec.ownHost.test(hostname)) {
        return true
      }
    } catch {
      return true
    }
  }
  return false
}

export function getAnthropicTelemetryAttributes(
  env: NodeJS.ProcessEnv = process.env,
): Attributes {
  const provider = getAPIProvider()
  const attrs: Attributes = {
    'anthropic.provider': provider,
    'anthropic.custom_base_url': hasCustomProviderBaseUrl(provider, env),
  }
  if (!isClaudeAISubscriber()) {
    return attrs
  }
  const plan = getSubscriptionType()
  if (plan && TELEMETRY_PLANS.has(plan)) {
    attrs['anthropic.plan'] = plan
  }
  const seatTier = getOauthAccountInfo()?.seatTier
  const seatType = seatTier ? SEAT_TIER_TO_TYPE.get(seatTier) : undefined
  if (seatType) {
    attrs['anthropic.seat_type'] = seatType
  }
  return attrs
}

export function getTelemetryAttributes(): Attributes {
  const userId = getOrCreateUserID()
  const sessionId = getSessionId()

  const attributes: Attributes = {
    'user.id': userId,
  }

  if (shouldIncludeAttribute('OTEL_METRICS_INCLUDE_SESSION_ID')) {
    attributes['session.id'] = sessionId
  }
  if (shouldIncludeAttribute('OTEL_METRICS_INCLUDE_VERSION')) {
    attributes['app.version'] = MACRO.VERSION
  }

  // Official 2.1.325 `X()` / `bhn()` (#1873): include the 4 low-cardinality
  // `vcs.*` repository attributes across metrics, logs, and spans when
  // `OTEL_METRICS_INCLUDE_REPOSITORY` is truthy, honoring explicit
  // `OTEL_RESOURCE_ATTRIBUTES` overrides over git discovery.
  if (shouldIncludeAttribute('OTEL_METRICS_INCLUDE_REPOSITORY')) {
    const resourceAttrs = parseOtelResourceAttributes(
      process.env.OTEL_RESOURCE_ATTRIBUTES,
    )
    const vcsAttrs =
      resourceAttrs[VCS_REPOSITORY_URL_FULL] === undefined
        ? getVcsRepositoryTelemetryAttributes()
        : undefined
    for (const key of VCS_REPOSITORY_ATTRIBUTE_KEYS) {
      const value = resourceAttrs[key] ?? vcsAttrs?.[key]
      if (typeof value === 'string' && value.length > 0) {
        attributes[key] = value
      }
    }
  }

  // Only include OAuth account data when actively using OAuth authentication
  const oauthAccount = getOauthAccountInfo()
  if (oauthAccount) {
    const orgId = oauthAccount.organizationUuid
    const email = oauthAccount.emailAddress
    const accountUuid = oauthAccount.accountUuid

    if (orgId) attributes['organization.id'] = orgId
    if (email) attributes['user.email'] = email

    if (
      accountUuid &&
      shouldIncludeAttribute('OTEL_METRICS_INCLUDE_ACCOUNT_UUID')
    ) {
      attributes['user.account_uuid'] = accountUuid
      attributes['user.account_id'] =
        process.env.CLAUDE_CODE_ACCOUNT_TAGGED_ID ||
        toTaggedId('user', accountUuid)
    }
  }

  Object.assign(attributes, getAnthropicTelemetryAttributes())

  // Add terminal type if available
  if (envDynamic.terminal) {
    attributes['terminal.type'] = envDynamic.terminal
  }

  return attributes
}
