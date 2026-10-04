/**
 * densable 2.1.283 gold `xso` — signed --client-data-url document.
 * SEA /tmp/official-283/package/claude (chunk-9kx8dy2e.js).
 *
 * Fetch + parse + sidecar + cover (`xso`/`Pso`) plus leftover edges:
 * Iso merge into bootstrap client_data, Hso /status, cet floor disk.
 * Does not land --cloud/--environment apply.
 */
import axios from 'axios'
import { createHash } from 'crypto'
import { mkdir, open } from 'fs/promises'
import { join } from 'path'
import { stripVTControlCharacters } from 'util'
import { z } from 'zod/v4'
import { logForDebugging } from '../utils/debug.js'
import { classifyAxiosError, isENOENT } from '../utils/errors.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { safeParseJSON } from '../utils/json.js'
import { lazySchema } from '../utils/lazySchema.js'
import { logError } from '../utils/log.js'
import { getAPIProvider, type APIProvider } from '../utils/model/providers.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { atomicWriteFile } from '../utils/storageV5/atomicWrite.js'
import { isPolicyAllowed } from '../services/policyLimits/index.js'
import {
  CLIENT_DATA_URL_ERROR_PREFIX,
  CLIENT_DATA_URL_ERROR_SUFFIX,
} from './leftoverCliFlags.js'

const SIGNING_CONTEXT_PREFIX = 'claude-code-client-data-v1\0'
const PATHNAME_RE = /^\/[A-Za-z0-9_./-]{1,300}$/
const DOWNLOADS_HOST_RE = /(^|\.)downloads\.claude\.ai$/i
const SCHEMA_VERSION = 1
const FETCH_TIMEOUT_MS = 10_000
const MAX_DOCUMENT_BYTES = 2_097_152
const MAX_SIDECAR_BYTES = 16_384
const SIDECAR_SUFFIX = '.raw-sig.json'
const SIDECAR_SCHEMA = 1
const SIDECAR_ALGORITHM = 'RSASSA-PKCS1-v1_5-SHA512'
const VERIFY_ALGORITHM = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-512',
} as const

/** gold `Evt` compiled trust root (chunk-fnerys0a.js). */
export const CLIENT_DATA_COMPILED_ROOTS: readonly {
  id: string
  spkiBase64: string
}[] = [
  {
    id: 'claude-code-release-signing-key',
    spkiBase64:
      'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAp28rSV5I8HmK8CK9GixBUZR/gtJxeOCsRXO4EJiej40jzBmQA3cWXGosVO82ZfFsRKVTtMC5iB/HH9sxjncrmYNWGroJNbx29m/FgYQBgkCXT4AfFl6rnnXqRGLZOerj/4AqE4yQ1GZbhBgR55Z7ro0ieKK8RHYUspBKAFHyWRhCCz6THW6YRbf0p/hG/08TOY6Sj3cJ7/AEoTRf9ZmVNX1k0KvbUSiVGpGY9OIHWgxRJUF2pArU4o/hk+sqGAgEUh8Bjvjwvz6+quLXPg+y0Y8Ugb1Fg6BUppam/zydYY/Q/+yNjnuF154gD1jEeeir8R5czs6zUHSbo2yXUpAsIdWYo5End8vGsluVmFExnUWm/fTVMGoM5Wm3v1VRepMydEnJ+atz4oQdmPQcKNAip5GJO2uyk++xFr9CpKvlR5jral92toYV/m+mur3va8ydamWBo/qG7/wt0sdS81IwH6lcu0SQ39rgKD+bdoPLv05EqVMYTFRI2QZEsWGYTMs0DOrfCIJFH50qyD0x4sWw1gEWeG3jDgY8cj2StZz+zjqzUd05CibcCzEAGm1EQg5y9D40tIsAU1OI7bpgQ9V0lC8lrqE7zJY66UK9Z1daA8jrdDi6migNjHFrXfT3V4QvMthCIO05q05SS3x2G3ZpIgmI+CePUPB1pDf+lhPkU1MCAwEAAQ==',
  },
]

