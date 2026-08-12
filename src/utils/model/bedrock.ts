import memoize from 'lodash-es/memoize.js'
import {
  getDefaultAwsProviderChain,
  refreshAndGetAwsCredentials,
} from '../auth.js'
import { getAWSRegion, isEnvTruthy } from '../envUtils.js'
import { logError } from '../log.js'
import { getAWSClientProxyConfig } from '../proxy.js'

export const getBedrockInferenceProfiles = memoize(async function (): Promise<
  string[]
> {
  const [client, { ListInferenceProfilesCommand }] = await Promise.all([
    createBedrockClient(),
    import('@aws-sdk/client-bedrock'),
  ])
  const allProfiles = []
  let nextToken: string | undefined

  try {
    do {
      const command = new ListInferenceProfilesCommand({
        ...(nextToken && { nextToken }),
        typeEquals: 'SYSTEM_DEFINED',
      })
      const response = await client.send(command)

      if (response.inferenceProfileSummaries) {
        allProfiles.push(...response.inferenceProfileSummaries)
      }

      nextToken = response.nextToken
    } while (nextToken)

    // Filter for Anthropic models (SYSTEM_DEFINED filtering handled in query)
    return allProfiles
      .filter(profile => profile.inferenceProfileId?.includes('anthropic'))
      .map(profile => profile.inferenceProfileId)
      .filter(Boolean) as string[]
  } catch (error) {
    logError(error as Error)
    throw error
  }
})

export function findFirstMatch(
  profiles: string[],
  substring: string,
): string | null {
  return profiles.find(p => p.includes(substring)) ?? null
}

async function createBedrockClient() {
  const { BedrockClient } = await import('@aws-sdk/client-bedrock')
  // Match the Anthropic Bedrock SDK's region behavior exactly:
  // - Reads AWS_REGION or AWS_DEFAULT_REGION env vars (not AWS config files)
  // - Falls back to 'us-east-1' if neither is set
  // This ensures we query profiles from the same region the client will use
  const region = getAWSRegion()

  const skipAuth = isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)

  const clientConfig: ConstructorParameters<typeof BedrockClient>[0] = {
    region,
    ...(process.env.ANTHROPIC_BEDROCK_BASE_URL && {
      endpoint: process.env.ANTHROPIC_BEDROCK_BASE_URL,
    }),
    ...(await getAWSClientProxyConfig()),
    ...(skipAuth && {
      requestHandler: new (
        await import('@smithy/node-http-handler')
      ).NodeHttpHandler(),
      httpAuthSchemes: [
        {
          schemeId: 'smithy.api#noAuth',
          identityProvider: () => async () => ({}),
          signer: new (await import('@smithy/core')).NoAuthSigner(),
        },
      ],
      httpAuthSchemeProvider: () => [{ schemeId: 'smithy.api#noAuth' }],
    }),
  }

  if (!skipAuth && !process.env.AWS_BEARER_TOKEN_BEDROCK) {
    // Official 2.1.207: prefer export credentials; else stall-guarded default chain
    const cachedCredentials = await refreshAndGetAwsCredentials()
    if (cachedCredentials) {
      clientConfig.credentials = {
        accessKeyId: cachedCredentials.accessKeyId,
        secretAccessKey: cachedCredentials.secretAccessKey,
        sessionToken: cachedCredentials.sessionToken,
      }
    } else if (!isEnvTruthy(process.env.CLAUDE_CODE_SKIP_AWS_CRED_CACHE)) {
      const resolveChain = await getDefaultAwsProviderChain(region)
      clientConfig.credentials = async () => {
        const creds = await resolveChain()
        return {
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
          sessionToken: creds.sessionToken || undefined,
        }
      }
    }
  }

  return new BedrockClient(clientConfig)
}

