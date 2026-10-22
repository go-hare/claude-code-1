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
import { Yw } from './readPerm/consent.js'
import { Bht, qjt } from './readPerm/provenance.js'
import { un } from './store.js'

/** densable VQ — tokenless public content without admitPublicRead. */
const PUBLIC_UNASKED = 'public_unasked'
/** densable Jjt — message body for PUBLIC_UNASKED (prefixed by err helpers). */
const PUBLIC_UNASKED_DETAIL =
  'this is a public artifact from outside your organization, and no person has approved reading it here — nothing was fetched'

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
  /** densable O7 — path appears in boot livePaths. */
  live?: boolean
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

function isFileMap(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** densable Pq on the raw 404 bytes — trim equals "not found", ≤256 bytes. */
function isFrameNotFoundBody(bytes: Uint8Array | undefined): boolean {
  if (bytes === undefined || bytes.byteLength > 256) return false
  return Buffer.from(bytes).toString('utf8').trim() === 'not found'
}

function isListableFilePath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) return false
  return !/[\p{Cc}\p{Cf}\p{Co}\p{Zl}\p{Zp}]/u.test(path)
}

async function fetchContentHostJson(input: {
  slug: string
  servedPath: string
  assetToken: string | undefined
  signal?: AbortSignal
  relay: boolean
  fetchVia: typeof import('./frameRelay.js').fetchViaArtifactFrameRelay
}): Promise<
  | {
      ok: true
      status: number
      data: unknown
      reason?: string
      bytes?: Uint8Array
    }
  | { ok: false; reason: string; status?: number }
> {
  if (input.relay && input.assetToken !== undefined) {
    const via = await input.fetchVia({
      slug: input.slug,
      servedPath: input.servedPath,
      assetToken: input.assetToken,
      signal: input.signal,
      maxBytes: 16 * 1024 * 1024 + 1,
      fileRead: true,
    })
    if (!via.relayed) {
      return { ok: false, reason: via.code, status: via.status }
    }
    if (!via.result.ok) {
      return {
        ok: true,
        status: via.result.status ?? 0,
        data: undefined,
        bytes: via.result.bytes,
      }
    }
    try {
      return {
        ok: true,
        status: via.result.status,
        data: JSON.parse(via.result.bytes.toString('utf8')),
      }
    } catch {
      return { ok: true, status: via.result.status, data: undefined }
    }
  }
  const tokenQ =
    input.assetToken !== undefined
      ? `?__frame_t=${encodeURIComponent(input.assetToken)}`
      : ''
  const url = `${contentHostBase(input.slug)}${input.servedPath}${tokenQ}`
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: input.signal,
      redirect: 'manual',
    })
    let data: unknown
    if (response.status >= 200 && response.status < 300) {
      try {
        data = await response.json()
      } catch {
        data = undefined
      }
    }
    return { ok: true, status: response.status, data }
  } catch {
    return { ok: false, reason: 'request_error' }
  }
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
      cowritten?: true
      outsideWriter?: unknown
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
    cowritten?: unknown
    outside_writer?: unknown
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
  qjt(input.slug, data.cowritten)
  Bht(input.slug, data.outside_writer)
  return {
    kind: 'ok',
    assets,
    usage: { files, bytes, maxFiles, maxBytes },
    ...(typeof data.next === 'string' && data.next ? { next: data.next } : {}),
    ...(data.cowritten ? { cowritten: true as const } : {}),
    ...(data.outside_writer !== undefined
      ? { outsideWriter: data.outside_writer }
      : {}),
  }
}

/** densable wCm portable — rxl POST agent-upload (raw bytes, not multipart). */
export async function uploadArtifactAsset(input: {
  slug: string
  filePath: string
  signal?: AbortSignal
  /**
   * densable mlt bytes. When set, the caller already read the pinned file
   * and this function must not open `filePath` again.
   */
  bytes?: Buffer
  /** densable qIt — after local bytes are accepted, before the store answers. */
  onLocalRead?: () => void | Promise<void>
}): Promise<
  | { kind: 'ok'; asset: AssetRow; fileName: string; resent?: boolean }
  | {
      kind: 'error'
      message: string
      reason: string
      code: string
      resent?: boolean
    }