export type ClientDataFailure =
  | 'invalid_url'
  | 'remote_session'
  | 'third_party_provider'
  | 'policy_denied'
  | 'not_found'
  | 'http_status'
  | 'timeout'
  | 'network'
  | 'read_failed'
  | 'too_large'
  | 'unsigned'
  | 'sidecar_invalid'
  | 'bad_signature'
  | 'parse_failed'
  | 'unknown_key'
  | 'key_unusable'
  | 'unsupported_schema'
  | 'replayed_version'
  | 'exception'

export type ClientDataEntry = {
  pattern: RegExp
  clientData: Record<string, unknown>
}

export type ClientDataDocument = {
  version: number
  entries: ClientDataEntry[]
  /** gold cet `r.issued_at` — optional on the signed JSON. */
  issued_at?: string
}

export type ClientDataUrlSource = {
  url: string
  signingContext: string
  cacheKey: string
  roots: typeof CLIENT_DATA_COMPILED_ROOTS
}

export type ClientDataUrlResolution =
  | { kind: 'unset' }
  | { kind: 'invalid_url' }
  | { kind: 'ok'; source: ClientDataUrlSource }

type HostedFetchResult =
  | {
      status: 'ok'
      documentBytes: Uint8Array
      sidecar: unknown
      hasSidecar: boolean
      sidecarHttpStatus: number | undefined
      httpStatus: number | undefined
    }
  | {
      status: 'error'
      reason: ClientDataFailure
      httpStatus?: number
    }

export type HostedFetchFn = (args: {
  url: string
  sidecarUrl: string
}) => Promise<HostedFetchResult>

const documentSchema = lazySchema(() =>
  z
    .object({
      schema_version: z.literal(SCHEMA_VERSION),
      version: z.number().int().nonnegative(),
      configs: z
        .array(
          z
            .object({
              model_pattern: z.string().min(1).max(200),
              client_data: z.record(z.string(), z.unknown()),
            })
            .passthrough(),
        )
        .max(50),
    })
    .passthrough(),
)

