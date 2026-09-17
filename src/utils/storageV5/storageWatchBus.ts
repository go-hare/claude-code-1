/**
 * densable 2.1.246 #16 subscribe bus.
 *
 *   class Au @207360606   expect / isWritingLocally / openedAtMs / listeners / emit
 *   Mu @207361294         acquire per configHome
 *   Bu                    release + closeAll
 *   class Cu @207361619   watch multiplexer
 *   Qp / Zp / Zn / fa / rg / ng / tg
 *   Ot @207296119         sole `bus.emit` caller (hb `o7c as K`)
 *   At/en @207296396      `e.bus.expect(ue(key))` write wrap (hb `p7c as Q` / `q7c as pm`)
 */

import { watch, type FSWatcher } from 'fs'
import { stat, statfs } from 'fs/promises'
import { dirname, resolve } from 'path'
import { logForDebugging } from '../debug.js'
import { isENOENT } from '../errors.js'
import { getPlatform } from '../platform.js'
import { getReadSymlinkClass, isStreamNamespaceKey } from './writeValidate.js'

/** densable leftover `Ti` @207367379. */
export const UNANNOUNCED_GRACE_MS = 250
/** densable leftover `Gp`. */
const FAILED_ARM_RETRY_MS = 30_000
/** densable leftover `Yp`. */
const ECHO_MISS_LIMIT = 2
/**
 * densable leftover `Xp` — fs types that deny watch promotion.
 * Copied from official 2.1.246 SEA @207367500.
 */
const PROMOTION_DENIED_FS_TYPES = new Set<number>([
  26985, 4283649346, 4266872130, 1702057286, 16914839, 2020557398, 64206,
  12805120, 198183888, 1196443219, 428016422, 1397113167, 1799439955,
  1952539503, 2088527475,
])

export type StorageWatchHandle = {
  rearm: (maxAgeMs?: number) => Promise<void>
  promotable: () => boolean
  distrust: (reason: string) => void
  release: () => Promise<void>
}

type WatchArm =
  | { kind: 'unarmed' }
  | { kind: 'live'; identity: string; watcher: FSWatcher }
  | { kind: 'failed'; identity: string; failedAtMs: number }
  | { kind: 'dead'; identity: string; watcher: FSWatcher }

type WatchRecord = {
  directory: string
  recursive: boolean
  listeners: Set<(filename: string | null) => void>
  healthListeners: Set<() => void>
  references: number
  arm: WatchArm
  checkedAtMs: number
  rearming: Promise<void>
  queued: { maxAgeMs: number; turn: Promise<void> } | undefined
  confirmed: boolean
  demotedForLife: boolean
  lastCallbackAtMs: number
  echoMisses: number
  lastEchoMissAtMs: number
  callbacks: number
  callbacksSinceCheck: number
  checkedShape: { mtimeMs: number; nlink: number } | undefined
}

type StatOk = {
  ok: true
  value: {
    isDirectory: () => boolean
    dev: number | bigint
    ino: number | bigint
    birthtimeMs: number
    mtimeMs: number
    nlink: number
  }
}
type StatFail = { ok: false; error: { kind: 'absent' | 'fs' } }

async function tryStat(path: string): Promise<StatOk | StatFail> {
  try {
    const info = await stat(path)
    return { ok: true, value: info }
  } catch (error) {
    return {
      ok: false,
      error: { kind: isENOENT(error) ? 'absent' : 'fs' },
    }
  }
}

function liveWatcher(arm: WatchArm): FSWatcher | undefined {
  return arm.kind === 'live' || arm.kind === 'dead' ? arm.watcher : undefined
}

function identityMatches(
  arm: WatchArm,
  identity: string | undefined,
  now: number,
): boolean {
  switch (arm.kind) {
    case 'unarmed':
      return identity === undefined
    case 'live':
      return arm.identity === identity
    case 'failed':
      return (
        arm.identity === identity && now - arm.failedAtMs < FAILED_ARM_RETRY_MS
      )
    case 'dead':
      return false
  }
}