> {
  if (!isValidArtifactSlug(input.slug)) {
    return {
      kind: 'error',
      code: 'invalid_request',
      message: 'not a valid artifact id',
      reason: 'invalid_slug',
    }
  }
  const ext = extname(input.filePath).toLowerCase()
  const contentType = ARTIFACT_ASSET_CONTENT_TYPES.get(ext)
  if (!ASSET_EXTS.has(ext) || contentType === undefined) {
    return {
      kind: 'error',
      code: 'unsupported_type',
      message: `unsupported asset type "${ext}"`,
      reason: 'unsupported_type',
    }
  }
  let bytes: Buffer
  if (input.bytes !== undefined) {
    bytes = input.bytes
  } else {
    try {
      bytes = Buffer.from(await readFile(input.filePath))
    } catch {
      return {
        kind: 'error',
        code: 'store_unavailable',
        message: `cannot read file_path: ${input.filePath}`,
        reason: 'read_error',
      }
    }
  }
  const limit = assetUploadByteLimit(contentType)
  if (bytes.length === 0 || bytes.length > limit) {
    return {
      kind: 'error',
      code: bytes.length === 0 ? 'invalid_request' : 'too_large',
      message:
        bytes.length === 0
          ? 'the file is empty'
          : contentType === ASSET_SVG_CONTENT_TYPE
            ? `the SVG exceeds the ${limit >> 20} MiB limit for SVG assets — simplify or rasterize it`
            : `the file exceeds the ${limit >> 20} MiB per-asset limit — compress or split it`,
      reason: 'size',
    }
  }
  if (input.onLocalRead) await input.onLocalRead()
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
  const resent = marks.retried === true
  if (!rxl.replied) {
    return {
      kind: 'error',
      code: rxl.failure.code,
      message: rxl.failure.message,
      reason: rxl.failure.reason,
      ...(resent ? { resent: true } : {}),
    }
  }
  if (rxl.status !== 200) {
    const fail = mapAssetHttpToFail(rxl, 'upload')
    return {
      kind: 'error',
      code: fail.code,
      message: fail.message,
      reason: fail.reason,
      ...(resent ? { resent: true } : {}),
    }
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
      code: 'upstream_error',
      message:
        'the upload probably succeeded but the reply was unreadable — retry at most once; if it repeats, stop and report it',
      reason: 'malformed_echo',
      ...(resent ? { resent: true } : {}),
    }
  }
  // densable hMw: sha256 optional but must match yHe when present
  if (
    data.sha256 !== undefined &&
    (typeof data.sha256 !== 'string' || !ASSET_SHA256_RE.test(data.sha256))
  ) {
    return {
      kind: 'error',
      code: 'upstream_error',
      message:
        'the upload probably succeeded but the reply was unreadable — retry at most once; if it repeats, stop and report it',
      reason: 'malformed_echo',
      ...(resent ? { resent: true } : {}),
    }
  }
  un().assetsOnRoster = true
  return {
    kind: 'ok',
    ...(resent ? { resent: true } : {}),
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

/** densable O7 single_page (member / non-public). */
const SINGLE_PAGE_MESSAGE =
  'this artifact is a single page with no separately published files, so there is no file list; read the page itself'
/** densable O7 single_page (publicRead + te). */
const PUBLIC_SINGLE_PAGE_MESSAGE =
  'this public artifact is a single page with no separately published files, so there is no file list; read the page itself'
/** densable O7 public_refused. */
const PUBLIC_REFUSED_MESSAGE =
  "this public artifact's files are not available to readers outside its organization right now — it may no longer be public, or it was taken down"

/** densable M relay_unavailable (Y). */
const LIST_RELAY_UNAVAILABLE_MESSAGE =
  'published-file reads run only from a local session or an Anthropic-hosted cloud session with its gateway relay enabled; retrying from here will not help'
/** densable M relay_not_served (ee). */
const LIST_RELAY_NOT_SERVED_MESSAGE =
  "published-file reads aren't available from this kind of session; retrying from here will not help"

/** densable Oce — writerClass is boolean owner||writer. */
function isOwnerOrWriterRole(role: unknown): boolean {
  return role === 'owner' || role === 'writer'
}

/** densable iIr — member source tree `/_src/` before the published path. */
function memberSourceRead(boot: {
  assetToken: string | undefined
  data: Record<string, unknown>
}): boolean {
  if (boot.assetToken === undefined) return false
  const perm =
    boot.data.perm !== null && typeof boot.data.perm === 'object'
      ? (boot.data.perm as Record<string, unknown>)
      : undefined
  return boot.data.mode !== 'external' || perm?.role === 'writer'
}

type ShareForTreatAsData = {
  typeLocked?: boolean
  typeLock?: unknown
  authoredByOthers?: boolean
  outsideWriter?: boolean
}

/** Gold DualInk mapToolResult flags: `foreign` / `outside_writer` / `public_read`. */
export type ArtifactTreatAsDataStamp = {
  foreign?: true
  outside_writer?: true
  public_read?: true
}

function shareForTreatAsData(slug: string): ShareForTreatAsData | undefined {
  try {
    // Lazy yt — avoid cycle at module load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { yt } =
      require('./readPerm/provenance.js') as typeof import('./readPerm/provenance.js')
    return yt(slug)
  } catch {
    return undefined
  }
}

function treatAsDataStampFromBoot(
  bootData: Record<string, unknown>,
  share: ShareForTreatAsData | undefined,
  tokenless: boolean,
): ArtifactTreatAsDataStamp {
  const perm =
    bootData.perm !== null && typeof bootData.perm === 'object'
      ? (bootData.perm as Record<string, unknown>)
      : undefined
  const role = perm?.role
  const cowritten =
    bootData.cowritten === true || bootData.artifactKind === 'live-doc'
  const typeLocked = isTypeLockedFromBoot(bootData, share)
  // densable Obe: true/false stay boolean; anything else is undefined.
  const bootOutside =
    bootData.outsideWriter === true
      ? true
      : bootData.outsideWriter === false
        ? false
        : undefined
  // densable LPe(role==="owner", Obe(outsideWriter), yt?.outsideWriter)
  const outsideOrgFlag =
    bootOutside === true ||
    share?.outsideWriter === true ||
    (role === 'owner' && bootOutside === undefined)
  const authoredByOthers =
    bootData.authoredByOthers === true || share?.authoredByOthers === true
  // densable Tgr: a missing or unknown role is "couldn't confirm", not
  // someone else's writing. `role !== 'owner'` is true for undefined.
  const roleIsOther =
    typeof role === 'string' && role !== 'owner' && role !== 'unknown'
  const foreign =
    authoredByOthers || roleIsOther || cowritten || typeLocked || outsideOrgFlag
  return {
    ...(foreign ? { foreign: true as const } : {}),
    ...(outsideOrgFlag ? { outside_writer: true as const } : {}),
    ...(tokenless ? { public_read: true as const } : {}),
  }
}

/**
 * densable Ppe — typeLocked from boot.type object or shareStatus.
 * Semantic helper only (invent-ban `export function Ppe`).
 */
function isTypeLockedFromBoot(
  data: Record<string, unknown>,
  share?: { typeLocked?: boolean; typeLock?: unknown } | undefined,
): boolean {
  const t = data.type
  return (
    (t !== null && typeof t === 'object') ||
    share?.typeLocked === true ||
    share?.typeLock != null
  )
}

/** densable aIr — orgRelation from boot. */
function orgRelationFromBoot(boot: {
  data: Record<string, unknown>
  assetToken: string | undefined
}): 'external' | 'public' | 'unproven' | 'own' | 'same' {
  const mode = boot.data.mode
  const perm =
    boot.data.perm !== null && typeof boot.data.perm === 'object'
      ? (boot.data.perm as Record<string, unknown>)
      : undefined
  if (mode === 'external') return 'external'
  if (boot.assetToken === undefined) return 'public'
  if (mode !== undefined) return 'unproven'
  if (perm?.role === 'owner') return 'own'
  return typeof perm?.mode === 'string' && perm.mode !== ''
    ? 'same'
    : 'unproven'
}

function livePathsFromBootData(data: Record<string, unknown>): string[] {
  const raw = data.livePaths
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const row of raw) {
    if (typeof row === 'string' && row.length > 0) out.push(row)
    else if (row && typeof row === 'object') {
      const path = Reflect.get(row, 'path')
      if (typeof path === 'string' && path.length > 0) out.push(path)
    }
  }
  return out
}