const sidecarSchema = lazySchema(() =>
  z
    .object({
      schema: z.literal(SIDECAR_SCHEMA),
      algorithm: z.literal(SIDECAR_ALGORITHM),
      signature: z.string().min(1),
      publicKeySha256: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .passthrough(),
)

let loadedDocument: ClientDataDocument | undefined
let hostedFetchOverride: HostedFetchFn | undefined

/** gold `Ydr` / chunk-2rcwkatq.js — session marks + disk floor. */
const PUBLISHED_FLOOR_FILE = 'published-floor.json'
const PUBLISHED_FLOOR_SCHEMA_VERSION = 1
const PUBLISHED_FLOOR_MAX_SOURCES = 32
const PUBLISHED_FLOOR_MAX_BYTES = 65536

type PublishedCatalogFloorMark = {
  version: number
  issuedAt: string
  recordedAt: number
}

const publishedCatalogFloorMarks = new Map<string, PublishedCatalogFloorMark>()
let publishedCatalogFloorRead: Promise<void> | undefined
let publishedCatalogFloorWrite: Promise<void> | undefined

const publishedFloorFileSchema = lazySchema(() =>
  z.object({
    version: z.literal(PUBLISHED_FLOOR_SCHEMA_VERSION),
    sources: z.record(
      z.string().min(1).max(64),
      z.object({
        version: z.number().int().nonnegative(),
        issuedAt: z.string().max(64),
        recordedAt: z.number().int().nonnegative(),
      }),
    ),
  }),
)

export function resetClientDataUrlStateForTests(): void {
  loadedDocument = undefined
  hostedFetchOverride = undefined
  publishedCatalogFloorMarks.clear()
  publishedCatalogFloorRead = undefined
  publishedCatalogFloorWrite = undefined
}

export function setClientDataHostedFetchForTests(
  fetchFn: HostedFetchFn | undefined,
): void {
  hostedFetchOverride = fetchFn
}

export function getLoadedClientDataDocument(): ClientDataDocument | undefined {
  return loadedDocument
}

export function setLoadedClientDataDocumentForTests(
  document: ClientDataDocument | undefined,
): void {
  loadedDocument = document
}

export function setClientDataVersionFloorForTests(
  cacheKey: string,
  version: number,
): void {
  publishedCatalogFloorMarks.set(cacheKey, {
    version,
    issuedAt: '',
    recordedAt: 0,
  })
}

/** gold `Tx()` + `Ydr` — `~/.claude/cache/model-catalog/published-floor.json`. */
export function getPublishedCatalogFloorPath(): string {
  return join(
    getClaudeConfigHomeDir(),
    'cache',
    'model-catalog',
    PUBLISHED_FLOOR_FILE,
  )
}

function mergePublishedCatalogFloorMarks(
  loaded: Map<string, PublishedCatalogFloorMark> | undefined,
): void {
  if (loaded === undefined) return
  for (const [key, mark] of loaded) {
    const current = publishedCatalogFloorMarks.get(key)
    if (current === undefined || mark.version > current.version) {
      publishedCatalogFloorMarks.set(key, mark)
    }
  }
}

async function readPublishedCatalogFloorFile(): Promise<
  Map<string, PublishedCatalogFloorMark> | undefined
> {
  const path = getPublishedCatalogFloorPath()
  let bytes: Buffer
  try {
    const handle = await open(path, 'r')
    try {
      const buf = Buffer.alloc(PUBLISHED_FLOOR_MAX_BYTES + 1)
      const { bytesRead } = await handle.read(
        buf,
        0,
        PUBLISHED_FLOOR_MAX_BYTES + 1,
        0,
      )
      bytes = buf.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (!isENOENT(error)) {
      logForDebugging(
        `[publishedCatalog] floor file read failed: ${error instanceof Error ? error.message : 'unknown'}; no persisted version marks this session`,
      )
    }
    return
  }
  const parsed =
    bytes.length > PUBLISHED_FLOOR_MAX_BYTES
      ? undefined
      : publishedFloorFileSchema().safeParse(
          safeParseJSON(bytes.toString('utf8'), false),
        )
  if (!parsed?.success) {
    logForDebugging(
      `[publishedCatalog] floor file ${parsed === undefined ? 'oversized' : 'invalid'}; no persisted version marks this session`,
    )
    return
  }
  return new Map(Object.entries(parsed.data.sources))
}

function hydratePublishedCatalogFloor(): Promise<void> {
  publishedCatalogFloorRead ??= readPublishedCatalogFloorFile().then(
    mergePublishedCatalogFloorMarks,
  )
  return publishedCatalogFloorRead
}

async function writePublishedCatalogFloorFile(): Promise<void> {
  try {
    mergePublishedCatalogFloorMarks(await readPublishedCatalogFloorFile())
    const sources = Object.fromEntries(
      [...publishedCatalogFloorMarks.entries()]
        .sort(([, a], [, b]) => b.recordedAt - a.recordedAt)
        .slice(0, PUBLISHED_FLOOR_MAX_SOURCES),
    )
    const dir = join(getClaudeConfigHomeDir(), 'cache', 'model-catalog')
    await mkdir(dir, { recursive: true })
    await atomicWriteFile(
      getPublishedCatalogFloorPath(),
      jsonStringify({
        version: PUBLISHED_FLOOR_SCHEMA_VERSION,
        sources,
      }),
      { mode: 384 },
    )
  } catch (error) {
    logForDebugging(
      `[publishedCatalog] floor file write failed: ${error instanceof Error ? error.message : 'unknown'}`,
    )
  }
}

function enqueuePublishedCatalogFloorWrite(): Promise<void> {
  const next = (publishedCatalogFloorWrite ?? Promise.resolve()).then(
    writePublishedCatalogFloorFile,
    writePublishedCatalogFloorFile,
  )
  publishedCatalogFloorWrite = next
  return next
}

/** gold `Y5t` — highest accepted document version for this cacheKey. */
export async function getPublishedCatalogFloorVersion(
  cacheKey: string,
): Promise<number> {
  await hydratePublishedCatalogFloor()
  return publishedCatalogFloorMarks.get(cacheKey)?.version ?? 0
}

/** gold `cet` — persist a higher version mark to session Map + disk. */
export async function persistPublishedCatalogFloor(
  cacheKey: string,
  document: { version: number; issued_at?: string },
  recordedAt = Date.now(),
): Promise<void> {
  await hydratePublishedCatalogFloor()
  const current = publishedCatalogFloorMarks.get(cacheKey)
  if (current !== undefined && current.version >= document.version) return
  publishedCatalogFloorMarks.set(cacheKey, {
    version: document.version,
    issuedAt: (document.issued_at ?? '').slice(0, 64),
    recordedAt,
  })
  await enqueuePublishedCatalogFloorWrite()
}

function hostnameOf(value: string): string {
  const asUrl = value.startsWith('//') ? `https:${value}` : value
  let hostname: string
  try {
    hostname = new URL(asUrl).hostname
  } catch {
    hostname = value.match(/^[^/:]+/)?.[0] ?? value
  }
  return hostname.endsWith('.') ? hostname.slice(0, -1) : hostname
}

/** gold `HL` for downloads.claude.ai. */
export function isDownloadsClaudeAiHost(host: string): boolean {
  return DOWNLOADS_HOST_RE.test(hostnameOf(host))
}

function cacheKeyFor(pathname: string): string {
  return createHash('sha256').update(pathname).digest('hex').slice(0, 32)
}

function signingContextFor(pathname: string): string {
  return `${SIGNING_CONTEXT_PREFIX}${pathname}\0`
}

const CONTROL_OR_FORMAT_RE = /[\p{Cc}\p{Cf}\u2028\u2029]+/gu

function sanitizeClientDataText(value: string): string {
  // gold `An` @175826587: replace Cc/Cf/LS/PS with space
  return stripVTControlCharacters(value).replace(CONTROL_OR_FORMAT_RE, ' ')
}

export function formatClientDataUrlError(detail: string): string {
  return `${CLIENT_DATA_URL_ERROR_PREFIX}${detail}${CLIENT_DATA_URL_ERROR_SUFFIX}`
}

export function describeClientDataUrlFailure(
  failure: ClientDataFailure,
  httpStatus?: number,
): string {
  switch (failure) {
    case 'invalid_url':
      return 'the URL must be the https://downloads.claude.ai/ address Anthropic gave you, exactly as given'
    case 'remote_session':
      return 'it cannot be used in a cloud, remote-environment or ssh session, which runs Claude Code on another machine'
    case 'third_party_provider':
      return 'it only works when Claude Code talks to the Anthropic API directly, not through a cloud provider such as Bedrock, Vertex or Foundry, or a cloud gateway'
    case 'policy_denied':
      return "your organization's policy does not allow it"
    case 'not_found':
      return 'there is nothing at that URL; it may have been withdrawn, so ask Anthropic for a new one'
    case 'http_status':
    case 'timeout':
    case 'network':
    case 'read_failed':
      return `Claude Code could not fetch the document from downloads.claude.ai (${failure === 'http_status' ? `HTTP ${httpStatus ?? 'error'}` : failure}); check that your network or proxy allows https://downloads.claude.ai`
    case 'too_large':
      return 'the server returned something too large to be a configuration document; try again, and if it keeps happening ask Anthropic'
    case 'unsigned':
    case 'sidecar_invalid':
    case 'bad_signature':
    case 'parse_failed':
      return `the document or its signature is not valid (${failure}); ask Anthropic for a new URL`
    case 'unknown_key':
    case 'key_unusable':
    case 'unsupported_schema':
      return `this version of Claude Code cannot read the document (${failure}); update Claude Code`
    case 'replayed_version':
      return 'the server returned an older document than one already accepted on this machine; a proxy on your network may be serving an old copy; if not, ask Anthropic for a new URL'
    case 'exception':
      return 'Claude Code hit an internal error loading it; run with --debug for details'
  }
}

export function resolveClientDataUrlSource(
  raw = process.env.CLAUDE_CODE_CLIENT_DATA_URL,
): ClientDataUrlResolution {
  const value = raw?.trim()
  if (!value) return { kind: 'unset' }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { kind: 'invalid_url' }
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    !isDownloadsClaudeAiHost(parsed.hostname) ||
    /[?#]/.test(value) ||
    !PATHNAME_RE.test(parsed.pathname)
  ) {
    return { kind: 'invalid_url' }
  }
  return {
    kind: 'ok',
    source: {
      url: parsed.toString(),
      signingContext: signingContextFor(parsed.pathname),
      cacheKey: cacheKeyFor(parsed.pathname),
      roots: CLIENT_DATA_COMPILED_ROOTS,
    },
  }
}

export function parseClientDataDocument(
  bytes: Uint8Array,
):
  | { ok: true; document: ClientDataDocument }
  | { ok: false; reason: 'parse_failed' | 'unsupported_schema' } {
  const parsed = safeParseJSON(Buffer.from(bytes).toString('utf8'), false)
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('schema_version' in parsed)
  ) {
    return { ok: false, reason: 'parse_failed' }
  }
  const schemaVersion = (parsed as { schema_version: unknown }).schema_version
  if (schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      reason:
        typeof schemaVersion === 'number'
          ? 'unsupported_schema'
          : 'parse_failed',
    }
  }
  const result = documentSchema().safeParse(parsed)
  if (!result.success) return { ok: false, reason: 'parse_failed' }
  const entries: ClientDataEntry[] = []
  for (const config of result.data.configs) {
    try {
      entries.push({
        pattern: new RegExp(config.model_pattern),
        clientData: config.client_data,
      })
    } catch {
      return { ok: false, reason: 'parse_failed' }
    }
  }
  const issuedAt = (parsed as { issued_at?: unknown }).issued_at
  return {
    ok: true,
    document: {
      version: result.data.version,
      entries,
      ...(typeof issuedAt === 'string' ? { issued_at: issuedAt } : {}),
    },
  }
}

export function clientDataForModel(
  document: ClientDataDocument,
  model: string,
): Record<string, unknown> | null {
  return (
    document.entries.find(entry => entry.pattern.test(model))?.clientData ??
    null
  )
}

function coveredPatternsLabel(document: ClientDataDocument): string {
  return sanitizeClientDataText(
    document.entries.map(entry => entry.pattern.source).join(', '),
  )
}

function sessionModel(): string {
  const { getMainLoopModel } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../utils/model/model.js') as typeof import('../utils/model/model.js')
  return getMainLoopModel()
}

export function coverClientDataDocument(
  document: ClientDataDocument,
  model: string,
): string | undefined {
  if (clientDataForModel(document, model) !== null) return
  const patterns = coveredPatternsLabel(document)
  if (patterns === '') {
    return 'the document covers no models; it has been switched off'
  }
  return `the document covers models matching ${patterns}, and this session runs ${sanitizeClientDataText(model)}; pass the matching --model`
}

/**
 * gold `Iso` @190505174 — merge signed document client_data for this model
 * over bootstrap/settings client_data. Returns `base` unchanged when the
 * document is missing or does not cover the model.
 */
export function mergeLoadedClientDataInto(
  base: Record<string, unknown> | null | undefined,
  model: string = sessionModel(),
): Record<string, unknown> | null | undefined {
  if (loadedDocument === undefined) return base
  const extra = clientDataForModel(loadedDocument, model)
  if (extra === null) return base
  return { ...(base ?? {}), ...extra }
}

/** gold `t$r` after QFr — bootstrap cache merged with Iso document. */
export function readMergedClientData(
  model: string = sessionModel(),
): Record<string, unknown> | null | undefined {
  let base: Record<string, unknown> | null | undefined
  try {
    const { getGlobalConfig } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/config.js') as typeof import('../utils/config.js')
    const cache = getGlobalConfig().clientDataCache
    base =
      cache && typeof cache === 'object'
        ? (cache as Record<string, unknown>)
        : cache
  } catch {
    base = null
  }
  return mergeLoadedClientDataInto(base, model)
}

/**
 * gold `Hso` @190505288 — `/status` "Client data" value, or undefined
 * when no document is loaded.
 */
export function describeLoadedClientDataStatus(
  model: string = sessionModel(),
): string | undefined {
  if (loadedDocument === undefined) return
  return clientDataForModel(loadedDocument, model) !== null
    ? `applied to ${sanitizeClientDataText(model)} (document v${loadedDocument.version})`
    : `loaded, not applied to ${sanitizeClientDataText(model)}: it covers models matching ${coveredPatternsLabel(loadedDocument)}`
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof data === 'string') return new TextEncoder().encode(data)
  return new Uint8Array(0)
}

