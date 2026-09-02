/**
 * densable frame asset / file / verify / delete / room_send APIs (2.1.239).
 * Asset list/upload/delete: densable rxl (agent-* blob POST), not DL / multipart.
 * Paths from gold-Artifact-rest-actions-239. SEA often leaves room host unbound.
 */
import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { basename, extname } from 'path'
import { getOauthConfig } from '../../constants/oauth.js'
import { getClaudeAIOAuthTokens } from '../../utils/auth.js'
import { DL } from './frameDl.js'
import { isArtifactToolRegistered } from '../../utils/artifactUrl.js'
import { isValidArtifactSlug } from './arm.js'
import {
  ARTIFACT_ASSET_CONTENT_TYPES,
  ARTIFACT_ASSET_ID_RE,
  ARTIFACT_SAVE_CONTENT_TYPE_RE,
  ARTIFACT_SAVE_MAX_BYTES,
  extensionForContentType,
  normalizePublishedPath,
} from './outDirPaths.js'
import {
  ASSET_SVG_CONTENT_TYPE,
  ASSET_UPLOAD_MAX_BYTES,
  assetAgentDeleteRoute,
  assetAgentListRoute,
  assetAgentUploadRoute,
  assetRxl,
  assetRxlTimeouts,
  assetUploadByteLimit,
  ASSET_LIST_LIMIT,
  mapAssetHttpToFail,
} from './assetRxl.js'
import { fetchFrameBoot, frameControlPlaneHeaders } from './mint.js'
import { un } from './store.js'

const ASSET_ID_RE = /^[0-9a-f]{32}$/
/** densable vWt — list_assets cursor. */
const ASSET_LIST_CURSOR_RE = /^[A-Za-z0-9_=-]{1,4096}$/
/** densable exl — created_at. */
const ASSET_CREATED_AT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/
/** densable MEe — content_type echo. */
const ASSET_CONTENT_TYPE_RE = /^[a-z0-9]{1,24}\/[a-z0-9.+-]{1,80}$/
/** densable yHe — lowercase sha256. */
const ASSET_SHA256_RE = /^[0-9a-f]{64}$/

/** densable _Gi keys. */
const ASSET_EXTS = new Set(ARTIFACT_ASSET_CONTENT_TYPES.keys())

export type AssetRow = {
  id: string
  url: string
  contentType: string
  sizeBytes: number
  sha256?: string
  createdAt: string
}

export type FileRow = {
  path: string
  contentType: string
  sizeBytes: number
  sha256: string
}

function authHeaders(): Record<string, string> | null {
  const token = getClaudeAIOAuthTokens()?.accessToken
  if (!token) return null
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...frameControlPlaneHeaders(),
  }
}

function origin(): string {
  return getOauthConfig().CLAUDE_AI_ORIGIN
}

/** densable JSON GET via DL (o$i) — files/diagnostics; assets use rxl instead. */
async function frameCpGet(
  path: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; status: number; data: unknown }
  | { ok: false; reason: string; status?: number }
> {
  const res = await DL.get(path, {
    signal,
    timeoutMs: 15_000,
    headers: frameControlPlaneHeaders(),
  })
  if (!res.ok) {
    return { ok: false, reason: res.reason, status: res.status }
  }
  if (!res.fromFrame) {
    return { ok: false, reason: 'relay_error', status: res.status }
  }
  return { ok: true, status: res.status, data: res.data }
}

/** densable Le.number().int() — reject null / numeric strings. */
function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

function malformedList(): {
  kind: 'error'
  message: string
  reason: string
} {
  return {
    kind: 'error',
    message: 'the listing was unreadable',
    reason: 'malformed_reply',
  }
}

/** densable ECm — rxl POST agent-list. */
export async function listArtifactAssets(input: {
  slug: string
  after?: string
  signal?: AbortSignal
}): Promise<
  | {
      kind: 'ok'
      assets: AssetRow[]
      usage: {
        files: number
        bytes: number
        maxFiles: number
        maxBytes: number
      }
      next?: string
    }
  | { kind: 'error'; message: string; reason: string }
