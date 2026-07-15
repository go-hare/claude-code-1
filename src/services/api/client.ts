import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import type { GoogleAuth } from 'google-auth-library'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getAnthropicApiKey,
  getApiKeyFromApiKeyHelper,
  getClaudeAIOAuthTokens,
  getDefaultAwsProviderChain,
  hostManagedAwsSdkCredentials,
  isClaudeAISubscriber,
  isHostManagedProviderAuth,
  refreshAndGetAwsCredentials,
  refreshGcpCredentialsIfNeeded,
} from 'src/utils/auth.js'
import { getUserAgent } from 'src/utils/http.js'
import { getSmallFastModel } from 'src/utils/model/model.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from 'src/utils/model/providers.js'
import { wrapFetchWithBodyIdleWatchdog } from 'src/utils/bodyIdleWatchdog.js'
import { getProxyFetchOptions } from 'src/utils/proxy.js'
import {
  resolveByteStreamIdleTimeoutMs,
  shouldEnableBodyIdleWatchdog,
} from 'src/utils/streamWatchdogGates.js'
import {
  getIsNonInteractiveSession,
  getSessionId,
} from 'src/bootstrap/state.js'
import { getOauthConfig } from '../../constants/oauth.js'
import { isDebugToStdErr, logForDebugging } from '../../utils/debug.js'
import {
  getAWSRegion,
  getVertexRegionForModel,
  isEnvTruthy,
} from '../../utils/envUtils.js'
import { applyGzipRequestBodyInit } from '../../utils/gzipRequestBodies.js'
import {
  applyGatewayFromEnvResult,
  formatGatewaySessionExpiredError,
  getGatewayAuth,
  isGatewayAuthExpired,
  resolveGatewayFromEnv,
} from '../../utils/gatewayEnv.js'
import { extractAuthorizationHeader } from '../../utils/residualFinalEnvGates.js'
import { shouldPropagateTraceparent } from '../../utils/propagateTraceparent.js'

/**
 * Environment variables for different client types:
 *
 * Direct API:
 * - ANTHROPIC_API_KEY: Required for direct API access
 *
 * AWS Bedrock:
 * - AWS credentials configured via aws-sdk defaults
 * - AWS_REGION or AWS_DEFAULT_REGION: Sets the AWS region for all models (default: us-east-1)
 * - ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION: Optional. Override AWS region specifically for the small fast model (Haiku)
 *
 * Foundry (Azure):
 * - ANTHROPIC_FOUNDRY_RESOURCE: Your Azure resource name (e.g., 'my-resource')
 *   For the full endpoint: https://{resource}.services.ai.azure.com/anthropic/v1/messages
 * - ANTHROPIC_FOUNDRY_BASE_URL: Optional. Alternative to resource - provide full base URL directly
 *   (e.g., 'https://my-resource.services.ai.azure.com')
 *
 * Authentication (one of the following):
 * - ANTHROPIC_FOUNDRY_API_KEY: Your Microsoft Foundry API key (if using API key auth)
 * - Azure AD authentication: If no API key is provided, uses DefaultAzureCredential
 *   which supports multiple auth methods (environment variables, managed identity,
 *   Azure CLI, etc.). See: https://docs.microsoft.com/en-us/javascript/api/@azure/identity
 *
 * Vertex AI:
 * - Model-specific region variables (highest priority):
 *   - VERTEX_REGION_CLAUDE_3_5_HAIKU: Region for Claude 3.5 Haiku model
 *   - VERTEX_REGION_CLAUDE_HAIKU_4_5: Region for Claude Haiku 4.5 model
 *   - VERTEX_REGION_CLAUDE_3_5_SONNET: Region for Claude 3.5 Sonnet model
 *   - VERTEX_REGION_CLAUDE_3_7_SONNET: Region for Claude 3.7 Sonnet model
 * - CLOUD_ML_REGION: Optional. The default GCP region to use for all models
 *   If specific model region not specified above
 * - ANTHROPIC_VERTEX_PROJECT_ID: Required. Your GCP project ID
 * - Standard GCP credentials configured via google-auth-library
 *
 * Priority for determining region:
 * 1. Hardcoded model-specific environment variables
 * 2. Global CLOUD_ML_REGION variable
 * 3. Default region from config
 * 4. Fallback region (us-east5)
 */