function sidecarUrlFor(url: string): string {
  const parsed = new URL(url)
  parsed.pathname += SIDECAR_SUFFIX
  return parsed.toString()
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

function signedPayload(documentBytes: Uint8Array, context: string): Uint8Array {
  const prefix = new TextEncoder().encode(context)
  const payload = new Uint8Array(prefix.length + documentBytes.length)
  payload.set(prefix)
  payload.set(documentBytes, prefix.length)
  return payload
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', asBufferSource(bytes))
  return Buffer.from(digest).toString('hex')
}

function rootDer(root: { spkiBase64: string }): Uint8Array {
  return new Uint8Array(Buffer.from(root.spkiBase64, 'base64'))
}

export async function verifyClientDataSignature(args: {
  documentBytes: Uint8Array
  sidecar: unknown
  roots?: readonly { id: string; spkiBase64: string }[]
  context: string
}): Promise<
  | { ok: true; rootId: string }
  | {
      ok: false
      reason:
        | 'sidecar_invalid'
        | 'unknown_key'
        | 'key_unusable'
        | 'bad_signature'
    }
> {
  const parsed = sidecarSchema().safeParse(args.sidecar)
  if (!parsed.success) return { ok: false, reason: 'sidecar_invalid' }
  const signature = Buffer.from(parsed.data.signature, 'base64')
  if (
    signature.length === 0 ||
    signature.toString('base64') !== parsed.data.signature
  ) {
    return { ok: false, reason: 'sidecar_invalid' }
  }
  const roots = args.roots ?? CLIENT_DATA_COMPILED_ROOTS
  let matched: { id: string; der: Uint8Array } | undefined
  for (const root of roots) {
    const der = copyBytes(rootDer(root))
    if ((await sha256Hex(der)) === parsed.data.publicKeySha256) {
      matched = { id: root.id, der }
      break
    }
  }
  if (matched === undefined) return { ok: false, reason: 'unknown_key' }
  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey(
      'spki',
      asBufferSource(matched.der),
      VERIFY_ALGORITHM,
      false,
      ['verify'],
    )
  } catch (error) {
    logForDebugging(
      `[clientDataUrl] trust root ${matched.id} is not an importable RSA key: ${error instanceof Error ? error.name : 'error'}`,
    )
    return { ok: false, reason: 'key_unusable' }
  }
  let ok = false
  try {
    ok = await crypto.subtle.verify(
      VERIFY_ALGORITHM.name,
      key,
      asBufferSource(copyBytes(signature)),
      asBufferSource(signedPayload(args.documentBytes, args.context)),
    )
  } catch {
    ok = false
  }
  return ok
    ? { ok: true, rootId: matched.id }
    : { ok: false, reason: 'bad_signature' }
}