> {
  if (!isValidArtifactSlug(input.slug)) {
    return {
      kind: 'error',
      message: 'not a valid artifact id',
      reason: 'invalid_slug',
    }
  }
  if (input.after !== undefined && !ASSET_LIST_CURSOR_RE.test(input.after)) {
    return {
      kind: 'error',
      message:
        'after must be the next value from an earlier list_assets result',
      reason: 'invalid_cursor',
    }
  }
  const marks: Record<string, boolean> = {}
  const rxl = await assetRxl(
    {
      verb: 'list',
      route: assetAgentListRoute(input.slug),
      body: {
        ...(input.after !== undefined ? { after: input.after } : {}),
        limit: ASSET_LIST_LIMIT,
      },
      contentType: 'application/json',
      timeoutMs: assetRxlTimeouts.listDeleteMs,
      marks,
    },
    input.signal,
  )
  if (!rxl.replied) {
    return {
      kind: 'error',
      message: rxl.failure.message,
      reason: rxl.failure.reason,
    }
  }
  if (rxl.status !== 200) {
    const fail = mapAssetHttpToFail(rxl, 'list')
    return { kind: 'error', message: fail.message, reason: fail.reason }
  }
  const data = (rxl.data ?? {}) as {
    assets?: unknown
    usage?: Record<string, unknown>
    next?: unknown
  }
  if (
    !Array.isArray(data.assets) ||
    data.assets.length > 1000 ||
    !data.usage ||
    typeof data.usage !== 'object'
  ) {
    return malformedList()
  }
  const usageRaw = data.usage
  const files = usageRaw.files
  const bytes = usageRaw.bytes
  const maxFiles = usageRaw.max_files ?? usageRaw.maxFiles
  const maxBytes = usageRaw.max_bytes ?? usageRaw.maxBytes
  if (
    !isNonNegInt(files) ||
    !isNonNegInt(bytes) ||
    !isNonNegInt(maxFiles) ||
    !isNonNegInt(maxBytes)
  ) {
    return malformedList()
  }
  const assets: AssetRow[] = []
  for (const row of data.assets) {
    if (!row || typeof row !== 'object') return malformedList()
    const r = row as Record<string, unknown>
    const id = typeof r.opaque_id === 'string' ? r.opaque_id : undefined
    const contentType =
      typeof r.content_type === 'string' ? r.content_type : undefined
    const sizeBytes = r.size_bytes
    const createdAt =
      typeof r.created_at === 'string' ? r.created_at : undefined
    if (
      id === undefined ||
      !ASSET_ID_RE.test(id) ||
      contentType === undefined ||
      !ASSET_CONTENT_TYPE_RE.test(contentType) ||
      contentType.length > 40 ||
      !isNonNegInt(sizeBytes) ||
      sizeBytes > ASSET_UPLOAD_MAX_BYTES ||
      createdAt === undefined ||
      !ASSET_CREATED_AT_RE.test(createdAt) ||
      createdAt.length > 40
    ) {
      return malformedList()
    }
    if (r.sha256 !== undefined) {
      if (typeof r.sha256 !== 'string' || !ASSET_SHA256_RE.test(r.sha256)) {
        return malformedList()
      }
    }
    assets.push({
      id,
      url: `_blob/${id}`,
      contentType,
      sizeBytes,
      ...(typeof r.sha256 === 'string' ? { sha256: r.sha256 } : {}),
      createdAt,
    })
  }
  if (data.next !== undefined && data.next !== null && data.next !== '') {
    if (
      typeof data.next !== 'string' ||
      !ASSET_LIST_CURSOR_RE.test(data.next)
    ) {
      return malformedList()
    }
  }
  un().assetsOnRoster = true
  return {
    kind: 'ok',
    assets,
    usage: { files, bytes, maxFiles, maxBytes },
    ...(typeof data.next === 'string' && data.next ? { next: data.next } : {}),
  }
}

