/**
 * Official AnthropicAws densable (Claude Platform on AWS).
 *
 * Mirrors the bundled AnthropicAws client from official CLI:
 * - base URL: ANTHROPIC_AWS_BASE_URL or
 *   https://aws-external-anthropic.{region}.api.aws
 * - workspace header: anthropic-workspace-id (ANTHROPIC_AWS_WORKSPACE_ID)
 * - auth: api key / Bearer, or SigV4 service `aws-external-anthropic`
 *
 * Uses bedrock-sdk getAuthHeaders for SigV4 (same stack as Mantle).
 */

import Anthropic, {
  type ClientOptions,
  AnthropicError,
} from '@anthropic-ai/sdk'
import { getAuthHeaders } from '@anthropic-ai/bedrock-sdk/core/aws-auth.js'

const AWS_EXTERNAL_ANTHROPIC_SERVICE = 'aws-external-anthropic'

function readEnv(name: string): string | undefined {
  const v = process.env[name]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function mergeHeaders(
  ...parts: Array<Record<string, string> | undefined | null>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of parts) {
    if (!p) continue
    for (const [k, v] of Object.entries(p)) {
      if (v != null) out[k] = v
    }
  }
  return out
}

type AwsCredentialIdentity = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export type AnthropicAwsClientOptions = ClientOptions & {
  awsRegion?: string | undefined
  awsAccessKey?: string | null | undefined
  awsSecretAccessKey?: string | null | undefined
  awsSessionToken?: string | null | undefined
  awsProfile?: string | undefined
  providerChainResolver?:
    | (() => Promise<() => Promise<AwsCredentialIdentity>>)
    | null
  workspaceId?: string | undefined
  skipAuth?: boolean
}

/**
 * Official AnthropicAws densable client.
 */
export class AnthropicAwsClient extends Anthropic {
  awsRegion: string | undefined
  awsAccessKey: string | null
  awsSecretAccessKey: string | null
  awsSessionToken: string | null
  awsProfile: string | null
  providerChainResolver:
    | (() => Promise<() => Promise<AwsCredentialIdentity>>)
    | null
  workspaceId: string | undefined
  skipAuth: boolean
  private _useSigV4: boolean

  constructor({
    awsRegion,
    baseURL,
    apiKey,
    awsAccessKey = null,
    awsSecretAccessKey = null,
    awsSessionToken = null,
    awsProfile,
    providerChainResolver = null,
    workspaceId,
    skipAuth = false,
    defaultHeaders,
    ...opts
  }: AnthropicAwsClientOptions = {}) {
    const resolvedRegion =
      awsRegion ?? readEnv('AWS_REGION') ?? readEnv('AWS_DEFAULT_REGION')
    const resolvedBaseURL =
      baseURL ??
      readEnv('ANTHROPIC_AWS_BASE_URL') ??
      (resolvedRegion
        ? `https://aws-external-anthropic.${resolvedRegion}.api.aws`
        : undefined)

    if (!resolvedBaseURL && !skipAuth) {
      throw new AnthropicError(
        'No AWS region or base URL found. Set `awsRegion` in the constructor, the `AWS_REGION` / `AWS_DEFAULT_REGION` environment variable, or provide a `baseURL` / `ANTHROPIC_AWS_BASE_URL` environment variable.',
      )
    }

    const hasExplicitApiKey = apiKey != null
    const hasPartialAwsCreds =
      (awsAccessKey != null) !== (awsSecretAccessKey != null)
    if (hasPartialAwsCreds) {
      throw new AnthropicError(
        '`awsAccessKey` and `awsSecretAccessKey` must be provided together. You provided only one.',
      )
    }
    const hasExplicitAwsCreds =
      awsAccessKey != null && awsSecretAccessKey != null
    const hasAwsProfile = awsProfile != null

    let resolvedApiKey: string | undefined
    if (hasExplicitApiKey) {
      resolvedApiKey = apiKey as string
    } else if (!hasExplicitAwsCreds && !hasAwsProfile) {
      resolvedApiKey = readEnv('ANTHROPIC_AWS_API_KEY')
    }

    const resolvedWorkspace =
      workspaceId ?? readEnv('ANTHROPIC_AWS_WORKSPACE_ID')
    if (!resolvedWorkspace && !skipAuth) {
      throw new AnthropicError(
        'No workspace ID found. Set `workspaceId` in the constructor or the `ANTHROPIC_AWS_WORKSPACE_ID` environment variable.',
      )
    }

    const headers = mergeHeaders(
      resolvedWorkspace
        ? { 'anthropic-workspace-id': resolvedWorkspace }
        : undefined,
      defaultHeaders as Record<string, string> | undefined,
    )

    super({
      apiKey: resolvedApiKey,
      baseURL: resolvedBaseURL,
      defaultHeaders: headers,
      ...opts,
    })

    this.awsRegion = resolvedRegion
    this.awsAccessKey = awsAccessKey
    this.awsSecretAccessKey = awsSecretAccessKey
    this.awsSessionToken = awsSessionToken
    this.awsProfile = awsProfile ?? null
    this.providerChainResolver = providerChainResolver
    this.workspaceId = resolvedWorkspace
    this.skipAuth = skipAuth
    this._useSigV4 = resolvedApiKey == null
  }

  protected override async authHeaders(
    opts: Parameters<Anthropic['authHeaders']>[0],
  ): Promise<Awaited<ReturnType<Anthropic['authHeaders']>>> {
    if (this.skipAuth) return undefined
    if (!this._useSigV4) {
      return super.authHeaders(opts)
    }
    // SigV4 handled in prepareRequest
    return undefined
  }

  protected override validateHeaders(): void {
    // Auth validation is handled in constructor / prepareRequest
  }

  protected override async prepareRequest(
    request: Parameters<Anthropic['prepareRequest']>[0],
    info: Parameters<Anthropic['prepareRequest']>[1],
  ): Promise<void> {
    if (this.skipAuth || !this._useSigV4) return
    const regionName = this.awsRegion
    if (!regionName) {
      throw new AnthropicError(
        'No AWS region found. Set `awsRegion` in the constructor or the `AWS_REGION` / `AWS_DEFAULT_REGION` environment variable.',
      )
    }
    const headers = await getAuthHeaders(request, {
      url: info.url,
      regionName,
      serviceName: AWS_EXTERNAL_ANTHROPIC_SERVICE,
      awsAccessKey: this.awsAccessKey,
      awsSecretAccessKey: this.awsSecretAccessKey,
      awsSessionToken: this.awsSessionToken,
      awsProfile: this.awsProfile,
      // bedrock-sdk AuthProps accepts providerChainResolver with smithy types;
      // our local identity shape is structurally compatible at runtime.
      providerChainResolver: this.providerChainResolver as never,
    })
    // Merge signed headers over request headers (official qT8 order).
    const merged = mergeHeaders(
      headers,
      request.headers as Record<string, string> | undefined,
    )
    request.headers = merged
  }
}
