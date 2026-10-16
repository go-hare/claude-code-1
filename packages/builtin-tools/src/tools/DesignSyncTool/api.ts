/**
 * densable 2.1.289 DesignSync RPC (`P` / L B U W M Y q J V).
 * POST /anthropic.omelette.api.v1alpha.OmeletteService/<method>.
 */
import axios from 'axios'
import { getOauthConfig } from 'src/constants/oauth.js'
import { errorMessage } from 'src/utils/errors.js'
import { getAnthropicClientPlatform } from 'src/utils/teleport/api.js'

const SERVICE = 'anthropic.omelette.api.v1alpha.OmeletteService'
const GET_FILE_CAP = 262_144

export class DesignRpcError extends Error {
  readonly method: string
  readonly status: number
  readonly body: unknown
  readonly telemetryMessage: string

  constructor(method: string, status: number, body: unknown) {
    super(`Design API ${method} failed: HTTP ${status} ${summarizeBody(body)}`)
    this.name = 'DesignRpcError'
    this.method = method
    this.status = status
    this.body = body
    this.telemetryMessage = `Design API ${method} failed: HTTP ${status}`
  }
}

export class DesignAuthError extends DesignRpcError {
  constructor(method: string, status: number, body: unknown) {
    super(method, status, body)
    this.name = 'DesignAuthError'
  }
}

function summarizeBody(body: unknown): string {
  if (body == null) return ''
  if (typeof body === 'string') return body.slice(0, 200)
  try {
    return JSON.stringify(body).slice(0, 200)
  } catch {
    return String(body).slice(0, 200)
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object') {
    return value as Record<string, unknown>
  }
  return null
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export type DesignProjectItem = {
  projectId?: string
  name?: string
  ownerDisplayName?: string
  isOwned?: boolean
  updatedAt?: string
  type?: string
  callerCanEdit?: boolean
  canEdit?: boolean
  sharing?: { teamCanEdit?: boolean }
}

function parseProject(value: unknown): DesignProjectItem | null {
  const row = asRecord(value)
  if (!row) return null
  const sharing = asRecord(row.sharing)
  return {
    projectId: optionalString(row.projectId),
    name: optionalString(row.name),
    ownerDisplayName: optionalString(row.ownerDisplayName),
    isOwned: optionalBoolean(row.isOwned),
    updatedAt: optionalString(row.updatedAt),
    type: optionalString(row.type),
    callerCanEdit: optionalBoolean(row.callerCanEdit),
    canEdit: optionalBoolean(row.canEdit),
    ...(sharing
      ? { sharing: { teamCanEdit: optionalBoolean(sharing.teamCanEdit) } }
      : {}),
  }
}

/**
 * Tests set this so a mistaken write cannot reach api.anthropic.com.
 * Unset in production.
 */
function assertDesignSyncNetworkAllowed(): void {
  if (process.env.CLAUDE_CODE_DESIGN_SYNC_TEST_BLOCK === '1') {
    throw new Error('DesignSync blocked a network call in tests')
  }
}

/** Gold `P`. */
export async function designRpc(
  method: string,
  token: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  assertDesignSyncNetworkAllowed()
  const url = `${getOauthConfig().BASE_API_URL}/${SERVICE}/${method}`
  let response: { status: number; data: unknown }
  try {
    response = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-client-platform': getAnthropicClientPlatform(),
        'X-Anthropic-Client': 'claude-cli-design-sync',
      },
      timeout: 60_000,
      maxBodyLength: 33_554_432,
      validateStatus: () => true,
      signal,
    })
  } catch (error) {
    throw new DesignRpcError(method, 0, { error: errorMessage(error) })
  }
  if (response.status === 401 || response.status === 403) {
    throw new DesignAuthError(method, response.status, response.data)
  }
  if (response.status < 200 || response.status >= 300) {
    throw new DesignRpcError(method, response.status, response.data)
  }
  return response.data
}

export async function listOrgProjects(
  token: string,
  type: string,
  signal: AbortSignal,
): Promise<DesignProjectItem[]> {
  const data = await designRpc('ListOrgProjects', token, { type }, signal)
  const items = asRecord(data)?.items
  if (!Array.isArray(items)) return []
  return items.flatMap(item => {
    const project = parseProject(item)
    return project ? [project] : []
  })
}

