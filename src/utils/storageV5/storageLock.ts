/**
 * densable leftover `Be`/`ne` @207293555, `mt`/`he` @207295041,
 * `Ke` @207295455, `Wr` @207295080, `ut`/`Ve` @205799448.
 * In-process queue + ALS reentrant + proper-lockfile.
 *
 * 本文件用语义名，官方符号名保留在各函数的 doc 注释里作追溯锚点。
 */

import { AsyncLocalStorage } from 'async_hooks'
import { lstat, mkdir, stat } from 'fs/promises'
import { dirname, resolve } from 'path'
import { isENOENT } from '../errors.js'
import { logForDebugging } from '../debug.js'
import { getPlatform } from '../platform.js'
import * as lockfile from '../lockfile.js'
import type { StorageV5Result } from './createLocalFsBackend.js'

const DEFAULT_STALE_MS = 30000
const DEFAULT_ACQUIRE_RETRIES = 28
const MAX_ACQUIRE_TIMEOUT_MS = 600000
const BACKOFF = { factor: 1.25, minTimeout: 5, maxTimeout: 200 }
const BENIGN_RELEASE_CODES = new Set(['ERELEASED', 'ENOTACQUIRED'])

type LockFrame = { identity: string; released: boolean }

const lockFrameStore = new AsyncLocalStorage<LockFrame[]>()
const pathQueues = new Map<string, Promise<unknown>>()

function ok<T>(value: T): StorageV5Result<T> {
  return { ok: true, value }
}

function err(code: string): StorageV5Result<never> {
  return { ok: false, error: { code } }
}

export type StorageLockCtx = {
  suspect: () => boolean
}

export type StorageLockOptions = {
  lockfilePath?: string
  ifReentrant: () => StorageV5Result<unknown>
  ifContended: (error: {
    kind?: string
    code?: string
  }) => StorageV5Result<unknown>
  createParent?: boolean
  parentMode?: number
  staleMs?: number
  updateMs?: number
  acquireTimeoutMs?: number
  registryKeyedOnLockfile?: boolean
  forgoIf?: (error: { kind?: string }) => boolean
  onForgone?: (error: unknown) => void
  proceedIf?: () => Promise<boolean>
}

/** densable leftover `Wr` @207295080. */
export function computeLockRetryPolicy(e?: number): {
  retries: number
  factor: number
  minTimeout: number
  maxTimeout: number
} {
  if (e === undefined) return { retries: DEFAULT_ACQUIRE_RETRIES, ...BACKOFF }
  const r = Math.min(e, MAX_ACQUIRE_TIMEOUT_MS)
  let n = 0
  let i = 0
  for (;;) {
    const t = Math.min(
      BACKOFF.maxTimeout,
      Math.round(BACKOFF.minTimeout * BACKOFF.factor ** n),
    )
    if (i + t > r) return { retries: n, ...BACKOFF }
    if (t === BACKOFF.maxTimeout) {
      const o = Math.floor((r - i) / t)
      return { retries: n + o, ...BACKOFF }
    }
    i += t
    n += 1
  }
}

/** densable leftover `Ke` @207295455. */
export async function enterPathQueue(e: string): Promise<{
  [Symbol.asyncDispose](): Promise<void>
}> {
  const r = pathQueues.get(e) ?? Promise.resolve()
  let n = (): void => {}
  const i = new Promise<void>(o => {
    n = o
  })
  const t = r.then(() => i)
  pathQueues.set(e, t)
  await r
  return {
    async [Symbol.asyncDispose]() {
      n()
      if (pathQueues.get(e) === t) pathQueues.delete(e)
    },
  }
}

function normalizeLockError(e: { kind?: string; code?: string }): {
  kind?: string
  code?: string
} {
  return e.kind === 'fs' && e.code === 'ELOCKED' ? { kind: 'contended' } : e
}

function logLockReleaseFailure(e: unknown): void {
  const r =
    e !== null && typeof e === 'object' && 'code' in e
      ? String((e as { code?: string }).code)
      : undefined
  if (r === undefined || !BENIGN_RELEASE_CODES.has(r)) {
    logForDebugging(`storage lock release failed: ${String(e)}`, {
      level: 'warn',
    })
  }
}

/** densable leftover `ut`/`Ve` @205799448. */
export async function acquireLockfile(
  file: string,
  options: Parameters<typeof lockfile.lock>[1],
): Promise<() => Promise<void>> {
  const r = await lockfile.lock(file, options)
  return Object.assign(r, { [Symbol.asyncDispose]: r })
}

/** densable leftover `mt`/`he` @207295041. */
export async function runSerializedByPath<T>(
  e: string,
  r: () => Promise<T>,
): Promise<T> {
  await using n = await enterPathQueue(resolve(e))
  void n
  return await r()
}

