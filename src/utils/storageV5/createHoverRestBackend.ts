/**
 * Pluggable HTTP Hover REST `StorageV5` backend.
 *
 * Implements the full `StorageV5` interface over standard JSON REST endpoints
 * (`/v5/keys/*`, `/v5/scopes/*`, `/v5/streams/*`, `/v5/leases/*`,
 * `/v5/host-files/*`), with strict `baseUrl` scheme/loopback validation,
 * bearer auth token resolution, `AbortSignal.timeout` request timeouts, and
 * exact HTTP-to-`StorageV5Result` error mapping.
 */

import { randomUUID } from 'node:crypto'
import type {
  StorageV5,
  StorageV5LeaseHandle,
  StorageV5ListEntry,
  StorageV5ReadOpts,
  StorageV5ReadReq,
  StorageV5RecordItem,
  StorageV5Result,
  StorageV5ScopeKind,
} from './createLocalFsBackend.js'
import type { HostFilesResult, LocalHostFiles } from './createLocalHostFiles.js'
import type {
  ResolveKeyHit,
  ResolveKeyOpts,
  StorageV5EditCurrent,
  StorageV5EditDecision,
} from './storageHbMutate.js'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const DEFAULT_TIMEOUT_MS = 30_000
const TEXT_ENCODER = new TextEncoder()
const TEXT_DECODER = new TextDecoder()