function emitWatch(
  listeners: Set<(filename: string | null) => void>,
  filename: string | null,
): void {
  for (const listener of [...listeners]) {
    try {
      listener(filename)
    } catch (error) {
      logForDebugging(`storage watch listener threw: ${error}`, {
        level: 'warn',
      })
    }
  }
}

function emitHealth(record: WatchRecord): void {
  for (const listener of [...record.healthListeners]) {
    try {
      listener()
    } catch (error) {
      logForDebugging(`storage watch health listener threw: ${error}`, {
        level: 'warn',
      })
    }
  }
}

/**
 * densable leftover `rg` @207366436 — `setTimeout(rg, deadline, record, sinceMs)`.
 */
function rg(e: WatchRecord, r: number): void {
  setImmediate(ng, e, r)
}

/**
 * densable leftover `ng` @207366455 — echo miss / reset / demote.
 * `Yp` = `ECHO_MISS_LIMIT`.
 */
function ng(e: WatchRecord, r: number): void {
  if (e.references <= 0 || e.arm.kind !== 'live') return
  if (e.lastCallbackAtMs >= r) {
    e.echoMisses = 0
    return
  }
  if (r <= e.lastEchoMissAtMs) return
  e.lastEchoMissAtMs = performance.now()
  e.echoMisses += 1
  if (e.echoMisses >= ECHO_MISS_LIMIT && !e.demotedForLife) {
    demoteForLife(e, 'it did not report our own writes')
  }
}

/** densable leftover `fa` @207367209. */
function demoteForLife(record: WatchRecord, reason: string): void {
  record.demotedForLife = true
  logForDebugging(
    `storage watch on ${record.directory} back to polling for good: ${reason}`,
  )
  emitHealth(record)
}

function openNativeWatch(
  directory: string,
  recursive: boolean,
  onName: (filename: string | null) => void,
  onDead: (watcher: FSWatcher) => void,
  warnUnavailable: boolean,
): FSWatcher | undefined {
  try {
    const watcher = watch(
      directory,
      { persistent: false, recursive },
      (_event, filename) => {
        onName(typeof filename === 'string' ? filename : null)
      },
    )
    watcher.on('error', error => {
      logForDebugging(
        `storage watcher error at ${directory}; polling carries it: ${error}`,
        { level: 'warn' },
      )
      onDead(watcher)
      onName(null)
    })
    watcher.unref()
    return watcher
  } catch (error) {
    if (warnUnavailable) {
      logForDebugging(
        `storage watcher unavailable at ${directory}; polling carries it and the arm is retried: ${error}`,
        { level: 'warn' },
      )
    }
    return
  }
}

/** densable leftover class `Cu` @207361619. */
class StorageDirectoryWatches {
  watches = new Map<string, WatchRecord>()
  blindDirectories = new Set<string>()
  platform = getPlatform()
  promotionDenied: boolean
  unannouncedGraceMs: number

  constructor(opts: { configHome?: string; unannouncedGraceMs?: number }) {
    this.unannouncedGraceMs = opts.unannouncedGraceMs ?? UNANNOUNCED_GRACE_MS
    this.promotionDenied = opts.configHome !== undefined
    if (opts.configHome !== undefined) {
      void this.decidePromotionDenied(opts.configHome)
    }
  }

  /** densable leftover `decidePromotionDenied`. */
  async decidePromotionDenied(configHome: string): Promise<void> {
    const mount = /^\/mnt\/[^/]+(\/|$)/
    if (
      this.platform === 'wsl' &&
      (mount.test(configHome) || mount.test(resolve(configHome)))
    ) {
      return
    }
    let denied = false
    if (this.platform === 'linux' || this.platform === 'wsl') {
      for (let dir = resolve(configHome); ; dir = dirname(dir)) {
        try {
          const type = Number((await statfs(dir)).type) >>> 0
          denied = PROMOTION_DENIED_FS_TYPES.has(type)
          break
        } catch (error) {
          const code =
            typeof error === 'object' && error && 'code' in error
              ? String((error as { code: unknown }).code)
              : ''
          if (
            !(code === 'ENOENT' || code === 'ENOTDIR') ||
            dirname(dir) === dir
          ) {
            return
          }
        }
      }
    }
    this.promotionDenied = denied
    if (!denied) this.watches.forEach(emitHealth)
  }

