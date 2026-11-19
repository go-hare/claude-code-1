/**
 * Upload BriefTool attachments to private_api so web viewers can preview them.
 *
 * When the repl bridge is active, attachment paths are meaningless to a web
 * viewer (they're on Claude's machine). We upload to /api/oauth/file_upload —
 * the same store MessageComposer/SpaceMessage render from — and stash the
 * returned file_uuid alongside the path. Web resolves file_uuid → preview;
 * desktop/local try path first.
 *
 * Best-effort: any failure (no token, bridge off, network error, 4xx) logs
 * debug and returns undefined. The attachment still carries {path, size,
 * isImage}, so local-terminal and same-machine-desktop render unaffected.
 */

import { feature } from 'bun:bundle'
import axios from 'axios'
import { randomUUID } from 'crypto'
import { constants } from 'fs'
import { open } from 'fs/promises'
import { basename, extname } from 'path'
import { z } from 'zod/v4'

import {
  getBridgeAccessToken,
  getBridgeBaseUrlOverride,
} from 'src/bridge/bridgeConfig.js'
import { getOauthConfig } from 'src/constants/oauth.js'
import { logForDebugging } from 'src/utils/debug.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { getPlatform } from 'src/utils/platform.js'
import {
  formatUnsaveableSkillRefusal,
  isSkillAttachmentPath,
  validateSkillAttachmentForUpload,
} from 'src/utils/plugins/skillUploadValidation.js'
import { jsonStringify } from 'src/utils/slowOperations.js'

// Matches the private_api backend limit
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

const UPLOAD_TIMEOUT_MS = 30_000

// Backend dispatches on mime: image/* → upload_image_wrapped (writes
// PREVIEW/THUMBNAIL, no ORIGINAL), everything else → upload_generic_file
// (ORIGINAL only, no preview). Only whitelist raster formats the
// transcoder reliably handles — svg/bmp/ico risk a 400, and pdf routes
// to upload_pdf_file_wrapped which also skips ORIGINAL. Dispatch
// viewers use /preview for images and /contents for everything else,
// so images go image/* and the rest go octet-stream.
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

function guessMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

function debug(msg: string): void {
  logForDebugging(`[brief:upload] ${msg}`)
}

/**
 * Base URL for uploads. Must match the host the token is valid for.
 *
 * Subprocess hosts (cowork) pass ANTHROPIC_BASE_URL alongside
 * CLAUDE_CODE_OAUTH_TOKEN — prefer that since getOauthConfig() only
 * returns staging when USE_STAGING_OAUTH is set, which such hosts don't
 * set. Without this a staging token hits api.anthropic.com → 401 → silent
 * skip → web viewer sees inert cards with no file_uuid.
 */
function getBridgeBaseUrl(): string {
  return (
    getBridgeBaseUrlOverride() ??
    process.env.ANTHROPIC_BASE_URL ??
    getOauthConfig().BASE_API_URL
  )
}

// /api/oauth/file_upload returns one of ChatMessage{Image,Blob,Document}FileSchema.
// All share file_uuid; that's the only field we need.
const uploadResponseSchema = lazySchema(() =>
  z.object({ file_uuid: z.string() }),
)

export type BriefUploadContext = {
  replBridgeEnabled: boolean
  signal?: AbortSignal
}

export type BriefUploadOutcome =
  | { fileUuid: string }
  | { error: string; suspectedLimitBytes?: number }