function pinDownloadsRedirect(
  url: string,
): (redirect: { href?: string }) => void {
  const origin = (() => {
    try {
      const parsed = new URL(url).origin
      return parsed === 'null' ? '' : parsed
    } catch {
      return ''
    }
  })()
  return redirect => {
    const href = typeof redirect.href === 'string' ? redirect.href : ''
    let hostname = ''
    let protocol = ''
    let hopOrigin = ''
    try {
      const parsed = new URL(href)
      hostname = parsed.hostname.toLowerCase()
      protocol = parsed.protocol.toLowerCase()
      hopOrigin = parsed.origin === 'null' ? '' : parsed.origin
    } catch {
      hostname = ''
    }
    const sameOrigin = origin !== '' && hopOrigin === origin
    if (
      !(
        hostname !== '' &&
        isDownloadsClaudeAiHost(hostname) &&
        (protocol === 'https:' || sameOrigin) &&
        (sameOrigin || protocol === 'https:')
      )
    ) {
      throw new Error(
        '[publishedCatalog] redirect refused: a hop left the host the request was pinned to',
      )
    }
  }
}

async function defaultHostedFetch(args: {
  url: string
  sidecarUrl: string
}): Promise<HostedFetchResult> {
  const beforeRedirect = pinDownloadsRedirect(args.url)
  const noCache = {
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  }
  try {
    const documentResponse = await axios.get<ArrayBuffer>(args.url, {
      responseType: 'arraybuffer',
      timeout: FETCH_TIMEOUT_MS,
      maxContentLength: MAX_DOCUMENT_BYTES,
      maxBodyLength: MAX_DOCUMENT_BYTES,
      validateStatus: () => true,
      beforeRedirect,
      headers: noCache,
    })
    const httpStatus = documentResponse.status
    if (httpStatus < 200 || httpStatus >= 300) {
      logForDebugging(`[publishedCatalog] fetch: HTTP ${httpStatus}`)
      return {
        status: 'error',
        reason: 'http_status',
        httpStatus,
      }
    }
    const documentBytes = toBytes(documentResponse.data)
    if (documentBytes.length > MAX_DOCUMENT_BYTES) {
      return { status: 'error', reason: 'too_large', httpStatus }
    }
    const sidecarResponse = await axios.get<ArrayBuffer>(args.sidecarUrl, {
      responseType: 'arraybuffer',
      timeout: FETCH_TIMEOUT_MS,
      maxContentLength: MAX_SIDECAR_BYTES,
      maxBodyLength: MAX_SIDECAR_BYTES,
      validateStatus: () => true,
      beforeRedirect,
      headers: noCache,
    })
    let sidecar: unknown
    let hasSidecar = false
    if (sidecarResponse.status >= 200 && sidecarResponse.status < 300) {
      const sidecarBytes = toBytes(sidecarResponse.data)
      if (sidecarBytes.length <= MAX_SIDECAR_BYTES) {
        hasSidecar = true
        sidecar = safeParseJSON(
          Buffer.from(sidecarBytes).toString('utf8'),
          false,
        )
      }
    } else {
      logForDebugging(
        `[publishedCatalog] sidecar fetch: HTTP ${sidecarResponse.status}`,
      )
    }
    logForDebugging(
      `[publishedCatalog] fetch ok: ${documentBytes.length} bytes${hasSidecar ? ', sidecar present' : ', no sidecar'}`,
    )
    return {
      status: 'ok',
      documentBytes,
      sidecar,
      hasSidecar,
      sidecarHttpStatus: sidecarResponse.status,
      httpStatus,
    }
  } catch (error) {
    const { kind, status } = classifyAxiosError(error)
    logForDebugging(
      `[publishedCatalog] fetch failed: ${kind}${status !== undefined ? ` ${status}` : ''}`,
    )
    switch (kind) {
      case 'timeout':
        return { status: 'error', reason: 'timeout' }
      case 'network':
        return { status: 'error', reason: 'network' }
      case 'auth':
      case 'http':
        if (status === undefined) {
          const code =
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            typeof error.code === 'string'
              ? error.code
              : undefined
          return {
            status: 'error',
            reason:
              code === 'ERR_FR_MAX_BODY_LENGTH_EXCEEDED' ||
              code === 'ERR_BAD_RESPONSE'
                ? 'too_large'
                : 'network',
          }
        }
        return {
          status: 'error',
          reason: 'http_status',
          httpStatus: status,
        }
      default:
        return { status: 'error', reason: 'exception' }
    }
  }
}