/** densable wCm portable — rxl POST agent-upload (raw bytes, not multipart). */
export async function uploadArtifactAsset(input: {
  slug: string
  filePath: string
  signal?: AbortSignal
}): Promise<
  | { kind: 'ok'; asset: AssetRow; fileName: string }
  | { kind: 'error'; message: string; reason: string }
> {
  if (!isValidArtifactSlug(input.slug)) {
    return {
      kind: 'error',
      message: 'not a valid artifact id',
      reason: 'invalid_slug',
    }
  }
  const ext = extname(input.filePath).toLowerCase()
  const contentType = ARTIFACT_ASSET_CONTENT_TYPES.get(ext)
  if (!ASSET_EXTS.has(ext) || contentType === undefined) {
    return {
      kind: 'error',
      message: `unsupported asset type "${ext}"`,
      reason: 'unsupported_type',
    }
  }
  let bytes: Buffer
  try {
    bytes = Buffer.from(await readFile(input.filePath))
  } catch {
    return {
      kind: 'error',
      message: `cannot read file_path: ${input.filePath}`,
      reason: 'read_error',
    }
  }
  const limit = assetUploadByteLimit(contentType)
  if (bytes.length === 0 || bytes.length > limit) {
    return {
      kind: 'error',
      message:
        bytes.length === 0
          ? 'the file is empty'
          : contentType === ASSET_SVG_CONTENT_TYPE
            ? `the SVG exceeds the ${limit >> 20} MiB limit for SVG assets — simplify or rasterize it`
            : `the file exceeds the ${limit >> 20} MiB per-asset limit — compress or split it`,
      reason: 'size',
    }
  }
  const fileName = basename(input.filePath)
  const marks: Record<string, boolean> = {}
  const rxl = await assetRxl(
    {
      verb: 'upload',
      route: assetAgentUploadRoute(input.slug),
      body: bytes,
      contentType,
      timeoutMs: assetRxlTimeouts.uploadMs,
      maxBodyLength: ASSET_UPLOAD_MAX_BYTES + 4096,
      marks,
    },
    input.signal,
  )
  if (!rxl.replied) {
    return {
      kind: 'error',
      message: rxl.failure.message,
      reason: rxl.failure.reason,
    }
  }
  if (rxl.status !== 200) {
    const fail = mapAssetHttpToFail(rxl, 'upload')
    return { kind: 'error', message: fail.message, reason: fail.reason }
  }
  const data = (rxl.data ?? {}) as Record<string, unknown>
  const id = typeof data.opaque_id === 'string' ? data.opaque_id : ''
  const echoType =
    typeof data.content_type === 'string' ? data.content_type : ''
  const sizeBytes = data.size_bytes
  const echoOk =
    ASSET_ID_RE.test(id) &&
    echoType === contentType &&
    typeof sizeBytes === 'number' &&
    Number.isInteger(sizeBytes) &&
    sizeBytes >= 0 &&
    (contentType === ASSET_SVG_CONTENT_TYPE
      ? sizeBytes > 0 && sizeBytes <= ASSET_UPLOAD_MAX_BYTES
      : sizeBytes === bytes.length)
  if (!echoOk) {
    return {
      kind: 'error',
      message:
        'the upload probably succeeded but the reply was unreadable — retry at most once; if it repeats, stop and report it',
      reason: 'malformed_echo',
    }
  }
  // densable hMw: sha256 optional but must match yHe when present
  if (
    data.sha256 !== undefined &&
    (typeof data.sha256 !== 'string' || !ASSET_SHA256_RE.test(data.sha256))
  ) {
    return {
      kind: 'error',
      message:
        'the upload probably succeeded but the reply was unreadable — retry at most once; if it repeats, stop and report it',
      reason: 'malformed_echo',
    }
  }
  un().assetsOnRoster = true
  return {
    kind: 'ok',
    fileName,
    asset: {
      id,
      url: `_blob/${id}`,
      contentType: echoType,
      sizeBytes,
      ...(typeof data.sha256 === 'string' ? { sha256: data.sha256 } : {}),
      createdAt: new Date().toISOString(),
    },
  }
}