function createStderrLogger(): ClientOptions['logger'] {
  return {
    error: (msg, ...args) =>
      console.error('[Anthropic SDK ERROR]', msg, ...args),
    warn: (msg, ...args) => console.error('[Anthropic SDK WARN]', msg, ...args),
    info: (msg, ...args) => console.error('[Anthropic SDK INFO]', msg, ...args),
    debug: (msg, ...args) =>
      console.error('[Anthropic SDK DEBUG]', msg, ...args),
  }
}

export async function getAnthropicClient({
  apiKey,
  maxRetries,
  model,
  fetchOverride,
  source,
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: ClientOptions['fetch']
  source?: string
}): Promise<Anthropic> {
  const containerId = process.env.CLAUDE_CODE_CONTAINER_ID
  const remoteSessionId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  const clientApp = process.env.CLAUDE_AGENT_SDK_CLIENT_APP
  const customHeaders = getCustomHeaders()
  const defaultHeaders: { [key: string]: string } = {
    'x-app': 'cli',
    'User-Agent': getUserAgent(),
    'X-Claude-Code-Session-Id': getSessionId(),
    ...customHeaders,
    ...(containerId ? { 'x-claude-remote-container-id': containerId } : {}),
    ...(remoteSessionId
      ? { 'x-claude-remote-session-id': remoteSessionId }
      : {}),
    // SDK consumers can identify their app/library for backend analytics
    ...(clientApp ? { 'x-client-app': clientApp } : {}),
    // SSH auth proxy nonce — tunneled API requests must carry this header
    ...(process.env.ANTHROPIC_AUTH_NONCE
      ? { 'x-auth-nonce': process.env.ANTHROPIC_AUTH_NONCE }
      : {}),
  }

  // Log API client configuration for HFI debugging
  logForDebugging(
    `[API:request] Creating client, ANTHROPIC_CUSTOM_HEADERS present: ${!!process.env.ANTHROPIC_CUSTOM_HEADERS}, has Authorization header: ${!!customHeaders['Authorization']}`,
  )

  // Official ADDITIONAL_PROTECTION densable — x-anthropic-additional-protection.
  let additionalProtectionEnabled = isEnvTruthy(
    process.env.CLAUDE_CODE_ADDITIONAL_PROTECTION,
  )
  try {
    const { isAdditionalProtectionEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    additionalProtectionEnabled = isAdditionalProtectionEnabled()
  } catch {
    // residual helpers optional
  }
  if (additionalProtectionEnabled) {
    defaultHeaders['x-anthropic-additional-protection'] = 'true'
  }

  // Official CLAUDE_CODE_PROPAGATE_TRACEPARENT — forward W3C trace context.
  if (shouldPropagateTraceparent() && process.env.TRACEPARENT) {
    defaultHeaders['traceparent'] = process.env.TRACEPARENT
  }
  if (shouldPropagateTraceparent() && process.env.TRACESTATE) {
    defaultHeaders['tracestate'] = process.env.TRACESTATE
  }

  logForDebugging('[API:auth] OAuth token check starting')
  await checkAndRefreshOAuthTokenIfNeeded()
  logForDebugging('[API:auth] OAuth token check complete')

  // Official uRi first branch: resolve + apply gateway BEFORE getAPIProvider()
  // and before cloud client branches. Env/secure-storage session must be
  // visible to getAPIProvider() (gateway ranks above BEDROCK/VERTEX/etc.).
  const gatewayFromEnvEarly = resolveGatewayFromEnv()
  if (gatewayFromEnvEarly.status === 'missing') {
    logForDebugging(gatewayFromEnvEarly.message)
  } else if (gatewayFromEnvEarly.status === 'invalid_url') {
    throw new Error(gatewayFromEnvEarly.message)
  }
  applyGatewayFromEnvResult(gatewayFromEnvEarly)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      getGatewayAuth: getGw,
      tryRestoreGatewayAuthFromSecureStorage,
      maybeRefreshGatewayIdp,
    } = require('../../utils/gatewayEnv.js') as typeof import('../../utils/gatewayEnv.js')
    if (!getGw()) {
      // Else restore enterpriseGateway from secureStorage when gatewayTrust pin
      // present (sync densable; live TLS probe denser via restoreGatewayAuth).
      tryRestoreGatewayAuthFromSecureStorage({ quiet: true })
    }
    // Fire-and-forget densable when transport absent (skipped/error); real
    // postToken inject denser at enterprise login sites.
    void maybeRefreshGatewayIdp()
  } catch {
    // densable optional
  }

  // Official CAh → F_({ forAnthropicAPI: true, hasBodyIdleWatchdog: CAh(provider) })
  // Provider for this client request matches current session provider (getAPIProvider).
  // Must run AFTER env/secure-storage gateway apply so first cold start with
  // CLAUDE_CODE_USE_GATEWAY does not mis-route to BedrockClient.
  const requestProvider = getAPIProvider()

  // Skip apiKeyHelper headers when a gateway JWT session is active.
  if (!isClaudeAISubscriber() && requestProvider !== 'gateway') {
    await configureApiKeyHeaders(defaultHeaders, getIsNonInteractiveSession())
  }
  const hasBodyIdleWatchdog = shouldEnableBodyIdleWatchdog({
    requestProvider,
    currentProvider: requestProvider,
  })
  // Official HAi — only resolve when CAh is on; consumer wraps response body.
  const bodyIdleTimeoutMs = hasBodyIdleWatchdog
    ? resolveByteStreamIdleTimeoutMs({ provider: requestProvider })
    : 0

  // Base fetch (gzip / client-request-id), then byte-body idle watchdog when
  // CAh is on so F_ timeout:false is not a hang hole.
  let resolvedFetch = buildFetch(fetchOverride, source)
  if (hasBodyIdleWatchdog && bodyIdleTimeoutMs > 0) {
    resolvedFetch = wrapFetchWithBodyIdleWatchdog(
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      (resolvedFetch ?? globalThis.fetch) as (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => Promise<Response>,
      () => ({
        enabled: true,
        idleTimeoutMs: bodyIdleTimeoutMs,
      }),
    ) as ClientOptions['fetch']
  }

  const ARGS = {
    defaultHeaders,
    maxRetries,
    timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
    dangerouslyAllowBrowser: true,
    fetchOptions: getProxyFetchOptions({
      forAnthropicAPI: true,
      hasBodyIdleWatchdog,
    }) as ClientOptions['fetchOptions'],
    ...(resolvedFetch && {
      fetch: resolvedFetch,
    }),
  }
  // Official USE_*/SKIP_* densables for cloud provider client selection.
  // IMPORTANT: Client construction must follow getAPIProvider() (requestProvider),
  // not raw env alone. Gateway session ranks above BEDROCK/VERTEX/etc. in
  // getAPIProvider(); building BedrockClient while provider==="gateway" sends
  // gateway-mapped models to the wrong endpoint with wrong auth.
  let useBedrock = isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
  let useFoundry = isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
  let useVertex = isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
  let skipBedrockAuth = isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)
  let skipFoundryAuth = isEnvTruthy(process.env.CLAUDE_CODE_SKIP_FOUNDRY_AUTH)
  let skipVertexAuth = isEnvTruthy(process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH)
  let skipAwsCredCache = isEnvTruthy(
    process.env.CLAUDE_CODE_SKIP_AWS_CRED_CACHE,
  )
  try {
    const {
      isUseBedrockEnvEnabled,
      isUseFoundryEnvEnabled,
      isUseVertexEnvEnabled,
      isSkipBedrockAuthEnvEnabled,
      isSkipFoundryAuthEnvEnabled,
      isSkipVertexAuthEnvEnabled,
      isSkipAwsCredCacheEnvEnabled,
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    useBedrock = isUseBedrockEnvEnabled()
    useFoundry = isUseFoundryEnvEnabled()
    useVertex = isUseVertexEnvEnabled()
    skipBedrockAuth = isSkipBedrockAuthEnvEnabled()
    skipFoundryAuth = isSkipFoundryAuthEnvEnabled()
    skipVertexAuth = isSkipVertexAuthEnvEnabled()
    skipAwsCredCache = isSkipAwsCredCacheEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  // Only construct cloud clients when getAPIProvider selected that provider.
  // Gateway / firstParty fall through past these branches.
  if (requestProvider === 'bedrock' && useBedrock) {
    const { BedrockClient } = await import('./bedrockClient.js')
    // Use region override for small fast model if specified
    const awsRegion =
      model === getSmallFastModel() &&
      process.env.ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION
        ? process.env.ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION
        : getAWSRegion()

    const bedrockArgs: Record<string, unknown> = {
      ...ARGS,
      awsRegion,
      ...(skipBedrockAuth && {
        skipAuth: true,
      }),
      ...(isDebugToStdErr() && { logger: createStderrLogger() }),
    }

    // Add API key authentication if available
    if (process.env.AWS_BEARER_TOKEN_BEDROCK) {
      bedrockArgs.skipAuth = true
      // Add the Bearer token for Bedrock API key authentication
      bedrockArgs.defaultHeaders = {
        ...(bedrockArgs.defaultHeaders as Record<string, string> | undefined),
        Authorization: `Bearer ${process.env.AWS_BEARER_TOKEN_BEDROCK}`,
      }
    } else if (!skipBedrockAuth) {
      // Official 2.1.207: host-managed desktop credentials (Qv/vpe) skip
      // settings awsAuthRefresh/export and use env keys or fromIni only.
      if (isHostManagedProviderAuth()) {
        bedrockArgs.providerChainResolver =
          hostManagedAwsSdkCredentials('Bedrock').providerChainResolver
      } else {
        // Export path when configured; else stall-guarded default chain via
        // providerChainResolver (avoids re-resolving SSO / Windows Cred
        // Manager on every request without a 60s hang).
        const cachedCredentials = await refreshAndGetAwsCredentials()
        if (cachedCredentials) {
          bedrockArgs.awsAccessKey = cachedCredentials.accessKeyId
          bedrockArgs.awsSecretKey = cachedCredentials.secretAccessKey
          bedrockArgs.awsSessionToken = cachedCredentials.sessionToken
        } else if (!skipAwsCredCache) {
          const resolveChain = await getDefaultAwsProviderChain(awsRegion)
          bedrockArgs.providerChainResolver = async () => {
            return async () => {
              const creds = await resolveChain()
              return {
                accessKeyId: creds.accessKeyId,
                secretAccessKey: creds.secretAccessKey,
                sessionToken: creds.sessionToken || undefined,
              }
            }
          }
        }
      }
    }
    // we have always been lying about the return type - this doesn't support batching or models
    return new BedrockClient(bedrockArgs) as unknown as Anthropic
  }
  if (requestProvider === 'foundry' && useFoundry) {
    const { AnthropicFoundry } = await import('@anthropic-ai/foundry-sdk')
    // Determine Azure AD token provider based on configuration
    // SDK reads ANTHROPIC_FOUNDRY_API_KEY by default
    let azureADTokenProvider: (() => Promise<string>) | undefined
    if (!process.env.ANTHROPIC_FOUNDRY_API_KEY) {
      if (skipFoundryAuth) {
        // Mock token provider for testing/proxy scenarios (similar to Vertex mock GoogleAuth)
        azureADTokenProvider = () => Promise.resolve('')
      } else {
        // Use real Azure AD authentication with DefaultAzureCredential
        const {
          DefaultAzureCredential: AzureCredential,
          getBearerTokenProvider,
        } = await import('@azure/identity')
        azureADTokenProvider = getBearerTokenProvider(
          new AzureCredential(),
          'https://cognitiveservices.azure.com/.default',
        )
      }
    }

    const foundryArgs: ConstructorParameters<typeof AnthropicFoundry>[0] = {
      ...ARGS,
      ...(azureADTokenProvider && { azureADTokenProvider }),
      ...(isDebugToStdErr() && { logger: createStderrLogger() }),
    }
    // we have always been lying about the return type - this doesn't support batching or models
    return new AnthropicFoundry(foundryArgs) as unknown as Anthropic
  }
  if (requestProvider === 'vertex' && useVertex) {
    // Refresh GCP credentials if gcpAuthRefresh is configured and credentials are expired
    // This is similar to how we handle AWS credential refresh for Bedrock
    if (!skipVertexAuth) {
      await refreshGcpCredentialsIfNeeded()
    }

    const [{ AnthropicVertex }, { GoogleAuth }] = await Promise.all([
      import('@anthropic-ai/vertex-sdk'),
      import('google-auth-library'),
    ])
    // TODO: Cache either GoogleAuth instance or AuthClient to improve performance
    // Currently we create a new GoogleAuth instance for every getAnthropicClient() call
    // This could cause repeated authentication flows and metadata server checks
    // However, caching needs careful handling of:
    // - Credential refresh/expiration
    // - Environment variable changes (GOOGLE_APPLICATION_CREDENTIALS, project vars)
    // - Cross-request auth state management
    // See: https://github.com/googleapis/google-auth-library-nodejs/issues/390 for caching challenges

    // Prevent metadata server timeout by providing projectId as fallback
    // google-auth-library checks project ID in this order:
    // 1. Environment variables (GCLOUD_PROJECT, GOOGLE_CLOUD_PROJECT, etc.)
    // 2. Credential files (service account JSON, ADC file)
    // 3. gcloud config
    // 4. GCE metadata server (causes 12s timeout outside GCP)
    //
    // We only set projectId if user hasn't configured other discovery methods
    // to avoid interfering with their existing auth setup

    // Check project environment variables in same order as google-auth-library
    // See: https://github.com/googleapis/google-auth-library-nodejs/blob/main/src/auth/googleauth.ts
    const hasProjectEnvVar =
      process.env['GCLOUD_PROJECT'] ||
      process.env['GOOGLE_CLOUD_PROJECT'] ||
      process.env['gcloud_project'] ||
      process.env['google_cloud_project']

    // Check for credential file paths (service account or ADC)
    // Note: We're checking both standard and lowercase variants to be safe,
    // though we should verify what google-auth-library actually checks
    const hasKeyFile =
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] ||
      process.env['google_application_credentials']

    const googleAuth = skipVertexAuth
      ? ({
          // Mock GoogleAuth for testing/proxy scenarios
          getClient: () => ({
            getRequestHeaders: () => ({}),
          }),
        } as unknown as GoogleAuth)
      : new GoogleAuth({
          scopes: ['https://www.googleapis.com/auth/cloud-platform'],
          // Only use ANTHROPIC_VERTEX_PROJECT_ID as last resort fallback
          // This prevents the 12-second metadata server timeout when:
          // - No project env vars are set AND
          // - No credential keyfile is specified AND
          // - ADC file exists but lacks project_id field
          //
          // Risk: If auth project != API target project, this could cause billing/audit issues
          // Mitigation: Users can set GOOGLE_CLOUD_PROJECT to override
          ...(hasProjectEnvVar || hasKeyFile
            ? {}
            : {
                projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
              }),
        })

    const vertexArgs: ConstructorParameters<typeof AnthropicVertex>[0] = {
      ...ARGS,
      region: getVertexRegionForModel(model),
      googleAuth: googleAuth as any,
      ...(isDebugToStdErr() && { logger: createStderrLogger() }),
    }
    // we have always been lying about the return type - this doesn't support batching or models
    return new AnthropicVertex(vertexArgs) as unknown as Anthropic
  }

  // Official anthropicAws / mantle client densables (after bedrock/foundry/vertex).
  let useAnthropicAws = isEnvTruthy(process.env.CLAUDE_CODE_USE_ANTHROPIC_AWS)
  let useMantle = isEnvTruthy(process.env.CLAUDE_CODE_USE_MANTLE)
  let skipAnthropicAwsAuth = isEnvTruthy(
    process.env.CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH,
  )
  let skipMantleAuth = isEnvTruthy(process.env.CLAUDE_CODE_SKIP_MANTLE_AUTH)
  type PeelAuth = (headers: Record<string, string>) => {
    value: string | undefined
    rest: Record<string, string>
  }
  let peelAuth: PeelAuth = headers => ({
    value: headers.Authorization ?? headers.authorization,
    rest: Object.fromEntries(
      Object.entries(headers).filter(
        ([k]) => k.toLowerCase() !== 'authorization',
      ),
    ),
  })
  let apiKeyFromAuthorizationHeader = (
    authorization: string | undefined,
  ): string | undefined => {
    if (!authorization) return undefined
    const m = authorization.match(/^Bearer (.+)$/i)
    return m?.[1] ?? authorization
  }
  try {
    const residual =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    useAnthropicAws = residual.isAnthropicAwsProviderEnabled()
    useMantle = residual.isMantleProviderEnabled()
    skipAnthropicAwsAuth = residual.shouldSkipAnthropicAwsAuth()
    skipMantleAuth = residual.shouldSkipMantleAuth()
    peelAuth = residual.extractAuthorizationHeader
    apiKeyFromAuthorizationHeader = residual.apiKeyFromAuthorizationHeader
  } catch {
    // keep raw env fallbacks + local peel helpers
  }

  if (requestProvider === 'anthropicAws' && useAnthropicAws) {
    const { AnthropicAwsClient } = await import('./anthropicAwsClient.js')
    const peeled = peelAuth(
      (ARGS.defaultHeaders ?? {}) as Record<string, string>,
    )
    const skipAuthBearer = skipAnthropicAwsAuth ? peeled.value : undefined
    const awsArgs: ConstructorParameters<typeof AnthropicAwsClient>[0] = {
      ...ARGS,
      defaultHeaders: {
        ...peeled.rest,
        Authorization: null as unknown as string,
      },
      ...(skipAnthropicAwsAuth &&
        !skipAuthBearer && {
          skipAuth: true,
        }),
      ...(skipAuthBearer && {
        apiKey: apiKeyFromAuthorizationHeader(skipAuthBearer) ?? skipAuthBearer,
        defaultHeaders: {
          ...peeled.rest,
          Authorization: skipAuthBearer,
        },
      }),
      ...(isDebugToStdErr() && { logger: createStderrLogger() }),
    }
    // Official: when no ANTHROPIC_AWS_API_KEY and not skipAuth, inject AWS creds.
    if (!process.env.ANTHROPIC_AWS_API_KEY && !skipAnthropicAwsAuth) {
      if (isHostManagedProviderAuth()) {
        awsArgs.providerChainResolver =
          hostManagedAwsSdkCredentials('AnthropicAws').providerChainResolver
      } else {
        const cachedCredentials = await refreshAndGetAwsCredentials()
        if (cachedCredentials) {
          awsArgs.awsAccessKey = cachedCredentials.accessKeyId
          awsArgs.awsSecretAccessKey = cachedCredentials.secretAccessKey
          awsArgs.awsSessionToken = cachedCredentials.sessionToken
        } else if (!skipAwsCredCache) {
          const resolveChain = await getDefaultAwsProviderChain(getAWSRegion())
          awsArgs.providerChainResolver = async () => {
            return async () => {
              const creds = await resolveChain()
              return {
                accessKeyId: creds.accessKeyId,
                secretAccessKey: creds.secretAccessKey,
                sessionToken: creds.sessionToken || undefined,
              }
            }
          }
        }
      }
    }
    return new AnthropicAwsClient(awsArgs) as unknown as Anthropic
  }

  if (requestProvider === 'mantle' && useMantle) {
    const { AnthropicBedrockMantle } = await import('@anthropic-ai/bedrock-sdk')
    const peeled = peelAuth(
      (ARGS.defaultHeaders ?? {}) as Record<string, string>,
    )
    const skipAuthBearer = skipMantleAuth ? peeled.value : undefined
    const bearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK?.trim()
    let awsCreds: {
      accessKeyId: string
      secretAccessKey: string
      sessionToken?: string
    } | null = null
    if (!bearerToken && !skipMantleAuth) {
      if (!isHostManagedProviderAuth()) {
        const cached = await refreshAndGetAwsCredentials()
        if (cached) {
          awsCreds = {
            accessKeyId: cached.accessKeyId,
            secretAccessKey: cached.secretAccessKey,
            sessionToken: cached.sessionToken,
          }
        }
      }
    }
    const mantleArgs: ConstructorParameters<typeof AnthropicBedrockMantle>[0] =
      {
        ...ARGS,
        awsRegion: getAWSRegion(),
        defaultHeaders: bearerToken
          ? {
              ...peeled.rest,
              Authorization: `Bearer ${bearerToken}`,
            }
          : {
              ...peeled.rest,
              Authorization: null as unknown as string,
            },
        ...(skipMantleAuth &&
          !skipAuthBearer && {
            skipAuth: true,
          }),
        ...(skipAuthBearer && {
          apiKey:
            apiKeyFromAuthorizationHeader(skipAuthBearer) ?? skipAuthBearer,
          defaultHeaders: {
            ...peeled.rest,
            Authorization: skipAuthBearer,
          },
        }),
        ...(awsCreds && {
          awsAccessKey: awsCreds.accessKeyId,
          awsSecretAccessKey: awsCreds.secretAccessKey,
          awsSessionToken: awsCreds.sessionToken,
        }),
        ...(isHostManagedProviderAuth() &&
          !bearerToken &&
          !skipMantleAuth &&
          !awsCreds && {
            providerChainResolver:
              hostManagedAwsSdkCredentials('Mantle').providerChainResolver,
          }),
        ...(isDebugToStdErr() && { logger: createStderrLogger() }),
      }
    return new AnthropicBedrockMantle(mantleArgs) as unknown as Anthropic
  }

  // Gateway session was applied before requestProvider resolution (env +
  // secure-storage). Build the Anthropic client with gateway auth when present.
  const gatewaySession = getGatewayAuth()
  if (requestProvider === 'gateway') {
    if (!gatewaySession || isGatewayAuthExpired(gatewaySession)) {
      throw new Error(formatGatewaySessionExpiredError())
    }
  }

  // Official gateway client: kTt peel Authorization then set Bearer jwt.
  const gatewayDefaultHeaders = gatewaySession
    ? {
        ...extractAuthorizationHeader(
          (ARGS.defaultHeaders ?? {}) as Record<string, string>,
        ).rest,
        Authorization: `Bearer ${gatewaySession.jwt}`,
      }
    : undefined

  // Determine authentication method based on available tokens
  const clientConfig: ConstructorParameters<typeof Anthropic>[0] = {
    apiKey: gatewaySession
      ? null
      : isClaudeAISubscriber()
        ? null
        : apiKey || getAnthropicApiKey(),
    authToken: gatewaySession
      ? gatewaySession.jwt
      : isClaudeAISubscriber()
        ? getClaudeAIOAuthTokens()?.accessToken
        : undefined,
    // Gateway session wins; else staging OAuth baseURL when ant.
    ...(gatewaySession
      ? { baseURL: gatewaySession.url }
      : process.env.USER_TYPE === 'ant' &&
          isEnvTruthy(process.env.USE_STAGING_OAUTH)
        ? { baseURL: getOauthConfig().BASE_API_URL }
        : {}),
    ...ARGS,
    ...(gatewayDefaultHeaders ? { defaultHeaders: gatewayDefaultHeaders } : {}),
    ...(isDebugToStdErr() && { logger: createStderrLogger() }),
  }

  return new Anthropic(clientConfig)
}