  async watch(
    directory: string,
    recursive: boolean,
    listener: (filename: string | null) => void,
    health: () => void = () => {},
  ): Promise<StorageWatchHandle> {
    const id = `${recursive ? 'tree' : 'flat'}:${resolve(directory)}`
    const record =
      this.watches.get(id) ??
      ({
        directory: resolve(directory),
        recursive,
        listeners: new Set<(filename: string | null) => void>(),
        healthListeners: new Set<() => void>(),
        references: 0,
        arm: { kind: 'unarmed' },
        checkedAtMs: Number.NEGATIVE_INFINITY,
        rearming: Promise.resolve(),
        queued: undefined,
        confirmed: false,
        demotedForLife: this.blindDirectories.has(id),
        lastCallbackAtMs: Number.NEGATIVE_INFINITY,
        echoMisses: 0,
        lastEchoMissAtMs: Number.NEGATIVE_INFINITY,
        callbacks: 0,
        callbacksSinceCheck: 0,
        checkedShape: undefined,
      } satisfies WatchRecord)
    record.listeners.add(listener)
    record.healthListeners.add(health)
    record.references += 1
    this.watches.set(id, record)
    try {
      await this.rearm(id, record)
    } catch (error) {
      await this.unwatch(id, record, listener, health)
      throw error
    }
    let released = false
    return {
      rearm: (maxAgeMs?: number) => this.rearm(id, record, maxAgeMs),
      promotable: () => this.promotable(record),
      distrust: reason => {
        if (!record.demotedForLife) demoteForLife(record, reason)
      },
      release: async () => {
        if (!released) {
          released = true
          await this.unwatch(id, record, listener, health)
        }
      },
    }
  }

  promotable(record: WatchRecord): boolean {
    return (
      !this.promotionDenied &&
      !record.recursive &&
      !record.demotedForLife &&
      record.confirmed &&
      record.arm.kind === 'live'
    )
  }

  rearm(id: string, record: WatchRecord, maxAgeMs = 0): Promise<void> {
    if (record.queued !== undefined && record.queued.maxAgeMs <= maxAgeMs) {
      return record.queued.turn
    }
    const turn = record.rearming.then(() => {
      if (record.queued?.turn === turn) record.queued = undefined
      return this.rearmNow(id, record, maxAgeMs)
    })
    record.queued = { maxAgeMs, turn }
    record.rearming = turn.catch(() => {})
    return turn
  }

  async rearmNow(
    id: string,
    record: WatchRecord,
    maxAgeMs: number,
  ): Promise<void> {
    const now = performance.now()
    if (record.arm.kind !== 'dead' && now - record.checkedAtMs < maxAgeMs)
      return
    record.checkedAtMs = now
    if (record.arm.kind === 'live' && this.platform === 'macos') return
    const callbacks = record.callbacks
    const info = await tryStat(record.directory)
    record.checkedAtMs = performance.now()
    if (!info.ok && info.error.kind !== 'absent') return
    const identity =
      info.ok && info.value.isDirectory()
        ? `${String(info.value.dev)}:${String(info.value.ino)}:${info.value.birthtimeMs}`
        : undefined
    if (this.watches.get(id) !== record) return
    if (identityMatches(record.arm, identity, now)) {
      if (info.ok && record.arm.kind === 'live') {
        this.noteCheckedShape(record, info.value, record.callbacks - callbacks)
      }
      return
    }
    record.checkedShape = undefined
    liveWatcher(record.arm)?.close()
    record.confirmed = false
    record.echoMisses = 0
    record.arm =
      identity === undefined
        ? { kind: 'unarmed' }
        : record.arm.kind === 'dead' && record.arm.identity === identity
          ? { kind: 'failed', identity, failedAtMs: now }
          : this.armLive(record, identity, now)
    emitHealth(record)
  }