/**
 * densable leftover `Be`/`ne` @207293555.
 * sl: `ne(index, fn, {lockfilePath: He, ifReentrant, ifContended})`.
 */
export async function withStorageLock<T>(
  e: string,
  r: (ctx: StorageLockCtx) => Promise<StorageV5Result<T>>,
  n: StorageLockOptions,
): Promise<StorageV5Result<T>> {
  const i = n.lockfilePath ?? e
  const t = resolve(i)
  const o = lockFrameStore.getStore() ?? []
  if (o.some(f => f.identity === t && !f.released)) {
    return n.ifReentrant() as StorageV5Result<T>
  }
  await using u = await enterPathQueue(t)
  void u
  const s = () => r({ suspect: () => false })
  const a = (f: unknown) => {
    n.onForgone?.(f)
    return s()
  }
  if (n.proceedIf !== undefined && !(await n.proceedIf())) {
    return await s()
  }
  const c = dirname(i)
  if (n.createParent !== false) {
    try {
      await mkdir(c, {
        recursive: true,
        ...(n.parentMode !== undefined && { mode: n.parentMode }),
      })
    } catch (error) {
      const fe = { kind: 'fs', code: 'Failed' }
      if (n.forgoIf?.(fe) !== true) {
        return n.ifContended(fe) as StorageV5Result<T>
      }
      return (await a(error)) as StorageV5Result<T>
    }
  } else {
    try {
      await stat(c)
    } catch (error) {
      if (isENOENT(error)) {
        const fe = { kind: 'absent', code: 'NotFound' }
        if (n.forgoIf?.(fe) !== true) {
          return n.ifContended(fe) as StorageV5Result<T>
        }
        return (await a(error)) as StorageV5Result<T>
      }
    }
  }
  let m = false
  const k = Date.now()
  const y = performance.now()
  const L = computeLockRetryPolicy(n.acquireTimeoutMs)
  const A = (f: { retries: number } | number) =>
    acquireLockfile(n.registryKeyedOnLockfile === true ? i : e, {
      realpath: false,
      stale: n.staleMs ?? DEFAULT_STALE_MS,
      retries: f,
      ...(n.lockfilePath !== undefined && { lockfilePath: n.lockfilePath }),
      ...(n.updateMs !== undefined && { update: n.updateMs }),
      onCompromised: O => {
        m = true
        logForDebugging(
          `storage lock compromised (likely a process suspend or slow filesystem): ${String(O)}`,
          { level: 'warn' },
        )
      },
    })
  let b:
    | { ok: true; value: () => Promise<void> }
    | { ok: false; error: { kind?: string; code?: string } }
  try {
    const release = await A(n.forgoIf === undefined ? L : 0)
    b = { ok: true, value: release }
  } catch (error) {
    b = {
      ok: false,
      error: normalizeLockError({
        kind: 'fs',
        code:
          error !== null &&
          typeof error === 'object' &&
          'code' in error &&
          typeof (error as { code?: string }).code === 'string'
            ? (error as { code: string }).code
            : 'ELOCKED',
      }),
    }
  }
  if (!b.ok && n.forgoIf !== undefined) {
    // densable leftover Be/ne @207294539:
    //   f = De(b.error).kind==="contended"
    //   if (!f) { O = await l(Vr(lockfile)); f = O.ok || O.error.kind!=="absent" }
    //   if (f) b = await A(L)
    // Probe is lstat, not a second acquire (acquire would steal + leak).
    let f = normalizeLockError(b.error).kind === 'contended'
    if (!f) {
      try {
        await lstat(n.lockfilePath ?? `${e}.lock`)
        f = true
      } catch (error) {
        f = !isENOENT(error)
      }
    }
    if (f) {
      try {
        b = { ok: true, value: await A(L) }
      } catch {
        /* keep fail */
      }
    }
  }
  if (!b.ok) {
    const f = normalizeLockError(b.error)
    if (n.forgoIf?.(f) !== true) {
      return n.ifContended(f) as StorageV5Result<T>
    }
    return (await a(f)) as StorageV5Result<T>
  }
  const le: LockFrame = { identity: t, released: false }
  try {
    return await lockFrameStore.run([...o, le], () =>
      r({
        suspect: () => {
          const f = Date.now() - k
          const O = performance.now() - y
          return m || Math.abs(f - O) > 1000
        },
      }),
    )
  } finally {
    le.released = true
    await b.value().catch(logLockReleaseFailure)
  }
}

export function lockOk<T>(value: T): StorageV5Result<T> {
  return ok(value)
}

export function lockErr(code: string): StorageV5Result<never> {
  return err(code)
}

/** densable leftover `tn`/`on` @207299900 — default value-publish lock timing. */
const VALUE_PUBLISH_UPDATE_MS = 4000
const VALUE_PUBLISH_STALE_MS = 10_000
/** densable leftover `an`/`un` — jobsRoot pins lock timing. */
const JOBS_ROOT_UPDATE_MS = 2000
const JOBS_ROOT_STALE_MS = 5000