export async function createBedrockRuntimeClient() {
  const { BedrockRuntimeClient } = await import(
    '@aws-sdk/client-bedrock-runtime'
  )
  const region = getAWSRegion()
  const skipAuth = isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)

  const clientConfig: ConstructorParameters<typeof BedrockRuntimeClient>[0] = {
    region,
    ...(process.env.ANTHROPIC_BEDROCK_BASE_URL && {
      endpoint: process.env.ANTHROPIC_BEDROCK_BASE_URL,
    }),
    ...(await getAWSClientProxyConfig()),
    ...(skipAuth && {
      // BedrockRuntimeClient defaults to HTTP/2 without fallback
      // proxy servers may not support this, so we explicitly force HTTP/1.1
      requestHandler: new (
        await import('@smithy/node-http-handler')
      ).NodeHttpHandler(),
      httpAuthSchemes: [
        {
          schemeId: 'smithy.api#noAuth',
          identityProvider: () => async () => ({}),
          signer: new (await import('@smithy/core')).NoAuthSigner(),
        },
      ],
      httpAuthSchemeProvider: () => [{ schemeId: 'smithy.api#noAuth' }],
    }),
  }

  if (!skipAuth && !process.env.AWS_BEARER_TOKEN_BEDROCK) {
    const cachedCredentials = await refreshAndGetAwsCredentials()
    if (cachedCredentials) {
      clientConfig.credentials = {
        accessKeyId: cachedCredentials.accessKeyId,
        secretAccessKey: cachedCredentials.secretAccessKey,
        sessionToken: cachedCredentials.sessionToken,
      }
    } else if (!isEnvTruthy(process.env.CLAUDE_CODE_SKIP_AWS_CRED_CACHE)) {
      const resolveChain = await getDefaultAwsProviderChain(region)
      clientConfig.credentials = async () => {
        const creds = await resolveChain()
        return {
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
          sessionToken: creds.sessionToken || undefined,
        }
      }
    }
  }

  return new BedrockRuntimeClient(clientConfig)
}

export const getInferenceProfileBackingModel = memoize(async function (
  profileId: string,
): Promise<string | null> {
  try {
    const [client, { GetInferenceProfileCommand }] = await Promise.all([
      createBedrockClient(),
      import('@aws-sdk/client-bedrock'),
    ])
    const command = new GetInferenceProfileCommand({
      inferenceProfileIdentifier: profileId,
    })
    const response = await client.send(command)

    if (!response.models || response.models.length === 0) {
      return null
    }

    // Use the first model as the primary backing model for cost calculation
    // In practice, application inference profiles typically load balance between
    // similar models with the same cost structure
    const primaryModel = response.models[0]
    if (!primaryModel?.modelArn) {
      return null
    }

    // Extract model name from ARN
    // ARN format: arn:aws:bedrock:region:account:foundation-model/model-name
    const lastSlashIndex = primaryModel.modelArn.lastIndexOf('/')
    return lastSlashIndex >= 0
      ? primaryModel.modelArn.substring(lastSlashIndex + 1)
      : primaryModel.modelArn
  } catch (error) {
    logError(error as Error)
    return null
  }
})

/**
 * Check if a model ID is a foundation model (e.g., "anthropic.claude-sonnet-4-5-20250929-v1:0")
 */
export function isFoundationModel(modelId: string): boolean {
  return modelId.startsWith('anthropic.')
}

/**
 * Cross-region inference profile prefixes for Bedrock.
 * densable 2.1.224: `us-gov` is a valid env override via
 * ANTHROPIC_BEDROCK_REGION_PREFIX (Qgg/ldc); AWS_REGION us-gov-* also maps here.
 */
const BEDROCK_REGION_PREFIXES = [
  'us',
  'eu',
  'apac',
  'global',
  'us-gov',
] as const

/**
 * Extract the model/inference profile ID from a Bedrock ARN.
 * If the input is not an ARN, returns it unchanged.
 *
 * ARN format: arn:aws:bedrock:<region>:<account>:inference-profile/<profile-id>
 * Also handles: arn:aws:bedrock:<region>:<account>:application-inference-profile/<profile-id>
 * And foundation model ARNs: arn:aws:bedrock:<region>::foundation-model/<model-id>
 */
export function extractModelIdFromArn(modelId: string): string {
  if (!modelId.startsWith('arn:')) {
    return modelId
  }
  const lastSlashIndex = modelId.lastIndexOf('/')
  if (lastSlashIndex === -1) {
    return modelId
  }
  return modelId.substring(lastSlashIndex + 1)
}

export type BedrockRegionPrefix = (typeof BEDROCK_REGION_PREFIXES)[number]

/**
 * densable Upt(e) — map AWS region string → cross-region inference profile prefix.
 *   us-gov-* → us-gov
 *   us-*     → us
 *   eu-*     → eu
 *   ap-*     → apac
 *   else     → global
 */
export function deriveBedrockRegionPrefixFromAwsRegion(
  awsRegion: string | undefined | null,
): BedrockRegionPrefix {
  const t = awsRegion ?? ''
  if (t.startsWith('us-gov-')) return 'us-gov'
  if (t.startsWith('us-')) return 'us'
  if (t.startsWith('eu-')) return 'eu'
  if (t.startsWith('ap-')) return 'apac'
  return 'global'
}

/**
 * densable Qcr(e):
 *   if AWS region is us-gov-* → always "us-gov" (env cannot override residency)
 *   else ANTHROPIC_BEDROCK_REGION_PREFIX ?? Upt(e)
 *
 * Changelog 2.1.224 #4: prefer a specific cross-region inference profile over
 * the AWS_REGION-derived one when the env is set.
 */