async function configureApiKeyHeaders(
  headers: Record<string, string>,
  isNonInteractiveSession: boolean,
): Promise<void> {
  // Official HFI densable — trajectory runner injects bearer via env.
  try {
    const { getHfiBearerToken } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    const hfi = getHfiBearerToken()
    if (hfi) {
      headers['Authorization'] = `Bearer ${hfi}`
      return
    }
  } catch {
    // residual helpers optional
  }
  const token =
    process.env.ANTHROPIC_AUTH_TOKEN ||
    (await getApiKeyFromApiKeyHelper(isNonInteractiveSession))
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
}

function getCustomHeaders(): Record<string, string> {
  const customHeaders: Record<string, string> = {}
  const customHeadersEnv = process.env.ANTHROPIC_CUSTOM_HEADERS

  if (!customHeadersEnv) return customHeaders

  // Split by newlines to support multiple headers
  const headerStrings = customHeadersEnv.split(/\n|\r\n/)

  for (const headerString of headerStrings) {
    if (!headerString.trim()) continue

    // Parse header in format "Name: Value" (curl style). Split on first `:`
    // then trim — avoids regex backtracking on malformed long header lines.
    const colonIdx = headerString.indexOf(':')
    if (colonIdx === -1) continue
    const name = headerString.slice(0, colonIdx).trim()
    const value = headerString.slice(colonIdx + 1).trim()
    if (name) {
      customHeaders[name] = value
    }
  }

  return customHeaders
}

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'