/** SEA `uHr` = 30 MiB floor for suspected-limit reporting on unnamed failures. */
export const SUSPECTED_UPLOAD_LIMIT_BYTES = 31_457_280
const SUSPECTED_LIMIT_HTTP_STATUSES = new Set([502, 503, 504, 507, 520, 524])
/** Official 2.1.321 #1895 (`Pe`): HTTP statuses eligible for upload retry (includes 507). */
export const RETRYABLE_UPLOAD_HTTP_STATUSES = new Set([
  429, 500, 502, 503, 504, 507, 520, 521, 522, 523, 524, 529,
])
const UPLOAD_RETRY_DELAY_MS = 500
const UPLOAD_TIMEOUT_RE =
  /^upload failed: (?:network error \(|the connection closed before the server answered$|the server did not answer within \d|the transfer stalled \()/
const UPLOAD_INVALID_URL_OR_CERT_RE = /\bInvalid URL\b|certificate/i

function formatMiB(bytes: number): string {
  const mib = bytes / 1_048_576
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`
}

/**
 * SEA `zxo` + `Be` + `fHr` — format bridge upload failure so large-file
 * unnamed/transient failures tell Claude to report the failure instead of
 * shrinking the file.
 */
export function formatLargeFileUploadFailure(opts: {
  size: number
  uploadError: string
  suspectedLimitBytes?: number
}): string {
  if (opts.uploadError === 'upload aborted') {
    return 'upload aborted — the turn was stopped before the upload finished, which says nothing about the file or the network. Send the file again if the user still wants it'
  }
  const hasSuspectedLimit =
    typeof opts.suspectedLimitBytes === 'number' &&
    Number.isSafeInteger(opts.suspectedLimitBytes) &&
    opts.suspectedLimitBytes > 0
  const isUnknownOrTransient =
    SUSPECTED_LIMIT_HTTP_STATUSES.has(
      Number(/server returned (\d+)/.exec(opts.uploadError)?.[1]),
    ) ||
    (UPLOAD_TIMEOUT_RE.test(opts.uploadError) &&
      !UPLOAD_INVALID_URL_OR_CERT_RE.test(opts.uploadError))
  if (
    hasSuspectedLimit &&
    opts.size > SUSPECTED_UPLOAD_LIMIT_BYTES &&
    isUnknownOrTransient
  ) {
    return `${opts.uploadError} — the cause is unknown and may pass. If the same file fails like this again, it may be over the upload limit that applies to this session, which was not named and is never under ${formatMiB(SUSPECTED_UPLOAD_LIMIT_BYTES)}. Report this failure to the user instead of shrinking the file.`
  }
  return opts.uploadError
}

/**
 * Official 2.1.321 #1895: execute a Brief attachment upload request, retrying
 * once on retryable HTTP statuses (including HTTP 507 Insufficient Storage) or
 * transient network errors.
 */
export async function postBriefUploadWithRetry(opts: {
  url: string
  body: Buffer
  token: string
  boundary: string
  fullPath: string
  size: number
  signal?: AbortSignal
  postFn?: typeof axios.post
  retryDelayMs?: number
}): Promise<BriefUploadOutcome> {
  const {
    url,
    body,
    token,
    boundary,
    fullPath,
    size,
    signal,
    postFn = axios.post,
    retryDelayMs = UPLOAD_RETRY_DELAY_MS,
  } = opts
  const maxAttempts = 2
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await postFn(url, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length.toString(),
        },
        timeout: UPLOAD_TIMEOUT_MS,
        signal,
        validateStatus: () => true,
      })

      if (response.status !== 201) {
        if (
          attempt < maxAttempts &&
          RETRYABLE_UPLOAD_HTTP_STATUSES.has(response.status) &&
          !signal?.aborted
        ) {
          debug(
            `upload got retryable HTTP ${response.status} for ${fullPath}; retrying (attempt ${attempt + 1}/${maxAttempts})`,
          )
          if (retryDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, retryDelayMs))
          }
          continue
        }
        debug(
          `upload failed for ${fullPath}: status=${response.status} body=${jsonStringify(response.data).slice(0, 200)}`,
        )
        const error = `upload failed: server returned ${response.status}`
        if (
          SUSPECTED_LIMIT_HTTP_STATUSES.has(response.status) &&
          size > SUSPECTED_UPLOAD_LIMIT_BYTES
        ) {
          return { error, suspectedLimitBytes: SUSPECTED_UPLOAD_LIMIT_BYTES }
        }
        return { error }
      }

      const parsed = uploadResponseSchema().safeParse(response.data)
      if (!parsed.success) {
        debug(
          `unexpected response shape for ${fullPath}: ${parsed.error.message}`,
        )
        return { error: 'upload failed: unexpected server response' }
      }

      debug(`uploaded ${fullPath} → ${parsed.data.file_uuid} (${size} bytes)`)
      return { fileUuid: parsed.data.file_uuid }
    } catch (e) {
      const aborted = signal?.aborted === true
      if (attempt < maxAttempts && !aborted) {
        debug(
          `upload threw for ${fullPath} (${e}); retrying (attempt ${attempt + 1}/${maxAttempts})`,
        )
        if (retryDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs))
        }
        continue
      }
      debug(`upload threw for ${fullPath}: ${e}`)
      const error = aborted
        ? 'upload aborted'
        : `upload failed: network error (${e instanceof Error ? e.message : String(e)})`
      if (!aborted && size > SUSPECTED_UPLOAD_LIMIT_BYTES) {
        return { error, suspectedLimitBytes: SUSPECTED_UPLOAD_LIMIT_BYTES }
      }
      return { error }
    }
  }
  return { error: 'upload failed: exhausted retry attempts' }
}

/**
 * Upload a single attachment and return either `fileUuid` or structured error.
 */
export async function uploadBriefAttachmentWithStatus(
  fullPath: string,
  size: number,
  ctx: BriefUploadContext,
): Promise<BriefUploadOutcome> {
  if (feature('BRIDGE_MODE')) {
    if (!ctx.replBridgeEnabled) {
      return { error: 'upload failed: bridge is not enabled' }
    }

    if (size > MAX_UPLOAD_BYTES) {
      debug(`skip ${fullPath}: ${size} bytes exceeds ${MAX_UPLOAD_BYTES} limit`)
      return {
        error: `upload failed: file exceeds maximum upload size of ${formatMiB(MAX_UPLOAD_BYTES)}`,
      }
    }

    const token = getBridgeAccessToken()
    if (!token) {
      debug('skip: no oauth token')
      return { error: 'upload failed: no OAuth token available' }
    }

    let content: Buffer
    try {
      const platform = getPlatform()
      const flags =
        platform === 'windows'
          ? constants.O_RDONLY
          : constants.O_RDONLY |
            (constants.O_NOFOLLOW ?? 0) |
            (constants.O_NONBLOCK ?? 0) |
            (constants.O_NOCTTY ?? 0)
      const handle = await open(fullPath, flags)
      try {
        const st = await handle.stat({ bigint: true })
        if (!st.isFile()) {
          debug(`skip ${fullPath}: not a regular file`)
          return { error: 'upload failed: path is not a regular file' }
        }
        content = await handle.readFile()
      } finally {
        await handle.close().catch(() => {})
      }
    } catch (e) {
      debug(`read failed for ${fullPath}: ${e}`)
      return {
        error: `upload failed: could not read file (${e instanceof Error ? e.message : String(e)})`,
      }
    }

    // Official 2.1.323 #2146: validate SKILL.md and .skill archives before
    // uploading to claude.ai so unsaveable skills fail fast with actionable copy.
    if (isSkillAttachmentPath(fullPath)) {
      const failure = validateSkillAttachmentForUpload(fullPath, content)
      if (failure) {
        const refusal = formatUnsaveableSkillRefusal(fullPath, content)
        debug(`refuse skill upload ${fullPath}: ${failure.rule}`)
        return {
          error:
            refusal?.message ??
            `not sent: claude.ai would refuse to save it as a skill, because ${failure.why}.`,
        }
      }
    }

    const baseUrl = getBridgeBaseUrl()
    const url = `${baseUrl}/api/oauth/file_upload`
    const filename = basename(fullPath)
    const mimeType = guessMimeType(filename)
    const boundary = `----FormBoundary${randomUUID()}`

    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          `Content-Type: ${mimeType}\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])

    return postBriefUploadWithRetry({
      url,
      body,
      token,
      boundary,
      fullPath,
      size,
      signal: ctx.signal,
    })
  }
  return { error: 'upload failed: bridge mode disabled' }
}

/**
 * Upload a single attachment. Returns file_uuid on success, undefined otherwise.
 * Every early-return is intentional graceful degradation.
 */
export async function uploadBriefAttachment(
  fullPath: string,
  size: number,
  ctx: BriefUploadContext,
): Promise<string | undefined> {
  const outcome = await uploadBriefAttachmentWithStatus(fullPath, size, ctx)
  return 'fileUuid' in outcome ? outcome.fileUuid : undefined
}