  armLive(record: WatchRecord, identity: string, now: number): WatchArm {
    const watcher = openNativeWatch(
      record.directory,
      record.recursive,
      filename => {
        if (record.arm.kind === 'live' && record.arm.watcher === watcher) {
          record.lastCallbackAtMs = performance.now()
          record.callbacks += 1
          record.callbacksSinceCheck += 1
          if (filename === record.directory) {
            record.checkedAtMs = Number.NEGATIVE_INFINITY
            if (record.confirmed) {
              record.confirmed = false
              emitHealth(record)
            }
          } else if (filename !== null && !record.confirmed) {
            record.confirmed = true
            if (this.promotable(record)) emitHealth(record)
          }
        }
        emitWatch(record.listeners, filename)
      },
      dead => {
        if (record.arm.kind === 'live' && record.arm.watcher === dead) {
          record.arm = { kind: 'dead', identity, watcher: dead }
          record.confirmed = false
          emitHealth(record)
        }
      },
      record.arm.kind !== 'failed',
    )
    return watcher === undefined
      ? { kind: 'failed', identity, failedAtMs: now }
      : { kind: 'live', identity, watcher }
  }

  noteCheckedShape(
    record: WatchRecord,
    info: { mtimeMs: number; nlink: number },
    callbacksSince: number,
  ): void {
    const prev = record.checkedShape
    const silent =
      prev !== undefined &&
      (prev.mtimeMs !== info.mtimeMs || prev.nlink !== info.nlink) &&
      record.callbacksSinceCheck === 0 &&
      record.confirmed &&
      !record.demotedForLife
    record.checkedShape = { mtimeMs: info.mtimeMs, nlink: info.nlink }
    record.callbacksSinceCheck = callbacksSince
    if (silent) {
      const announced = record.callbacks
      setTimeout(() => {
        setImmediate(() => {
          if (
            record.references > 0 &&
            record.arm.kind === 'live' &&
            record.callbacks === announced &&
            !record.demotedForLife
          ) {
            demoteForLife(
              record,
              'its directory changed without a single event',
            )
          }
        })
      }, this.unannouncedGraceMs).unref()
    }
  }

  async unwatch(
    id: string,
    record: WatchRecord,
    listener: (filename: string | null) => void,
    health: () => void,
  ): Promise<void> {
    record.listeners.delete(listener)
    record.healthListeners.delete(health)
    record.references -= 1
    if (record.references <= 0 && this.watches.get(id) === record) {
      this.watches.delete(id)
      if (record.demotedForLife) this.blindDirectories.add(id)
      liveWatcher(record.arm)?.close()
      record.arm = { kind: 'unarmed' }
    }
  }

  async closeAll(): Promise<void> {
    for (const record of this.watches.values()) {
      liveWatcher(record.arm)?.close()
      record.arm = { kind: 'unarmed' }
      record.healthListeners.clear()
    }
    this.watches.clear()
  }

  /**
   * densable leftover `Cu.expectEcho` @207363204.
   * Official: `flat:${Qr(e)}` then `setTimeout(rg, r, t, n).unref()`.
   */
  expectEcho(e: string, r: number, n: number): void {
    const t = this.watches.get(`flat:${resolve(e)}`)
    if (t !== undefined && t.arm.kind === 'live') {
      setTimeout(rg, r, t, n).unref()
    }
  }
}

type InFlight = { count: number; openedAtMs: number }

/** densable leftover class `Au` @207360606. */
export class StorageWatchBus {
  listeners = new Set<(change: unknown, sourceInstanceId: string) => void>()
  inFlight = new Map<string, InFlight>()
  watchers: StorageDirectoryWatches
  tickPhaseMs = Math.floor(Math.random() * 60_000)
  referenceCount = 0

  constructor(opts: { configHome?: string; unannouncedGraceMs?: number } = {}) {
    this.watchers = new StorageDirectoryWatches(opts)
  }

