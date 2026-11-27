/**
 * Pluggable in-memory `StorageV5` backend for diskless / multi-tenant embedded hosts.
 *
 * Implements the full `StorageV5` interface completely in memory using per-instance
 * `Map` / `Set` structures with zero filesystem I/O, full CRUD, scope management,
 * optimistic preconditions, record streams, leases, and synchronous change subscriptions.
 */

import { createHash, randomUUID } from 'crypto'
import { dirname, posix } from 'path'
import {
  DELETE_SCOPE_FENCED_SY,
  resolveKeyFilesystemPath,
  type StorageV5,
  type StorageV5LeaseHandle,
  type StorageV5ListEntry,
  type StorageV5ReadOpts,
  type StorageV5ReadReq,
  type StorageV5RecordItem,
  type StorageV5Result,
  type StorageV5ScopeKind,
} from './createLocalFsBackend.js'
import type { HostFilesResult, LocalHostFiles } from './createLocalHostFiles.js'
import { resolveScopeListDirectories } from './listEntriesZa.js'
import {
  type ResolveKeyHit,
  type ResolveKeyOpts,
  type StorageV5EditCurrent,
  type StorageV5EditDecision,
  stagingScopeBesidePf,
  stagingScopeWithinLf,
} from './storageHbMutate.js'
import { validateStorageKey, validateStorageScope } from './writeValidate.js'

const TEXT_ENCODER = new TextEncoder()
const TEXT_DECODER = new TextDecoder()

export type CreateMemoryStorageV5BackendOptions = {
  initialFiles?: Record<string, string | Uint8Array>
  configHome?: string
  globalConfigFile?: string
  bridgeSpawnRoot?: string
  clock?: () => number
}

export type MemoryStorageV5 = StorageV5 & {
  snapshot(): Record<string, string>
  clear(): void
}

type MemoryFileEntry = {
  bytes: Uint8Array
  version: string
  mtimeMs: number
  createdMs: number
  mode: number
  key?: Record<string, unknown>
}

type MemoryRecordEntry = {
  seq: number
  endSeq: number
  recordId: string
  data: Uint8Array
  tombstoned: boolean
}

type MemoryLeaseEntry = {
  targetKey: string
  target: unknown
  holder: string
  expiresAtMs: number
  meta?: unknown
}

type MemorySubscription = {
  id: string
  filter: { target: 'key'; path: string } | { target: 'scope'; dirs: string[] }
  listener: (event: unknown) => void
}

