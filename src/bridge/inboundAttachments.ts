/**
 * Resolve file_uuid attachments on inbound bridge user messages.
 *
 * densable 2.1.225: photos (is_image && no sha256) are inlined as image content
 * blocks for the model; everything else still lands as @path refs after download
 * to ~/.claude/uploads/{sessionId}/. Peer SendFile (sha256 present) stays path-
 * only and reports integrity failures instead of silent drop.
 */

import type {
  Base64ImageSource,
  ContentBlockParam,
  ImageBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import axios from 'axios'
import { createHash, randomUUID } from 'crypto'
import { mkdir, realpath, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { z } from 'zod/v4'
import { getSessionId } from '../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { registerChromeUploadAttachmentDigest } from '../utils/claudeInChrome/fileUpload.js'
import { CROSS_SESSION_MESSAGE_TAG } from '../constants/xml.js'
import { logForDebugging } from '../utils/debug.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import {
  type ImageLimits,
  maybeResizeAndDownsampleImageBuffer,
} from '../utils/imageResizer.js'
import { lazySchema } from '../utils/lazySchema.js'
import { getBridgeAccessToken, getBridgeBaseUrl } from './bridgeConfig.js'

/** densable qpe — 30 MiB transfer cap. */
export const INBOUND_ATTACHMENT_MAX_BYTES = 31_457_280
/** densable Uee — max attachments materialized per message. */
export const INBOUND_ATTACHMENT_MAX_COUNT = 16

const DOWNLOAD_TIMEOUT_MS = 30_000

/** densable e8 — image inline resize limits. */
const INLINE_IMAGE_LIMITS: ImageLimits = {
  maxWidth: 2000,
  maxHeight: 2000,
  maxBase64Size: 5_242_880,
  targetRawSize: 3_932_160,
}

/**
 * densable RYd — open tag for DEe (`cross-session-message`), not command-name.
 * SEA: `RYd=new RegExp(\`^<${DEe}(?:[ \\t][^>\\r\\n\\v\\f\\u0085\\u2028\\u2029]*)?>\`)`
 */
const CROSS_SESSION_MESSAGE_OPEN_RE = new RegExp(
  `^<${CROSS_SESSION_MESSAGE_TAG}(?:[ \\t][^>\\r\\n\\v\\f\\u0085\\u2028\\u2029]*)?>`,
)

/**
 * densable `_je` prefixes before the cross-session-message tag (each ends with `\n`).
 * SEA: `[`${RQs}\n`,`${kQs}\n`,`${yZy}\n`]` where
 *   RQs = "Another Claude session sent a message while you were working:"
 *   kQs = "Another Claude session sent a message:"
 *   yZy = "A peer session sent a message while you were working:"
 */
const CROSS_SESSION_INLINE_DISABLE_PREFIXES = [
  'Another Claude session sent a message while you were working:\n',
  'Another Claude session sent a message:\n',
  'A peer session sent a message while you were working:\n',
] as const

function debug(msg: string): void {
  logForDebugging(`[bridge:inbound-attach] ${msg}`)
}

function featureOk(name: string): void {
  logEvent('tengu_feature_ok', {
    feature_name:
      name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

function featureSad(name: string, errorCode: string): void {
  logEvent('tengu_feature_sad', {
    feature_name:
      name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_code:
      errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

function featureBad(name: string, errorCode: string): void {
  logEvent('tengu_feature_bad', {
    feature_name:
      name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_code:
      errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

const attachmentSchema = lazySchema(() =>
  z.object({
    file_uuid: z.string(),
    file_name: z.string(),
    is_image: z.boolean().nullish(),
    // densable: sha256 nullish().catch(null) — bad values become null (no integrity).
    sha256: z.string().nullish().catch(null),
    file_size: z.number().nullish().catch(undefined),
  }),
)
const attachmentsArraySchema = lazySchema(() => z.array(attachmentSchema()))

export type InboundAttachment = z.infer<ReturnType<typeof attachmentSchema>>

type ResolveFailure = 'download' | 'digest_mismatch' | 'write'

type ResolveOneResult =
  | { imageBlock: ImageBlockParam }
  | { path: string; inlineFellBack?: boolean }
  | { failure: ResolveFailure }

const FAILURE_REASONS: Record<ResolveFailure, string> = {
  download: 'it could not be downloaded',
  digest_mismatch: 'it failed integrity verification',
  write: 'it could not be written to the uploads directory',
}

/** densable DDt — pull file_attachments off a loosely-typed inbound message. */
export function extractInboundAttachments(msg: unknown): InboundAttachment[] {
  if (typeof msg !== 'object' || msg === null || !('file_attachments' in msg)) {
    return []
  }
  const raw = (msg as { file_attachments: unknown }).file_attachments
  if (!Array.isArray(raw)) return []
  // densable flatMaps per-item safeParse so one bad entry doesn't drop the rest.
  const schema = attachmentSchema()
  return raw.flatMap(item => {
    const parsed = schema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

/**
 * densable DDr — strip path components and keep only filename-safe chars.
 * file_name comes from the network (web composer), so treat it as untrusted.
 */
function sanitizeFileName(name: string): string {
  const base = basename(name).replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment'
  const lastDot = base.lastIndexOf('.')
  const ext =
    lastDot > 0 && base.length - lastDot <= 16 ? base.slice(lastDot) : ''
  const stem = ext ? base.slice(0, lastDot) : base
  const maxStem = 200 - ext.length
  return (stem.length > maxStem ? stem.slice(0, maxStem) : stem) + ext
}

function uploadsDir(): string {
  return join(getClaudeConfigHomeDir(), 'uploads', getSessionId())
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** densable Woi — size + sha256 integrity check. */
function verifyIntegrity(
  buf: Buffer,
  att: Pick<InboundAttachment, 'sha256' | 'file_size'>,
): boolean {
  if (typeof att.file_size === 'number' && buf.length !== att.file_size) {
    return false
  }
  return sha256Hex(buf) === att.sha256
}

/** densable RIn. */
function undeliveredNotice(fileName: string, reason: string): string {
  return `[SendFile: "${sanitizeFileName(fileName)}" was not delivered — ${reason}]`
}

/** densable kIn. */
function droppedNotice(count: number): string {
  return `[SendFile: ${count} additional attachment(s) were dropped — max ${INBOUND_ATTACHMENT_MAX_COUNT} per message]`
}

/**
 * densable Voi — insert path-ref prefix after a leading cross-session wrapper
 * when present; otherwise plain prepend.
 */
function insertPrefixAfterCrossSessionWrapper(
  text: string,
  prefix: string,
): string {
  if (!prefix) return text
  const re = new RegExp(`^<${CROSS_SESSION_MESSAGE_TAG}\\b[^>]*>\\n?`)
  const m = re.exec(text)
  return m ? m[0] + prefix + text.slice(m[0].length) : prefix + text
}

/**
 * densable `qvt` — true when content is a peer/cross-session wrap that starts
 * with `<cross-session-message…>` (optionally after densable `_je` prefixes).
 *
 * Used by `resolveAndPrepend` / WLi to **disable image inline** so peer
 * attachments stay @path refs. Historical export name kept; this is **not**
 * slash `command-name` detection (SEA RYd uses DEe = cross-session-message).
 */
export function looksLikeSlashCommandContent(content: string): boolean {
  if (CROSS_SESSION_MESSAGE_OPEN_RE.test(content)) return true
  const prefix = CROSS_SESSION_INLINE_DISABLE_PREFIXES.find(p =>
    content.startsWith(p),
  )
  return (
    prefix !== undefined &&
    CROSS_SESSION_MESSAGE_OPEN_RE.test(content.slice(prefix.length))
  )
}

/** densable zue — magic-byte image detect; null if not a known image. */
function detectKnownImageMediaType(
  buffer: Buffer,
): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
  if (buffer.length < 4) return null
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png'
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return 'image/gif'
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer.length >= 12 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp'
  }
  // densable returns null for unknown — do not default to png for inline.
  return null
}

/** densable XKu — buffer → image content block, or null on failure. */
async function bufferToInlineImageBlock(
  buffer: Buffer,
): Promise<ImageBlockParam | null> {
  const mediaType = detectKnownImageMediaType(buffer)
  if (mediaType === null) return null
  try {
    const ext = mediaType.split('/')[1] || 'png'
    const resized = await maybeResizeAndDownsampleImageBuffer(
      buffer,
      buffer.length,
      ext,
      INLINE_IMAGE_LIMITS,
    )
    const normalized = resized.mediaType === 'jpg' ? 'jpeg' : resized.mediaType
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: `image/${normalized}` as Base64ImageSource['media_type'],
        data: resized.buffer.toString('base64'),
      },
    }
  } catch {
    return null
  }
}

/** densable VI — simple concurrency gate. */
function createConcurrencyGate(limit: number) {
  let active = 0
  const waiters: Array<() => void> = []
  async function acquire(): Promise<void> {
    if (active < limit) {
      active++
      return
    }
    await new Promise<void>(resolve => {
      waiters.push(resolve)
    })
    active++
  }
  function release(): void {
    const next = waiters.shift()
    if (next) next()
    else active--
  }
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    await acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

/**
 * densable Acv — fetch + write one attachment; optionally inline as image.
 * @param registerChromeDigest densable `t` — register digest for Chrome upload allowlist
 * @param allowInline densable `r` — try image content block when
 *   `is_image===true && sha256===undefined` (SEA exact; null after catch does not inline)
 */
async function resolveOne(
  att: InboundAttachment,
  registerChromeDigest: boolean,
  allowInline: boolean,
): Promise<ResolveOneResult> {
  const token = getBridgeAccessToken()
  if (!token) {
    debug('skip: no oauth token')
    return { failure: 'download' }
  }

  let data: Buffer
  try {
    if (
      typeof att.file_size === 'number' &&
      att.file_size > INBOUND_ATTACHMENT_MAX_BYTES
    ) {
      return { failure: 'download' }
    }
    // getOauthConfig() (via getBridgeBaseUrl) throws on a non-allowlisted
    // CLAUDE_CODE_CUSTOM_OAUTH_URL — keep it inside the try so a bad
    // FedStart URL degrades to "no @path" instead of crashing print.ts's
    // reader loop (which has no catch around the await).
    const url = `${getBridgeBaseUrl()}/api/oauth/files/${encodeURIComponent(att.file_uuid)}/content`
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxContentLength: INBOUND_ATTACHMENT_MAX_BYTES,
      maxBodyLength: INBOUND_ATTACHMENT_MAX_BYTES,
      validateStatus: () => true,
    })
    if (response.status !== 200) {
      debug(`fetch ${att.file_uuid} failed: status=${response.status}`)
      return { failure: 'download' }
    }
    data = Buffer.from(response.data)
    if (data.length > INBOUND_ATTACHMENT_MAX_BYTES) {
      debug(`fetch ${att.file_uuid} over size cap (${data.length} bytes)`)
      return { failure: 'download' }
    }
  } catch (e) {
    debug(`fetch ${att.file_uuid} threw: ${e}`)
    return { failure: 'download' }
  }

  if (typeof att.sha256 === 'string' && !verifyIntegrity(data, att)) {
    debug(`fetch ${att.file_uuid} failed integrity verification`)
    return { failure: 'digest_mismatch' }
  }

  const safeName = sanitizeFileName(att.file_name)
  const prefix = (
    att.file_uuid.slice(0, 8) || randomUUID().slice(0, 8)
  ).replace(/[^a-zA-Z0-9_-]/g, '_')
  const dir = uploadsDir()
  const outPath = join(dir, `${prefix}-${safeName}`)

  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(outPath, data, { mode: 0o600 })
  } catch (e) {
    debug(`write ${outPath} failed: ${e}`)
    return { failure: 'write' }
  }

  // densable SEA: chrome digest only when sha256 === void 0 (not null / not string).
  if (registerChromeDigest && att.sha256 === undefined) {
    try {
      const real = await realpath(outPath)
      registerChromeUploadAttachmentDigest(real, sha256Hex(data))
    } catch {
      debug(`registration skipped for ${outPath}`)
    }
  }

  debug(`resolved ${att.file_uuid} → ${outPath} (${data.length} bytes)`)

  // densable SEA exact: r&&e.is_image===!0&&e.sha256===void 0
  // Schema catch(null) on bad sha → null → does NOT inline (not truthiness).
  if (allowInline && att.is_image === true && att.sha256 === undefined) {
    const imageBlock = await bufferToInlineImageBlock(data).catch(e => {
      debug(`inline ${att.file_uuid} threw: ${e}`)
      return null
    })
    if (imageBlock) {
      debug(`inlined ${att.file_uuid} (${data.length} bytes)`)
      return { imageBlock }
    }
    debug(`inline ${att.file_uuid} fell back to @path ref`)
    return { path: outPath, inlineFellBack: true }
  }

  return { path: outPath }
}

/** densable Goi — peer file receive telemetry. */
function logPeerFileReceive(
  transport: string,
  fileCount: number,
  verifiedCount: number,
): void {
  logEvent('tengu_send_file_received', {
    transport:
      transport as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    file_count: fileCount,
    verified_count: verifiedCount,
  })
  if (verifiedCount === fileCount) featureOk('peer_file_receive')
  else if (verifiedCount > 0) featureSad('peer_file_receive', 'partial_failed')
  else featureBad('peer_file_receive', 'all_failed')
}

export type ResolvedInboundAttachments = {
  prefix: string
  imageBlocks: ImageBlockParam[]
}

/**
 * densable fVm — resolve attachments to @path prefix + optional image blocks.
 *
 * @param allowChromeRegistration densable `t` — register digests when writing photos
 * @param allowInline densable `r` — attempt image content blocks
 */
export async function resolveInboundAttachments(
  attachments: InboundAttachment[],
  allowChromeRegistration = true,
  allowInline = true,
): Promise<ResolvedInboundAttachments> {
  if (attachments.length === 0) return { prefix: '', imageBlocks: [] }
  debug(`resolving ${attachments.length} attachment(s)`)

  const integrityAttachments = attachments.filter(
    a => typeof a.sha256 === 'string',
  )

  if (!getBridgeAccessToken()) {
    debug('skip: no oauth token')
    featureSad('bridge_attachment_resolve', 'no_token')
    if (integrityAttachments.length > 0) {
      const over = integrityAttachments.length - INBOUND_ATTACHMENT_MAX_COUNT
      const slice =
        over > 0
          ? integrityAttachments.slice(0, INBOUND_ATTACHMENT_MAX_COUNT)
          : integrityAttachments
      logPeerFileReceive('bridge', slice.length, 0)
      const drop = over > 0 ? ` ${droppedNotice(over)}` : ''
      return {
        prefix:
          slice
            .map(a =>
              undeliveredNotice(
                a.file_name,
                'it could not be downloaded (not signed in)',
              ),
            )
            .join(' ') +
          drop +
          ' ',
        imageBlocks: [],
      }
    }
    return { prefix: '', imageBlocks: [] }
  }

  const notices: string[] = []
  let list = attachments
  const overCap = list.length > INBOUND_ATTACHMENT_MAX_COUNT
  if (overCap) {
    debug(
      `dropping ${list.length - INBOUND_ATTACHMENT_MAX_COUNT} attachment(s) over the ${INBOUND_ATTACHMENT_MAX_COUNT} cap`,
    )
    if (integrityAttachments.length > 0) {
      notices.push(droppedNotice(list.length - INBOUND_ATTACHMENT_MAX_COUNT))
    }
    list = list.slice(0, INBOUND_ATTACHMENT_MAX_COUNT)
  }

  const tryInline = allowChromeRegistration && allowInline
  const gate = createConcurrencyGate(4)
  const results = await Promise.all(
    list.map(att =>
      gate(() => resolveOne(att, allowChromeRegistration, tryInline)),
    ),
  )

  const pathRefs: string[] = []
  const imageBlocks: ImageBlockParam[] = []
  let inlineFellBack = 0
  let integrityTotal = 0
  let integrityOk = 0
  let hadDigestMismatch = false

  results.forEach((result, idx) => {
    const att = list[idx]!
    const isIntegrity = typeof att.sha256 === 'string'
    if (isIntegrity) integrityTotal++

    if ('imageBlock' in result) {
      imageBlocks.push(result.imageBlock)
      return
    }
    if ('path' in result) {
      pathRefs.push(`@"${result.path}"`)
      if (result.inlineFellBack) inlineFellBack++
      if (isIntegrity) integrityOk++
      return
    }
    if (result.failure === 'digest_mismatch') hadDigestMismatch = true
    // densable only surfaces failure notices for integrity (SendFile) attachments.
    if (isIntegrity) {
      notices.push(
        undeliveredNotice(att.file_name, FAILURE_REASONS[result.failure]),
      )
    }
  })

  if (integrityTotal > 0) {
    logPeerFileReceive('bridge', integrityTotal, integrityOk)
  }

  const resolved = pathRefs.length + imageBlocks.length
  if (resolved === 0) {
    featureBad(
      'bridge_attachment_resolve',
      hadDigestMismatch ? 'digest_mismatch' : 'all_failed',
    )
  } else if (resolved < list.length) {
    featureSad(
      'bridge_attachment_resolve',
      hadDigestMismatch ? 'digest_mismatch' : 'partial_failed',
    )
  } else if (overCap) {
    featureSad('bridge_attachment_resolve', 'over_count_cap')
  } else {
    featureOk('bridge_attachment_resolve')
  }

  if (inlineFellBack > 0) {
    featureSad('bridge_attachment_inline_image', 'fallback_path_ref')
  } else if (imageBlocks.length > 0) {
    featureOk('bridge_attachment_inline_image')
  }

  const prefixParts = [...pathRefs, ...notices]
  return {
    prefix: prefixParts.length > 0 ? prefixParts.join(' ') + ' ' : '',
    imageBlocks,
  }
}

/**
 * densable mVm — prepend @path refs to content, targeting the LAST text block.
 */
export function prependPathRefs(
  content: string | Array<ContentBlockParam>,
  prefix: string,
): string | Array<ContentBlockParam> {
  if (!prefix) return content
  if (typeof content === 'string') {
    return insertPrefixAfterCrossSessionWrapper(content, prefix)
  }
  const i = content.findLastIndex(b => b.type === 'text')
  if (i !== -1) {
    const b = content[i]!
    if (b.type === 'text') {
      return [
        ...content.slice(0, i),
        {
          ...b,
          text: insertPrefixAfterCrossSessionWrapper(b.text, prefix),
        },
        ...content.slice(i + 1),
      ]
    }
  }
  return [...content, { type: 'text', text: prefix.trimEnd() }]
}

/** densable GNl — drop empty text blocks before prepending images. */
function stripEmptyTextBlocks(
  blocks: ContentBlockParam[],
): ContentBlockParam[] {
  if (!blocks.some(b => b.type === 'text' && (!b.text || !b.text.trim()))) {
    return blocks
  }
  return blocks.filter(b => !(b.type === 'text' && (!b.text || !b.text.trim())))
}

/**
 * densable hVm — put image blocks first so the model sees photos without Read.
 */
export function prependImageBlocks(
  content: string | Array<ContentBlockParam>,
  imageBlocks: ImageBlockParam[],
): string | Array<ContentBlockParam> {
  if (imageBlocks.length === 0) return content
  const rest: ContentBlockParam[] =
    typeof content === 'string'
      ? content.trim() === ''
        ? []
        : [{ type: 'text', text: content }]
      : stripEmptyTextBlocks(content)
  return [...imageBlocks, ...rest]
}

/**
 * densable WLi — extract + resolve + prepend.
 *
 * @param allowInline densable third arg — human RC origins pass true; densable
 *   `qvt` peer/cross-session wraps disable image inline. Defaults true.
 */
export async function resolveAndPrepend(
  msg: unknown,
  content: string | Array<ContentBlockParam>,
  allowInline = true,
): Promise<string | Array<ContentBlockParam>> {
  const base = content ?? ''
  const attachments = extractInboundAttachments(msg)
  if (attachments.length === 0) return base

  // densable WLi: i=r&&!(typeof n==="string"&&qvt(n))
  const tryInline =
    allowInline &&
    !(typeof base === 'string' && looksLikeSlashCommandContent(base))

  const { prefix, imageBlocks } = await resolveInboundAttachments(
    attachments,
    allowInline,
    tryInline,
  )

  const isEmpty = typeof base === 'string' ? base === '' : base.length === 0
  if (imageBlocks.length === 0 && !prefix && isEmpty) {
    return typeof base === 'string'
      ? '[attachment could not be downloaded]'
      : [{ type: 'text', text: '[attachment could not be downloaded]' }]
  }

  return prependImageBlocks(prependPathRefs(base, prefix), imageBlocks)
}
