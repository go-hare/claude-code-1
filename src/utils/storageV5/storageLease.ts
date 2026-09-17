/**
 * densable 2.1.246 #16 lease graph.
 *
 *   Lt @207258507   leasesDir
 *   rs @207258557 / A9c / Vn   leasePath
 *   W / J           digestStringifyCanonKey + digestSha256Hex
 *   vd @207312251   acquire
 *   bd              renew
 *   hd              release
 *   Sd              list
 *   Co @207313829 / wd @207314179   read+parse
 *   Rd @207314828   write via leftover Ur
 *   Sb @207544990 / wb / Rb   hb wrappers
 *   Vn @207273400   path-prefix Di
 */

import { randomUUID } from 'crypto'
import { readFile, readdir, stat, unlink } from 'fs/promises'
import { join, sep } from 'path'
import { logForDebugging } from '../debug.js'
import { isENOENT } from '../errors.js'
import type {
  StorageV5LeaseHandle,
  StorageV5Result,
} from './createLocalFsBackend.js'
import {
  atomicWriteStagedRename,
  digestSha256Hex,
  digestStringifyCanonKey,
} from './digestLog.js'
import { withStorageLock } from './storageLock.js'
import { validateBridgeSpawnRoot, validateStorageKey } from './writeValidate.js'

const PE = 'storage-v2'

export type StorageLeaseRoots = {
  configHome: string
  globalConfigFile: string
  bridgeSpawnRoot?: string
}

export type StorageLeaseRecord = {
  holder: string
  token: string
  expiresAtMs: number
  target: unknown
  meta?: unknown
}

type LeaseParse =
  | { kind: 'record'; record: StorageLeaseRecord }
  | { kind: 'corrupt' }
  | { kind: 'unreadable'; lapsed: boolean }

type LeaseSnapshot = { bytes: Uint8Array }

function ok<T>(value: T): StorageV5Result<T> {
  return { ok: true, value }
}

function err(
  code: string,
  extra?: Record<string, unknown>,
): StorageV5Result<never> {
  return { ok: false, error: { code, ...extra } }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  return value as Record<string, unknown>
}

/** densable leftover `Lt` @207258507. */
export function leasesDir(roots: StorageLeaseRoots): string {
  return join(roots.configHome, PE, 'leases')
}

/** densable leftover `W` — canon stringify, else JSON. */
export function leaseWireKey(target: unknown): string | undefined {
  const rec = asRecord(target)
  if (!rec) return
  if ('lease' in rec) {
    return typeof rec.lease === 'string' ? `lease:${rec.lease}` : undefined
  }
  return digestStringifyCanonKey(rec) ?? JSON.stringify(rec)
}

/** densable leftover `rs` / `A9c` / `Vn` @207258557. */
export function leasePath(roots: StorageLeaseRoots, target: unknown): string {
  const wire = leaseWireKey(target) ?? ''
  return join(leasesDir(roots), `${digestSha256Hex(wire)}.json`)
}

/** densable leftover `Ed`. */
export function leaseHolderName(holder: string | undefined): string {
  return holder !== undefined && holder.trim() !== ''
    ? holder
    : `anonymous:${randomUUID()}`
}

/** densable leftover `To`. */
function invalidTtl(ttlMs: number): StorageV5Result<never> | undefined {
  if (Number.isInteger(ttlMs) && ttlMs > 0) return
  return err('InvalidArgument', { argument: 'ttlMs' })
}

/** densable leftover `Ld`. */
function invalidMeta(meta: unknown): StorageV5Result<never> | undefined {
  if (meta === undefined) return
  try {
    if (JSON.stringify(meta) === undefined) {
      return err('InvalidArgument', { argument: 'meta' })
    }
  } catch {
    return err('InvalidArgument', { argument: 'meta' })
  }
}

function isNonEmptySegment(value: unknown): boolean {
  return (
    typeof value === 'string' && value.trim() !== '' && !/[\\/]/.test(value)
  )
}

/** densable leftover `Pd`. */
function invalidTarget(
  roots: StorageLeaseRoots,
  target: unknown,
): StorageV5Result<never> | undefined {
  const rec = asRecord(target)
  if (!rec) return err('InvalidArgument', { argument: 'target' })
  if ('lease' in rec) {
    return isNonEmptySegment(rec.lease)
      ? undefined
      : err('InvalidArgument', { argument: 'target.lease' })
  }
  const z = validateStorageKey(rec)
  if (z !== undefined) return err(z.code, { argument: z.argument })
  const re = validateBridgeSpawnRoot(roots, rec)
  if (re !== undefined) return err(re.code, { argument: re.argument })
}