function normalizeVirtualPath(p: string): string {
  const slash = p.replaceAll('\\', '/')
  const normalized = posix.normalize(slash)
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

function toBytes(value: string | Uint8Array): Uint8Array {
  if (typeof value === 'string') {
    return TEXT_ENCODER.encode(value)
  }
  return new Uint8Array(value)
}

function computeVersion(bytes: Uint8Array, counter: number): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  return `mem-${counter}-${hash}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function fallbackDeepClone(
  value: unknown,
  seen: WeakMap<object, unknown>,
): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }
  const existing = seen.get(value)
  if (existing !== undefined) {
    return existing
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value)
  }
  if (value instanceof Date) {
    return new Date(value.getTime())
  }
  if (Array.isArray(value)) {
    const clonedArr: unknown[] = []
    seen.set(value, clonedArr)
    for (const item of value) {
      clonedArr.push(fallbackDeepClone(item, seen))
    }
    return clonedArr
  }
  const clonedObj: Record<string, unknown> = {}
  seen.set(value, clonedObj)
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    clonedObj[k] = fallbackDeepClone(v, seen)
  }
  return clonedObj
}

function safeDeepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value
  }
  try {
    return structuredClone(value)
  } catch {
    return fallbackDeepClone(value, new WeakMap()) as T
  }
}

function cloneRecord(rec: Record<string, unknown>): Record<string, unknown> {
  return safeDeepClone(rec)
}

function canonicalizeLeaseValue(
  value: unknown,
  ancestors: WeakSet<object>,
): string | null {
  if (value === null || value === undefined) {
    return 'null'
  }
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return JSON.stringify(value)
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : null
    case 'bigint':
    case 'symbol':
    case 'function':
      return null
    case 'object': {
      if (value instanceof Date) {
        return Number.isFinite(value.getTime())
          ? JSON.stringify(value.toISOString())
          : null
      }
      if (ancestors.has(value)) {
        return null
      }
      ancestors.add(value)
      try {
        if (Array.isArray(value)) {
          const items: string[] = []
          for (const elem of value) {
            const serialized =
              elem === undefined
                ? 'null'
                : canonicalizeLeaseValue(elem, ancestors)
            if (serialized === null) return null
            items.push(serialized)
          }
          return `[${items.join(',')}]`
        }
        const rec = value as Record<string, unknown>
        const keys = Object.keys(rec).sort()
        const pairs: string[] = []
        for (const k of keys) {
          const propVal = rec[k]
          if (propVal === undefined) continue
          const serialized = canonicalizeLeaseValue(propVal, ancestors)
          if (serialized === null) return null
          pairs.push(`${JSON.stringify(k)}:${serialized}`)
        }
        return `{${pairs.join(',')}}`
      } finally {
        ancestors.delete(value)
      }
    }
    default:
      return null
  }
}

function canonicalizeLeaseTarget(value: unknown): string | null {
  return canonicalizeLeaseValue(value ?? null, new WeakSet())
}

function rewriteMovedKey(
  entryKey: Record<string, unknown> | undefined,
  fromScope: Record<string, unknown>,
  toScope: Record<string, unknown>,
  relPath: string,
): Record<string, unknown> {
  if (entryKey) {
    const updated: Record<string, unknown> = cloneRecord(entryKey)
    for (const k of Object.keys(fromScope)) {
      if (!(k in toScope)) {
        delete updated[k]
      }
    }
    for (const [k, v] of Object.entries(toScope)) {
      updated[k] = safeDeepClone(v)
    }
    return updated
  }
  const parts = relPath.split('/').filter(Boolean)
  return cloneRecord({
    ...toScope,
    ...(parts.length > 0 ? { relPath: parts } : {}),
  })
}

function ok<T>(value: T): StorageV5Result<T> {
  return { ok: true, value }
}

function fail(
  code: string,
  argument?: string,
  extra?: { holder?: string; expiresAtMs?: number; meta?: unknown },
): StorageV5Result<never> {
  return {
    ok: false,
    error: {
      code,
      ...(argument !== undefined ? { argument } : {}),
      ...(extra?.holder !== undefined ? { holder: extra.holder } : {}),
      ...(extra?.expiresAtMs !== undefined
        ? { expiresAtMs: extra.expiresAtMs }
        : {}),
      ...(extra?.meta !== undefined ? { meta: extra.meta } : {}),
    },
  }
}

function isUnderDir(filePath: string, dirPath: string): boolean {
  const normDir = normalizeVirtualPath(dirPath)
  const normFile = normalizeVirtualPath(filePath)
  if (normDir === '/') return normFile.startsWith('/')
  return normFile.startsWith(`${normDir}/`)
}

function createMemoryHostFiles(): LocalHostFiles {
  const unsupported = <T>(): Promise<HostFilesResult<T>> =>
    Promise.resolve({ ok: false, error: { code: 'Unsupported' } })

  return {
    serves: () => false,
    serving: () => 'absent',
    readText: async () => ({ ok: true, value: { found: false } }),
    readBytes: async () => ({ ok: true, value: { found: false } }),
    write: () => unsupported(),
    listFolder: async () => ({ ok: true, value: { found: false } }),
    ensureFolder: () => unsupported(),
    readLink: async () => ({ ok: true, value: { found: false } }),
    access: async () => ({
      ok: true,
      value: { accessible: false, code: 'ENOENT' },
    }),
    rename: () => unsupported(),
    delete: () => unsupported(),
    realPath: async () => ({ ok: true, value: { found: false } }),
    stat: async () => ({ ok: true, value: { kind: 'absent' } }),
  }
}

function extractReadReq(req: StorageV5ReadReq): {
  kind: 'whole' | 'range' | 'tail'
  key: unknown
  offset?: number
  length?: number
  tail?: number
} {
  const rec = asRecord(req)
  if (rec && 'key' in rec) {
    if (typeof rec.tail === 'number') {
      return { kind: 'tail', key: rec.key, tail: rec.tail }
    }
    if (typeof rec.offset === 'number') {
      return {
        kind: 'range',
        key: rec.key,
        offset: rec.offset,
        length: typeof rec.length === 'number' ? rec.length : undefined,
      }
    }
    return { kind: 'whole', key: rec.key }
  }
  return { kind: 'whole', key: req }
}

function sliceBytes(
  bytes: Uint8Array,
  req: {
    kind: 'whole' | 'range' | 'tail'
    offset?: number
    length?: number
    tail?: number
  },
): Uint8Array {
  if (req.kind === 'tail') {
    const tail = Math.max(0, req.tail ?? 0)
    const start = Math.max(0, bytes.byteLength - tail)
    return bytes.slice(start)
  }
  if (req.kind === 'range') {
    const offset = Math.max(0, req.offset ?? 0)
    if (offset >= bytes.byteLength) return new Uint8Array(0)
    const end =
      req.length === undefined
        ? bytes.byteLength
        : Math.min(bytes.byteLength, offset + Math.max(0, req.length))
    return bytes.slice(offset, end)
  }
  return bytes.slice()
}

function joinRecordLines(records: readonly MemoryRecordEntry[]): Uint8Array {
  const active = records.filter(r => !r.tombstoned)
  if (active.length === 0) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (const rec of active) {
    chunks.push(rec.data)
    total += rec.data.byteLength
    if (rec.data.byteLength === 0 || rec.data[rec.data.byteLength - 1] !== 10) {
      chunks.push(new Uint8Array([10]))
      total += 1
    }
  }
  const out = new Uint8Array(total)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.byteLength
  }
  return out
}

function parseLinesIntoRecords(bytes: Uint8Array): MemoryRecordEntry[] {
  if (bytes.byteLength === 0) return []
  const text = TEXT_DECODER.decode(bytes)
  const lines = text.split('\n').filter(line => line.length > 0)
  return lines.map((line, index) => ({
    seq: index + 1,
    endSeq: index + 1,
    recordId: `line-${index + 1}`,
    data: TEXT_ENCODER.encode(line),
    tombstoned: false,
  }))
}

/**
 * Create an isolated, zero-disk in-memory `StorageV5` backend.
 */
export function createMemoryStorageV5Backend(
  options: CreateMemoryStorageV5BackendOptions = {},
): MemoryStorageV5 {
  const configHome = normalizeVirtualPath(options.configHome ?? '/mem-claude')
  const globalConfigFile = normalizeVirtualPath(
    options.globalConfigFile ?? `${configHome}/.claude.json`,
  )
  const roots: StorageV5['roots'] = {
    configHome,
    globalConfigFile,
    ...(options.bridgeSpawnRoot !== undefined
      ? { bridgeSpawnRoot: normalizeVirtualPath(options.bridgeSpawnRoot) }
      : {}),
  }
  const clock = options.clock ?? (() => Date.now())
  const instanceId = `mem-v5-${randomUUID()}`

  const files = new Map<string, MemoryFileEntry>()
  const scopes = new Set<string>([configHome])
  const streams = new Map<string, MemoryRecordEntry[]>()
  const leases = new Map<string, MemoryLeaseEntry>()
  const subscriptions = new Map<string, MemorySubscription>()
  let versionCounter = 0
  let closed = false

  function recordAncestors(filePath: string): void {
    let dir = normalizeVirtualPath(dirname(filePath))
    while (dir && dir !== '.' && !scopes.has(dir)) {
      scopes.add(dir)
      const parent = normalizeVirtualPath(dirname(dir))
      if (parent === dir) break
      dir = parent
    }
  }

  function resolveKeyPath(key: unknown): string | null {
    const rec = asRecord(key)
    if (!rec || typeof rec.namespace !== 'string') return null
    if (validateStorageKey(rec) !== undefined) return null
    const resolved = resolveKeyFilesystemPath(roots, rec)
    if (resolved !== null) {
      return normalizeVirtualPath(resolved)
    }
    return null
  }

  function resolveScopeDirs(scope: unknown): string[] | null {
    const rec = asRecord(scope)
    if (!rec || typeof rec.namespace !== 'string') return null
    if (validateStorageScope(rec) !== undefined) return null
    const pages = resolveScopeListDirectories(roots, rec)
    if (pages.length === 0) return null
    const dirs = pages.map(page => normalizeVirtualPath(page.directory))
    if (
      dirs.some(
        dir =>
          dir === '/' || dir === configHome || !isUnderDir(dir, configHome),
      )
    ) {
      return null
    }
    return dirs
  }

  function matchesLeaseScope(scope: unknown, target: unknown): boolean {
    if (scope === undefined || scope === null) return true
    const scopeDirs = resolveScopeDirs(scope)
    if (scopeDirs) {
      const targetPath = resolveKeyPath(target)
      if (targetPath !== null) {
        return scopeDirs.some(
          dir => targetPath === dir || isUnderDir(targetPath, dir),
        )
      }
      const targetDirs = resolveScopeDirs(target)
      if (targetDirs) {
        return targetDirs.some(td =>
          scopeDirs.some(dir => td === dir || isUnderDir(td, dir)),
        )
      }
      return false
    }
    const scopeKeyPath = resolveKeyPath(scope)
    if (scopeKeyPath !== null) {
      const targetPath = resolveKeyPath(target)
      return (
        targetPath !== null &&
        (targetPath === scopeKeyPath || isUnderDir(targetPath, scopeKeyPath))
      )
    }
    const scopeRec = asRecord(scope)
    const targetRec = asRecord(target)
    if (scopeRec && targetRec) {
      for (const [k, v] of Object.entries(scopeRec)) {
        if (v === undefined) continue
        if (
          canonicalizeLeaseTarget(targetRec[k]) !== canonicalizeLeaseTarget(v)
        ) {
          return false
        }
      }
      return true
    }
    return canonicalizeLeaseTarget(target) === canonicalizeLeaseTarget(scope)
  }

  function checkClosed(): StorageV5Result<never> | undefined {
    return closed ? fail('Closed') : undefined
  }

  function notifyChange(
    type: string,
    affectedPath: string,
    version?: string,
  ): void {
    const norm = normalizeVirtualPath(affectedPath)
    for (const sub of subscriptions.values()) {
      const matched =
        sub.filter.target === 'key'
          ? sub.filter.path === norm
          : sub.filter.dirs.some(dir => dir === norm || isUnderDir(norm, dir))
      if (matched) {
        try {
          sub.listener({ type, path: norm, ...(version ? { version } : {}) })
        } catch {
          // Listener errors must never break storage mutations
        }
      }
    }
  }

  function checkPrecondition(
    existing: MemoryFileEntry | undefined,
    precondition?: { type?: string; version?: string },
  ): StorageV5Result<never> | undefined {
    if (precondition === undefined) return undefined
    switch (precondition.type) {
      case 'none':
        return undefined
      case 'ifAbsent':
      case 'ifNotExists':
      case 'absent':
        if (existing !== undefined) return fail('PreconditionFailed')
        return undefined
      case 'exists':
      case 'ifExists':
        if (existing === undefined) return fail('PreconditionFailed')
        return undefined
      case 'ifMatch':
      case 'version':
        if (
          existing === undefined ||
          precondition.version === undefined ||
          existing.version !== precondition.version
        ) {
          return fail('PreconditionFailed')
        }
        return undefined
      default:
        return fail('InvalidArgument', 'opts.precondition')
    }
  }

  function putFile(
    path: string,
    bytes: Uint8Array,
    opts?: { mode?: number; key?: Record<string, unknown> },
  ): MemoryFileEntry {
    const now = clock()
    const existing = files.get(path)
    versionCounter += 1
    const entry: MemoryFileEntry = {
      bytes: new Uint8Array(bytes),
      version: computeVersion(bytes, versionCounter),
      mtimeMs: now,
      createdMs: existing?.createdMs ?? now,
      mode: opts?.mode ?? existing?.mode ?? 0o600,
      key: opts?.key ? cloneRecord(opts.key) : existing?.key,
    }
    files.set(path, entry)
    recordAncestors(path)
    return entry
  }

  // Seed initial files if supplied
  if (options.initialFiles) {
    for (const [rawPath, content] of Object.entries(options.initialFiles)) {
      const targetPath = rawPath.startsWith('/')
        ? normalizeVirtualPath(rawPath)
        : normalizeVirtualPath(`${configHome}/${rawPath}`)
      putFile(targetPath, toBytes(content))
    }
  }

  function getOrInitStream(path: string): MemoryRecordEntry[] {
    let list = streams.get(path)
    if (!list) {
      const existing = files.get(path)
      list = existing ? parseLinesIntoRecords(existing.bytes) : []
      streams.set(path, list)
    }
    return list
  }

  function buildScopeEntryKey(
    scope: Record<string, unknown>,
    filePath: string,
    dir: string,
  ): Record<string, unknown> {
    const existing = files.get(filePath)?.key
    if (existing) return cloneRecord(existing)
    const rel = posix.relative(dir, filePath)
    const parts = rel.split('/').filter(Boolean)
    return cloneRecord({
      ...scope,
      ...(parts.length > 0 ? { relPath: parts } : {}),
    })
  }

  const hostFiles = createMemoryHostFiles()

  const backend: MemoryStorageV5 = {
    roots,
    instanceId,
    clock,
    nativeWatch: false,
    hostFiles,

    async scopeKind(
      scope: Record<string, unknown>,
    ): Promise<StorageV5Result<StorageV5ScopeKind>> {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const dirs = resolveScopeDirs(scope)
      if (!dirs) return fail('InvalidArgument', 'scope')
      const exists = dirs.some(
        dir =>
          scopes.has(dir) ||
          Array.from(files.keys()).some(p => isUnderDir(p, dir)),
      )
      return ok({ kind: exists ? 'directory' : 'absent' })
    },

    async stat(
      key: unknown,
    ): Promise<StorageV5Result<{ size: number; mtimeMs: number }>> {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      const entry = files.get(path)
      if (!entry) return fail('NotFound')
      return ok({ size: entry.bytes.byteLength, mtimeMs: entry.mtimeMs })
    },

    async statMeta(
      key: unknown,
    ): Promise<
      StorageV5Result<{ size: number; mtimeMs?: number; createdMs?: number }>
    > {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      const entry = files.get(path)
      if (!entry) return fail('NotFound')
      return ok({
        size: entry.bytes.byteLength,
        mtimeMs: entry.mtimeMs,
        createdMs: entry.createdMs,
      })
    },

    async read(
      reqs: StorageV5ReadReq[],
      _opts?: StorageV5ReadOpts,
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
      void _opts
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const items: Array<{
        found: boolean
        totalBytes: number
        value?: Uint8Array
        version?: string
        mtimeMs?: number
      }> = []
      for (let i = 0; i < reqs.length; i++) {
        const parsed = extractReadReq(reqs[i]!)
        const path = resolveKeyPath(parsed.key)
        if (!path) return fail('InvalidArgument', `entries[${i}].key`)
        const entry = files.get(path)
        if (!entry) {
          items.push({ found: false, totalBytes: 0 })
        } else {
          items.push({
            found: true,
            totalBytes: entry.bytes.byteLength,
            value: sliceBytes(entry.bytes, parsed),
            version: entry.version,
            mtimeMs: entry.mtimeMs,
          })
        }
      }
      return ok({ items })
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
                version: item.version,
                mtimeMs: item.mtimeMs,
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
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      const existing = files.get(path)
      const preErr = checkPrecondition(existing, opts?.precondition)
      if (preErr) return preErr
      const entry = putFile(path, toBytes(value), {
        mode: opts?.mode,
        key: asRecord(key) ?? undefined,
      })
      streams.delete(path)
      notifyChange('write', path, entry.version)
      return ok({ version: entry.version })
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
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      const existing = files.get(path)
      if (opts?.precondition !== undefined) {
        const preErr = checkPrecondition(existing, opts.precondition)
        if (preErr) return preErr
        if (
          opts.precondition.nonEmpty &&
          (!existing || existing.bytes.byteLength === 0)
        ) {
          return fail('PreconditionFailed')
        }
      }
      const list = getOrInitStream(path)
      let nextSeq = list.length > 0 ? list[list.length - 1]!.endSeq + 1 : 1
      const acks: Array<{ seq: number; endSeq: number; recordId: string }> = []
      for (const rec of records) {
        const recordId = rec.recordId ?? randomUUID()
        const seq = nextSeq
        nextSeq += 1
        list.push({
          seq,
          endSeq: seq,
          recordId,
          data: toBytes(rec.data),
          tombstoned: false,
        })
        acks.push({ seq, endSeq: seq, recordId })
      }
      const joined = joinRecordLines(list)
      const entry = putFile(path, joined, { key: asRecord(key) ?? undefined })
      notifyChange('append', path, entry.version)
      return ok({ acks })
    },

    async delete(key: unknown): Promise<StorageV5Result<{ existed: boolean }>> {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      const existed = files.delete(path)
      streams.delete(path)
      if (existed) {
        notifyChange('delete', path)
      }
      return ok({ existed })
    },

    async acquireLease(
      target: unknown,
      ttlMs: number,
      opts?: { holder?: string; meta?: unknown },
    ): Promise<StorageV5Result<StorageV5LeaseHandle>> {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
        return fail('InvalidArgument', 'ttlMs')
      }
      const targetKey = canonicalizeLeaseTarget(target)
      if (targetKey === null) {
        return fail('InvalidArgument', 'target')
      }
      const now = clock()
      const holder = opts?.holder ?? randomUUID()
      const existing = leases.get(targetKey)
      if (
        existing &&
        existing.expiresAtMs > now &&
        existing.holder !== holder
      ) {
        return fail('AlreadyHeld', undefined, {
          holder: existing.holder,
          expiresAtMs: existing.expiresAtMs,
          ...(existing.meta !== undefined
            ? { meta: safeDeepClone(existing.meta) }
            : {}),
        })
      }
      const entry: MemoryLeaseEntry = {
        targetKey,
        target: safeDeepClone(target),
        holder,
        expiresAtMs: now + ttlMs,
        ...(opts?.meta !== undefined ? { meta: safeDeepClone(opts.meta) } : {}),
      }
      leases.set(targetKey, entry)
      const handle: StorageV5LeaseHandle = {
        get expiresAtMs() {
          return entry.expiresAtMs
        },
        holder,
        async renew(nextTtlMs: number) {
          const renewClosedErr = checkClosed()
          if (renewClosedErr) return renewClosedErr
          if (!Number.isFinite(nextTtlMs) || nextTtlMs <= 0) {
            return fail('InvalidArgument', 'ttlMs')
          }
          const cur = leases.get(targetKey)
          if (!cur) return fail('NotFound')
          const nowRenew = clock()
          if (
            cur !== entry ||
            cur.holder !== holder ||
            cur.expiresAtMs <= nowRenew
          ) {
            if (cur === entry && cur.expiresAtMs <= nowRenew) {
              leases.delete(targetKey)
            }
            return fail('PreconditionFailed')
          }
          cur.expiresAtMs = nowRenew + nextTtlMs
          return ok({ expiresAtMs: cur.expiresAtMs })
        },
        async release() {
          const releaseClosedErr = checkClosed()
          if (releaseClosedErr) return releaseClosedErr
          const cur = leases.get(targetKey)
          if (cur === entry && cur.holder === holder) {
            leases.delete(targetKey)
          }
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
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const now = clock()
      const items: Array<{
        target: unknown
        holder: string
        expiresAtMs: number
      }> = []
      for (const [key, lease] of leases.entries()) {
        if (lease.expiresAtMs <= now) {
          leases.delete(key)
          continue
        }
        if (!matchesLeaseScope(scope, lease.target)) {
          continue
        }
        items.push({
          target: safeDeepClone(lease.target),
          holder: lease.holder,
          expiresAtMs: lease.expiresAtMs,
        })
      }
      return ok({ items })
    },

    async subscribe(
      filter:
        | { target: 'key'; key: unknown }
        | { target: 'scope'; scope: unknown },
      listener: (event: unknown) => void,
    ): Promise<
      StorageV5Result<{ unsubscribe: () => void; observationLagMs: number }>
    > {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const id = randomUUID()
      if (filter.target === 'key') {
        const path = resolveKeyPath(filter.key)
        if (!path) return fail('InvalidArgument', 'filter.key')
        subscriptions.set(id, {
          id,
          filter: { target: 'key', path },
          listener,
        })
      } else {
        const dirs = resolveScopeDirs(filter.scope)
        if (!dirs) return fail('InvalidArgument', 'filter.scope')
        subscriptions.set(id, {
          id,
          filter: { target: 'scope', dirs },
          listener,
        })
      }
      return ok({
        unsubscribe: () => {
          subscriptions.delete(id)
        },
        observationLagMs: 0,
      })
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
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      if (!files.has(path) && !streams.has(path)) {
        return ok({ items: [] })
      }
      const list = getOrInitStream(path)
      const isBackward = opts?.order === 'backward'
      let filtered = list.filter(rec => {
        if (opts?.fromSeq !== undefined) {
          return isBackward ? rec.seq <= opts.fromSeq : rec.seq >= opts.fromSeq
        }
        return true
      })
      if (isBackward) {
        filtered = [...filtered].reverse()
      }
      const items: StorageV5RecordItem[] = []
      let usedBytes = 0
      let stoppedEarly = false
      for (const rec of filtered) {
        if (opts?.limit !== undefined && items.length >= opts.limit) {
          stoppedEarly = true
          break
        }
        let data = rec.data.slice()
        let truncated = false
        if (
          opts?.maxBytesPerRecord !== undefined &&
          data.byteLength > opts.maxBytesPerRecord
        ) {
          data = data.slice(0, opts.maxBytesPerRecord)
          truncated = true
        }
        if (
          opts?.maxBytes !== undefined &&
          items.length > 0 &&
          usedBytes + data.byteLength > opts.maxBytes
        ) {
          stoppedEarly = true
          break
        }
        usedBytes += data.byteLength
        items.push({
          seq: rec.seq,
          endSeq: rec.endSeq,
          recordId: rec.recordId,
          data,
          byteLength: rec.data.byteLength,
          ...(truncated ? { truncated: true } : {}),
          ...(rec.tombstoned ? { tombstoned: true } : {}),
        })
      }
      let nextSeq: number | undefined
      if (isBackward) {
        if (stoppedEarly && items.length > 0) {
          const oldestReturnedSeq = items[items.length - 1]!.seq
          nextSeq = oldestReturnedSeq > 1 ? oldestReturnedSeq - 1 : undefined
        } else {
          nextSeq = undefined
        }
      } else if (stoppedEarly && items.length > 0) {
        const lastReturned = items[items.length - 1]!
        nextSeq = (lastReturned.endSeq ?? lastReturned.seq) + 1
      } else if (stoppedEarly && items.length === 0) {
        nextSeq = filtered.length > 0 ? filtered[0]!.seq : (opts?.fromSeq ?? 1)
      } else {
        nextSeq = list.length > 0 ? list[list.length - 1]!.endSeq + 1 : 1
      }
      return ok({
        items,
        ...(nextSeq !== undefined ? { nextSeq } : {}),
      })
    },

    async listEntries(
      scope: unknown,
    ): Promise<
      StorageV5Result<{ items: StorageV5ListEntry[]; cursor?: unknown }>
    > {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const scopeRec = asRecord(scope)
      if (!scopeRec) return fail('InvalidArgument', 'scope')
      const dirs = resolveScopeDirs(scopeRec)
      if (!dirs) return fail('InvalidArgument', 'scope')

      const items: StorageV5ListEntry[] = []
      const seenScopes = new Set<string>()
      const seenKeys = new Set<string>()

      for (const dir of dirs) {
        for (const [filePath, entry] of files.entries()) {
          if (!isUnderDir(filePath, dir)) continue
          const rel = posix.relative(dir, filePath)
          const slashIdx = rel.indexOf('/')
          if (slashIdx === -1) {
            if (!seenKeys.has(filePath)) {
              seenKeys.add(filePath)
              items.push({
                kind: 'key',
                key: buildScopeEntryKey(scopeRec, filePath, dir),
                size: entry.bytes.byteLength,
                mtimeMs: entry.mtimeMs,
              })
            }
          } else {
            const childDirName = rel.slice(0, slashIdx)
            const childDirPath = `${dir}/${childDirName}`
            if (!seenScopes.has(childDirPath)) {
              seenScopes.add(childDirPath)
              items.push({
                kind: 'scope',
                scope: cloneRecord({ ...scopeRec, child: childDirName }),
              })
            }
          }
        }
        for (const scopeDir of scopes) {
          if (!isUnderDir(scopeDir, dir)) continue
          const rel = posix.relative(dir, scopeDir)
          if (!rel.includes('/') && !seenScopes.has(scopeDir)) {
            seenScopes.add(scopeDir)
            items.push({
              kind: 'scope',
              scope: cloneRecord({ ...scopeRec, child: rel }),
            })
          }
        }
      }
      return ok({ items })
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
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const scopeRec = asRecord(scope)
      if (!scopeRec) return fail('InvalidArgument', 'scope')
      const dirs = resolveScopeDirs(scopeRec)
      if (!dirs) return fail('InvalidArgument', 'scope')

      const items: StorageV5ListEntry[] = []
      const seenPaths = new Set<string>()
      const cap = opts?.limit ?? opts?.maxLeaves
      for (const dir of dirs) {
        if (cap !== undefined && items.length >= cap) break
        const matching = Array.from(files.entries())
          .filter(([filePath]) => isUnderDir(filePath, dir))
          .sort(([a], [b]) => a.localeCompare(b))
        for (const [filePath, entry] of matching) {
          if (seenPaths.has(filePath)) continue
          seenPaths.add(filePath)
          if (cap !== undefined && items.length >= cap) break
          items.push({
            kind: 'key',
            key: buildScopeEntryKey(scopeRec, filePath, dir),
            ...(opts?.skipKeyStats
              ? {}
              : { size: entry.bytes.byteLength, mtimeMs: entry.mtimeMs }),
          })
        }
      }
      return ok({ items })
    },

    async resolveKey(
      key: unknown,
      opts: ResolveKeyOpts,
    ): Promise<StorageV5Result<ResolveKeyHit>> {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      const withinDirs = resolveScopeDirs(opts?.within)
      if (!withinDirs) return fail('InvalidArgument', 'opts.within')
      if (withinDirs.some(dir => path === dir || isUnderDir(path, dir))) {
        return ok({ kind: 'inPlace' })
      }
      return ok({ kind: 'escapes', reason: 'outside_scope' })
    },

    async resolveKeys(
      keys: unknown,
      opts: ResolveKeyOpts,
    ): Promise<
      StorageV5Result<{ items: Array<StorageV5Result<ResolveKeyHit>> }>
    > {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      if (!Array.isArray(keys)) return fail('InvalidArgument', 'keys')
      const items = await Promise.all(
        keys.map(key => backend.resolveKey(key, opts)),
      )
      return ok({ items })
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
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const fromPath = resolveKeyPath(from)
      const toPath = resolveKeyPath(to)
      if (!fromPath) return fail('InvalidArgument', 'from')
      if (!toPath) return fail('InvalidArgument', 'to')
      const src = files.get(fromPath)
      if (!src) return fail('NotFound')
      const preErr = checkPrecondition(files.get(toPath), opts?.precondition)
      if (preErr) return preErr
      const entry = putFile(toPath, src.bytes, {
        mode: opts?.exactMode ?? opts?.mode ?? src.mode,
        key: asRecord(to) ?? undefined,
      })
      if (fromPath !== toPath) {
        streams.delete(toPath)
      }
      notifyChange('write', toPath, entry.version)
      return ok({ version: entry.version, bytes: entry.bytes.byteLength })
    },

    async move(
      from: unknown,
      to: unknown,
      opts?: {
        parent?: string
        precondition?: { type?: string; version?: string }
      },
    ): Promise<StorageV5Result<{ version?: string; bytes: number }>> {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const fromPath = resolveKeyPath(from)
      const toPath = resolveKeyPath(to)
      if (!fromPath) return fail('InvalidArgument', 'from')
      if (!toPath) return fail('InvalidArgument', 'to')
      const src = files.get(fromPath)
      if (!src) return fail('NotFound')
      if (fromPath === toPath) {
        const preErr = checkPrecondition(src, opts?.precondition)
        if (preErr) return preErr
        return ok({ version: src.version, bytes: src.bytes.byteLength })
      }
      const preErr = checkPrecondition(files.get(toPath), opts?.precondition)
      if (preErr) return preErr
      const entry = putFile(toPath, src.bytes, {
        mode: src.mode,
        key: asRecord(to) ?? undefined,
      })
      const oldStream = streams.get(fromPath)
      if (oldStream) {
        streams.set(toPath, oldStream)
        streams.delete(fromPath)
      } else {
        streams.delete(toPath)
      }
      files.delete(fromPath)
      notifyChange('write', toPath, entry.version)
      notifyChange('delete', fromPath)
      return ok({ version: entry.version, bytes: entry.bytes.byteLength })
    },

    async moveScope(
      from: unknown,
      to: unknown,
      opts?: { replace?: boolean },
    ): Promise<StorageV5Result<{ moved: boolean }>> {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const fromScopeRec = asRecord(from)
      const toScopeRec = asRecord(to)
      const fromDirs = resolveScopeDirs(from)
      const toDirs = resolveScopeDirs(to)
      if (
        !fromDirs ||
        !toDirs ||
        fromDirs.length === 0 ||
        toDirs.length === 0
      ) {
        return fail('InvalidArgument', 'scope')
      }
      const srcDir = fromDirs[0]!
      const dstDir = toDirs[0]!
      if (isUnderDir(srcDir, dstDir) || isUnderDir(dstDir, srcDir)) {
        return fail('InvalidArgument', 'to')
      }
      const srcFiles = Array.from(files.entries()).filter(([p]) =>
        isUnderDir(p, srcDir),
      )
      if (srcFiles.length === 0 && !scopes.has(srcDir)) {
        return ok({ moved: false })
      }
      if (srcDir === dstDir) {
        return ok({ moved: true })
      }
      const dstFiles = Array.from(files.keys()).filter(p =>
        isUnderDir(p, dstDir),
      )
      const dstExists = scopes.has(dstDir) || dstFiles.length > 0
      if (dstExists && !opts?.replace) {
        return fail('AlreadyExists')
      }
      if (opts?.replace) {
        for (const p of dstFiles) {
          files.delete(p)
          streams.delete(p)
          notifyChange('delete', p)
        }
        for (const s of Array.from(scopes)) {
          if (s === dstDir || isUnderDir(s, dstDir)) {
            scopes.delete(s)
          }
        }
      }
      for (const [oldPath, entry] of srcFiles) {
        const rel = posix.relative(srcDir, oldPath)
        const nextPath = normalizeVirtualPath(`${dstDir}/${rel}`)
        const nextKey = rewriteMovedKey(
          entry.key,
          fromScopeRec ?? {},
          toScopeRec ?? {},
          rel,
        )
        files.set(nextPath, { ...entry, key: nextKey })
        files.delete(oldPath)
        const oldStream = streams.get(oldPath)
        if (oldStream) {
          streams.set(nextPath, oldStream)
          streams.delete(oldPath)
        } else {
          streams.delete(nextPath)
        }
        recordAncestors(nextPath)
        notifyChange('write', nextPath, entry.version)
        notifyChange('delete', oldPath)
      }
      for (const s of Array.from(scopes)) {
        if (isUnderDir(s, srcDir)) {
          const relSub = posix.relative(srcDir, s)
          scopes.delete(s)
          scopes.add(normalizeVirtualPath(`${dstDir}/${relSub}`))
        }
      }
      scopes.delete(srcDir)
      scopes.add(dstDir)
      return ok({ moved: true })
    },

    stagingScopeBeside(scope: unknown): Record<string, unknown> {
      return stagingScopeBesidePf(scope)
    },

    stagingScopeWithin(scope: unknown): Record<string, unknown> {
      return stagingScopeWithinLf(scope)
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
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      if (!Array.isArray(entries)) return fail('InvalidArgument', 'entries')
      if (
        opts?.keepBefore !== undefined &&
        (!Number.isSafeInteger(opts.keepBefore) || opts.keepBefore < 0)
      ) {
        return fail('InvalidArgument', 'opts.keepBefore')
      }
      if (
        opts?.preserveFrom !== undefined &&
        (!Number.isSafeInteger(opts.preserveFrom) || opts.preserveFrom < 0)
      ) {
        return fail('InvalidArgument', 'opts.preserveFrom')
      }
      if (
        opts?.keepBefore !== undefined &&
        opts?.preserveFrom !== undefined &&
        opts.preserveFrom < opts.keepBefore
      ) {
        return fail('InvalidArgument', 'opts.preserveFrom')
      }
      const preErr = checkPrecondition(files.get(path), opts?.precondition)
      if (preErr) return preErr
      const existingStream =
        opts?.keepBefore !== undefined || opts?.preserveFrom !== undefined
          ? getOrInitStream(path)
          : []
      const prefix =
        opts?.keepBefore !== undefined
          ? existingStream
              .filter(rec => rec.seq < opts.keepBefore!)
              .map(rec => ({ ...rec, data: rec.data.slice() }))
          : []
      const suffix =
        opts?.preserveFrom !== undefined
          ? existingStream
              .filter(rec => rec.seq >= opts.preserveFrom!)
              .map(rec => ({ ...rec, data: rec.data.slice() }))
          : []
      const middle: MemoryRecordEntry[] = entries.map(item => {
        const rec = asRecord(item)
        const rawData =
          rec && 'data' in rec
            ? (rec.data as string | Uint8Array)
            : typeof item === 'string' || item instanceof Uint8Array
              ? item
              : JSON.stringify(item)
        const recordId =
          rec && typeof rec.recordId === 'string' ? rec.recordId : randomUUID()
        return {
          seq: 0,
          endSeq: 0,
          recordId,
          data: toBytes(rawData),
          tombstoned: false,
        }
      })
      const nextRecords: MemoryRecordEntry[] = [
        ...prefix,
        ...middle,
        ...suffix,
      ].map((rec, idx) => ({
        ...rec,
        seq: idx + 1,
        endSeq: idx + 1,
      }))
      streams.set(path, nextRecords)
      const joined = joinRecordLines(nextRecords)
      const entry = putFile(path, joined, { key: asRecord(key) ?? undefined })
      notifyChange('write', path, entry.version)
      return ok({ bytes: joined.byteLength })
    },

    async writeFromFile(
      key: unknown,
      sourcePath: unknown,
      opts?: {
        parent?: string
        precondition?: { type?: string; version?: string }
      },
    ): Promise<StorageV5Result<{ bytes: number; version?: string }>> {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const destPath = resolveKeyPath(key)
      if (!destPath) return fail('InvalidArgument', 'key')
      if (typeof sourcePath !== 'string') return fail('InvalidArgument', 'path')
      const src = files.get(normalizeVirtualPath(sourcePath))
      if (!src) return fail('Unsupported')
      const preErr = checkPrecondition(files.get(destPath), opts?.precondition)
      if (preErr) return preErr
      const entry = putFile(destPath, src.bytes, {
        key: asRecord(key) ?? undefined,
      })
      streams.delete(destPath)
      notifyChange('write', destPath, entry.version)
      return ok({ bytes: entry.bytes.byteLength, version: entry.version })
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
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      if (
        opts === null ||
        typeof opts !== 'object' ||
        typeof opts.maxBytes !== 'number' ||
        !Number.isFinite(opts.maxBytes) ||
        opts.maxBytes < 0
      ) {
        return fail('InvalidArgument', 'opts.maxBytes')
      }
      if (
        body === null ||
        typeof body !== 'object' ||
        typeof body[Symbol.asyncIterator] !== 'function'
      ) {
        return fail('InvalidArgument', 'body')
      }
      const preErr = checkPrecondition(files.get(path), opts.precondition)
      if (preErr) return preErr
      const chunks: Uint8Array[] = []
      let total = 0
      try {
        for await (const chunk of body) {
          const bytes =
            chunk instanceof Uint8Array
              ? chunk
              : typeof chunk === 'string'
                ? TEXT_ENCODER.encode(chunk)
                : null
          if (!bytes) return fail('InvalidArgument', 'body')
          total += bytes.byteLength
          if (total > opts.maxBytes) return fail('TooLarge')
          chunks.push(bytes)
        }
      } catch {
        return fail('IoError')
      }
      const closedAfterErr = checkClosed()
      if (closedAfterErr) return closedAfterErr
      const preAfterErr = checkPrecondition(files.get(path), opts.precondition)
      if (preAfterErr) return preAfterErr
      const out = new Uint8Array(total)
      let pos = 0
      for (const c of chunks) {
        out.set(c, pos)
        pos += c.byteLength
      }
      const entry = putFile(path, out, {
        mode: opts.mode,
        key: asRecord(key) ?? undefined,
      })
      streams.delete(path)
      notifyChange('write', path, entry.version)
      return ok({ bytes: out.byteLength, version: entry.version })
    },

    async close(): Promise<StorageV5Result<void>> {
      closed = true
      subscriptions.clear()
      return ok(undefined)
    },

    async touch(key: unknown): Promise<StorageV5Result<{ mtimeMs: number }>> {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      const existing = files.get(path)
      if (!existing) {
        return fail('NotFound')
      }
      existing.mtimeMs = clock()
      notifyChange('touch', path, existing.version)
      return ok({ mtimeMs: existing.mtimeMs })
    },

    async setMode(
      key: unknown,
      mode: number,
    ): Promise<StorageV5Result<{ applied: boolean; mode?: number }>> {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      const existing = files.get(path)
      if (!existing) return fail('NotFound')
      existing.mode = mode
      return ok({ applied: true, mode })
    },

    async digest(
      key: unknown,
      opts?: { maxBytes?: number; algorithm?: string },
    ): Promise<
      StorageV5Result<{ digest: string; totalBytes: number; mtimeMs: number }>
    > {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      const entry = files.get(path)
      if (!entry) return fail('NotFound')
      if (
        opts?.maxBytes !== undefined &&
        entry.bytes.byteLength > opts.maxBytes
      ) {
        return fail('TooLarge')
      }
      const algo = opts?.algorithm ?? 'sha256'
      let digest: string
      try {
        digest = createHash(algo).update(entry.bytes).digest('hex')
      } catch {
        return fail('InvalidArgument', 'opts.algorithm')
      }
      return ok({
        digest,
        totalBytes: entry.bytes.byteLength,
        mtimeMs: entry.mtimeMs,
      })
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
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      const existing = files.get(path)
      const preErr = checkPrecondition(existing, opts?.precondition)
      if (preErr) return preErr
      const found = existing !== undefined
      let decision: unknown
      try {
        decision = edit(
          existing
            ? {
                value: existing.bytes.slice(),
                version: existing.version,
                mtimeMs: existing.mtimeMs,
              }
            : undefined,
        )
      } catch {
        return fail('Failed', 'edit')
      }
      if (
        decision === null ||
        typeof decision !== 'object' ||
        Array.isArray(decision)
      ) {
        return fail('Failed', 'edit')
      }
      const decisionRec = decision as Record<string, unknown>
      if ('then' in decisionRec && typeof decisionRec.then === 'function') {
        Promise.resolve(decisionRec).catch(() => {})
        return fail('Failed', 'edit')
      }
      const hasWrite = 'write' in decisionRec
      const hasSkip = 'skip' in decisionRec
      if (hasWrite === hasSkip) {
        return fail('InvalidArgument', 'edit')
      }
      if (hasSkip) {
        if (decisionRec.skip !== true) {
          return fail('InvalidArgument', 'edit')
        }
        return ok({ written: false, found, version: existing?.version })
      }
      if (
        typeof decisionRec.write !== 'string' &&
        !(decisionRec.write instanceof Uint8Array)
      ) {
        return fail('InvalidArgument', 'edit')
      }
      const entry = putFile(path, toBytes(decisionRec.write), {
        key: asRecord(key) ?? undefined,
      })
      streams.delete(path)
      notifyChange('write', path, entry.version)
      return ok({ written: true, found, version: entry.version })
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
      return backend.update(
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
    ): Promise<StorageV5Result<{ created: boolean }>> {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const dirs = resolveScopeDirs(scope)
      if (!dirs) return fail('InvalidArgument', 'scope')
      let created = false
      for (const dir of dirs) {
        if (!scopes.has(dir)) {
          scopes.add(dir)
          recordAncestors(`${dir}/.keep`)
          created = true
        }
      }
      return ok({ created })
    },

    async deleteScope(
      scope: unknown,
      opts?: { olderThanMs?: number },
    ): Promise<
      StorageV5Result<{ deleted: number; skipped?: number; failed?: number }>
    > {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const rec = asRecord(scope)
      if (!rec) return fail('InvalidArgument', 'scope')
      if (DELETE_SCOPE_FENCED_SY.has(String(rec.namespace))) {
        return fail('InvalidArgument', 'scope')
      }
      if (
        rec.namespace === 'bridgeSpawn' &&
        rec.dir === undefined &&
        opts?.olderThanMs === undefined
      ) {
        return fail('InvalidArgument', 'scope.dir')
      }
      if (rec.namespace === 'pluginCache' && rec.version === undefined) {
        return fail('InvalidArgument', 'scope.version')
      }
      const dirs = resolveScopeDirs(scope)
      if (!dirs) return fail('InvalidArgument', 'scope')
      const cutoff =
        opts?.olderThanMs !== undefined ? clock() - opts.olderThanMs : undefined
      let deleted = 0
      let skipped = 0
      const seenPaths = new Set<string>()
      for (const dir of dirs) {
        for (const [filePath, entry] of Array.from(files.entries())) {
          if (!isUnderDir(filePath, dir) || seenPaths.has(filePath)) continue
          seenPaths.add(filePath)
          if (cutoff !== undefined && entry.mtimeMs >= cutoff) {
            skipped += 1
            continue
          }
          files.delete(filePath)
          streams.delete(filePath)
          deleted += 1
          notifyChange('delete', filePath)
        }
        if (cutoff === undefined) {
          for (const scopeDir of Array.from(scopes)) {
            if (scopeDir === dir || isUnderDir(scopeDir, dir)) {
              scopes.delete(scopeDir)
            }
          }
        }
      }
      return ok({
        deleted,
        ...(skipped > 0 ? { skipped } : {}),
      })
    },

    async tombstone(
      key: unknown,
      recordIds: string[],
    ): Promise<StorageV5Result<{ matched: boolean[]; newly: string[] }>> {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      const list = getOrInitStream(path)
      const matched: boolean[] = []
      const newly: string[] = []
      for (const id of recordIds) {
        const rec = list.find(r => r.recordId === id)
        if (!rec) {
          matched.push(false)
          continue
        }
        matched.push(true)
        if (!rec.tombstoned) {
          rec.tombstoned = true
          newly.push(id)
        }
      }
      return ok({ matched, newly })
    },

    async applyTombstones(
      key: unknown,
    ): Promise<StorageV5Result<{ purged: number }>> {
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      const list = getOrInitStream(path)
      const before = list.length
      const kept = list.filter(r => !r.tombstoned)
      const purged = before - kept.length
      if (purged > 0) {
        streams.set(path, kept)
        const joined = joinRecordLines(kept)
        const entry = putFile(path, joined, { key: asRecord(key) ?? undefined })
        notifyChange('write', path, entry.version)
      }
      return ok({ purged })
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
      const closedErr = checkClosed()
      if (closedErr) return closedErr
      const path = resolveKeyPath(key)
      if (!path) return fail('InvalidArgument', 'key')
      const entry = files.get(path)
      if (!entry && !streams.has(path)) {
        return ok({ headSeq: null, recordCount: 0, size: 0 })
      }
      const list = getOrInitStream(path)
      const active = list.filter(r => !r.tombstoned)
      return ok({
        headSeq: active.length > 0 ? active[active.length - 1]!.endSeq : null,
        recordCount: active.length,
        version: entry?.version,
        size: entry?.bytes.byteLength ?? 0,
        tornTailBytes: 0,
      })
    },

    async readValue(
      key: unknown,
    ): Promise<
      | { bytes: Uint8Array; version: string; size: number; mtimeMs: number }
      | undefined
    > {
      if (closed) return undefined
      const path = resolveKeyPath(key)
      if (!path) return undefined
      const entry = files.get(path)
      if (!entry) return undefined
      return {
        bytes: entry.bytes.slice(),
        version: entry.version,
        size: entry.bytes.byteLength,
        mtimeMs: entry.mtimeMs,
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

    snapshot(): Record<string, string> {
      const out: Record<string, string> = {}
      for (const [path, entry] of files.entries()) {
        out[path] = TEXT_DECODER.decode(entry.bytes)
      }
      return out
    },

    clear(): void {
      files.clear()
      scopes.clear()
      scopes.add(configHome)
      streams.clear()
      leases.clear()
    },
  }

  return backend
}