async function loadDocument(
  resolution: Extract<ClientDataUrlResolution, { kind: 'ok' | 'invalid_url' }>,
  runsOnAnotherMachine: boolean,
  deps: {
    getProvider: () => APIProvider
    isCatalogAllowed: (policy: string) => boolean
    fetchHosted: HostedFetchFn
  },
): Promise<
  | { document: ClientDataDocument }
  | { failure: ClientDataFailure; httpStatus?: number }
> {
  if (resolution.kind === 'invalid_url') {
    return { failure: 'invalid_url' }
  }
  if (runsOnAnotherMachine) return { failure: 'remote_session' }
  if (deps.getProvider() !== 'firstParty') {
    return { failure: 'third_party_provider' }
  }
  if (!deps.isCatalogAllowed('allow_model_catalog')) {
    return { failure: 'policy_denied' }
  }
  const { source } = resolution
  const fetched = await deps.fetchHosted({
    url: source.url,
    sidecarUrl: sidecarUrlFor(source.url),
  })
  if (fetched.status !== 'ok') {
    const { httpStatus } = fetched
    if (httpStatus === 404 || httpStatus === 410) {
      return { failure: 'not_found' }
    }
    return {
      failure: fetched.reason,
      httpStatus,
    }
  }
  if (!fetched.hasSidecar) {
    const sidecarHttpStatus = fetched.sidecarHttpStatus
    if (
      sidecarHttpStatus === undefined ||
      sidecarHttpStatus === 404 ||
      sidecarHttpStatus === 410
    ) {
      return { failure: 'unsigned' }
    }
    return sidecarHttpStatus >= 200 && sidecarHttpStatus < 300
      ? { failure: 'too_large' }
      : { failure: 'http_status', httpStatus: sidecarHttpStatus }
  }
  const verified = await verifyClientDataSignature({
    documentBytes: fetched.documentBytes,
    sidecar: fetched.sidecar,
    roots: source.roots,
    context: source.signingContext,
  })
  if (!verified.ok) return { failure: verified.reason }
  const parsed = parseClientDataDocument(fetched.documentBytes)
  if (!parsed.ok) return { failure: parsed.reason }
  const { document } = parsed
  if (
    document.version < (await getPublishedCatalogFloorVersion(source.cacheKey))
  ) {
    return { failure: 'replayed_version' }
  }
  await persistPublishedCatalogFloor(source.cacheKey, document)
  return { document }
}

