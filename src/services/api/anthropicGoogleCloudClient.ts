/**
 * densable AnthropicGoogleCloud (Claude Platform on Google Cloud) @199581842.
 *
 * Gold L: `https://claude.googleapis.com/v1alpha/projects/${project}/locations/${location}/workspaces/${workspace}/invoke`
 * Default location `global`. Auth is Google bearer (ADC / googleAuth), not apiKey.
 */
import Anthropic, {
  type ClientOptions,
  AnthropicError,
} from '@anthropic-ai/sdk'
import { GoogleAuth, type AuthClient } from 'google-auth-library'

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const DEFAULT_LOCATION = 'global'

function readEnv(name: string): string | undefined {
  const v = process.env[name]
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
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

function invokeBaseURL(
  project: string,
  location: string,
  workspaceId: string,
): string {
  return `https://claude.googleapis.com/v1alpha/projects/${project}/locations/${location}/workspaces/${workspaceId}/invoke`
}

export type AnthropicGoogleCloudClientOptions = ClientOptions & {
  project?: string | null
  location?: string | null
  workspaceId?: string
  skipAuth?: boolean
  googleAuth?: GoogleAuth | null
  authClient?: AuthClient | null
}

export class AnthropicGoogleCloudClient extends Anthropic {
  project: string | null
  location: string | null
  workspaceId: string | undefined
  skipAuth: boolean
  private googleAuth: GoogleAuth | null
  private authClient: AuthClient | null
  private authClientPromise: Promise<AuthClient> | null

  constructor({
    baseURL,
    project,
    location,
    workspaceId,
    skipAuth = false,
    googleAuth = null,
    authClient = null,
    apiKey: _apiKey,
    defaultHeaders,
    ...opts
  }: AnthropicGoogleCloudClientOptions = {}) {
    if (authClient && googleAuth) {
      throw new AnthropicError(
        'The `authClient` and `googleAuth` arguments are mutually exclusive; only one can be passed at a time.',
      )
    }
    const resolvedProject =
      project ??
      readEnv('ANTHROPIC_GOOGLE_CLOUD_PROJECT') ??
      readEnv('GOOGLE_CLOUD_PROJECT') ??
      null
    const resolvedLocation =
      location ?? readEnv('ANTHROPIC_GOOGLE_CLOUD_LOCATION') ?? DEFAULT_LOCATION
    const resolvedWorkspace =
      workspaceId ?? readEnv('ANTHROPIC_GOOGLE_CLOUD_WORKSPACE_ID')
    const envBase = readEnv('ANTHROPIC_GOOGLE_CLOUD_BASE_URL')
    const givenBase = baseURL ?? envBase
    if (!resolvedWorkspace && !(skipAuth && givenBase)) {
      throw new AnthropicError(
        'No workspace ID found. Set `workspaceId` in the constructor or the `ANTHROPIC_GOOGLE_CLOUD_WORKSPACE_ID` environment variable.',
      )
    }
    let resolvedBase = givenBase
    if (!resolvedBase) {
      if (resolvedProject && resolvedWorkspace) {
        resolvedBase = invokeBaseURL(
          resolvedProject,
          resolvedLocation,
          resolvedWorkspace,
        )
      } else if (skipAuth) {
        throw new AnthropicError(
          'No project was given. Set `project` or the `ANTHROPIC_GOOGLE_CLOUD_PROJECT` environment variable (or provide `baseURL`).',
        )
      }
    }

    const headers = mergeHeaders(
      resolvedWorkspace
        ? { 'anthropic-workspace-id': resolvedWorkspace }
        : undefined,
      defaultHeaders as Record<string, string> | undefined,
    )

    super({
      apiKey: null,
      baseURL: resolvedBase ?? 'https://unresolved.invalid',
      defaultHeaders: headers,
      ...opts,
    })

    this.project = resolvedProject
    this.location = resolvedLocation
    this.workspaceId = resolvedWorkspace
    this.skipAuth = skipAuth
    this.googleAuth = googleAuth
    this.authClient = authClient
    this.authClientPromise = null
    if (!skipAuth && !authClient) {
      const auth =
        googleAuth ?? new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] })
      this.googleAuth = auth
      this.authClientPromise = auth.getClient()
      void this.authClientPromise.catch(() => {})
    }
    if (!resolvedBase && !skipAuth) {
      const auth =
        this.googleAuth ??
        new GoogleAuth({
          scopes: [CLOUD_PLATFORM_SCOPE],
          ...(authClient ? { authClient } : {}),
        })
      void auth.getProjectId().then(id => {
        this.project = id
        if (this.workspaceId) {
          this.baseURL = invokeBaseURL(id, resolvedLocation, this.workspaceId)
        }
      })
    }
  }

  protected override async authHeaders(): Promise<
    Awaited<ReturnType<Anthropic['authHeaders']>>
  > {
    return undefined
  }

  protected override validateHeaders(): void {}

  protected override async prepareRequest(
    request: Parameters<Anthropic['prepareRequest']>[0],
    _info: Parameters<Anthropic['prepareRequest']>[1],
  ): Promise<void> {
    if (this.skipAuth) return
    const headers = (request.headers ?? {}) as Record<string, string>
    if (headers.Authorization || headers.authorization) return
    const token = await this.googleAccessToken()
    request.headers = { ...headers, Authorization: `Bearer ${token}` }
  }

  private async googleAccessToken(): Promise<string> {
    if (this.authClient) {
      const { token } = await this.authClient.getAccessToken()
      if (!token) {
        throw new AnthropicError(
          'Failed to obtain a Google access token from Application Default Credentials.',
        )
      }
      return token
    }
    const client = await (this.authClientPromise ??
      (
        this.googleAuth ?? new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] })
      ).getClient())
    const { token } = await client.getAccessToken()
    if (!token) {
      throw new AnthropicError(
        'Failed to obtain a Google access token from Application Default Credentials.',
      )
    }
    return token
  }
}
