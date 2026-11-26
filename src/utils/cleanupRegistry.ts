/**
 * Official `fe` / `W` / `Et` / `mEe` / `DYe` / `Vk` / `svt` / `tde` @178613195.
 * Leftover: host-owned cleanup + preExitFlush bags via WeakOwnerCache.
 * This module stays free of gracefulShutdown to avoid circular deps.
 */

import type { SessionHost } from './sessionHost.js'
import {
  getBootstrapSession,
  getBootstrapSessionHost,
  hasActiveSessionAls,
  runWithSession,
  type Session,
} from './sessionRoot.js'

type CleanupFn = () => void | Promise<void>

/** Official register input — fn | Disposable | AsyncDisposable (it()). */
export type CleanupRegistrable =
  | CleanupFn
  | { [Symbol.dispose](): void }
  | { [Symbol.asyncDispose](): PromiseLike<void> }

/** Official W.register / Et / Vk return — unregister + [Symbol.dispose]. */
export type CleanupUnregister = (() => void) & { [Symbol.dispose](): void }

/** Official tde=2000 — cleanup drain race budget (gracefulShutdown + `_G`). */
export const CLEANUP_DRAIN_TIMEOUT_MS = 2000

function asCleanupFn(e: CleanupRegistrable): CleanupFn {
  if (typeof e === 'function') return e
  if (Symbol.asyncDispose in e) {
    return async () => {
      await e[Symbol.asyncDispose]()
    }
  }
  return () => e[Symbol.dispose]()
}

