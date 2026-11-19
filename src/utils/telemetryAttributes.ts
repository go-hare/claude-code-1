import type { Attributes } from '@opentelemetry/api'
import { getSessionId } from 'src/bootstrap/state.js'
import {
  getOauthAccountInfo,
  getSubscriptionType,
  isClaudeAISubscriber,
} from './auth.js'
import { getOrCreateUserID } from './config.js'
import { envDynamic } from './envDynamic.js'
import { isEnvTruthy } from './envUtils.js'
import { type APIProvider, getAPIProvider } from './model/providers.js'
import { toTaggedId } from './taggedId.js'

// Default configuration for metrics cardinality
const METRICS_CARDINALITY_DEFAULTS = {
  OTEL_METRICS_INCLUDE_SESSION_ID: true,
  OTEL_METRICS_INCLUDE_VERSION: false,
  OTEL_METRICS_INCLUDE_ACCOUNT_UUID: true,
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