function filesCountedFromBootData(data: Record<string, unknown>): boolean {
  const n = data.fileCount
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0
}

/**
 * densable te — HEAD content-host `/_f/{ver}/`; 200 means the page itself is
 * still served (public single-page), otherwise list 403 is public_refused.
 * Semantic helper only (invent-ban `export function te`).
 */
async function probeArtifactPageHead(input: {
  slug: string
  ver: string
  signal?: AbortSignal
}): Promise<boolean> {
  const url = `${contentHostBase(input.slug)}/_f/${encodeURIComponent(input.ver)}/`
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: input.signal,
      redirect: 'manual',
    })
    return res.status === 200
  } catch (e) {
    if (
      input.signal?.aborted ||
      (e instanceof DOMException && e.name === 'AbortError')
    ) {
      throw e instanceof DOMException
        ? e
        : new DOMException('Aborted', 'AbortError')
    }
    return false
  }
}

/**
 * densable O7 / XCm — boot then list published files on a frame.
 * Semantic export only (invent-ban `export function O7`).
 */
export async function listArtifactFiles(input: {
  slug: string
  signal?: AbortSignal
  /**
   * densable admitPublicRead — mKe(…, "files"); gates tokenless public after Yw.
   */
  admitPublicRead?: () => boolean
  /** densable probeToolUseId — reuse shareStatus.probeBoots via fetchFrameBoot. */
  probeToolUseId?: string
}): Promise<
  | {
      kind: 'ok'
      ver: string
      files: FileRow[]
      cowritten?: boolean
      publicRead?: boolean
      narrowed?: boolean
      relay?: boolean
      agentDirect?: boolean
      typeLocked?: boolean
      writerClass?: boolean
      foreign?: boolean
      outsideOrg?: boolean
      outside_writer?: boolean
      public_read?: boolean
      orgRelation?: 'external' | 'public' | 'unproven' | 'own' | 'same'
      title?: string
      favicon?: unknown
      publishPreconditions?: boolean
      reused?: boolean
    }
  | {
      kind: 'error'
      message: string
      reason: string
      ver?: string
      cowritten?: boolean
      typeLocked?: boolean
    }