function buildFetch(
  fetchOverride: ClientOptions['fetch'],
  source: string | undefined,
): ClientOptions['fetch'] {
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  const inner = fetchOverride ?? globalThis.fetch
  // Only send to the first-party API — Bedrock/Vertex/Foundry don't log it
  // and unknown headers risk rejection by strict proxies (inc-4029 class).
  const injectClientRequestId =
    getAPIProvider() === 'firstParty' && isFirstPartyAnthropicBaseUrl()
  return (input, init) => {
    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
    const headers = new Headers(init?.headers)
    // Generate a client-side request ID so timeouts (which return no server
    // request ID) can still be correlated with server logs by the API team.
    // Callers that want to track the ID themselves can pre-set the header.
    if (injectClientRequestId && !headers.has(CLIENT_REQUEST_ID_HEADER)) {
      headers.set(CLIENT_REQUEST_ID_HEADER, randomUUID())
    }
    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
    let url = ''
    try {
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      url = input instanceof Request ? input.url : String(input)
      const id = headers.get(CLIENT_REQUEST_ID_HEADER)
      logForDebugging(
        `[API REQUEST] ${new URL(url).pathname}${id ? ` ${CLIENT_REQUEST_ID_HEADER}=${id}` : ''} source=${source ?? 'unknown'}`,
      )
    } catch {
      // never let logging crash the fetch
    }
    // Official x_h: compress eligible first-party request bodies with gzip
    // and pad JSON body whitespace for length fingerprint resistance.
    const withGzip = applyGzipRequestBodyInit(url, {
      ...init,
      headers,
    })
    return inner(input, withGzip ?? { ...init, headers })
  }
}