/** densable ACm — rxl POST agent-delete. */
export async function deleteArtifactAsset(input: {
  slug: string
  id: string
  signal?: AbortSignal
}): Promise<
  | { kind: 'ok'; deleted: boolean }
  | { kind: 'error'; message: string; reason: string }
> {
  if (!isValidArtifactSlug(input.slug) || !ASSET_ID_RE.test(input.id)) {
    return {
      kind: 'error',
      message: 'invalid slug or asset_id',
      reason: 'input',
    }
  }
  const marks: Record<string, boolean> = {}
  const rxl = await assetRxl(
    {
      verb: 'delete',
      route: assetAgentDeleteRoute(input.slug, input.id),
      body: '{}',
      contentType: 'application/json',
      timeoutMs: assetRxlTimeouts.listDeleteMs,
      marks,
    },
    input.signal,
  )
  if (!rxl.replied) {
    return {
      kind: 'error',
      message: rxl.failure.message,
      reason: rxl.failure.reason,
    }
  }
  if (rxl.status !== 200) {
    const fail = mapAssetHttpToFail(rxl, 'delete')
    return { kind: 'error', message: fail.message, reason: fail.reason }
  }
  const data = (rxl.data ?? {}) as { deleted?: unknown }
  if (typeof data.deleted !== 'boolean') {
    return {
      kind: 'error',
      message:
        'the delete may have succeeded but the reply was unreadable — list the assets to check',
      reason: 'malformed_reply',
    }
  }
  un().assetsOnRoster = true
  return { kind: 'ok', deleted: data.deleted }
}

/** densable XCm — list published files on a frame. */
export async function listArtifactFiles(input: {
  slug: string
  signal?: AbortSignal
}): Promise<
  | {
      kind: 'ok'
      ver: string
      files: FileRow[]
      cowritten?: boolean
    }
  | { kind: 'error'; message: string; reason: string }
> {
  if (!isValidArtifactSlug(input.slug)) {
    return { kind: 'error', message: 'invalid slug', reason: 'input' }
  }
  try {
    const res = await frameCpGet(
      `/api/frame/files/${encodeURIComponent(input.slug)}`,
      input.signal,
    )
    if (!res.ok) {
      return {
        kind: 'error',
        message:
          res.reason === 'no-auth'
            ? 'no-auth'
            : `file list failed (${res.reason})`,
        reason: res.reason === 'no-auth' ? 'no_auth' : 'http',
      }
    }
    if (res.status < 200 || res.status >= 300) {
      return {
        kind: 'error',
        message: `file list failed (HTTP ${res.status})`,
        reason: 'http',
      }
    }
    const data = (res.data ?? {}) as {
      ver?: unknown
      files?: unknown
      cowritten?: unknown
    }
    const files: FileRow[] = []
    if (Array.isArray(data.files)) {
      for (const row of data.files) {
        if (!row || typeof row !== 'object') continue
        const r = row as Record<string, unknown>
        if (typeof r.path !== 'string') continue
        files.push({
          path: r.path,
          contentType: String(
            r.content_type ?? r.contentType ?? 'application/octet-stream',
          ),
          sizeBytes: Number(r.size_bytes ?? r.sizeBytes ?? 0),
          sha256: String(r.sha256 ?? ''),
        })
      }
    }
    return {
      kind: 'ok',
      ver:
        typeof data.ver === 'string' ? data.ver : 'unrecognized-version-shape',
      files,
      ...(data.cowritten === true ? { cowritten: true } : {}),
    }
  } catch {
    return {
      kind: 'error',
      message: 'file list failed (network error)',
      reason: 'request_error',
    }
  }
}