> {
  if (!isValidArtifactSlug(input.slug)) {
    return { kind: 'error', message: 'invalid slug', reason: 'input' }
  }
  try {
    const {
      isArtifactFrameRelayOpen,
      isClaudeCodeRemoteEnv,
      isAnthropicHostedRemoteSession,
    } = await import('./frameRelay.js')
    // densable M: remote without gateway relay → relay_unavailable.
    if (isClaudeCodeRemoteEnv() && !isArtifactFrameRelayOpen()) {
      return {
        kind: 'error',
        reason: 'relay_unavailable',
        message: LIST_RELAY_UNAVAILABLE_MESSAGE,
      }
    }
    // densable M relay_not_served / tx(XWn): KEEP omit — tip has no bound-host
    // probe; remote-without-relay is covered by relay_unavailable above.
    void LIST_RELAY_NOT_SERVED_MESSAGE
    const agentDirect = isAnthropicHostedRemoteSession()
    const remoteRelay = isClaudeCodeRemoteEnv() && isArtifactFrameRelayOpen()
    // densable M: aT(..., { gatePublicRead:!1, probeToolUseId }) then admit after Yw.
    const boot = await fetchFrameBoot(
      input.slug,
      input.signal ?? new AbortController().signal,
      {
        // densable M/O7: gatePublicRead:!1 — admitPublicRead stays after Yw.
        gatePublicRead: false,
        kind: 'read',
        // densable relayOnly:!o — only when remote+relay open (not local).
        ...(remoteRelay ? { relayOnly: true } : {}),
        ...(input.probeToolUseId !== undefined
          ? { probeToolUseId: input.probeToolUseId }
          : {}),
      },
    )
    if (boot.err !== null) {
      if (boot.errorCode === 'boot_relay_error') {
        if (boot.status === 403 || boot.status === 404) {
          return {
            kind: 'error',
            reason: 'relay_refused',
            message:
              "file list failed: published-file reads from a cloud session go through the session gateway's artifact relay, which is not enabled for this session yet; retrying from here will not help",
          }
        }
        if (boot.status === 401) {
          return {
            kind: 'error',
            reason: 'relay_unauthorized',
            message:
              "file list failed: the session gateway did not accept this session's credential for the artifact relay; retrying from here will not help",
          }
        }
      }
      return {
        kind: 'error',
        message: boot.err.replace(/^artifact read/, 'file list'),
        reason:
          boot.errorCode === 'public_read_disabled'
            ? 'public_read_disabled'
            : boot.status === 404
              ? 'boot_404'
              : 'boot',
      }
    }
    const tokenless = boot.assetToken === undefined
    // densable publicRead = tokenless after M/aT prelude.
    const publicRead = tokenless
    // densable M prelude: tokenless + !Yw → refuse; then admitPublicRead gate.
    if (tokenless && !Yw()) {
      return {
        kind: 'error',
        reason: 'tokenless',
        message:
          'this artifact is served to you as a public (non-member) reader, and its files are not readable that way',
        ver: boot.ver,
      }
    }
    if (tokenless && input.admitPublicRead?.() !== true) {
      return {
        kind: 'error',
        reason: PUBLIC_UNASKED,
        message: `file list failed: ${PUBLIC_UNASKED_DETAIL}`,
        ver: boot.ver,
      }
    }
    const filesCounted = filesCountedFromBootData(boot.data)
    const livePaths = livePathsFromBootData(boot.data)
    const cowritten =
      boot.data.cowritten === true || boot.data.artifactKind === 'live-doc'
    const perm =
      boot.data.perm !== null && typeof boot.data.perm === 'object'
        ? (boot.data.perm as Record<string, unknown>)
        : undefined
    const role = perm?.role
    const share = shareForTreatAsData(input.slug)
    const typeLocked = isTypeLockedFromBoot(boot.data, share)
    // densable LPe(role==="owner", Obe(outsideWriter), yt?.outsideWriter)
    const stamp = treatAsDataStampFromBoot(boot.data, share, tokenless)
    const outsideOrgFlag = stamp.outside_writer === true
    const writerClass = isOwnerOrWriterRole(role)
    const foreign = stamp.foreign === true
    const orgRelation = orgRelationFromBoot(boot)
    // densable relay: F && !tokenless
    const relay = isArtifactFrameRelayOpen() && !tokenless

    const { fetchViaArtifactFrameRelay } = await import('./frameRelay.js')
    const servedPath = `/_f/${encodeURIComponent(boot.ver)}/_files.json`
    const res = await fetchContentHostJson({
      slug: input.slug,
      servedPath,
      assetToken: boot.assetToken,
      signal: input.signal,
      relay: relay && boot.assetToken !== undefined,
      fetchVia: fetchViaArtifactFrameRelay,
    })
    if (!res.ok) {
      return {
        kind: 'error',
        message:
          res.reason === 'no-auth'
            ? 'no-auth'
            : `file list failed (${res.reason})`,
        reason: res.reason === 'no-auth' ? 'no_auth' : 'http',
        ver: boot.ver,
        ...(cowritten ? { cowritten: true } : {}),
      }
    }
    if (res.status < 200 || res.status >= 300) {
      // densable O7: 404 + !filesCounted && (!relay || frameNotFound) → single_page
      if (
        res.status === 404 &&
        !filesCounted &&
        (!relay || isFrameNotFoundBody(res.bytes))
      ) {
        return {
          kind: 'error',
          reason: 'single_page',
          message: SINGLE_PAGE_MESSAGE,
          ver: boot.ver,
          ...(cowritten ? { cowritten: true } : {}),
          ...(typeLocked ? { typeLocked: true } : {}),
        }
      }
      // densable: publicRead + 403 → te()? single_page : public_refused.
      if (publicRead && res.status === 403) {
        if (
          await probeArtifactPageHead({
            slug: input.slug,
            ver: boot.ver,
            signal: input.signal,
          })
        ) {
          return {
            kind: 'error',
            reason: 'single_page',
            message: PUBLIC_SINGLE_PAGE_MESSAGE,
            ver: boot.ver,
            ...(cowritten ? { cowritten: true } : {}),
            ...(typeLocked ? { typeLocked: true } : {}),
          }
        }
        return {
          kind: 'error',
          reason: 'public_refused',
          message: PUBLIC_REFUSED_MESSAGE,
          ver: boot.ver,
          ...(cowritten ? { cowritten: true } : {}),
        }
      }
      return {
        kind: 'error',
        reason: `http_${res.status}`,
        message:
          res.status === 404
            ? 'the artifact has published files, but the artifact service does not offer their list yet; retrying from here will not help'
            : `file list failed (HTTP ${res.status})`,
        ver: boot.ver,
        ...(cowritten ? { cowritten: true } : {}),
      }
    }
    const data = (res.data ?? {}) as {
      ver?: unknown
      files?: unknown
      cowritten?: unknown
      narrowed?: unknown
    }
    if (data.ver !== boot.ver || !isFileMap(data.files)) {
      return {
        kind: 'error',
        reason: 'bad_shape',
        message:
          'the artifact service answered with a file list this version of the tool cannot read',
        ver: boot.ver,
        ...(cowritten ? { cowritten: true } : {}),
      }
    }
    const entries = Object.entries(data.files)
    if (entries.length > 4096) {
      return {
        kind: 'error',
        reason: 'too_many',
        message: 'the file list names more than 4096 files',
        ver: boot.ver,
        ...(cowritten ? { cowritten: true } : {}),
      }
    }
    const files: FileRow[] = []
    for (const [path, meta] of entries) {
      if (!isListableFilePath(path) || !meta || typeof meta !== 'object') {
        continue
      }
      const r = meta as Record<string, unknown>
      const contentType = String(r.contentType ?? '')
      const sha256 = String(r.sha256 ?? '')
      if (
        !ARTIFACT_SAVE_CONTENT_TYPE_RE.test(contentType) ||
        !ASSET_SHA256_RE.test(sha256)
      ) {
        continue
      }
      const live = livePaths.includes(path)
      files.push({
        path,
        contentType,
        sizeBytes: Number(r.size ?? 0),
        sha256,
        ...(live ? { live: true } : {}),
      })
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    const listCowritten = data.cowritten === true || cowritten
    return {
      kind: 'ok',
      ver:
        typeof data.ver === 'string'
          ? data.ver
          : boot.ver || 'unrecognized-version-shape',
      files,
      ...(listCowritten ? { cowritten: true } : {}),
      ...(publicRead ? { publicRead: true } : {}),
      ...(publicRead && data.narrowed === true ? { narrowed: true } : {}),
      ...(relay ? { relay: true } : {}),
      ...(agentDirect ? { agentDirect: true } : {}),
      ...(typeLocked ? { typeLocked: true } : {}),
      ...(writerClass ? { writerClass: true } : {}),
      ...(foreign ? { foreign: true } : {}),
      ...(outsideOrgFlag ? { outsideOrg: true } : {}),
      ...(stamp.outside_writer ? { outside_writer: true } : {}),
      ...(stamp.public_read ? { public_read: true } : {}),
      orgRelation,
      ...(typeof boot.data.title === 'string'
        ? { title: boot.data.title }
        : {}),
      ...(boot.data.favicon !== undefined
        ? { favicon: boot.data.favicon }
        : {}),
      ...(boot.data.publishPreconditions === true
        ? { publishPreconditions: true }
        : {}),
      ...(boot.reused === true ? { reused: true } : {}),
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
    const boot = await fetchFrameBoot(
      input.slug,
      input.signal ?? new AbortController().signal,
      { gatePublicRead: false, kind: 'read' },
    )
    if (boot.err !== null || !boot.ver) {
      return {
        kind: 'error',
        message: boot.err ?? 'verify failed (boot)',
        reason: 'boot',
      }
    }
    const res = await frameCpGet(
      `/api/frame/diag/${encodeURIComponent(input.slug)}/${encodeURIComponent(boot.ver)}`,
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

/** densable pe — content-type before `;`, trimmed, lowercased. */
function contentHostMediaType(headers: Headers): string {
  const raw = headers.get('content-type')
  if (raw === null) return ''
  const semi = raw.indexOf(';')
  return (semi === -1 ? raw : raw.slice(0, semi)).trim().toLowerCase()
}

/**
 * densable Ibe — content-host plain-text forbidden without proxy/deny headers.
 * Semantic helper only (invent-ban `export function Ibe`).
 */
function isPublicAssetForbiddenPlain(headers: Headers, body: string): boolean {
  const deny = headers.get('x-deny-reason')
  return (
    contentHostMediaType(headers) === 'text/plain' &&
    body.trim() === 'forbidden' &&
    headers.get('x-proxy-error') === null &&
    !(deny !== null && deny.length <= 64 && /^[a-z0-9_]+$/.test(deny))
  )
}

/** densable wko public_refused copy for tokenless asset 403 + Ibe. */
const ASSET_PUBLIC_REFUSED_MESSAGE =
  'this public artifact serves no asset with that id to readers outside its organization, or it is no longer public'

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
 * densable TCm / wko portable — boot → content-host `/_f/{ver}/_blob/{assetId}`
 * or remote Fdw via frame relay when sEe(). Gold `admitPublicRead` (mKe kind
 * assets/files) gates tokenless public content after Yw.
 */
export async function fetchArtifactAssetBytes(input: {
  slug: string
  assetId: string
  env?: 'prod' | 'staging'
  signal?: AbortSignal
  /** densable admitPublicRead — mKe(…, "assets"|"files"); omit → refuse public. */
  admitPublicRead?: () => boolean
  /** densable probeToolUseId — reuse shareStatus.probeBoots for this tool use. */
  probeToolUseId?: string
}): Promise<
  | {
      kind: 'ok'
      bytes: Buffer
      contentType: string
      ver: string
      relay?: boolean
      publicRead?: boolean
      foreign?: boolean
      outside_writer?: boolean
      public_read?: boolean
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
    {
      // densable wko: gatePublicRead:!1 — admitPublicRead stays after Yw.
      gatePublicRead: false,
      kind: 'read',
      ...(input.probeToolUseId !== undefined
        ? { probeToolUseId: input.probeToolUseId }
        : {}),
    },
  )
  if (boot.err !== null) {
    return {
      kind: 'error',
      message: boot.err.replace(/^artifact read/, 'asset read'),
      reason:
        boot.errorCode === 'public_read_disabled'
          ? 'public_read_disabled'
          : boot.status === 404
            ? 'boot_404'
            : 'boot',
    }
  }
  const tokenless = boot.assetToken === undefined
  const stamp = treatAsDataStampFromBoot(
    boot.data,
    shareForTreatAsData(input.slug),
    tokenless,
  )
  // densable: if(h&&!Yw()) tokenless; if(h&&admit?.()!==!0) public_unasked
  if (tokenless && !Yw()) {
    return errAsset(
      'tokenless',
      'this artifact is served to you as a public (non-member) reader, and assets are not readable that way',
    )
  }
  if (tokenless && input.admitPublicRead?.() !== true) {
    return errAsset(PUBLIC_UNASKED, PUBLIC_UNASKED_DETAIL)
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
        publicRead?: boolean
        foreign?: boolean
        outside_writer?: boolean
        public_read?: boolean
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
      ...(tokenless ? { publicRead: true } : {}),
      ...stamp,
    }
  }

  // densable: relay only when member-token path (g = remote && !tokenless)
  if (!tokenless && isClaudeCodeRemoteEnv() && isArtifactFrameRelayOpen()) {
    const via = await fetchViaArtifactFrameRelay({
      slug: input.slug,
      servedPath,
      assetToken: boot.assetToken!,
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

  const tokenQ =
    boot.assetToken !== undefined
      ? `?__frame_t=${encodeURIComponent(boot.assetToken)}`
      : ''
  const url = `${contentHostBase(input.slug, input.env)}${servedPath}${tokenQ}`
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
    if (res.status === 403 && tokenless) {
      // densable wko: Ibe(headers, jQ(...)) → public_refused (not bare http_403).
      let body = ''
      try {
        body = await res.text()
      } catch {
        body = ''
      }
      if (isPublicAssetForbiddenPlain(res.headers, body)) {
        return errAsset('public_refused', ASSET_PUBLIC_REFUSED_MESSAGE)
      }
      return errAsset('http_403', ASSET_PUBLIC_REFUSED_MESSAGE)
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
 * densable JCm / q0t portable — boot → content-host `/_f/{ver}/{published/path}`.
 * Gold `admitPublicRead` (mKe kind files) gates tokenless public content after Yw.
 */
export async function fetchArtifactFileBytes(input: {
  slug: string
  path: string
  env?: 'prod' | 'staging'
  signal?: AbortSignal
  /** densable admitPublicRead — mKe(…, "files"); omit → refuse public. */
  admitPublicRead?: () => boolean
  /** densable probeToolUseId — reuse shareStatus.probeBoots for this tool use. */
  probeToolUseId?: string
}): Promise<
  | {
      kind: 'ok'
      path: string
      ver: string
      bytes: Buffer
      contentType: string
      sha256: string
      publicRead?: boolean
      foreign?: boolean
      outside_writer?: boolean
      public_read?: boolean
      writerClass?: true
      source?: true
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
    {
      // densable file read: gatePublicRead:!1 — admitPublicRead stays after Yw.
      gatePublicRead: false,
      kind: 'read',
      ...(input.probeToolUseId !== undefined
        ? { probeToolUseId: input.probeToolUseId }
        : {}),
    },
  )
  if (boot.err !== null) {
    return {
      kind: 'error',
      message: boot.err.replace(/^artifact read/, 'file read'),
      reason:
        boot.errorCode === 'public_read_disabled'
          ? 'public_read_disabled'
          : boot.status === 404
            ? 'boot_404'
            : 'boot',
    }
  }
  const tokenless = boot.assetToken === undefined
  const stamp = treatAsDataStampFromBoot(
    boot.data,
    shareForTreatAsData(input.slug),
    tokenless,
  )
  // densable: if(b&&!Yw()) tokenless; if(b&&admit?.()!==!0) public_unasked
  if (tokenless && !Yw()) {
    return errFile(
      'tokenless',
      'this artifact is served to you as a public (non-member) reader, and its files are not readable that way',
    )
  }
  if (tokenless && input.admitPublicRead?.() !== true) {
    return errFile(PUBLIC_UNASKED, PUBLIC_UNASKED_DETAIL)
  }
  const encoded = norm.key.split('/').map(encodeURIComponent).join('/')
  const publishedPath = `/_f/${encodeURIComponent(boot.ver)}/${encoded}`
  const readPaths = memberSourceRead(boot)
    ? [
        `/_f/${encodeURIComponent(boot.ver)}/_src/${encoded === '' ? 'index.html' : encoded}`,
        publishedPath,
      ]
    : [publishedPath]

  const perm =
    boot.data.perm !== null && typeof boot.data.perm === 'object'
      ? (boot.data.perm as Record<string, unknown>)
      : undefined
  const writerClass = isOwnerOrWriterRole(perm?.role)
  const finishOk = (
    bytes: Buffer,
    contentTypeRaw: string,
    source = false,
  ):
    | {
        kind: 'ok'
        path: string
        ver: string
        bytes: Buffer
        contentType: string
        sha256: string
        publicRead?: boolean
        foreign?: boolean
        outside_writer?: boolean
        public_read?: boolean
        writerClass?: true
        source?: true
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
      ...(tokenless ? { publicRead: true } : {}),
      ...(writerClass ? { writerClass: true as const } : {}),
      ...(source ? { source: true as const } : {}),
      ...stamp,
    }
  }

  for (const [pathIndex, readPath] of readPaths.entries()) {
    const lastPath = pathIndex === readPaths.length - 1
    if (!tokenless && isClaudeCodeRemoteEnv() && isArtifactFrameRelayOpen()) {
      const via = await fetchViaArtifactFrameRelay({
        slug: input.slug,
        servedPath: readPath,
        assetToken: boot.assetToken!,
        signal: input.signal,
        maxBytes: ARTIFACT_SAVE_MAX_BYTES + 1,
        fileRead: true,
      })
      if (!via.relayed) {
        if (!lastPath) continue
        return errFile(via.code, via.why)
      }
      if (via.result.ok) {
        return finishOk(
          via.result.bytes,
          via.result.contentType ?? 'application/octet-stream',
          pathIndex === 0 && memberSourceRead(boot),
        )
      }
      const fail = via.result
      if (!lastPath) continue
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

    const tokenQ =
      boot.assetToken !== undefined
        ? `?__frame_t=${encodeURIComponent(boot.assetToken)}`
        : ''
    const url = `${contentHostBase(input.slug, input.env)}${readPath}${tokenQ}`
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: input.signal,
        redirect: 'manual',
      })
      if (res.status !== 200) {
        if (!lastPath) continue
        if (res.status === 404) {
          return errFile(
            'http_404',
            'no file is published at that path in the served version — action "list_files" shows the paths',
          )
        }
        return errFile(
          `http_${res.status}`,
          tokenless
            ? "this public artifact's files are not available to readers outside its organization right now — it may no longer be public, or it was taken down"
            : `unexpected answer from the content host (HTTP ${res.status})`,
        )
      }
      return finishOk(
        Buffer.from(await res.arrayBuffer()),
        res.headers.get('content-type') ?? 'application/octet-stream',
        pathIndex === 0 && memberSourceRead(boot),
      )
    } catch {
      if (!lastPath) continue
      return errFile(
        'request_error',
        'the content fetch failed in transit, timed out, or exceeded the size limit',
      )
    }
  }
  return errFile(
    'http_404',
    'no file is published at that path in the served version — action "list_files" shows the paths',
  )
}
