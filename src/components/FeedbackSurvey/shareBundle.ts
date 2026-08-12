/**
 * densable 2.1.224 share/feedback bundle helpers — SEA 1:1.
 *
 * - Y7t  → encodeShareRequestBody (streaming JSON body with content string)
 * - hBa  → writeFeedbackBundleZip
 * - m0t  → resolveTranscriptShareMode
 */
import { randomBytes } from 'crypto'
import { createWriteStream } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { Zip, ZipDeflate } from 'fflate'
import { getAuthHeaders } from '../../utils/http.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { jsonStringify } from '../../utils/slowOperations.js'

/** densable mmh / fBa — large array keys streamed element-wise inside content */
export const SHARE_STREAM_ARRAY_KEYS = new Set(['transcript'])

/** densable hmh / mBa — object-of-arrays streamed element-wise */
export const SHARE_STREAM_OBJECT_ARRAY_KEYS = new Set(['subagentTranscripts'])

export type TranscriptShareMode =
  | { kind: 'post' }
  | { kind: 'bundle'; cause: 'provider' | 'no_creds'; label: string }
  | { kind: 'disabled'; reason: string }

/**
 * densable m0t — share/feedback export mode.
 * After early essential/policy gates, share only distinguishes bundle vs post:
 * `m0t().kind==="bundle"?"bundle":"post"`.
 */
export function resolveTranscriptShareMode(): TranscriptShareMode {
  // densable also checks DISABLE_FEEDBACK_COMMAND / DISABLE_BUG_COMMAND /
  // essential / policy here; submitTranscriptShare already gates essential+policy
  // before calling this. Keep provider + creds selection only.
  const provider = getAPIProvider()
  if (provider !== 'firstParty') {
    return {
      kind: 'bundle',
      cause: 'provider',
      label: provider,
    }
  }
  const auth = getAuthHeaders()
  if (auth.error) {
    return {
      kind: 'bundle',
      cause: 'no_creds',
      label: 'no Anthropic credentials',
    }
  }
  return { kind: 'post' }
}

/**
 * densable aBa — UTF-8 chunk buffer for Y7t.
 */
class ShareBodyBuffer {
  private chunks: Uint8Array[] = []
  private static encoder = new TextEncoder()

  push(fragment: string): void {
    if (fragment.length > 0) {
      this.chunks.push(ShareBodyBuffer.encoder.encode(fragment))
    }
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks)
  }

  get length(): number {
    let n = 0
    for (const c of this.chunks) n += c.length
    return n
  }
}

/**
 * densable i() inside Y7t: push JSON string content (stringify then strip quotes)
 * so the fragment is valid inside the outer `"content":"..."` string.
 */
function pushJsonStringContent(buf: ShareBodyBuffer, fragment: string): void {
  if (fragment.length === 0) return
  buf.push(jsonStringify(fragment).slice(1, -1))
}

/**
 * densable Y7t — build request/zip body:
 * `{"content":"<json of payload with streamed large fields>", ...extraOuterFields}`
 *
 * arrayKeys (transcript): stringify each element separately.
 * objectArrayKeys (subagentTranscripts): each agent → array of per-message JSON.
 */
export function encodeShareRequestBody(
  payload: Record<string, unknown>,
  options?: {
    arrayKeys?: Set<string>
    objectArrayKeys?: Set<string>
    extraOuterFields?: Record<string, unknown>
  },
): Buffer {
  const arrayKeys = options?.arrayKeys ?? SHARE_STREAM_ARRAY_KEYS
  const objectArrayKeys =
    options?.objectArrayKeys ?? SHARE_STREAM_OBJECT_ARRAY_KEYS
  const buf = new ShareBodyBuffer()

  const pushEscaped = (fragment: string): void => {
    pushJsonStringContent(buf, fragment)
  }

  buf.push('{"content":"')
  pushEscaped('{')
  let first = true
  const writeKey = (key: string): void => {
    if (!first) pushEscaped(',')
    first = false
    pushEscaped(`${jsonStringify(key)}:`)
  }

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue
    if (arrayKeys.has(key) && Array.isArray(value)) {
      writeKey(key)
      pushEscaped('[')
      for (let i = 0; i < value.length; i++) {
        if (i > 0) pushEscaped(',')
        // densable: i(Ie(u[d])) — double-escape element JSON into content string
        pushEscaped(jsonStringify(value[i]))
      }
      pushEscaped(']')
    } else if (
      objectArrayKeys.has(key) &&
      value !== null &&
      typeof value === 'object'
    ) {
      writeKey(key)
      pushEscaped('{')
      const entries = Object.entries(value as Record<string, unknown>)
      for (let p = 0; p < entries.length; p++) {
        const [agentId, messages] = entries[p] ?? ['', undefined]
        if (p > 0) pushEscaped(',')
        pushEscaped(`${jsonStringify(agentId)}:[`)
        if (Array.isArray(messages)) {
          for (let h = 0; h < messages.length; h++) {
            if (h > 0) pushEscaped(',')
            pushEscaped(jsonStringify(messages[h]))
          }
        }
        pushEscaped(']')
      }
      pushEscaped('}')
    } else {
      writeKey(key)
      pushEscaped(jsonStringify(value))
    }
  }
  pushEscaped('}')
  buf.push('"')

  const extra = options?.extraOuterFields
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      buf.push(`,${jsonStringify(k)}:${jsonStringify(v)}`)
    }
  }
  buf.push('}')
  return buf.toBuffer()
}

export type WriteFeedbackBundleResult =
  | { success: true; bundleId: string; zipPath: string }
  | { success: false; error: string }

/**
 * densable hBa — write a single-entry zip under configDir/feedback-bundles/.
 * Default entry name densable `feedback.json`; share path passes `transcript.json`.
 */
export async function writeFeedbackBundleZip(
  body: Buffer | Uint8Array | string,
  entryName = 'feedback.json',
): Promise<WriteFeedbackBundleResult> {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15)
  const bundleId = `cc-${stamp}-${randomBytes(3).toString('hex')}`
  const dir = join(getClaudeConfigHomeDir(), 'feedback-bundles')
  const zipPath = join(dir, `${bundleId}.zip`)

  try {
    // densable mode 448 = 0o700
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const data =
      typeof body === 'string'
        ? Buffer.from(body, 'utf8')
        : Buffer.isBuffer(body)
          ? body
          : Buffer.from(body)

    await new Promise<void>((resolve, reject) => {
      // densable mode 384 = 0o600
      const out = createWriteStream(zipPath, { mode: 0o600 })
      out.on('error', reject)

      const zip = new Zip((err, chunk, final) => {
        if (err) {
          out.destroy()
          reject(err)
          return
        }
        out.write(chunk)
        if (final) {
          out.end(() => resolve())
        }
      })
      const file = new ZipDeflate(entryName)
      zip.add(file)
      file.push(data, true)
      zip.end()
    })

    logForDebugging('feedback_bundle written', { level: 'info' })
    return { success: true, bundleId, zipPath }
  } catch (err) {
    await rm(zipPath, { force: true }).catch(() => {})
    logForDebugging(errorMessage(err), { level: 'error' })
    return { success: false, error: errorMessage(err) }
  }
}