/** densable verify gate mao() — tip default closed (schema freeze). */
export function isArtifactVerifyGateOpen(): boolean {
  return (
    process.env.CLAUDE_CODE_ARTIFACT_VERIFY === '1' ||
    process.env.CLAUDE_CODE_ARTIFACT_VERIFY === 'true'
  )
}

/** densable nRl() delete schema — tip opens with ASe or explicit env. */
export function isArtifactDeleteSchemaOpen(): boolean {
  if (isArtifactToolRegistered()) return true
  return (
    process.env.CLAUDE_CODE_ARTIFACT_DELETE === '1' ||
    process.env.CLAUDE_CODE_ARTIFACT_DELETE === 'true'
  )
}

/** densable delete cGi portable */
export async function deleteArtifactFrame(input: {
  slug: string
  signal?: AbortSignal
}): Promise<
  | { kind: 'ok'; alreadyGone?: boolean }
  | { kind: 'error'; message: string; reason: string }
> {
  if (!isValidArtifactSlug(input.slug)) {
    return { kind: 'error', message: 'invalid slug', reason: 'input' }
  }
  if (!isArtifactDeleteSchemaOpen()) {
    return {
      kind: 'error',
      message: 'action "delete" is not available in this session',
      reason: 'schema_off',
    }
  }
  const headers = authHeaders()
  if (!headers) {
    return { kind: 'error', message: 'no-auth', reason: 'no_auth' }
  }
  const url = `${origin()}/api/frame/${encodeURIComponent(input.slug)}`
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers,
      signal: input.signal,
    })
    if (res.status === 404) {
      return { kind: 'ok', alreadyGone: true }
    }
    if (!res.ok) {
      return {
        kind: 'error',
        message: `artifact delete failed (HTTP ${res.status})`,
        reason: 'http',
      }
    }
    return { kind: 'ok' }
  } catch {
    return {
      kind: 'error',
      message: 'artifact delete failed (network error)',
      reason: 'request_error',
    }
  }
}

/**
 * densable verify diagnostics — GET when mao() open.
 */
export async function fetchArtifactVerifyDiagnostics(input: {
  slug: string
  signal?: AbortSignal
}): Promise<
  | {
      kind: 'ok'
      ver: string
      state: 'no_row' | 'empty' | 'entries'
      entries: unknown[]
      truncated?: boolean
      dropped?: number
    }
  | { kind: 'error'; message: string; reason: string }
> {
  if (!isArtifactVerifyGateOpen()) {
    return {
      kind: 'error',
      message: 'verify is not available in this session.',
      reason: 'verify_unavailable',
    }
  }
  if (!isValidArtifactSlug(input.slug)) {
    return { kind: 'error', message: 'invalid slug', reason: 'input' }
  }
  try {
    const res = await frameCpGet(
      `/api/frame/diagnostics/${encodeURIComponent(input.slug)}`,
      input.signal,
    )
    if (!res.ok) {
      return {
        kind: 'error',
        message:
          res.reason === 'no-auth'
            ? 'no-auth'
            : `verify failed (${res.reason})`,
        reason: res.reason === 'no-auth' ? 'no_auth' : 'http',
      }
    }
    if (res.status === 404) {
      return {
        kind: 'ok',
        ver: 'unrecognized-version-shape',
        state: 'no_row',
        entries: [],
      }
    }
    if (res.status < 200 || res.status >= 300) {
      return {
        kind: 'error',
        message: `verify failed (HTTP ${res.status})`,
        reason: 'http',
      }
    }
    const data = (res.data ?? {}) as {
      ver?: unknown
      entries?: unknown
      truncated?: unknown
      dropped?: unknown
    }
    const entries = Array.isArray(data.entries) ? data.entries : []
    return {
      kind: 'ok',
      ver:
        typeof data.ver === 'string' ? data.ver : 'unrecognized-version-shape',
      state: entries.length === 0 ? 'empty' : 'entries',
      entries,
      ...(data.truncated === true ? { truncated: true } : {}),
      ...(typeof data.dropped === 'number' && data.dropped > 0
        ? { dropped: data.dropped }
        : {}),
    }
  } catch {
    return {
      kind: 'error',
      message: 'verify failed (network error)',
      reason: 'request_error',
    }
  }
}