export type HoverRestBackendOptions = {
  baseUrl: string
  authToken?: string | (() => string | undefined | Promise<string | undefined>)
  fetchImpl?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>
  defaultTimeoutMs?: number
  headers?: Record<string, string>
  configHome?: string
  globalConfigFile?: string
  bridgeSpawnRoot?: string
  clock?: () => number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ok<T>(value: T): StorageV5Result<T> {
  return { ok: true, value }
}

function fail(
  code: string,
  extra?: { argument?: string; telemetryCode?: string },
): StorageV5Result<never> {
  return {
    ok: false,
    error: {
      code,
      ...(extra?.argument !== undefined ? { argument: extra.argument } : {}),
      ...(extra?.telemetryCode !== undefined
        ? { telemetryCode: extra.telemetryCode }
        : {}),
    },
  }
}

function validateAndNormalizeBaseUrl(raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`Hover REST baseUrl must be a valid URL (got "${raw}")`)
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('Hover REST baseUrl must not contain credentials')
  }
  const isHttps = parsed.protocol === 'https:'
  const isLoopbackHttp =
    parsed.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
  if (!isHttps && !isLoopbackHttp) {
    throw new Error(
      `Hover REST baseUrl must use https:// or loopback http:// (got "${parsed.protocol}//${parsed.host}")`,
    )
  }
  const cleanPath = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.origin}${cleanPath}`
}

function encodePayloadValue(value: string | Uint8Array): {
  value: string
  encoding: 'utf8' | 'base64'
} {
  if (typeof value === 'string') {
    return { value, encoding: 'utf8' }
  }
  return {
    value: Buffer.from(value).toString('base64'),
    encoding: 'base64',
  }
}

function decodeBytesField(
  raw: unknown,
  encoding?: unknown,
  base64Fallback?: unknown,
): Uint8Array {
  if (typeof base64Fallback === 'string') {
    return new Uint8Array(Buffer.from(base64Fallback, 'base64'))
  }
  if (typeof raw === 'string') {
    if (encoding === 'base64') {
      return new Uint8Array(Buffer.from(raw, 'base64'))
    }
    return TEXT_ENCODER.encode(raw)
  }
  if (raw instanceof Uint8Array) {
    return new Uint8Array(raw)
  }
  if (Array.isArray(raw)) {
    return new Uint8Array(raw.filter((n): n is number => typeof n === 'number'))
  }
  return new Uint8Array(0)
}

function mapHttpStatusToErrorCode(status: number, serverCode?: string): string {
  switch (status) {
    case 404:
      return 'NotFound'
    case 412:
      return 'PreconditionFailed'
    case 400:
      return 'InvalidArgument'
    case 401:
    case 403:
      return 'PermissionDenied'
    case 409:
      return serverCode ?? 'AlreadyHeld'
    case 413:
      return 'TooLarge'
    case 501:
      return 'Unsupported'
    default:
      if (status >= 500) {
        return 'Unavailable'
      }
      return serverCode ?? 'IoError'
  }
}

function extractErrorDetails(body: unknown): {
  code?: string
  argument?: string
  telemetryCode?: string
} {
  if (!isRecord(body)) return {}
  const nested = isRecord(body.error) ? body.error : body
  return {
    code: typeof nested.code === 'string' ? nested.code : undefined,
    argument: typeof nested.argument === 'string' ? nested.argument : undefined,
    telemetryCode:
      typeof nested.telemetryCode === 'string'
        ? nested.telemetryCode
        : undefined,
  }
}

function isAbortOrTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'TimeoutError' || error.name === 'AbortError'
}

export function createHoverRestBackend(
  options: HoverRestBackendOptions,
): StorageV5 {
  const baseUrl = validateAndNormalizeBaseUrl(options.baseUrl)
  const fetchFn =
    options.fetchImpl ??
    ((input: string | URL | Request, init?: RequestInit) =>
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      fetch(input, init))
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
  const clock = options.clock ?? (() => Date.now())
  const instanceId = `hover-rest-v5-${randomUUID()}`
  const roots: StorageV5['roots'] = {
    configHome: options.configHome ?? '/hover-rest-claude',
    globalConfigFile:
      options.globalConfigFile ?? '/hover-rest-claude/.claude.json',
    ...(options.bridgeSpawnRoot !== undefined
      ? { bridgeSpawnRoot: options.bridgeSpawnRoot }
      : {}),
  }

  let closed = false

  async function resolveAuthToken(): Promise<string | undefined> {
    if (typeof options.authToken === 'function') {
      return await options.authToken()
    }
    return options.authToken
  }

  async function postJson<T>(
    endpoint: string,
    payload: unknown,
  ): Promise<StorageV5Result<T>> {
    if (closed) {
      return fail('Closed')
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
    }
    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        const lower = key.toLowerCase()
        if (lower === 'authorization' || lower === 'content-type') {
          continue
        }
        headers[lower] = value
      }
    }
    headers['content-type'] = 'application/json'

    let token: string | undefined
    try {
      token = await resolveAuthToken()
    } catch {
      return fail('PermissionDenied', { telemetryCode: 'AUTH_TOKEN_ERROR' })
    }
    if (typeof token === 'string' && token.length > 0) {
      headers.authorization = `Bearer ${token}`
    }

    const url = `${baseUrl}${endpoint}`
    let response: Response
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(defaultTimeoutMs),
      })
    } catch (error) {
      if (isAbortOrTimeoutError(error)) {
        return fail('Unavailable', { telemetryCode: 'TIMEOUT' })
      }
      return fail('IoError', { telemetryCode: 'NETWORK_ERROR' })
    }

    let parsedBody: unknown
    const text = await response.text().catch(() => '')
    if (text.trim().length > 0) {
      try {
        parsedBody = JSON.parse(text)
      } catch {
        if (!response.ok) {
          return fail(mapHttpStatusToErrorCode(response.status), {
            telemetryCode: `HTTP_${response.status}`,
          })
        }
        return fail('IoError', { telemetryCode: 'INVALID_JSON' })
      }
    }

    if (!response.ok) {
      const details = extractErrorDetails(parsedBody)
      const code = mapHttpStatusToErrorCode(response.status, details.code)
      return fail(code, {
        argument: details.argument,
        telemetryCode: details.telemetryCode ?? `HTTP_${response.status}`,
      })
    }

    // Support both raw REST payloads and explicit `{ ok, value | error }` envelopes
    if (isRecord(parsedBody) && typeof parsedBody.ok === 'boolean') {
      if (parsedBody.ok) {
        return ok(parsedBody.value as T)
      }
      const details = extractErrorDetails(parsedBody)
      return fail(details.code ?? 'IoError', {
        argument: details.argument,
        telemetryCode: details.telemetryCode,
      })
    }

    return ok(parsedBody as T)
  }

  async function postHostFiles<T>(
    endpoint: string,
    payload: unknown,
  ): Promise<HostFilesResult<T>> {
    const res = await postJson<T>(endpoint, payload)
    if (!res.ok) {
      return {
        ok: false,
        error: {
          code: res.error.code,
          ...(res.error.argument !== undefined
            ? { argument: res.error.argument }
            : {}),
          ...(res.error.telemetryCode !== undefined
            ? { telemetryCode: res.error.telemetryCode }
            : {}),
        },
      }
    }
    return { ok: true, value: res.value }
  }

  const hostFiles: LocalHostFiles = {
    serves: () => false,
    serving: () => 'absent',
    readText: async path =>
      await postHostFiles('/v5/host-files/read-text', { path }),
    readBytes: async path => {
      const res = await postHostFiles<
        | { found: false }
        | {
            found: true
            value?: unknown
            valueBase64?: string
            encoding?: string
            bytes: number
          }
      >('/v5/host-files/read-bytes', { path })
      if (!res.ok) return res
      if (!res.value.found) return { ok: true, value: { found: false } }
      const decoded = decodeBytesField(
        res.value.value,
        res.value.encoding,
        res.value.valueBase64,
      )
      return {
        ok: true,
        value: {
          found: true,
          value: decoded,
          bytes:
            typeof res.value.bytes === 'number'
              ? res.value.bytes
              : decoded.byteLength,
        },
      }
    },
    write: async (path, data, opts) => {
      const encoded =
        data instanceof Uint8Array
          ? {
              data: Buffer.from(data).toString('base64'),
              encoding: 'base64',
            }
          : { data, encoding: 'utf8' }
      return await postHostFiles('/v5/host-files/write', {
        path,
        ...encoded,
        opts,
      })
    },
    listFolder: async path =>
      await postHostFiles('/v5/host-files/list-folder', { path }),
    ensureFolder: async (path, opts) =>
      await postHostFiles('/v5/host-files/ensure-folder', { path, opts }),
    readLink: async path =>
      await postHostFiles('/v5/host-files/read-link', { path }),
    access: async (path, opts) =>
      await postHostFiles('/v5/host-files/access', { path, opts }),
    rename: async (from, to) =>
      await postHostFiles('/v5/host-files/rename', { from, to }),
    delete: async (path, opts) =>
      await postHostFiles('/v5/host-files/delete', { path, opts }),
    realPath: async path =>
      await postHostFiles('/v5/host-files/real-path', { path }),
    stat: async (path, opts) =>
      await postHostFiles('/v5/host-files/stat', { path, opts }),
  }

  const backend: StorageV5 = {
    roots,
    instanceId,
    clock,
    nativeWatch: false,
    hostFiles,

    async scopeKind(
      scope: Record<string, unknown>,
      opts?: { resolveLink?: boolean },
    ): Promise<StorageV5Result<StorageV5ScopeKind>> {
      return await postJson<StorageV5ScopeKind>('/v5/scopes/kind', {
        scope,
        opts,
      })
    },

    async stat(
      key: unknown,
    ): Promise<StorageV5Result<{ size: number; mtimeMs: number }>> {
      return await postJson<{ size: number; mtimeMs: number }>(
        '/v5/keys/stat',
        { key },
      )
    },

    async statMeta(
      key: unknown,
    ): Promise<
      StorageV5Result<{ size: number; mtimeMs?: number; createdMs?: number }>
    > {
      return await postJson<{
        size: number
        mtimeMs?: number
        createdMs?: number
      }>('/v5/keys/stat-meta', { key })
    },

    async read(
      reqs: StorageV5ReadReq[],
      opts?: StorageV5ReadOpts,
    ): Promise<
      StorageV5Result<{
        items: Array<{
          found: boolean
          totalBytes: number
          value?: Uint8Array
          version?: string
          mtimeMs?: number
        }>
      }>
    > {
      const res = await postJson<{
        items: Array<{
          found: boolean
          totalBytes?: number
          value?: unknown
          valueBase64?: string
          encoding?: string
          version?: string
          mtimeMs?: number
        }>
      }>('/v5/keys/read', { reqs, opts })
      if (!res.ok) return res
      const rawItems = Array.isArray(res.value?.items) ? res.value.items : []
      return ok({
        items: rawItems.map(item => {
          if (!item.found) {
            return { found: false, totalBytes: 0 }
          }
          const bytes = decodeBytesField(
            item.value,
            item.encoding,
            item.valueBase64,
          )
          return {
            found: true,
            totalBytes:
              typeof item.totalBytes === 'number'
                ? item.totalBytes
                : bytes.byteLength,
            value: bytes,
            ...(typeof item.version === 'string'
              ? { version: item.version }
              : {}),
            ...(typeof item.mtimeMs === 'number'
              ? { mtimeMs: item.mtimeMs }
              : {}),
          }
        }),
      })
    },

    async readText(
      reqs: StorageV5ReadReq[],
      opts?: StorageV5ReadOpts,
    ): Promise<
      StorageV5Result<{
        items: Array<{
          found: boolean
          totalBytes: number
          value?: string
          version?: string
          mtimeMs?: number
        }>
      }>
    > {
      const res = await backend.read(reqs, opts)
      if (!res.ok) return res
      return ok({
        items: res.value.items.map(item =>
          item.found && item.value !== undefined
            ? {
                found: true,
                totalBytes: item.totalBytes,
                value: TEXT_DECODER.decode(item.value),
                ...(item.version !== undefined
                  ? { version: item.version }
                  : {}),
                ...(item.mtimeMs !== undefined
                  ? { mtimeMs: item.mtimeMs }
                  : {}),
              }
            : { found: false, totalBytes: 0 },
        ),
      })
    },

    async write(
      key: unknown,
      value: string | Uint8Array,
      opts?: {
        mode?: number
        parent?: string
        publishDiscipline?: string
        precondition?: { type?: string; version?: string }
      },
    ): Promise<StorageV5Result<{ version: string }>> {
      const encoded = encodePayloadValue(value)
      return await postJson<{ version: string }>('/v5/keys/write', {
        key,
        ...encoded,
        opts,
      })
    },

    async append(
      key: unknown,
      records: Array<{ data: string | Uint8Array; recordId?: string }>,
      opts?: {
        singleName?: boolean
        precondition?: { type?: string; nonEmpty?: boolean }
      },
    ): Promise<
      StorageV5Result<{
        acks: Array<{ seq: number; endSeq: number; recordId: string }>
      }>
    > {
      const encodedRecords = records.map(rec => {
        if (typeof rec.data === 'string') {
          return {
            data: rec.data,
            encoding: 'utf8' as const,
            ...(rec.recordId !== undefined ? { recordId: rec.recordId } : {}),
          }
        }
        return {
          data: Buffer.from(rec.data).toString('base64'),
          encoding: 'base64' as const,
          ...(rec.recordId !== undefined ? { recordId: rec.recordId } : {}),
        }
      })
      return await postJson<{
        acks: Array<{ seq: number; endSeq: number; recordId: string }>
      }>('/v5/streams/append', {
        key,
        records: encodedRecords,
        opts,
      })
    },

    async delete(key: unknown): Promise<StorageV5Result<{ existed: boolean }>> {
      return await postJson<{ existed: boolean }>('/v5/keys/delete', { key })
    },

    async acquireLease(
      target: unknown,
      ttlMs: number,
      opts?: { holder?: string; meta?: unknown },
    ): Promise<StorageV5Result<StorageV5LeaseHandle>> {
      const res = await postJson<{
        leaseId?: string
        holder: string
        expiresAtMs: number
      }>('/v5/leases/acquire', { target, ttlMs, opts })
      if (!res.ok) return res

      let expiresAtMs = res.value.expiresAtMs
      const holder = res.value.holder
      const leaseId = res.value.leaseId

      const handle: StorageV5LeaseHandle = {
        get expiresAtMs(): number {
          return expiresAtMs
        },
        holder,
        async renew(
          nextTtlMs: number,
        ): Promise<StorageV5Result<{ expiresAtMs: number }>> {
          const renewRes = await postJson<{ expiresAtMs: number }>(
            '/v5/leases/renew',
            {
              target,
              holder,
              ...(leaseId !== undefined ? { leaseId } : {}),
              ttlMs: nextTtlMs,
            },
          )
          if (renewRes.ok) {
            expiresAtMs = renewRes.value.expiresAtMs
          }
          return renewRes
        },
        async release(): Promise<StorageV5Result<void>> {
          const releaseRes = await postJson<unknown>('/v5/leases/release', {
            target,
            holder,
            ...(leaseId !== undefined ? { leaseId } : {}),
          })
          if (!releaseRes.ok) return releaseRes
          return ok(undefined)
        },
      }
      return ok(handle)
    },

    async listLeases(scope: unknown): Promise<
      StorageV5Result<{
        items: Array<{ target: unknown; holder: string; expiresAtMs: number }>
      }>
    > {
      return await postJson<{
        items: Array<{ target: unknown; holder: string; expiresAtMs: number }>
      }>('/v5/leases/list', { scope })
    },

    async subscribe(): Promise<
      StorageV5Result<{ unsubscribe: () => void; observationLagMs: number }>
    > {
      if (closed) return fail('Closed')
      return fail('Unsupported')
    },

    async readRecords(
      key: unknown,
      opts?: {
        order?: 'forward' | 'backward'
        maxBytes?: number
        limit?: number
        fromSeq?: number
        maxBytesPerRecord?: number
      },
    ): Promise<
      StorageV5Result<{ items: StorageV5RecordItem[]; nextSeq?: number }>
    > {
      const res = await postJson<{
        items: Array<{
          seq: number
          data?: unknown
          dataBase64?: string
          encoding?: string
          byteLength?: number
          endSeq?: number
          recordId?: string
          truncated?: boolean
          tombstoned?: boolean
        }>
        nextSeq?: number
      }>('/v5/streams/read-records', { key, opts })
      if (!res.ok) return res

      const rawItems = Array.isArray(res.value?.items) ? res.value.items : []
      const items: StorageV5RecordItem[] = rawItems.map(item => {
        const data = decodeBytesField(item.data, item.encoding, item.dataBase64)
        return {
          seq: item.seq,
          data,
          ...(typeof item.byteLength === 'number'
            ? { byteLength: item.byteLength }
            : { byteLength: data.byteLength }),
          ...(typeof item.endSeq === 'number' ? { endSeq: item.endSeq } : {}),
          ...(typeof item.recordId === 'string'
            ? { recordId: item.recordId }
            : {}),
          ...(item.truncated === true ? { truncated: true } : {}),
          ...(item.tombstoned === true ? { tombstoned: true } : {}),
        }
      })
      return ok({
        items,
        ...(typeof res.value?.nextSeq === 'number'
          ? { nextSeq: res.value.nextSeq }
          : {}),
      })
    },

    async listEntries(
      scope: unknown,
      opts?: {
        cursor?: unknown
        skipKeyStats?: boolean
        skipScopeStats?: boolean
        suffix?: unknown
        links?: string
      },
    ): Promise<
      StorageV5Result<{ items: StorageV5ListEntry[]; cursor?: unknown }>
    > {
      return await postJson<{ items: StorageV5ListEntry[]; cursor?: unknown }>(
        '/v5/scopes/list-entries',
        { scope, opts },
      )
    },

    async listRecursive(
      scope: unknown,
      opts?: {
        cursor?: unknown
        skipKeyStats?: boolean
        includeValue?: boolean
        suffix?: unknown
        links?: 'enter' | 'skip' | 'follow'
        maxLeaves?: number
        limit?: number
      },
    ): Promise<
      StorageV5Result<{ items: StorageV5ListEntry[]; cursor?: unknown }>
    > {
      return await postJson<{ items: StorageV5ListEntry[]; cursor?: unknown }>(
        '/v5/scopes/list-recursive',
        { scope, opts },
      )
    },

    async resolveKey(
      key: unknown,
      opts: ResolveKeyOpts,
    ): Promise<StorageV5Result<ResolveKeyHit>> {
      return await postJson<ResolveKeyHit>('/v5/keys/resolve', { key, opts })
    },

    async resolveKeys(
      keys: unknown,
      opts: ResolveKeyOpts,
    ): Promise<
      StorageV5Result<{ items: Array<StorageV5Result<ResolveKeyHit>> }>
    > {
      return await postJson<{ items: Array<StorageV5Result<ResolveKeyHit>> }>(
        '/v5/keys/resolve-many',
        { keys, opts },
      )
    },

    async copy(
      from: unknown,
      to: unknown,
      opts?: {
        parent?: string
        share?: 'ifPossible' | 'require'
        mode?: number
        exactMode?: number
        requireMode?: boolean
        flush?: boolean
        precondition?: { type?: string; version?: string }
      },
    ): Promise<StorageV5Result<{ version?: string; bytes: number }>> {
      return await postJson<{ version?: string; bytes: number }>(
        '/v5/keys/copy',
        { from, to, opts },
      )
    },

    async move(
      from: unknown,
      to: unknown,
      opts?: {
        parent?: string
        precondition?: { type?: string; version?: string }
      },
    ): Promise<StorageV5Result<{ version?: string; bytes: number }>> {
      return await postJson<{ version?: string; bytes: number }>(
        '/v5/keys/move',
        { from, to, opts },
      )
    },

    async moveScope(
      from: unknown,
      to: unknown,
      opts?: { replace?: boolean },
    ): Promise<StorageV5Result<{ moved: boolean }>> {
      return await postJson<{ moved: boolean }>('/v5/scopes/move', {
        from,
        to,
        opts,
      })
    },

    stagingScopeBeside(scope: unknown): Record<string, unknown> {
      const rec = isRecord(scope) ? scope : {}
      return { ...rec, staging: `beside-${randomUUID()}` }
    },

    stagingScopeWithin(scope: unknown): Record<string, unknown> {
      const rec = isRecord(scope) ? scope : {}
      return { ...rec, staging: `within-${randomUUID()}` }
    },

    async replaceRecords(
      key: unknown,
      entries: unknown,
      opts?: {
        publishDiscipline?: 'atomic' | 'inPlace'
        parent?: string
        aliases?: unknown[]
        singleName?: boolean
        keepBefore?: number
        preserveFrom?: number
        precondition?: { type?: string; version?: string; seq?: number }
      },
    ): Promise<StorageV5Result<{ bytes: number }>> {
      const encodedEntries = Array.isArray(entries)
        ? entries.map(entry => {
            if (isRecord(entry) && entry.data instanceof Uint8Array) {
              return {
                ...entry,
                data: Buffer.from(entry.data).toString('base64'),
                encoding: 'base64',
              }
            }
            if (entry instanceof Uint8Array) {
              return {
                data: Buffer.from(entry).toString('base64'),
                encoding: 'base64',
              }
            }
            return entry
          })
        : entries
      return await postJson<{ bytes: number }>('/v5/streams/replace-records', {
        key,
        entries: encodedEntries,
        opts,
      })
    },

    async writeFromFile(
      key: unknown,
      path: unknown,
      opts?: {
        parent?: string
        precondition?: { type?: string; version?: string }
        growth?: string
        consumeSource?: boolean
        copy?: true
        requireMode?: boolean
        flush?: boolean
        expect?: { singleName?: boolean; maxBytes?: number; within?: string }
      },
    ): Promise<StorageV5Result<{ bytes: number; version?: string }>> {
      return await postJson<{ bytes: number; version?: string }>(
        '/v5/keys/write-from-file',
        { key, path, opts },
      )
    },

    async writeFromStream(
      key: unknown,
      body: AsyncIterable<unknown>,
      opts: {
        maxBytes: number
        parent?: string
        precondition?: { type?: string }
        mode?: number
      },
    ): Promise<StorageV5Result<{ bytes: number; version?: string }>> {
      if (closed) return fail('Closed')
      const chunks: Uint8Array[] = []
      let total = 0
      for await (const chunk of body) {
        const bytes =
          chunk instanceof Uint8Array
            ? chunk
            : typeof chunk === 'string'
              ? TEXT_ENCODER.encode(chunk)
              : null
        if (!bytes) return fail('InvalidArgument', { argument: 'body' })
        total += bytes.byteLength
        if (total > opts.maxBytes) return fail('TooLarge')
        chunks.push(bytes)
      }
      const out = new Uint8Array(total)
      let pos = 0
      for (const chunk of chunks) {
        out.set(chunk, pos)
        pos += chunk.byteLength
      }
      const writeRes = await backend.write(key, out, {
        parent: opts.parent,
        precondition: opts.precondition,
        mode: opts.mode,
      })
      if (!writeRes.ok) return writeRes
      return ok({ bytes: out.byteLength, version: writeRes.value.version })
    },

    async close(): Promise<StorageV5Result<void>> {
      closed = true
      return ok(undefined)
    },

    async touch(key: unknown): Promise<StorageV5Result<{ mtimeMs: number }>> {
      return await postJson<{ mtimeMs: number }>('/v5/keys/touch', { key })
    },

    async setMode(
      key: unknown,
      mode: number,
      opts?: { requireMode?: boolean; ifObject?: unknown },
    ): Promise<StorageV5Result<{ applied: boolean; mode?: number }>> {
      return await postJson<{ applied: boolean; mode?: number }>(
        '/v5/keys/set-mode',
        { key, mode, opts },
      )
    },

    async digest(
      key: unknown,
      opts?: { maxBytes?: number; algorithm?: string },
    ): Promise<
      StorageV5Result<{ digest: string; totalBytes: number; mtimeMs: number }>
    > {
      return await postJson<{
        digest: string
        totalBytes: number
        mtimeMs: number
      }>('/v5/keys/digest', { key, opts })
    },

    async update(
      key: unknown,
      edit: (
        current: StorageV5EditCurrent<Uint8Array> | undefined,
      ) => StorageV5EditDecision,
      opts?: {
        parent?: string
        publishDiscipline?: string
        acquireTimeoutMs?: number
        precondition?: { type?: string }
      },
    ): Promise<
      StorageV5Result<{ written: boolean; found: boolean; version?: string }>
    > {
      const readRes = await backend.read([key as StorageV5ReadReq])
      if (!readRes.ok) return readRes
      const item = readRes.value.items[0]
      const found = Boolean(item?.found && item.value !== undefined)
      const current: StorageV5EditCurrent<Uint8Array> | undefined =
        found && item?.value !== undefined
          ? {
              value: item.value,
              version: item.version,
              mtimeMs: item.mtimeMs,
            }
          : undefined

      const decision = edit(current)
      if ('skip' in decision) {
        return ok({ written: false, found, version: item?.version })
      }

      const precondition =
        opts?.precondition ??
        (found && item?.version !== undefined
          ? { type: 'ifMatch', version: item.version }
          : { type: 'ifAbsent' })

      const writeRes = await backend.write(key, decision.write, {
        parent: opts?.parent,
        publishDiscipline: opts?.publishDiscipline,
        precondition,
      })
      if (!writeRes.ok) return writeRes
      return ok({ written: true, found, version: writeRes.value.version })
    },

    async updateText(
      key: unknown,
      edit: (
        current: StorageV5EditCurrent<string> | undefined,
      ) => StorageV5EditDecision,
      opts?: {
        parent?: string
        publishDiscipline?: string
        acquireTimeoutMs?: number
        precondition?: { type?: string }
      },
    ): Promise<
      StorageV5Result<{ written: boolean; found: boolean; version?: string }>
    > {
      return await backend.update(
        key,
        current =>
          edit(
            current
              ? {
                  value: TEXT_DECODER.decode(current.value),
                  version: current.version,
                  mtimeMs: current.mtimeMs,
                }
              : undefined,
          ),
        opts,
      )
    },

    async ensureScope(
      scope: unknown,
      opts?: { parent?: string },
    ): Promise<StorageV5Result<{ created: boolean }>> {
      return await postJson<{ created: boolean }>('/v5/scopes/ensure', {
        scope,
        opts,
      })
    },

    async deleteScope(
      scope: unknown,
      opts?: { olderThanMs?: number },
    ): Promise<
      StorageV5Result<{ deleted: number; skipped?: number; failed?: number }>
    > {
      return await postJson<{
        deleted: number
        skipped?: number
        failed?: number
      }>('/v5/scopes/delete', { scope, opts })
    },

    async tombstone(
      key: unknown,
      recordIds: string[],
    ): Promise<StorageV5Result<{ matched: boolean[]; newly: string[] }>> {
      return await postJson<{ matched: boolean[]; newly: string[] }>(
        '/v5/streams/tombstone',
        { key, recordIds },
      )
    },

    async applyTombstones(
      key: unknown,
    ): Promise<StorageV5Result<{ purged: number }>> {
      return await postJson<{ purged: number }>(
        '/v5/streams/apply-tombstones',
        {
          key,
        },
      )
    },

    async statStream(key: unknown): Promise<
      StorageV5Result<{
        headSeq: number | null
        recordCount: number
        version?: string
        size?: number
        tornTailBytes?: number
      }>
    > {
      return await postJson<{
        headSeq: number | null
        recordCount: number
        version?: string
        size?: number
        tornTailBytes?: number
      }>('/v5/streams/stat', { key })
    },

    async readValue(
      key: unknown,
    ): Promise<
      | { bytes: Uint8Array; version: string; size: number; mtimeMs: number }
      | undefined
    > {
      if (closed) return undefined
      const res = await backend.read([key as StorageV5ReadReq])
      if (!res.ok) return undefined
      const item = res.value.items[0]
      if (!item?.found || item.value === undefined) return undefined
      return {
        bytes: item.value,
        version: item.version ?? '',
        size: item.totalBytes,
        mtimeMs: item.mtimeMs ?? clock(),
      }
    },

    async streamEntries(key: unknown): Promise<unknown> {
      const res = await backend.readRecords(key)
      return res.ok ? res.value.items : []
    },

    async scopeKeys(
      scope: unknown,
    ): Promise<StorageV5Result<Array<Record<string, unknown>>>> {
      const res = await backend.listRecursive(scope)
      if (!res.ok) return res
      const keys = res.value.items
        .map(item => item.key)
        .filter((k): k is Record<string, unknown> => k !== undefined)
      return ok(keys)
    },
  }

  return backend
}