export function resolveBedrockRegionPrefix(
  awsRegion: string | undefined | null = getAWSRegion(),
  env: NodeJS.ProcessEnv = process.env,
): BedrockRegionPrefix {
  if (awsRegion?.startsWith('us-gov-')) return 'us-gov'
  const raw = env.ANTHROPIC_BEDROCK_REGION_PREFIX
  if (raw !== undefined && raw !== '') {
    // densable Ne.enum(ldc) — accept known prefixes; unknown falls through to Upt
    if ((BEDROCK_REGION_PREFIXES as readonly string[]).includes(raw)) {
      return raw as BedrockRegionPrefix
    }
  }
  return deriveBedrockRegionPrefixFromAwsRegion(awsRegion)
}

/** densable warn when env override differs from AWS_REGION-derived prefix and discovery unavailable. */
export function formatBedrockRegionPrefixNoDiscoveryWarn(
  preferred: string,
  derived: string,
): string {
  return (
    `ANTHROPIC_BEDROCK_REGION_PREFIX=${preferred} is being applied without an availability check ` +
    `(inference-profile discovery is unavailable). If requests 400, ensure ${preferred}.* ` +
    `cross-region inference profiles are enabled in this account, or unset the variable to fall back to ${derived}.*.`
  )
}

/** densable warn when some models resolved without the preferred prefix. */
export function formatBedrockRegionPrefixMismatchWarn(
  preferred: string,
  modelLabels: string[],
): string {
  return (
    `ANTHROPIC_BEDROCK_REGION_PREFIX=${preferred}: ${modelLabels.length} model(s) resolved to a different prefix ` +
    `(no ${preferred}.* profile in this account): ${modelLabels.join(', ')}. ` +
    `This is a preference, not a residency guarantee.`
  )
}

/**
 * Extract the region prefix from a Bedrock cross-region inference model ID.
 * Handles both plain model IDs and full ARN format.
 * For example:
 * - "eu.anthropic.claude-sonnet-4-5-20250929-v1:0" → "eu"
 * - "us.anthropic.claude-3-7-sonnet-20250219-v1:0" → "us"
 * - "arn:aws:bedrock:ap-northeast-2:123:inference-profile/global.anthropic.claude-opus-4-6-v1" → "global"
 * - "anthropic.claude-3-5-sonnet-20241022-v2:0" → undefined (foundation model)
 * - "claude-sonnet-4-5-20250929" → undefined (first-party format)
 */
export function getBedrockRegionPrefix(
  modelId: string,
): BedrockRegionPrefix | undefined {
  // Extract the inference profile ID from ARN format if present
  // ARN format: arn:aws:bedrock:<region>:<account>:inference-profile/<profile-id>
  const effectiveModelId = extractModelIdFromArn(modelId)

  // Longer prefixes first so `us-gov` wins over `us`.
  const ordered = [...BEDROCK_REGION_PREFIXES].sort(
    (a, b) => b.length - a.length,
  )
  for (const prefix of ordered) {
    if (effectiveModelId.startsWith(`${prefix}.anthropic.`)) {
      return prefix
    }
  }
  return undefined
}

/**
 * Apply a region prefix to a Bedrock model ID.
 * If the model already has a different region prefix, it will be replaced.
 * If the model is a foundation model (anthropic.*), the prefix will be added.
 * If the model is not a Bedrock model, it will be returned as-is.
 *
 * For example:
 * - applyBedrockRegionPrefix("us.anthropic.claude-sonnet-4-5-v1:0", "eu") → "eu.anthropic.claude-sonnet-4-5-v1:0"
 * - applyBedrockRegionPrefix("anthropic.claude-sonnet-4-5-v1:0", "eu") → "eu.anthropic.claude-sonnet-4-5-v1:0"
 * - applyBedrockRegionPrefix("claude-sonnet-4-5-20250929", "eu") → "claude-sonnet-4-5-20250929" (not a Bedrock model)
 */
export function applyBedrockRegionPrefix(
  modelId: string,
  prefix: BedrockRegionPrefix,
): string {
  // Check if it already has a region prefix and replace it
  const existingPrefix = getBedrockRegionPrefix(modelId)
  if (existingPrefix) {
    return modelId.replace(`${existingPrefix}.`, `${prefix}.`)
  }

  // Check if it's a foundation model (anthropic.*) and add the prefix
  if (isFoundationModel(modelId)) {
    return `${prefix}.${modelId}`
  }

  // Not a Bedrock model format, return as-is
  return modelId
}