/**
 * densable jRm / LEe — room event host. SEA often binds LEe=null → unavailable.
 * Tip leaves unbound unless CLAUDE_CODE_ARTIFACT_ROOM_SEND=1 (still no peer bus).
 */
export type RoomSendResult =
  | { ok: true; peers: number }
  | { ok: false; reason: string }

export type ArtifactRoomHost = {
  sendRoomEvent: (slug: string, topic: string, data: unknown) => RoomSendResult
}

let roomHost: ArtifactRoomHost | null = null

/** densable jRm */
export function getArtifactRoomHost(): ArtifactRoomHost | null {
  return roomHost
}

export function setArtifactRoomHost(host: ArtifactRoomHost | null): void {
  roomHost = host
}

export function resetArtifactRoomHostForTests(): void {
  roomHost = null
}

/** densable room_send call body when host present; else unavailable. */
export function sendArtifactRoomEvent(
  slug: string,
  topic: string,
  data: unknown,
): RoomSendResult {
  const host = getArtifactRoomHost()
  if (!host) {
    return { ok: false, reason: 'room_send_unavailable' }
  }
  if (!topic || typeof topic !== 'string') {
    return { ok: false, reason: 'invalid_topic' }
  }
  return host.sendRoomEvent(slug, topic, data)
}

function contentHostBase(
  slug: string,
  env: 'prod' | 'staging' = 'prod',
): string {
  const u =
    env === 'staging'
      ? 'frame.staging.claudeusercontent.com'
      : 'frame.claudeusercontent.com'
  return `https://${slug}.${u}`
}

function errAsset(
  reason: string,
  detail: string,
): { kind: 'error'; message: string; reason: string } {
  return {
    kind: 'error',
    message: `asset read failed: ${detail}`,
    reason,
  }
}

function errFile(
  reason: string,
  detail: string,
): { kind: 'error'; message: string; reason: string } {
  return {
    kind: 'error',
    message: `file read failed: ${detail}`,
    reason,
  }
}

/**
 * densable TCm portable — boot → content-host `/_f/{ver}/_blob/{assetId}`
 * or remote Fdw via frame relay when sEe().
 */
export async function fetchArtifactAssetBytes(input: {
  slug: string
  assetId: string
  env?: 'prod' | 'staging'
  signal?: AbortSignal
}): Promise<
  | {
      kind: 'ok'
      bytes: Buffer
      contentType: string
      ver: string
      relay?: boolean
    }
  | { kind: 'error'; message: string; reason: string }
