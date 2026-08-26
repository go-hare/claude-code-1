export type UploadResult = {
  id: string
  url: string
  expiresAt: string
}

export type UploadParams = {
  html: string
  token: string
  uploadUrl: string
  hash?: string
  ttl?: 7 | 30
}

/**
 * Bun/fetch keep-alive pool can hand back a dead socket in long-lived CLI
 * sessions ("The socket connection was closed unexpectedly"). Artifact uploads
 * are infrequent and cross-origin from the API pool — always disable keep-alive
 * on this request and retry once on that transient.
 *
 * Aligns with `src/utils/proxy.ts` notes: Bun native fetch respects
 * `keepalive: false` for pooling; `Connection: close` is belt-and-suspenders.
 *
 * densable invent-ban: do NOT map this to asset_proxy_refused (artifact content
 * FETCH / CONNECT 407 taxonomy, unrelated to tip cloud-artifacts upload).
 */
export const SOCKET_CONNECTION_CLOSED_PREFIX =
  'The socket connection was closed unexpectedly'

const MAX_ATTEMPTS = 2

function matchesTransientArtifactUploadSocketError(error: Error): boolean {
  const msg = error.message
  if (msg.startsWith(SOCKET_CONNECTION_CLOSED_PREFIX)) return true
  // Node/undici variants sometimes surface instead of Bun's prefix.
  if (msg.includes('ECONNRESET') || msg.includes('UND_ERR_SOCKET')) return true
  const code =
    'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined
  return (
    code === 'ECONNRESET' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'ConnectionClosed' ||
    code === 'ERR_SOCKET_CLOSED'
  )
}

export function isTransientArtifactUploadSocketError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (matchesTransientArtifactUploadSocketError(error)) return true
  // Bun/fetch often wraps the native socket-closed error as
  // `new Error('fetch failed', { cause })` — unwrap one level only.
  const cause = error.cause
  return (
    cause instanceof Error && matchesTransientArtifactUploadSocketError(cause)
  )
}

function markProcessKeepAliveBad(): void {
  // Sticky disable for the process — same sticky latch as API withRetry after
  // ConnectionClosed. Dynamic require keeps client.ts free of a hard top-level
  // edge into proxy/axios for unit tests that only mock fetch.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { disableKeepAlive } =
      require('src/utils/proxy.js') as typeof import('src/utils/proxy.js')
    disableKeepAlive()
  } catch {
    // densable optional in isolated client tests
  }
}

async function uploadArtifactOnce(params: UploadParams): Promise<UploadResult> {
  const url = new URL(params.uploadUrl)
  if (params.hash) url.searchParams.set('hash', params.hash)
  if (params.ttl) url.searchParams.set('ttl', String(params.ttl))

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.token}`,
      'Content-Type': 'text/html',
      // Belt-and-suspenders with keepalive:false (Bun pool).
      Connection: 'close',
    },
    body: params.html,
    // Bun: do not reuse a pooled keep-alive socket for this upload.
    keepalive: false,
  })

  // Deno Deploy proxy flattens upstream status to 200; the Worker embeds the
  // real error in the body as `{ "error": "<code>" }`. Always parse body first.
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(
      `Artifact upload failed: HTTP ${response.status} (non-JSON body)`,
    )
  }

  if (parsed && typeof parsed === 'object' && 'error' in parsed) {
    const code = (parsed as { error: unknown }).error
    throw new Error(`Artifact upload failed: ${String(code)}`)
  }

  const data = parsed as Partial<UploadResult>
  if (
    typeof data.id !== 'string' ||
    typeof data.url !== 'string' ||
    typeof data.expiresAt !== 'string'
  ) {
    throw new Error(
      `Artifact upload returned malformed body: ${text.slice(0, 200)}`,
    )
  }
  return { id: data.id, url: data.url, expiresAt: data.expiresAt }
}

export async function uploadArtifact(
  params: UploadParams,
): Promise<UploadResult> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await uploadArtifactOnce(params)
    } catch (error) {
      lastError = error
      if (
        attempt < MAX_ATTEMPTS &&
        isTransientArtifactUploadSocketError(error)
      ) {
        // Evict trust in the global pool before the retry (and for later API).
        markProcessKeepAliveBad()
        continue
      }
      throw error
    }
  }
  throw lastError
}