/** Official W @178612748 — leftover DrainBag (never mint class W). */
class DrainBag {
  #e = new Set<CleanupFn>()
  #t = false
  get drainStarted(): boolean {
    return this.#t
  }
  get size(): number {
    return this.#e.size
  }
  register(e: CleanupRegistrable, onChange?: () => void): CleanupUnregister {
    const t = asCleanupFn(e)
    this.#e.add(t)
    onChange?.()
    const r = (): void => {
      if (this.#e.delete(t)) {
        onChange?.()
      }
    }
    return Object.assign(r, { [Symbol.dispose]: r })
  }
  async drain(onCleared?: () => void): Promise<void> {
    this.#t = true
    const e = Array.from(this.#e)
    this.#e.clear()
    onCleared?.()
    const r = (await Promise.allSettled(e.map(async i => i()))).find(
      i => i.status === 'rejected',
    )
    if (r !== undefined) throw r.reason
  }
  async [Symbol.asyncDispose](): Promise<void> {
    await this.drain()
  }
  get sizeForTesting(): number {
    return this.#e.size
  }
}

type LiveExitOwnerEntry = {
  hostRef: WeakRef<SessionHost>
  sessionRef: WeakRef<Session> | undefined
  bags: SessionExitBags
}

/** Official fe @178613195 — leftover SessionExitBags. */
class SessionExitBags {
  cleanup = new DrainBag()
  preExitFlush = new DrainBag()
  /** Strong back-reference keeping the WeakRef entry in liveExitOwners alive while the SessionHost lives. */
  ownerEntry: LiveExitOwnerEntry | undefined
}

class WeakOwnerCache<K extends object, T> {
  #e: (key: K) => T
  #t = new WeakMap<K, T>()
  constructor(e: (key: K) => T) {
    this.#e = e
  }
  of(e: K): T {
    const t = this.#t.get(e)
    if (t !== undefined) return t
    const o = this.#e(e)
    this.#t.set(e, o)
    return o
  }
}

const liveExitOwners = new Set<WeakRef<LiveExitOwnerEntry>>()

/**
 * Strong references held ONLY while a host's cleanup or preExitFlush bag is
 * non-empty so active OS-resource cleanups (MCP child procs, cron locks, UDS
 * sockets) are never silently lost to GC if the caller drops a Session without
 * explicitly draining. Removed immediately once drained or unregistered so
 * idle/drained hosts remain 100% GC-able.
 */
const activeNonEmptyOwners = new Set<LiveExitOwnerEntry>()

function syncActiveOwnerRetention(bags: SessionExitBags): void {
  const entry = bags.ownerEntry
  if (!entry) return
  if (bags.cleanup.size > 0 || bags.preExitFlush.size > 0) {
    activeNonEmptyOwners.add(entry)
  } else {
    activeNonEmptyOwners.delete(entry)
  }
}

function pruneDeadExitOwners(): void {
  for (const ref of liveExitOwners) {
    const entry = ref.deref()
    if (
      entry === undefined ||
      (entry.hostRef.deref() === undefined && !activeNonEmptyOwners.has(entry))
    ) {
      liveExitOwners.delete(ref)
    }
  }
}

function captureRootSessionRef(
  host: SessionHost,
): WeakRef<Session> | undefined {
  try {
    const session = getBootstrapSession()
    const rootSession = session?.root ?? session
    if (rootSession && rootSession.host === host) {
      return new WeakRef(rootSession)
    }
  } catch {
    // Ignore when sessionRoot is partially mocked in unit tests
  }
  return undefined
}

function refreshExitOwnerSessionRef(bags: SessionExitBags): void {
  const entry = bags.ownerEntry
  if (!entry) return
  try {
    const session = getBootstrapSession()
    const rootSession = session?.root ?? session
    const ownerHost = entry.hostRef.deref()
    if (rootSession && (!ownerHost || rootSession.host === ownerHost)) {
      if (entry.sessionRef?.deref() !== rootSession) {
        entry.sessionRef = new WeakRef(rootSession)
      }
    }
  } catch {
    // Ignore when sessionRoot is partially mocked in unit tests
  }
}

/** Official ot = new K(() => new fe); L() = ot.of(z().host) */
const sessionExitOwners = new WeakOwnerCache<SessionHost, SessionExitBags>(
  host => {
    const bags = new SessionExitBags()
    const entry: LiveExitOwnerEntry = {
      hostRef: new WeakRef(host),
      sessionRef: captureRootSessionRef(host),
      bags,
    }
    bags.ownerEntry = entry
    if (liveExitOwners.size > 64) {
      pruneDeadExitOwners()
    }
    liveExitOwners.add(new WeakRef(entry))
    return bags
  },
)

function sessionExitBags(): SessionExitBags {
  return sessionExitOwners.of(getBootstrapSessionHost())
}

function collectLiveExitOwners(): LiveExitOwnerEntry[] {
  const currentBags = sessionExitBags()
  const owners: LiveExitOwnerEntry[] = []
  const seen = new Set<SessionExitBags>()
  // Always drain owners that still have active non-empty cleanups, even if
  // their owning Session/SessionHost was dropped before shutdown.
  for (const entry of activeNonEmptyOwners) {
    if (!seen.has(entry.bags)) {
      seen.add(entry.bags)
      owners.push(entry)
    }
  }
  for (const ref of liveExitOwners) {
    const entry = ref.deref()
    if (
      entry === undefined ||
      (entry.hostRef.deref() === undefined && !activeNonEmptyOwners.has(entry))
    ) {
      liveExitOwners.delete(ref)
      continue
    }
    if (!seen.has(entry.bags)) {
      seen.add(entry.bags)
      owners.push(entry)
    }
  }
  if (!seen.has(currentBags) && currentBags.ownerEntry !== undefined) {
    owners.push(currentBags.ownerEntry)
  }
  return owners
}

async function drainOwnerBag(
  entry: LiveExitOwnerEntry,
  selectBag: (bags: SessionExitBags) => DrainBag,
): Promise<void> {
  const bag = selectBag(entry.bags)
  const onCleared = () => syncActiveOwnerRetention(entry.bags)
  const targetSession = entry.sessionRef?.deref()
  if (!targetSession) {
    // Owning Session was GC'd or unavailable — run directly outside ALS
    // without pretending it belongs to defaultBootstrapSession.
    await bag.drain(onCleared)
    return
  }
  let alreadyCurrent = false
  try {
    alreadyCurrent = getBootstrapSession().root === targetSession
  } catch {
    // Fall through to runWithSession
  }
  if (alreadyCurrent) {
    await bag.drain(onCleared)
    return
  }
  await runWithSession(targetSession, () => bag.drain(onCleared))
}

/**
 * Official Et — register a cleanup function for graceful shutdown / relaunch mEe.
 * @returns Unregister function (also [Symbol.dispose]) that removes the handler
 */
export function registerCleanup(
  cleanupFn: CleanupRegistrable,
): CleanupUnregister {
  const bags = sessionExitBags()
  refreshExitOwnerSessionRef(bags)
  return bags.cleanup.register(cleanupFn, () => syncActiveOwnerRetention(bags))
}

/**
 * Official mEe — drain cleanup bag. Used by gracefulShutdown + leftover `_G`.
 * Inside an active ALS host, drains ONLY that host's cleanup bag (supporting
 * per-session teardown). Outside ALS (process shutdown), drains ALL live hosts'
 * cleanup bags inside each host's root session context so isolated hosts never
 * orphan child processes, cron locks, or watchers.
 */
export async function runCleanupFunctions(): Promise<void> {
  if (hasActiveSessionAls()) {
    const bags = sessionExitBags()
    await bags.cleanup.drain(() => syncActiveOwnerRetention(bags))
    return
  }
  const owners = collectLiveExitOwners()
  const results = await Promise.allSettled(
    owners.map(entry => drainOwnerBag(entry, bags => bags.cleanup)),
  )
  const rejected = results.find(r => r.status === 'rejected')
  if (rejected !== undefined) {
    throw rejected.reason
  }
}

/** Official DYe — whether cleanup drain has started. */
export function cleanupDrainStarted(): boolean {
  return sessionExitBags().cleanup.drainStarted
}

/** Official DYe alias (storage-watch / Ma / kD gates). */
export const isCleanupDrainStarted = cleanupDrainStarted

/**
 * Official Vk — register a pre-exit flush for leftover `_G` g()/svt.
 * @returns Unregister function (also [Symbol.dispose])
 */
export function registerPreExitFlush(
  flushFn: CleanupRegistrable,
): CleanupUnregister {
  const bags = sessionExitBags()
  refreshExitOwnerSessionRef(bags)
  return bags.preExitFlush.register(flushFn, () =>
    syncActiveOwnerRetention(bags),
  )
}

/**
 * Official svt — drain preExitFlush bag (g() "pre-exit flush timeout (relaunch)").
 */
export async function runPreExitFlush(): Promise<void> {
  if (hasActiveSessionAls()) {
    const bags = sessionExitBags()
    await bags.preExitFlush.drain(() => syncActiveOwnerRetention(bags))
    return
  }
  const owners = collectLiveExitOwners()
  const results = await Promise.allSettled(
    owners.map(entry => drainOwnerBag(entry, bags => bags.preExitFlush)),
  )
  const rejected = results.find(r => r.status === 'rejected')
  if (rejected !== undefined) {
    throw rejected.reason
  }
}