  /** densable leftover `Au.expect` @207360762. */
  expect(id: string): () => void {
    const open = this.inFlight.get(id)
    if (open === undefined) {
      this.inFlight.set(id, { count: 1, openedAtMs: performance.now() })
    } else {
      open.count += 1
    }
    return () => {
      const cur = this.inFlight.get(id)
      if (cur === undefined || cur.count <= 1) this.inFlight.delete(id)
      else cur.count -= 1
    }
  }

  isWritingLocally(id: string): boolean {
    return this.inFlight.has(id)
  }

  /** densable leftover `Au.openedAtMs` @207361047. */
  openedAtMs(id: string): number | undefined {
    return this.inFlight.get(id)?.openedAtMs
  }

  addListener(
    listener: (change: unknown, sourceInstanceId: string) => void,
  ): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * densable leftover `Au.emit` @207361178.
   * Sole official caller is leftover `Ot` @207296119 (hb `o7c as K`).
   */
  emit(change: unknown, sourceInstanceId: string): void {
    for (const listener of this.listeners) {
      try {
        listener(change, sourceInstanceId)
      } catch (error) {
        logForDebugging(`storage change listener threw: ${error}`, {
          level: 'warn',
        })
      }
    }
  }
}

const buses = new Map<string, StorageWatchBus>()

/**
 * densable leftover `At`/`en` @207296396 — hb `p7c as Q` / `q7c as pm`.
 * Official: `e.bus.expect(ue(key))` around the write, not a mutex.
 */
export async function withStorageWatchExpect<T>(
  bus: StorageWatchBus,
  ids: string[],
  run: () => Promise<T>,
): Promise<T> {
  const stops = ids.map(id => bus.expect(id))
  try {
    return await run()
  } finally {
    for (const stop of stops) stop()
  }
}

/**
 * densable leftover `Ot` host — hb store `e` for `K(e, r)`.
 * `resolvePath` = leftover `Qe`/`Ee`; `keyId` = leftover `ue`.
 */
export type StorageAnnounceHost = {
  bus: StorageWatchBus
  instanceId: string
  roots: { configHome: string }
  timing: { echoDeadlineMs: number }
  resolvePath: (
    roots: { configHome: string },
    key: Record<string, unknown>,
  ) => string | null
  keyId: (key: Record<string, unknown>) => string
}

/**
 * densable leftover `Ot` @207296119 — hb `o7c as K`.
 * Always `bus.emit`. Official comma-if is emit then expectEcho when
 * created|updated|deleted && `!qe(key)` && `Xe(key)==="refuse"`
 * (`qe`=`Nr`, `Xe`=`Lr`).
 */
export function announceStorageChange(
  e: StorageAnnounceHost,
  r: unknown,
): void {
  const change = r as { kind?: string; key?: Record<string, unknown> }
  e.bus.emit(r, e.instanceId)
  if (
    (change.kind === 'created' ||
      change.kind === 'updated' ||
      change.kind === 'deleted') &&
    change.key !== undefined &&
    !isStreamNamespaceKey(change.key) &&
    getReadSymlinkClass(change.key) === 'refuse'
  ) {
    const file = e.resolvePath(e.roots, change.key)
    if (typeof file !== 'string') return
    e.bus.watchers.expectEcho(
      dirname(file),
      e.timing.echoDeadlineMs,
      e.bus.openedAtMs(e.keyId(change.key)) ?? performance.now(),
    )
  }
}

/** densable leftover `Mu` @207361294. */
export function acquireStorageWatchBus(
  configHome: string,
  unannouncedGraceMs = UNANNOUNCED_GRACE_MS,
): StorageWatchBus {
  const resolved = resolve(configHome)
  const bus =
    buses.get(resolved) ??
    new StorageWatchBus({ configHome, unannouncedGraceMs })
  bus.referenceCount += 1
  buses.set(resolved, bus)
  return bus
}

/** densable leftover `Bu`. */
export async function releaseStorageWatchBus(
  configHome: string,
): Promise<void> {
  const resolved = resolve(configHome)
  const bus = buses.get(resolved)
  if (bus === undefined) return
  bus.referenceCount -= 1
  if (bus.referenceCount <= 0) {
    buses.delete(resolved)
    await bus.watchers.closeAll()
  }
}