/** densable leftover `Do`. */
export function normalizeLeaseTarget(target: unknown): unknown {
  const rec = asRecord(target)
  if (rec && 'lease' in rec) return { namespace: 'state', id: rec.lease }
  return target
}

/** densable leftover `Vn` @207273400 — path prefix. */
export function isPathPrefix(parent: string, child: string): boolean {
  return (
    child === parent ||
    child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`)
  )
}

/** densable leftover `Di` (`ls` as N9c). */
export function leaseTargetInScope(
  resolvePath: (key: unknown) => string | null,
  scope: unknown,
  target: unknown,
): boolean {
  const scopePath = resolvePath(scope)
  const targetPath = resolvePath(target)
  if (!scopePath || !targetPath) return false
  return isPathPrefix(scopePath, targetPath)
}

function stripToken(
  record: StorageLeaseRecord,
): Omit<StorageLeaseRecord, 'token'> {
  const { token: _token, ...rest } = record
  return rest
}

/** densable leftover `wd` @207314179. */
export function parseLeaseRecord(
  raw: string,
  expectedTarget: unknown,
  now: number | undefined,
): LeaseParse {
  if (raw.trim() === '') return { kind: 'corrupt' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'corrupt' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'corrupt' }
  }
  const rec = parsed as Record<string, unknown>
  const holder = rec.holder
  const token = rec.token
  const expiresAtMs = rec.expiresAtMs
  if (typeof holder !== 'string' || holder.length < 1) {
    const f = rec.expiresAtMs
    return {
      kind: 'unreadable',
      lapsed:
        now !== undefined &&
        typeof f === 'number' &&
        Number.isFinite(f) &&
        f <= now,
    }
  }
  if (typeof token !== 'string' || token.length < 1) {
    const f = rec.expiresAtMs
    return {
      kind: 'unreadable',
      lapsed:
        now !== undefined &&
        typeof f === 'number' &&
        Number.isFinite(f) &&
        f <= now,
    }
  }
  if (typeof expiresAtMs !== 'number' || !Number.isFinite(expiresAtMs)) {
    return { kind: 'corrupt' }
  }
  const storedTarget = rec.target
  const target = expectedTarget ?? storedTarget
  if (target === undefined) {
    return {
      kind: 'unreadable',
      lapsed: now !== undefined && expiresAtMs <= now,
    }
  }
  return {
    kind: 'record',
    record: {
      holder,
      token,
      expiresAtMs,
      target,
      ...(rec.meta !== undefined && { meta: rec.meta }),
    },
  }
}

/** densable leftover `Co` @207313829. */
async function readLeaseCo(
  path: string,
  target: unknown,
  now: number | undefined,
): Promise<
  StorageV5Result<
    { record?: StorageLeaseRecord; snapshot?: LeaseSnapshot } | undefined
  >
> {
  try {
    const bytes = new Uint8Array(await readFile(path))
    const parsed = parseLeaseRecord(
      new TextDecoder('utf8').decode(bytes),
      target,
      now,
    )
    if (parsed.kind === 'unreadable' && !parsed.lapsed && now !== undefined) {
      return err('Failed')
    }
    return ok({
      record: parsed.kind === 'record' ? parsed.record : undefined,
      snapshot: { bytes },
    })
  } catch (error) {
    if (isENOENT(error)) return ok(undefined)
    return err('Failed')
  }
}

/** densable leftover `Fd` + byte `Ne`. */
async function leaseSnapshotMatches(
  path: string,
  snapshot: LeaseSnapshot | undefined,
): Promise<boolean> {
  try {
    await stat(path)
    if (snapshot === undefined) return false
    const cur = await readFile(path)
    return Buffer.from(cur).equals(Buffer.from(snapshot.bytes))
  } catch (error) {
    if (isENOENT(error)) return snapshot === undefined
    return false
  }
}

/** densable leftover `Rd` @207314828 via leftover `Ur`. */
async function writeLeaseRd(
  path: string,
  record: StorageLeaseRecord,
  snapshot: LeaseSnapshot | undefined,
  suspect: () => boolean,
): Promise<StorageV5Result<void>> {
  if (suspect() || !(await leaseSnapshotMatches(path, snapshot))) {
    return err('Failed')
  }
  const written = await atomicWriteStagedRename(
    path,
    Buffer.from(JSON.stringify(record)),
    undefined,
    true,
  )
  return written.ok ? ok(undefined) : err(written.error.code)
}

function lockPolicy(): {
  ifReentrant: () => StorageV5Result<never>
  ifContended: (error: {
    kind?: string
    code?: string
  }) => StorageV5Result<never>
} {
  return {
    ifReentrant: () => err('Failed'),
    ifContended: () => err('Failed'),
  }
}

/** densable leftover `vd` @207312251. */
async function acquireLeaseVd(
  roots: StorageLeaseRoots,
  target: unknown,
  ttlMs: number,
  holder: string,
  meta: unknown,
  now: () => number,
): Promise<
  StorageV5Result<
    | { kind: 'acquired'; record: StorageLeaseRecord }
    | { kind: 'held'; record: Omit<StorageLeaseRecord, 'token'> }
  >
> {
  const path = leasePath(roots, target)
  return withStorageLock<
    | { kind: 'acquired'; record: StorageLeaseRecord }
    | { kind: 'held'; record: Omit<StorageLeaseRecord, 'token'> }
  >(
    path,
    async ctx => {
      const t = now()
      const d = await readLeaseCo(path, target, t)
      if (!d.ok) return d
      const c = d.value?.record
      if (c !== undefined && c.expiresAtMs > t && c.holder !== holder) {
        return ok({ kind: 'held' as const, record: stripToken(c) })
      }
      const token =
        c !== undefined && c.holder === holder && c.expiresAtMs > t
          ? c.token
          : undefined
      const record: StorageLeaseRecord = {
        holder,
        token: token ?? randomUUID(),
        expiresAtMs: t + ttlMs,
        target,
        ...(meta !== undefined && { meta }),
      }
      const g = await writeLeaseRd(path, record, d.value?.snapshot, ctx.suspect)
      if (!g.ok) return g
      return ok({ kind: 'acquired' as const, record })
    },
    lockPolicy(),
  )
}

/** densable leftover `bd`. */
async function renewLeaseBd(
  roots: StorageLeaseRoots,
  target: unknown,
  token: string,
  ttlMs: number,
  now: () => number,
): Promise<
  StorageV5Result<
    | { kind: 'renewed'; expiresAtMs: number }
    | { kind: 'lost'; record?: Omit<StorageLeaseRecord, 'token'> }
  >
> {
  const path = leasePath(roots, target)
  return withStorageLock<
    | { kind: 'renewed'; expiresAtMs: number }
    | { kind: 'lost'; record?: Omit<StorageLeaseRecord, 'token'> }
  >(
    path,
    async ctx => {
      const s = now()
      const l = await readLeaseCo(path, target, s)
      if (!l.ok) return l
      const d = l.value?.record
      if (d === undefined || d.token !== token || d.expiresAtMs <= s) {
        return ok({
          kind: 'lost' as const,
          record: d === undefined ? undefined : stripToken(d),
        })
      }
      const c = { ...d, expiresAtMs: s + ttlMs }
      const f = await writeLeaseRd(path, c, l.value?.snapshot, ctx.suspect)
      if (!f.ok) return f
      return ok({ kind: 'renewed' as const, expiresAtMs: c.expiresAtMs })
    },
    lockPolicy(),
  )
}

/** densable leftover `hd`. */
async function releaseLeaseHd(
  roots: StorageLeaseRoots,
  target: unknown,
  token: string,
): Promise<StorageV5Result<void>> {
  const path = leasePath(roots, target)
  return withStorageLock(
    path,
    async ctx => {
      const o = await readLeaseCo(path, target, undefined)
      if (!o.ok) return o
      if (o.value?.record?.token !== token) return ok(undefined)
      if (
        ctx.suspect() ||
        !(await leaseSnapshotMatches(path, o.value.snapshot))
      ) {
        return err('Failed')
      }
      try {
        await unlink(path)
        return ok(undefined)
      } catch (error) {
        if (isENOENT(error)) return ok(undefined)
        return err('Failed')
      }
    },
    lockPolicy(),
  )
}

/** densable leftover `Sd`. */
async function listLeasesSd(
  roots: StorageLeaseRoots,
  now: () => number,
): Promise<StorageV5Result<Array<Omit<StorageLeaseRecord, 'token'>>>> {
  const dir = leasesDir(roots)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if (isENOENT(error)) return ok([])
    return err('Failed')
  }
  const i = now()
  const items: Array<Omit<StorageLeaseRecord, 'token'>> = []
  for (const name of names.filter(s => s.endsWith('.json'))) {
    try {
      const bytes = await readFile(join(dir, name))
      const l = parseLeaseRecord(
        new TextDecoder('utf8').decode(bytes),
        undefined,
        i,
      )
      if (l.kind !== 'record') {
        logForDebugging(
          `storage: lease record ${name} is ${l.kind} and is left out of the listing`,
        )
        continue
      }
      if (l.record.expiresAtMs > i) items.push(stripToken(l.record))
    } catch {}
  }
  return ok(items)
}

/** densable leftover `wb`. */
function makeLeaseHandleWb(
  roots: StorageLeaseRoots,
  target: unknown,
  holder: string,
  token: string,
  expiresAtMs: number,
  now: () => number,
  isClosed: () => boolean,
): StorageV5LeaseHandle {
  let s = expiresAtMs
  const refuse = (): StorageV5Result<never> => err('Unavailable')
  return {
    get expiresAtMs() {
      return s
    },
    holder,
    async renew(ttlMs) {
      if (isClosed()) return refuse()
      const c = invalidTtl(ttlMs)
      if (c !== undefined) return c
      const f = await renewLeaseBd(roots, target, token, ttlMs, now)
      if (!f.ok) return f
      if (f.value.kind === 'lost') {
        const p = f.value.record
        return err('NotHeld', {
          ...(p !== undefined && {
            holder: p.holder,
            expiresAtMs: p.expiresAtMs,
          }),
        })
      }
      s = f.value.expiresAtMs
      return ok({ expiresAtMs: s })
    },
    async release() {
      if (isClosed()) return refuse()
      const d = await releaseLeaseHd(roots, target, token)
      return d.ok ? ok(undefined) : d
    },
  }
}

export type StorageLeaseApi = {
  acquireLease: (
    target: unknown,
    ttlMs: number,
    opts?: { holder?: string; meta?: unknown },
  ) => Promise<StorageV5Result<StorageV5LeaseHandle>>
  listLeases: (scope: unknown) => Promise<
    StorageV5Result<{
      items: Array<{
        target: unknown
        holder: string
        expiresAtMs: number
      }>
    }>
  >
}

export function createLeaseApi(opts: {
  roots: StorageLeaseRoots
  clock: () => number
  isClosed: () => boolean
  resolvePath: (key: unknown) => string | null
}): StorageLeaseApi {
  const { roots, clock, isClosed, resolvePath } = opts
  const refuse = (): StorageV5Result<never> => err('Unavailable')

  return {
    /** densable leftover `Sb` @207544990. */
    async acquireLease(target, ttlMs, acquireOpts) {
      if (isClosed()) return refuse()
      const i =
        invalidTarget(roots, target) ??
        invalidTtl(ttlMs) ??
        invalidMeta(acquireOpts?.meta)
      if (i !== undefined) return i
      const o = leaseHolderName(acquireOpts?.holder)
      const a = await acquireLeaseVd(
        roots,
        target,
        ttlMs,
        o,
        acquireOpts?.meta,
        clock,
      )
      if (!a.ok) return a
      if (a.value.kind === 'held') {
        const s = a.value.record
        return err('Held', {
          holder: s.holder,
          expiresAtMs: s.expiresAtMs,
          ...(s.meta !== undefined && { meta: s.meta }),
        })
      }
      return ok(
        makeLeaseHandleWb(
          roots,
          target,
          o,
          a.value.record.token,
          a.value.record.expiresAtMs,
          clock,
          isClosed,
        ),
      )
    },
    /** densable leftover `Rb` @207546050. */
    async listLeases(scope) {
      if (isClosed()) return refuse()
      const t = await listLeasesSd(roots, clock)
      if (!t.ok) return t
      const items = t.value
        .filter(
          o =>
            !(asRecord(o.target) && 'lease' in (asRecord(o.target) ?? {})) &&
            leaseTargetInScope(resolvePath, scope, o.target),
        )
        .map(o => ({
          target: o.target,
          holder: o.holder,
          expiresAtMs: o.expiresAtMs,
        }))
      return ok({ items })
    },
  }
}