> {
  if (!isValidArtifactSlug(input.slug)) {
    return errAsset('invalid_slug', 'not a valid artifact id')
  }
  if (!ARTIFACT_ASSET_ID_RE.test(input.assetId)) {
    return errAsset('invalid_id', 'not a valid asset id')
  }
  const {
    isArtifactFrameRelayOpen,
    fetchViaArtifactFrameRelay,
    isClaudeCodeRemoteEnv,
  } = await import('./frameRelay.js')
  if (isClaudeCodeRemoteEnv() && !isArtifactFrameRelayOpen()) {
    return errAsset(
      'relay_unavailable',
      'asset reads run only from a local session or an Anthropic-hosted cloud session with its gateway relay enabled; retrying from here will not help',
    )
  }
  const boot = await fetchFrameBoot(
    input.slug,
    input.signal ?? new AbortController().signal,
  )
  if (boot.err !== null) {
    return {
      kind: 'error',
      message: boot.err.replace(/^artifact read/, 'asset read'),
      reason: boot.status === 404 ? 'boot_404' : 'boot',
    }
  }
  if (boot.assetToken === undefined) {
    return errAsset(
      'tokenless',
      'this artifact is served to you as a public (non-member) reader, and assets are not readable that way',
    )
  }
  const servedPath = `/_f/${encodeURIComponent(boot.ver)}/_blob/${encodeURIComponent(input.assetId.toLowerCase())}`

  const acceptOk = (
    bytes: Buffer,
    contentTypeRaw: string | undefined,
    relay?: boolean,
  ):
    | {
        kind: 'ok'
        bytes: Buffer
        contentType: string
        ver: string
        relay?: boolean
      }
    | { kind: 'error'; message: string; reason: string } => {
    const contentType =
      (contentTypeRaw ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
    if (extensionForContentType(contentType) === undefined) {
      return errAsset(
        'unexpected_type',
        'the content host served a type this tool does not save',
      )
    }
    if (bytes.length === 0 || bytes.length > ARTIFACT_SAVE_MAX_BYTES) {
      return errAsset(
        'size',
        bytes.length === 0
          ? 'the asset is empty'
          : `the asset exceeds the ${ARTIFACT_SAVE_MAX_BYTES >> 20} MiB limit`,
      )
    }
    return {
      kind: 'ok',
      bytes,
      contentType,
      ver: boot.ver,
      ...(relay ? { relay: true } : {}),
    }
  }

  if (isClaudeCodeRemoteEnv() && isArtifactFrameRelayOpen()) {
    const via = await fetchViaArtifactFrameRelay({
      slug: input.slug,
      servedPath,
      assetToken: boot.assetToken,
      signal: input.signal,
      maxBytes: ARTIFACT_SAVE_MAX_BYTES + 1,
      // densable TCm: 404 → http_404, do not Xeo/decline (same latch skip as fileRead).
      fileRead: true,
    })
    if (!via.relayed) {
      return errAsset(
        via.code,
        `asset reads run only from a local session or an Anthropic-hosted cloud session with its gateway relay enabled (${via.why})`,
      )
    }
    if (via.result.ok) {
      return acceptOk(via.result.bytes, via.result.contentType, true)
    }
    const fail = via.result
    if (fail.status === 404) {
      return errAsset(
        'http_404',
        'not found through this cloud session\'s artifact mount — no asset has that id, or asset reads are not enabled for this session yet; a writer of the artifact can tell which with action "list_assets"',
      )
    }
    return errAsset(
      fail.reason,
      `artifact content is unreachable from this session (${fail.reason})`,
    )
  }

  const url = `${contentHostBase(input.slug, input.env)}${servedPath}?__frame_t=${encodeURIComponent(boot.assetToken)}`
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: input.signal,
      redirect: 'manual',
    })
    if (res.status === 404) {
      return errAsset(
        'http_404',
        'no asset with that id in this artifact (it may have been deleted) — a writer of the artifact can check the id with action "list_assets"',
      )
    }
    if (res.status === 401 || res.status === 403) {
      return errAsset(
        `http_${res.status}`,
        'access to the artifact content was refused — the artifact may have been unshared or taken down since the id was listed',
      )
    }
    if (res.status !== 200) {
      return errAsset(
        `http_${res.status}`,
        `unexpected answer from the content host (HTTP ${res.status})`,
      )
    }
    return acceptOk(
      Buffer.from(await res.arrayBuffer()),
      res.headers.get('content-type') ?? undefined,
    )
  } catch {
    return errAsset(
      'request_error',
      `the content fetch failed in transit, timed out, or exceeded the ${ARTIFACT_SAVE_MAX_BYTES >> 20} MiB limit`,
    )
  }
}

/**
 * densable JCm portable — boot → content-host `/_f/{ver}/{published/path}`.
 */
export async function fetchArtifactFileBytes(input: {
  slug: string
  path: string
  env?: 'prod' | 'staging'
  signal?: AbortSignal
}): Promise<
  | {
      kind: 'ok'
      path: string
      ver: string
      bytes: Buffer
      contentType: string
      sha256: string
    }
  | { kind: 'error'; message: string; reason: string }