export async function getDesignProject(
  token: string,
  projectId: string,
  signal: AbortSignal,
): Promise<DesignProjectItem> {
  const data = await designRpc('GetProject', token, { projectId }, signal)
  return parseProject(data) ?? {}
}

export async function listDesignFiles(
  token: string,
  projectId: string,
  signal: AbortSignal,
): Promise<string[]> {
  const paths: string[] = []
  let offset = 0
  for (let page = 0; page < 50; page++) {
    const body: Record<string, unknown> = { projectId, depth: -1 }
    if (offset > 0) body.offset = offset
    const data = await designRpc('ListFiles', token, body, signal)
    const row = asRecord(data)
    const entries = Array.isArray(row?.entries) ? row.entries : []
    for (const entry of entries) {
      const path = asRecord(entry)?.path
      if (typeof path === 'string') paths.push(path)
    }
    if (row?.truncated !== true || entries.length === 0) return paths
    offset += entries.length
  }
  throw new DesignRpcError('ListFiles', 0, {
    error: `pagination exceeded 50 pages (${paths.length} paths)`,
  })
}

export type DesignFileBody = {
  content: string
  contentType: string
  isBase64: boolean
  truncated: boolean
}

/** Gold `W`. Non-base64 bodies are base64 text decoded to utf8. */
export async function getDesignFile(
  token: string,
  projectId: string,
  path: string,
  signal: AbortSignal,
): Promise<DesignFileBody> {
  const data = await designRpc(
    'GetFile',
    token,
    { projectId, path, raw: true },
    signal,
  )
  const row = asRecord(data)
  const raw = typeof row?.content === 'string' ? row.content : ''
  const isBase64 = row?.isBase64 ?? false
  let content = raw
  let truncated = false
  if (isBase64) {
    if (content.length > GET_FILE_CAP) {
      content = content.slice(0, GET_FILE_CAP)
      truncated = true
    }
  } else {
    let bytes = Buffer.from(raw, 'base64')
    if (bytes.byteLength > GET_FILE_CAP) {
      bytes = bytes.subarray(0, GET_FILE_CAP)
      truncated = true
    }
    content = bytes.toString('utf8')
  }
  return {
    content,
    contentType: optionalString(row?.contentType) ?? '',
    isBase64: isBase64 === true,
    truncated,
  }
}

export type PreparedDesignFile = {
  path: string
  data: string
  encoding?: string
  mimeType?: string
}

export async function writeDesignFiles(
  token: string,
  projectId: string,
  files: PreparedDesignFile[],
  signal: AbortSignal,
): Promise<unknown[]> {
  const data = await designRpc(
    'WriteFiles',
    token,
    { projectId, files, deduplicate: false },
    signal,
  )
  const written = asRecord(data)?.files
  return Array.isArray(written) ? written : []
}

export async function deleteDesignFiles(
  token: string,
  projectId: string,
  paths: string[],
  signal: AbortSignal,
): Promise<number> {
  if (paths.length === 0) return 0
  const data = await designRpc(
    'DeleteFiles',
    token,
    { projectId, paths },
    signal,
  )
  const deleted = asRecord(data)?.deleted
  return typeof deleted === 'number' ? deleted : 0
}

export async function createDesignProject(
  token: string,
  name: string,
  signal: AbortSignal,
): Promise<{ projectId: string; name: string }> {
  const data = await designRpc(
    'CreateProject',
    token,
    { name, type: 'PROJECT_TYPE_DESIGN_SYSTEM' },
    signal,
  )
  const projectId = optionalString(asRecord(data)?.projectId)
  if (!projectId) throw new DesignRpcError('CreateProject', 200, data)
  return { projectId, name }
}

export type DesignAssetCard = {
  name: string
  path: string
  subtitle?: string
  viewport?: { width: number; height?: number }
  group?: string
}

export async function recordDesignAsset(
  token: string,
  projectId: string,
  asset: DesignAssetCard,
  signal: AbortSignal,
): Promise<void> {
  const body: Record<string, unknown> = {
    projectId,
    name: asset.name,
    path: asset.path,
  }
  if (asset.subtitle) body.subtitle = asset.subtitle
  if (asset.viewport) body.viewport = asset.viewport
  if (asset.group) body.section = asset.group
  await designRpc('RecordAsset', token, body, signal)
}

export async function deleteDesignAsset(
  token: string,
  projectId: string,
  path: string,
  signal: AbortSignal,
): Promise<void> {
  await designRpc('DeleteAsset', token, { projectId, path }, signal)
}