type ValuePublishHost = {
  roots: { configHome: string }
  lockUnconditionalPublishes?: boolean
}

/** densable leftover `rr`/`mn` @207298800 — warn once per host. */
class ValuePublishLockWarnClaim {
  logged = false
  claim(): boolean {
    if (this.logged) return false
    this.logged = true
    return true
  }
}

const valuePublishLockWarnClaims = new WeakMap<
  object,
  ValuePublishLockWarnClaim
>()

/**
 * densable leftover `Ct`/`j` @207258332 — colocated `.lock` beside the object.
 */
export function isColocatedValueLockKey(key: Record<string, unknown>): boolean {
  switch (key.namespace) {
    case 'team':
    case 'mailbox':
      return true
    case 'globalConfig':
      return !('kind' in key)
    case 'jobsRoot':
      return 'file' in key && key.file === 'pins'
    default:
      return false
  }
}

/**
 * densable leftover `dn`/`Al` @207298500 — lock timing / parent create policy.
 */
export function valuePublishLockTiming(
  key: Record<string, unknown>,
): Pick<
  StorageLockOptions,
  'updateMs' | 'staleMs' | 'createParent' | 'registryKeyedOnLockfile'
> {
  if (!isColocatedValueLockKey(key)) {
    return { registryKeyedOnLockfile: true }
  }
  if (key.namespace === 'jobsRoot') {
    return {
      updateMs: JOBS_ROOT_UPDATE_MS,
      staleMs: JOBS_ROOT_STALE_MS,
      createParent: false,
    }
  }
  return {
    updateMs: VALUE_PUBLISH_UPDATE_MS,
    staleMs: VALUE_PUBLISH_STALE_MS,
    createParent: false,
  }
}

/**
 * densable leftover `Bt`/`vn` @207298558 — lockfilePath + reentrant/contended.
 */
export function buildSimpleValueLockOptions(
  lockfilePath: string,
): StorageLockOptions {
  return {
    lockfilePath,
    ifReentrant: () => err('Unavailable'),
    ifContended: () => err('Unavailable'),
  }
}

/**
 * densable leftover `fn`/`ur`/`C7c` @207298640.
 * Colocated + absent → NotFound (parent may be creatable); else Unavailable.
 */
export function buildValuePublishLockOptions(
  lockfilePath: string,
  key: Record<string, unknown>,
): StorageLockOptions {
  const colocated = isColocatedValueLockKey(key)
  return {
    lockfilePath,
    ...valuePublishLockTiming(key),
    ifReentrant: () => err('Unavailable'),
    ifContended: error =>
      colocated && error.kind === 'absent'
        ? err('NotFound')
        : err('Unavailable'),
  }
}

/** densable leftover `gn` @207299175 — once-per-host publish-without-lock warn. */
function warnValuePublishLockForgone(host: object, error: unknown): void {
  let claim = valuePublishLockWarnClaims.get(host)
  if (claim === undefined) {
    claim = new ValuePublishLockWarnClaim()
    valuePublishLockWarnClaims.set(host, claim)
  }
  if (!claim.claim()) return
  logForDebugging(
    `storage: the value publish lock is unavailable (${String(error)}); publishing without it, as a plain write does`,
    { level: 'warn' },
  )
}

/**
 * densable leftover `Kt`/`En`/`D7c` @207298873 — Be with forgoIf/onForgone/proceedIf.
 * `lockfilePath` is densable `Je`/`ns`/`Tt` result; `filePath` is Be's first arg.
 */
export async function withValuePublishLock<T>(
  host: ValuePublishHost,
  key: Record<string, unknown>,
  lockfilePath: string,
  filePath: string,
  run: (suspect: () => boolean) => Promise<StorageV5Result<T>>,
  extra?: Partial<StorageLockOptions>,
): Promise<StorageV5Result<T>> {
  const colocated = isColocatedValueLockKey(key)
  return withStorageLock(filePath, ctx => run(() => ctx.suspect()), {
    ...buildValuePublishLockOptions(lockfilePath, key),
    ...extra,
    ...(!colocated && {
      proceedIf: async () => {
        try {
          return (await stat(host.roots.configHome)).isDirectory()
        } catch (error) {
          return !isENOENT(error)
        }
      },
    }),
    forgoIf: error =>
      error.kind !== 'contended' && !(colocated && error.kind === 'absent'),
    onForgone: error => warnValuePublishLockForgone(host, error),
  })
}

/** densable hb default: `lockUnconditionalPublishes ?? ar()==="windows"`. */
export function defaultLockUnconditionalPublishes(): boolean {
  return getPlatform() === 'windows'
}