> {
  if (!isValidArtifactSlug(input.slug)) {
    return errFile('invalid_slug', 'not a valid artifact id')
  }
  const norm = normalizePublishedPath(input.path)
  if ('errMsg' in norm) {
    return errFile('invalid_path', norm.errMsg)
  }
  const {
    isArtifactFrameRelayOpen,
    fetchViaArtifactFrameRelay,
    isClaudeCodeRemoteEnv,
  } = await import('./frameRelay.js')
  if (isClaudeCodeRemoteEnv() && !isArtifactFrameRelayOpen()) {
    return errFile(
      'relay_unavailable',
      'file reads run only from a local session or an Anthropic-hosted cloud session with its gateway relay enabled',
    )
  }
  const boot = await fetchFrameBoot(
    input.slug,
    input.signal ?? new AbortController().signal,
  )
  if (boot.err !== null) {
    return {
      kind: 'error',
      message: boot.err.replace(/^artifact read/, 'file read'),
      reason: boot.status === 404 ? 'boot_404' : 'boot',
    }
  }
  if (boot.assetToken === undefined) {
    return errFile(
      'tokenless',
      'this artifact is served without an asset token; published files are not readable that way',
    )
  }
  const encoded = norm.key.split('/').map(encodeURIComponent).join('/')
  const servedPath = `/_f/${encodeURIComponent(boot.ver)}/${encoded}`

  const finishOk = (
    bytes: Buffer,
    contentTypeRaw: string,
  ):
    | {
        kind: 'ok'
        path: string
        ver: string
        bytes: Buffer
        contentType: string
        sha256: string
      }
    | { kind: 'error'; message: string; reason: string } => {
    const contentType = contentTypeRaw.split(';')[0]?.trim().toLowerCase() ?? ''
    if (!ARTIFACT_SAVE_CONTENT_TYPE_RE.test(contentType)) {
      return errFile(
        'unexpected_type',
        'the content host served the file with a type this tool does not save',
      )
    }
    if (bytes.length >= ARTIFACT_SAVE_MAX_BYTES) {
      return errFile(
        'size',
        `the file exceeds the ${ARTIFACT_SAVE_MAX_BYTES >> 20} MiB limit`,
      )
    }
    return {
      kind: 'ok',
      path: norm.key,
      ver: boot.ver,
      bytes,
      contentType,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  }

  if (isClaudeCodeRemoteEnv() && isArtifactFrameRelayOpen()) {
    const via = await fetchViaArtifactFrameRelay({
      slug: input.slug,
      servedPath,
      assetToken: boot.assetToken,
      signal: input.signal,
      maxBytes: ARTIFACT_SAVE_MAX_BYTES + 1,
      fileRead: true,
    })
    if (!via.relayed) {
      return errFile(via.code, via.why)
    }
    if (via.result.ok) {
      return finishOk(
        via.result.bytes,
        via.result.contentType ?? 'application/octet-stream',
      )
    }
    const fail = via.result
    if (fail.status === 404) {
      return errFile(
        'http_404',
        'no file is published at that path in the served version — or artifact reads through the session gateway are not enabled for this session',
      )
    }
    return errFile(
      fail.reason,
      `file content is unreachable from this session (${fail.reason})`,
    )
  }

  const url = `${contentHostBase(input.slug, input.env)}${servedPath}?__frame_t=${encodeURIComponent(boot.assetToken)}`
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: input.signal,
      redirect: 'manual',
    })
    if (res.status === 404) {
      return errFile(
        'http_404',
        'no file is published at that path in the served version — action "list_files" shows the paths',
      )
    }
    if (res.status !== 200) {
      return errFile(
        `http_${res.status}`,
        `unexpected answer from the content host (HTTP ${res.status})`,
      )
    }
    return finishOk(
      Buffer.from(await res.arrayBuffer()),
      res.headers.get('content-type') ?? 'application/octet-stream',
    )
  } catch {
    return errFile(
      'request_error',
      'the content fetch failed in transit, timed out, or exceeded the size limit',
    )
  }
}