/**
 * gold `xso`. Returns an Error: --client-data-url: … string to print+exit,
 * or undefined on success / unset.
 */
export async function loadClientDataUrl(
  { runsOnAnotherMachine = false }: { runsOnAnotherMachine?: boolean } = {},
  deps?: {
    getProvider?: () => APIProvider
    isCatalogAllowed?: (policy: string) => boolean
    fetchHosted?: HostedFetchFn
  },
): Promise<string | undefined> {
  try {
    const resolution = resolveClientDataUrlSource()
    if (resolution.kind === 'unset') return
    const result = await loadDocument(resolution, runsOnAnotherMachine, {
      getProvider: deps?.getProvider ?? getAPIProvider,
      isCatalogAllowed: deps?.isCatalogAllowed ?? isPolicyAllowed,
      fetchHosted:
        deps?.fetchHosted ?? hostedFetchOverride ?? defaultHostedFetch,
    })
    if ('failure' in result) {
      return formatClientDataUrlError(
        describeClientDataUrlFailure(result.failure, result.httpStatus),
      )
    }
    loadedDocument = result.document
    logForDebugging(
      `[clientDataUrl] loaded document v${result.document.version} covering ${result.document.entries.length} model pattern(s)`,
    )
    return
  } catch (error) {
    logError(error)
    return formatClientDataUrlError(describeClientDataUrlFailure('exception'))
  }
}

/** gold `Pso` — cover check after the session model is resolved. */
export function coverLoadedClientDataDocument(
  model: string = sessionModel(),
): string | undefined {
  if (loadedDocument === undefined) return
  const detail = coverClientDataDocument(loadedDocument, model)
  return detail === undefined ? undefined : formatClientDataUrlError(detail)
}
