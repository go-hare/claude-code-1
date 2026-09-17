/**
 * densable 2.1.246 #16 subscribe.
 *
 *   Fb @207546305 / Eb / Lb
 *   class Lt @207367705
 *   zu @207385459 / Hu @207385615 / Nu
 *   Et / Qn / pa / yg / kg / hg / ca
 *   wt / au / Oi.subscribe
 *   Ob @207547246 → or?Ou : Ot
 *   Ou @207359054 / Ii @207349789 / cn @207344553
 *   xi @207336252 / du @207336147 / Gr=4194304 / kp=2
 *   opensGap / deliverBehindGap / deliverMissedBefore / ya / Du / vg
 *
 * Host map: z=validateStorageKey, ke=qa, re/Oe=bt/Wa,
 * I=Ve, V=Ee, pe=W, or, Ar=Yn, Un=es, J=Kr, $e=Vn, Di.
 */

import { lstat } from 'fs/promises'
import { basename, dirname } from 'path'
import { logForDebugging } from '../debug.js'
import {
  digestResolveStreamPath,
  digestStringifyCanonKey,
} from './digestLog.js'
import { resolveScopeListDirectories } from './listEntriesZa.js'
import { isPathPrefix, leaseTargetInScope } from './storageLease.js'
import type { StorageWatchBus, StorageWatchHandle } from './storageWatchBus.js'
import { releaseStorageWatchBus } from './storageWatchBus.js'
import {
  getStreamSubscribeMode,
  getSymlinkPolicy,
  isFramedStreamKey,
  validateBridgeSpawnRoot,
  validateStorageKey,
  validateStorageScope,
} from './writeValidate.js'

export type StorageSubscribeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; argument?: string } }

export type StorageSubscribeFilter =
  | { target: 'key'; key: unknown }
  | { target: 'scope'; scope: unknown }

export type SubscriptionTiming = {
  backstopMs: number
  longBackstopMs: number
  echoDeadlineMs: number
  unannouncedGraceMs: number
  strayProbeDebounceMs: number
}

/** densable leftover `Wu` @207386649. */
export const DEFAULT_SUBSCRIPTION_TIMING: SubscriptionTiming = {
  backstopMs: 2000,
  longBackstopMs: 10_000,
  echoDeadlineMs: 2000,
  unannouncedGraceMs: 250,
  strayProbeDebounceMs: 200,
}

/** densable leftover `Tu`. Official also compares `'withRediff'`. */
const TICK_MODE: 'fixed2s' | 'withRediff' = 'fixed2s'
/** densable leftover `gg`. */
const KEY_BACKSTOP_MS: Record<string, number> = { globalConfig: 1000 }
/** densable leftover `qu` / `lg` / `cg`. */
const LOOK_FAILED_START_MS = 2000
const LOOK_FAILED_CAP_MS = 300_000
const LOOK_FAILED_REPORT_AFTER = 3

type ValueState =
  | { present: false }
  | { present: true; hash: string; size: number; mtimeMs: number }

type StreamStamp = {
  generation: string | number
  size: number
  mtimeMs: number
}

type StreamState = {
  exists: boolean
  generation: string | number
  lastSeq: number | null
  records: Map<number, string>
  tombstoned: Set<string>
  delivered?: Map<number, string>
  deliveredEnd?: number
  byteEnd?: number
  stamp?: StreamStamp
}

const EMPTY_STREAM: StreamState = {
  exists: false,
  generation: -1,
  lastSeq: null,
  records: new Map(),
  tombstoned: new Set(),
}

type Tracked =
  | {
      key: Record<string, unknown>
      kind: 'value'
      state: ValueState
      revision: number
    }
  | {
      key: Record<string, unknown>
      kind: 'stream'
      state: StreamState
      revision: number
    }

type Change =
  | {
      kind: 'created'
      key: Record<string, unknown>
      version?: string
      records?: Array<[number, string]>
      end?: number
    }
  | {
      kind: 'updated'
      key: Record<string, unknown>
      version?: string
      value?: Uint8Array
    }
  | { kind: 'deleted'; key: Record<string, unknown> }
  | {
      kind: 'appended'
      key: Record<string, unknown>
      seq: number
      recordId: string
      end?: number
    }
  | { kind: 'tombstoned'; key: Record<string, unknown>; recordId: string }

export type SubscribeBackend = {
  roots: {
    configHome: string
    globalConfigFile: string
    bridgeSpawnRoot?: string
  }
  instanceId: string
  nativeWatch: boolean
  timing: SubscriptionTiming
  bus: StorageWatchBus
  clockNow: () => number
  resolvePath: (key: unknown) => string | null
  readValue: (
    key: unknown,
  ) => Promise<
    | { bytes: Uint8Array; version: string; size: number; mtimeMs: number }
    | undefined
  >
  streamEntries: (key: unknown, stamp?: StreamStamp) => Promise<unknown>
  scopeKeys: (
    scope: unknown,
  ) => Promise<StorageSubscribeResult<Array<Record<string, unknown>>>>
}

export type SubscribeStore = {
  closed: boolean
  roots: SubscribeBackend['roots']
  subscriptions: Set<StorageSubscription>
  unlisten: () => void
}

function ok<T>(value: T): StorageSubscribeResult<T> {
  return { ok: true, value }
}

function err(
  code: string,
  extra?: { argument?: string },
): StorageSubscribeResult<never> {
  return { ok: false, error: { code, ...extra } }
}

function closedErr(): StorageSubscribeResult<never> {
  return err('Unavailable')
}

function invalid(
  argument: string,
  _message: string,
): { code: string; argument: string } {
  return { code: 'InvalidArgument', argument }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  return value as Record<string, unknown>
}

function isStreamKey(key: Record<string, unknown>): boolean {
  return isFramedStreamKey(key)
}

/** densable leftover `or(namespace)` @207334280. */
function isTranscriptOrHistory(namespace: unknown): boolean {
  return namespace === 'history' || namespace === 'transcript'
}

/** densable leftover `wt` @207334741. */
function streamSubscribeServed(key: Record<string, unknown>): boolean {
  return !isStreamKey(key) || getStreamSubscribeMode(key) !== 'refuse'
}

/** densable leftover `au` @207334797. */
function isUnlistableStreamScope(scope: Record<string, unknown>): boolean {
  return (
    scope.namespace === 'sessionLog' ||
    (scope.namespace === 'log' &&
      (scope.channel === undefined || scope.channel === 'debug')) ||
    (scope.namespace === 'transcript' && scope.sessionId === undefined)
  )
}

/** densable leftover `zu` @207385459. */
export function validateMaxObservationLagMs(
  value: unknown,
): { code: string; argument: string } | undefined {
  return value === undefined ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0)
    ? undefined
    : invalid(
        'opts.maxObservationLagMs',
        'must be a finite non-negative number',
      )
}

/** densable leftover `Nu`. */
function streamSubscribeLabel(
  namespace: unknown,
  rec: Record<string, unknown>,
): string {
  return 'channel' in rec && rec.channel !== undefined
    ? `${String(namespace)}/${String(rec.channel)}`
    : String(namespace)
}

/** densable leftover `Hu` @207385615. */
export function validateSubscribeFilter(
  filter: StorageSubscribeFilter,
): { code: string; argument: string } | undefined {
  const rec =
    filter.target === 'scope' ? asRecord(filter.scope) : asRecord(filter.key)
  if (!rec) return
  if (
    filter.target === 'scope'
      ? rec.namespace === 'marketplaceCache'
      : rec.namespace === 'marketplaceCache' &&
        ('relPath' in rec || rec.form === 'manifest')
  ) {
    return invalid(
      `${filter.target}.namespace`,
      'subscriptions to a marketplace tree, its files or a synthesized manifest are not served',
    )
  }
  const refused =
    filter.target === 'key'
      ? isStreamKey(rec) && !streamSubscribeServed(rec)
        ? streamSubscribeLabel(rec.namespace, rec)
        : undefined
      : isUnlistableStreamScope(rec)
        ? streamSubscribeLabel(rec.namespace, rec)
        : undefined
  if (refused === undefined) return
  const side = filter.target === 'key' ? 'key' : 'scope'
  const transcriptScope =
    filter.target === 'scope' && rec.namespace === 'transcript'
  const field = transcriptScope
    ? 'sessionId'
    : (filter.target === 'key' ? rec.namespace : rec.namespace) === 'log'
      ? 'channel'
      : 'namespace'
  return invalid(
    `${side}.${field}`,
    transcriptScope
      ? 'subscriptions to a transcript scope are served only when the scope is narrowed to one session'
      : `subscriptions to a line-append stream (${refused}) are not served`,
  )
}

function canonKey(key: Record<string, unknown>): string {
  return digestStringifyCanonKey(key) ?? JSON.stringify(key)
}

/** Official `ga` returning string[] was not declared in the storage window. */
function leafSpellings(name: string): string[] {
  return [name]
}

function originOf(
  sourceInstanceId: string | undefined,
  instanceId: string,
): 'self' | 'other' {
  return sourceInstanceId === instanceId ? 'self' : 'other'
}

function streamOf(tracked: Tracked | undefined): StreamState {
  return tracked?.kind === 'stream' ? tracked.state : EMPTY_STREAM
}

function valueOfRead(
  read:
    | { bytes: Uint8Array; version: string; size: number; mtimeMs: number }
    | undefined,
): ValueState {
  return read === undefined
    ? { present: false }
    : {
        present: true,
        hash: read.version,
        size: read.size,
        mtimeMs: read.mtimeMs,
      }
}

function snapshotEvent(
  key: Record<string, unknown>,
  read:
    | { bytes: Uint8Array; version: string; size: number; mtimeMs: number }
    | undefined,
): StorageSubscribeResult<unknown> {
  if (isStreamKey(key)) return err('Failed')
  if (read === undefined) {
    return ok({ kind: 'snapshot', key, absent: true, origin: 'other' })
  }
  return ok({
    kind: 'snapshot',
    key,
    value: read.bytes,
    version: read.version,
    origin: 'other',
  })
}

function valueDiff(
  key: Record<string, unknown>,
  prev: ValueState | undefined,
  next: ValueState,
): Change | undefined {
  if (isStreamKey(key)) return
  const had = prev !== undefined && prev.present
  if (!next.present) return had ? { kind: 'deleted', key } : undefined
  if (!had) return { kind: 'created', key, version: next.hash }
  return prev.present && prev.hash !== next.hash
    ? { kind: 'updated', key, version: next.hash }
    : undefined
}

function wrapChange(
  change: Change,
  origin: 'self' | 'other',
): StorageSubscribeResult<unknown> {
  switch (change.kind) {
    case 'created':
      return ok({
        kind: 'created',
        key: change.key,
        ...(change.version !== undefined && { version: change.version }),
        ...(change.records !== undefined && {
          records: change.records.map(([seq, recordId]) => ({ seq, recordId })),
        }),
        origin,
      })
    case 'updated':
      return isStreamKey(change.key)
        ? ok({ kind: 'created', key: change.key, origin })
        : ok({
            kind: 'updated',
            key: change.key,
            version: change.version,
            ...(change.value !== undefined && { value: change.value }),
            origin,
          })
    case 'deleted':
      return ok({ kind: 'deleted', key: change.key, origin })
    case 'appended':
      return ok({
        kind: 'appended',
        key: change.key,
        seq: change.seq,
        recordId: change.recordId,
        origin,
      })
    case 'tombstoned':
      return ok({
        kind: 'tombstoned',
        key: change.key,
        recordId: change.recordId,
        origin,
      })
  }
}

/** densable leftover `ya`. */
function streamRewound(
  key: Record<string, unknown>,
  prev: StreamState,
  next: StreamState,
): boolean {
  if (!prev.exists || !next.exists) return false
  if (
    prev.generation !== next.generation &&
    next.generation !== -1 &&
    prev.generation !== -1
  ) {
    return true
  }
  if (!isTranscriptOrHistory(key.namespace)) return false
  if (
    prev.byteEnd !== undefined &&
    next.byteEnd !== undefined &&
    next.byteEnd < prev.byteEnd
  ) {
    return true
  }
  if (
    prev.stamp !== undefined &&
    next.stamp !== undefined &&
    next.stamp.generation === prev.stamp.generation &&
    next.stamp.size < prev.stamp.size
  ) {
    return true
  }
  for (const seq of prev.records.keys()) {
    if (!next.records.has(seq)) return true
  }
  return false
}

/** densable leftover `Du`. */
function mergeDelivered(
  key: Record<string, unknown>,
  prev: StreamState,
  next: StreamState,
): StreamState {
  if (!isTranscriptOrHistory(key.namespace) || prev.delivered === undefined) {
    return next
  }
  if (!next.exists || streamRewound(key, prev, next)) return next
  const delivered = new Map(
    [...prev.delivered].filter(
      ([seq]) =>
        !next.records.has(seq) &&
        (next.byteEnd === undefined || seq >= next.byteEnd),
    ),
  )
  const deliveredEnd =
    prev.deliveredEnd !== undefined &&
    (next.byteEnd === undefined || prev.deliveredEnd > next.byteEnd)
      ? prev.deliveredEnd
      : undefined
  if (delivered.size === 0 && deliveredEnd === undefined) return next
  return {
    ...next,
    ...(delivered.size > 0 && { delivered }),
    ...(deliveredEnd !== undefined && { deliveredEnd }),
  }
}

/** densable leftover `bg`. */
function sortedRecordPairs(
  records: Map<number, string>,
): Array<{ seq: number; recordId: string }> {
  return [...records.entries()]
    .sort(([a], [b]) => a - b)
    .map(([seq, recordId]) => ({ seq, recordId }))
}

/** densable leftover `vg`. */
function streamRediffChanges(
  key: Record<string, unknown>,
  prev: StreamState,
  next: StreamState,
): Array<Record<string, unknown>> {
  if (!next.exists) {
    return prev.exists ? [{ kind: 'deleted', key, origin: 'other' }] : []
  }
  if (!prev.exists || streamRewound(key, prev, next)) {
    const out: Array<Record<string, unknown>> = prev.exists
      ? [{ kind: 'deleted', key, origin: 'other' }]
      : []
    out.push({
      kind: 'created',
      key,
      origin: 'other',
      records: sortedRecordPairs(next.records),
    })
    return out
  }
  const out: Array<Record<string, unknown>> = []
  const appended = [...next.records.entries()]
    .filter(
      ([seq]) => !prev.records.has(seq) && prev.delivered?.has(seq) !== true,
    )
    .sort(([a], [b]) => a - b)
  for (const [seq, recordId] of appended) {
    out.push({ kind: 'appended', key, seq, recordId, origin: 'other' })
  }
  for (const recordId of next.tombstoned) {
    if (!prev.tombstoned.has(recordId)) {
      out.push({ kind: 'tombstoned', key, recordId, origin: 'other' })
    }
  }
  return out
}

/** densable leftover `Et`. */
function observationPeriodMs(
  filter: StorageSubscribeFilter,
  timing: SubscriptionTiming,
): number {
  if (filter.target !== 'key') return timing.backstopMs
  const rec = asRecord(filter.key)
  const ns = typeof rec?.namespace === 'string' ? rec.namespace : ''
  return Math.min(KEY_BACKSTOP_MS[ns] ?? timing.backstopMs, timing.backstopMs)
}

/**
 * densable leftover class `Lt` @207367705.
 */
export class StorageSubscription {
  backend: SubscribeBackend
  target: StorageSubscribeFilter
  onEvent: (event: unknown) => void
  tracked = new Map<string, Tracked>()
  watchHandles: StorageWatchHandle[] = []
  queued: Array<{ change: Change; sourceInstanceId?: string }> = []
  pollTimer: ReturnType<typeof setTimeout> | undefined
  active = true
  primed = false
  rediffing = false
  rediffAgain = false
  gapFill: Promise<void> | null = null
  gapFillDepth = 0
  unlistable = false
  unobservable = new Map<
    string,
    {
      failures: number
      nextLookAt: number
      hintTaken: boolean
      reported: boolean
    }
  >()
  hinted = false
  promoted = false
  longPeriodMs: number
  leafIsSymlink = false
  callbacksSeen = 0
  strayProbe: ReturnType<typeof setTimeout> | undefined
  leafChanged = false
  lastTimerRediffAt = Number.NEGATIVE_INFINITY
  ticks = 0
  observedChanges = 0
  leafSpellings: string[] | undefined

  constructor(
    backend: SubscribeBackend,
    target: StorageSubscribeFilter,
    onEvent: (event: unknown) => void,
    maxObservationLagMs: number | undefined,
  ) {
    this.backend = backend
    this.target = target
    this.onEvent = onEvent
    const key = target.target === 'key' ? asRecord(target.key) : null
    this.leafSpellings =
      target.target === 'key' && key !== null && !isStreamKey(key)
        ? leafSpellings(basename(backend.resolvePath(key) ?? ''))
        : undefined
    this.longPeriodMs = Math.max(
      observationPeriodMs(target, backend.timing),
      Math.min(
        backend.timing.longBackstopMs,
        maxObservationLagMs ?? Number.POSITIVE_INFINITY,
      ),
    )
  }

  get observationLagMs(): number {
    return this.mayStretch()
      ? this.longPeriodMs
      : observationPeriodMs(this.target, this.backend.timing)
  }

  async start(): Promise<StorageSubscribeResult<boolean>> {
    this.rediffing = true
    const dirs = this.watchedDirectories().filter(({ directory }) =>
      this.watchesNatively(directory),
    )
    for (const { directory, recursive } of dirs) {
      const handle = await this.backend.bus.watchers.watch(
        directory,
        recursive,
        filename => {
          this.callbacksSeen += 1
          if (this.hintConcerns(filename)) {
            this.hinted = true
            this.rediff()
          } else if (this.promoted && this.strayProbe === undefined) {
            this.strayProbe = setTimeout(
              sub => {
                sub.strayProbe = undefined
                sub.rediff()
              },
              this.backend.timing.strayProbeDebounceMs,
              this,
            )
            this.strayProbe.unref()
          }
        },
        () => this.retrust('its watcher changed state'),
      )
      if (!this.active) {
        await handle.release()
        return ok(false)
      }
      this.watchHandles.push(handle)
    }
    const primed = await this.prime()
    this.leafIsSymlink = await this.leafSymlinked()
    if (this.leafIsSymlink) {
      this.longPeriodMs = observationPeriodMs(this.target, this.backend.timing)
    }
    this.rediffing = false
    if (primed !== undefined) {
      await this.stop()
      return err(primed.code)
    }
    if (!this.active) return ok(false)
    this.primed = true
    for (const queued of this.queued.splice(0)) {
      this.replayQueued(queued.change, queued.sourceInstanceId)
    }
    this.lastTimerRediffAt = performance.now()
    this.scheduleTick()
    if (this.rediffAgain) {
      this.rediffAgain = false
      this.rediff()
    }
    this.retrust('primed')
    return ok(true)
  }

  scheduleTick(): void {
    const period =
      this.promoted && TICK_MODE === 'withRediff'
        ? this.longPeriodMs
        : observationPeriodMs(this.target, this.backend.timing)
    const phase =
      (((Date.now() - this.backend.bus.tickPhaseMs) % period) + period) % period
    this.pollTimer = setTimeout(() => void this.tick(), period - phase)
    this.pollTimer.unref()
  }

  async tick(): Promise<void> {
    this.pollTimer = undefined
    try {
      await this.poll()
    } catch (error) {
      logForDebugging(`storage subscription tick failed: ${error}`, {
        level: 'warn',
      })
    } finally {
      if (this.active) this.scheduleTick()
    }
  }

  retrust(reason: string): void {
    if (!this.primed || !this.active) return
    const next = !this.leafIsSymlink && this.watchesPromotably()
    if (next === this.promoted) return
    this.promoted = next
    logForDebugging(
      `storage subscription ${next ? 'trusts' : 'stops trusting'} the watch on ${this.watchedDirectories()
        .map(({ directory }) => directory)
        .join(', ')}: ${reason}`,
    )
    if (TICK_MODE === 'withRediff' && this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer)
      this.scheduleTick()
    }
    if (next) {
      this.rediff()
      return
    }
    this.lastTimerRediffAt = Number.NEGATIVE_INFINITY
    Promise.all(this.watchHandles.map(handle => handle.rearm()))
      .catch(error => {
        logForDebugging(`storage watcher rearm failed: ${error}`, {
          level: 'warn',
        })
      })
      .then(() => this.rediff())
  }

  mayStretch(): boolean {
    const stream =
      this.target.target === 'key'
        ? (() => {
            const key = asRecord(this.target.key)
            return key !== null && isStreamKey(key)
          })()
        : isUnlistableStreamScope(
            asRecord(this.target.scope) ?? { namespace: '' },
          )
    return (
      !stream &&
      this.watchedDirectories().every(
        ({ directory, recursive }) =>
          !recursive && this.watchesNatively(directory),
      )
    )
  }

  watchesPromotably(): boolean {
    return (
      this.mayStretch() &&
      this.watchHandles.length > 0 &&
      this.watchHandles.every(handle => handle.promotable())
    )
  }

  async leafSymlinked(): Promise<boolean> {
    if (this.target.target !== 'key') return false
    const key = asRecord(this.target.key)
    if (!key || isStreamKey(key)) return false
    if (getSymlinkPolicy(key) !== 'follow') return false
    const path = this.backend.resolvePath(key)
    if (!path) return false
    try {
      return (await lstat(path)).isSymbolicLink()
    } catch {
      return false
    }
  }

  hintConcerns(filename: string | null): boolean {
    const spellings = this.leafSpellings
    if (filename === null || spellings === undefined) return true
    return leafSpellings(filename).some(name =>
      spellings.some(
        leaf =>
          name === leaf ||
          (leaf.length > 0 &&
            (name.startsWith(leaf) || name.startsWith(`.${leaf}`))),
      ),
    )
  }

  watchesNatively(directory: string): boolean {
    return (
      this.backend.nativeWatch &&
      isPathPrefix(this.backend.roots.configHome, directory)
    )
  }

  async poll(): Promise<void> {
    const now = performance.now()
    const period = observationPeriodMs(this.target, this.backend.timing)
    const maxAge = this.ticks++ === 0 ? 0 : period / 2
    try {
      await Promise.all(this.watchHandles.map(handle => handle.rearm(maxAge)))
    } catch (error) {
      logForDebugging(`storage watcher rearm failed: ${error}`, {
        level: 'warn',
      })
    }
    if (this.watchesPromotably() && (!this.leafIsSymlink || this.leafChanged)) {
      this.leafChanged = false
      const linked = await this.leafSymlinked()
      if (linked !== this.leafIsSymlink) {
        this.leafIsSymlink = linked
        this.retrust(linked ? 'the leaf is a symlink' : 'the leaf is a file')
      }
    }
    if (
      this.promoted &&
      now - this.lastTimerRediffAt < this.longPeriodMs - 1.5 * period
    ) {
      return
    }
    this.lastTimerRediffAt = now
    const wasRediffing = this.rediffing
    const probing = this.strayProbe !== undefined
    const seen = this.callbacksSeen
    const observed = this.observedChanges
    await this.rediff()
    if (
      this.promoted &&
      !wasRediffing &&
      !probing &&
      this.callbacksSeen === seen &&
      this.observedChanges !== observed
    ) {
      setTimeout(
        (sub: StorageSubscription, count: number) => {
          if (sub.active && sub.promoted && sub.callbacksSeen === count) {
            for (const handle of sub.watchHandles) {
              handle.distrust('a change arrived that it never announced')
            }
          }
        },
        this.backend.timing.unannouncedGraceMs,
        this,
        seen,
      ).unref()
    }
  }

  watchedDirectories(): Array<{ directory: string; recursive: boolean }> {
    if (this.target.target === 'key') {
      const key = asRecord(this.target.key)
      if (!key) return []
      const path =
        isStreamKey(key) && !isTranscriptOrHistory(key.namespace)
          ? digestResolveStreamPath(this.backend.roots, key)
          : this.backend.resolvePath(key)
      if (!path) return []
      return [
        {
          directory:
            isStreamKey(key) && !isTranscriptOrHistory(key.namespace)
              ? path
              : dirname(path),
          recursive: false,
        },
      ]
    }
    const scope = asRecord(this.target.scope)
    if (!scope) return []
    return resolveScopeListDirectories(this.backend.roots, scope).map(
      ({ directory }) => ({ directory, recursive: false }),
    )
  }

  async prime(): Promise<{ code: string } | undefined> {
    if (this.target.target === 'key') {
      const key = asRecord(this.target.key)
      if (!key) return { code: 'InvalidArgument' }
      if (isStreamKey(key)) {
        this.seedStream(key, (await this.observeStream(key)) ?? EMPTY_STREAM)
        return
      }
      const read = await this.backend.readValue(key)
      this.seedValue(key, valueOfRead(read))
      this.deliver(snapshotEvent(key, read))
      return
    }
    const listed = await this.backend.scopeKeys(this.target.scope)
    if (!listed.ok) return listed.error
    if (!this.active) return
    for (const key of listed.value) {
      if (isStreamKey(key)) {
        this.seedStream(key, (await this.observeStream(key)) ?? EMPTY_STREAM)
      } else {
        this.seedValue(key, valueOfRead(await this.backend.readValue(key)))
      }
      if (!this.active) return
    }
  }

  seedValue(key: Record<string, unknown>, state: ValueState): void {
    this.tracked.set(canonKey(key), { key, kind: 'value', state, revision: 0 })
  }

  seedStream(key: Record<string, unknown>, state: StreamState): void {
    this.tracked.set(canonKey(key), { key, kind: 'stream', state, revision: 0 })
  }

  async observeValue(
    key: Record<string, unknown>,
    prev?: ValueState,
  ): Promise<ValueState> {
    if (prev !== undefined && !isStreamKey(key)) {
      const path = this.backend.resolvePath(key)
      if (path && !prev.present) return prev
    }
    return valueOfRead(await this.backend.readValue(key))
  }

  async observeStream(
    key: Record<string, unknown>,
    prev?: StreamState,
    force = false,
  ): Promise<StreamState | undefined> {
    const id = canonKey(key)
    const failed = this.unobservable.get(id)
    let hintTaken = false
    if (failed !== undefined) {
      if (this.backend.clockNow() < failed.nextLookAt) {
        if (failed.hintTaken || (!force && !this.hinted)) return
        this.unobservable.set(id, { ...failed, hintTaken: true })
        hintTaken = true
      }
      if (!force) this.hinted = false
    }
    const observed = await this.backend.streamEntries(key, prev?.stamp)
    if (
      typeof observed === 'object' &&
      observed !== null &&
      'unobservable' in observed
    ) {
      const unobservable = (observed as { unobservable: { code: string } })
        .unobservable
      this.lookFailed(key, unobservable, hintTaken)
      return
    }
    this.unobservable.delete(id)
    if (observed === 'unchanged') return prev
    if (observed === 'missing') return EMPTY_STREAM
    if (typeof observed !== 'object' || observed === null) return prev
    const rec = observed as {
      generation?: string | number
      entries?: Array<{ seq: number; recordId: string; tombstoned?: boolean }>
      byteEnd?: number
      stamp?: StreamStamp
    }
    const entries = rec.entries ?? []
    const lastSeq = entries.reduce<number | null>(
      (max, entry) => (max === null ? entry.seq : Math.max(max, entry.seq)),
      null,
    )
    return {
      exists: true,
      generation: rec.generation ?? -1,
      lastSeq,
      records: new Map(entries.map(entry => [entry.seq, entry.recordId])),
      tombstoned: new Set(
        entries.filter(entry => entry.tombstoned).map(entry => entry.recordId),
      ),
      ...(rec.byteEnd !== undefined && { byteEnd: rec.byteEnd }),
      ...(rec.stamp !== undefined && { stamp: rec.stamp }),
    }
  }

  lookFailed(
    key: Record<string, unknown>,
    reason: { code: string },
    hintTaken: boolean,
  ): void {
    if (!this.active) return
    const id = canonKey(key)
    const prev = this.unobservable.get(id)
    const failures = (prev?.failures ?? 0) + 1
    const wait = Math.min(
      LOOK_FAILED_START_MS * 2 ** (failures - 1),
      LOOK_FAILED_CAP_MS,
    )
    const reported = prev?.reported ?? false
    const report = !reported && failures >= LOOK_FAILED_REPORT_AFTER
    this.unobservable.set(id, {
      failures,
      nextLookAt: this.backend.clockNow() + wait,
      hintTaken,
      reported: reported || report,
    })
    if (failures === 1) {
      logForDebugging(
        `storage subscription cannot observe a ${String(key.namespace)} stream (${reason.code}); looking again at lengthening intervals: ${id}`,
        { level: 'warn' },
      )
    }
    if (report) {
      this.deliver(err('Failed'))
    }
  }

  deliverLocal(change: unknown, sourceInstanceId: string): void {
    const rec = asRecord(change)
    const key = asRecord(rec?.key)
    if (!rec || !key || !this.active || !this.concerns(key)) return
    if (!this.primed) {
      this.queued.push({
        change: rec as Change,
        sourceInstanceId,
      })
      return
    }
    this.deliverOrdered(
      rec as Change,
      originOf(sourceInstanceId, this.backend.instanceId),
      false,
    )
  }

  /** densable leftover `opensGap`. */
  opensGap(change: Change): boolean {
    if (change.kind !== 'appended') return false
    const stream = streamOf(this.tracked.get(canonKey(change.key)))
    if (!stream.exists) return change.seq > 0
    if (
      isStreamKey(change.key) &&
      isTranscriptOrHistory(change.key.namespace)
    ) {
      const end = Math.max(stream.byteEnd ?? -1, stream.deliveredEnd ?? -1)
      return end >= 0 && change.seq > end
    }
    return change.seq > (stream.lastSeq ?? -1) + 1
  }

  deliverOrdered(
    change: Change,
    origin: 'self' | 'other',
    replay: boolean,
  ): void {
    if (this.gapFill !== null || this.opensGap(change)) {
      this.gapFillDepth += 1
      const release = this.backend.bus.expect(canonKey(change.key))
      this.gapFill = (this.gapFill ?? Promise.resolve()).then(() =>
        this.deliverBehindGap(change, origin, release, replay),
      )
      return
    }
    this.deliverAbsorbed(change, origin, replay)
  }

  /** densable leftover `deliverBehindGap`. */
  async deliverBehindGap(
    change: Change,
    origin: 'self' | 'other',
    release: () => void,
    replay = false,
  ): Promise<void> {
    try {
      try {
        if (
          this.active &&
          change.kind === 'appended' &&
          isStreamKey(change.key) &&
          this.opensGap(change)
        ) {
          await this.deliverMissedBefore(change.key, change.seq)
        }
      } catch (error) {
        logForDebugging(`storage subscription gap delivery failed: ${error}`, {
          level: 'warn',
        })
      }
      try {
        if (this.active) this.deliverAbsorbed(change, origin, replay)
      } catch (error) {
        logForDebugging(
          `storage subscription local delivery failed: ${error}`,
          {
            level: 'warn',
          },
        )
      }
    } finally {
      release()
      this.gapFillDepth -= 1
      if (this.gapFillDepth === 0) this.gapFill = null
    }
  }

  /** densable leftover `deliverMissedBefore`. */
  async deliverMissedBefore(
    key: Record<string, unknown>,
    seq: number,
  ): Promise<void> {
    const id = canonKey(key)
    const tracked = this.tracked.get(id)
    const prev = streamOf(tracked)
    const next = await this.observeStream(
      key,
      tracked?.kind === 'stream' ? tracked.state : undefined,
      true,
    )
    if (!this.active || next === undefined) return
    if (!next.exists || streamRewound(key, prev, next)) {
      setTimeout(() => void this.rediff(), 0)
      return
    }
    const missed = [...next.records.entries()]
      .filter(
        ([g]) =>
          g < seq && !prev.records.has(g) && prev.delivered?.has(g) !== true,
      )
      .sort(([a], [b]) => a - b)
    if (!prev.exists) {
      this.deliver(
        ok({
          kind: 'created',
          key,
          origin: 'other',
          records: missed.map(([g, v]) => ({ seq: g, recordId: v })),
        }),
      )
    } else {
      for (const [g, v] of missed) {
        this.deliver(
          ok({ kind: 'appended', key, seq: g, recordId: v, origin: 'other' }),
        )
      }
    }
    const merged = mergeDelivered(key, prev, next)
    const framed = isTranscriptOrHistory(key.namespace)
    const kept = new Map([...merged.records].filter(([g]) => g < seq))
    const hasAfter = [...next.records.keys()].some(g => g > seq)
    const lastSeq = [...kept.keys()].reduce<number | null>(
      (max, g) => (max === null ? g : Math.max(max, g)),
      null,
    )
    const state: StreamState = {
      ...merged,
      records: kept,
      lastSeq,
      ...(merged.byteEnd !== undefined && {
        byteEnd: Math.min(merged.byteEnd, seq),
      }),
      ...(!framed && {
        generation: prev.generation,
        tombstoned: prev.tombstoned,
      }),
    }
    if (hasAfter) {
      delete state.stamp
      setTimeout(() => void this.rediff(), 0)
    }
    this.tracked.set(id, {
      key,
      kind: 'stream',
      state,
      revision: (tracked?.revision ?? 0) + 1,
    })
  }

  deliverAbsorbed(
    change: Change,
    origin: 'self' | 'other',
    replay = false,
  ): void {
    if (this.absorb(change) && !replay) return
    this.deliver(wrapChange(change, origin))
  }

  replayQueued(change: Change, sourceInstanceId?: string): void {
    if (!this.active || !this.concerns(change.key)) return
    this.deliverOrdered(
      change,
      originOf(sourceInstanceId, this.backend.instanceId),
      true,
    )
  }

  concerns(key: Record<string, unknown>): boolean {
    if (this.target.target === 'key') {
      const own = asRecord(this.target.key)
      return own !== null && canonKey(own) === canonKey(key)
    }
    return leaseTargetInScope(this.backend.resolvePath, this.target.scope, key)
  }

  restartRun(id: string): void {
    const failed = this.unobservable.get(id)
    if (failed === undefined) return
    this.unobservable.set(id, {
      failures: 0,
      nextLookAt: this.backend.clockNow(),
      hintTaken: false,
      reported: failed.reported,
    })
  }

  absorb(change: Change): boolean {
    const id = canonKey(change.key)
    const tracked = this.tracked.get(id)
    const revision = (tracked?.revision ?? 0) + 1
    switch (change.kind) {
      case 'created':
      case 'updated':
        if (isStreamKey(change.key)) {
          if (change.kind === 'created') this.restartRun(id)
          const prev = streamOf(tracked)
          const incoming =
            change.kind === 'created' ? (change.records ?? []) : []
          if (
            change.kind === 'created' &&
            isTranscriptOrHistory(change.key.namespace)
          ) {
            const fresh = incoming.filter(
              ([seq]) =>
                !prev.records.has(seq) && prev.delivered?.has(seq) !== true,
            )
            if (prev.exists && fresh.length === 0) return true
            const delivered = new Map(prev.exists ? prev.delivered : undefined)
            let deliveredEnd = prev.exists ? (prev.deliveredEnd ?? -1) : -1
            for (const [seq, recordId] of incoming) {
              delivered.set(seq, recordId)
              deliveredEnd = Math.max(deliveredEnd, seq + 1)
            }
            if (change.end !== undefined) {
              deliveredEnd = Math.max(deliveredEnd, change.end)
            }
            const lastSeq = incoming.reduce<number | null>(
              (max, [seq]) => (max === null ? seq : Math.max(max, seq)),
              prev.lastSeq,
            )
            this.tracked.set(id, {
              key: change.key,
              kind: 'stream',
              state: {
                ...prev,
                exists: true,
                lastSeq,
                delivered,
                deliveredEnd,
              },
              revision,
            })
            return false
          }
          if (change.kind === 'created' && prev.exists) return true
          const records = new Map(prev.records)
          for (const [seq, recordId] of incoming) records.set(seq, recordId)
          const lastSeq = [...records.keys()].reduce<number | null>(
            (max, seq) => (max === null ? seq : Math.max(max, seq)),
            prev.lastSeq,
          )
          this.tracked.set(id, {
            key: change.key,
            kind: 'stream',
            state: {
              exists: true,
              generation: prev.generation,
              lastSeq,
              records,
              tombstoned: prev.tombstoned,
            },
            revision,
          })
          return false
        }
        if (change.version !== undefined) {
          this.tracked.set(id, {
            key: change.key,
            kind: 'value',
            state: {
              present: true,
              hash: change.version,
              size: -1,
              mtimeMs: -1,
            },
            revision,
          })
        }
        return false
      case 'deleted':
        if (isStreamKey(change.key)) this.restartRun(id)
        this.tracked.set(
          id,
          isStreamKey(change.key)
            ? { key: change.key, kind: 'stream', state: EMPTY_STREAM, revision }
            : {
                key: change.key,
                kind: 'value',
                state: { present: false },
                revision,
              },
        )
        return false
      case 'appended': {
        const stream = streamOf(tracked)
        if (isTranscriptOrHistory(change.key.namespace)) {
          const behind =
            stream.byteEnd !== undefined && change.seq < stream.byteEnd
          if (
            !behind &&
            (stream.records.has(change.seq) ||
              stream.delivered?.has(change.seq) === true)
          ) {
            return true
          }
          const delivered = new Map(stream.delivered)
          delivered.set(change.seq, change.recordId)
          const deliveredEnd = Math.max(
            stream.deliveredEnd ?? -1,
            change.end ?? change.seq + 1,
          )
          this.tracked.set(id, {
            key: change.key,
            kind: 'stream',
            state: {
              ...stream,
              exists: true,
              lastSeq: Math.max(stream.lastSeq ?? -1, change.seq),
              delivered,
              deliveredEnd,
            },
            revision,
          })
          if (behind) setTimeout(() => void this.rediff(), 0)
          return false
        }
        if (stream.records.has(change.seq)) return true
        const records = new Map(stream.records)
        records.set(change.seq, change.recordId)
        this.tracked.set(id, {
          key: change.key,
          kind: 'stream',
          state: {
            ...stream,
            exists: true,
            lastSeq: Math.max(stream.lastSeq ?? -1, change.seq),
            records,
          },
          revision,
        })
        return false
      }
      case 'tombstoned': {
        const stream = streamOf(tracked)
        if (stream.tombstoned.has(change.recordId)) return true
        this.tracked.set(id, {
          key: change.key,
          kind: 'stream',
          state: {
            ...stream,
            exists: true,
            tombstoned: new Set([...stream.tombstoned, change.recordId]),
          },
          revision,
        })
        return false
      }
    }
  }

  async rediff(): Promise<void> {
    if (!this.active) return
    if (this.rediffing) {
      this.rediffAgain = true
      return
    }
    this.rediffing = true
    try {
      await this.rediffOnce()
    } catch (error) {
      logForDebugging(`storage subscription rediff failed: ${error}`, {
        level: 'warn',
      })
    } finally {
      this.rediffing = false
      if (this.rediffAgain) {
        this.rediffAgain = false
        this.rediff()
      }
    }
  }

  async rediffOnce(): Promise<void> {
    if (this.target.target === 'scope') {
      const seen = new Set<string>()
      const listed = await this.backend.scopeKeys(this.target.scope)
      if (!this.active) return
      if (listed.ok) {
        this.unlistable = false
        for (const key of listed.value) {
          seen.add(canonKey(key))
          await this.rediffKey(key)
        }
      } else if (!this.unlistable) {
        this.unlistable = true
        logForDebugging(
          `storage subscription cannot list its scope (${listed.error.code}); looking at the members it knows until a listing succeeds`,
          { level: 'warn' },
        )
      }
      for (const [id, tracked] of [...this.tracked]) {
        if (!seen.has(id)) await this.rediffKey(tracked.key)
      }
      this.pruneAbsent()
      return
    }
    const key = asRecord(this.target.key)
    if (key) await this.rediffKey(key)
  }

  async rediffKey(key: Record<string, unknown>): Promise<void> {
    const id = canonKey(key)
    if (!this.active || this.backend.bus.isWritingLocally(id)) return
    const tracked = this.tracked.get(id)
    const revision = tracked?.revision ?? 0
    if (isStreamKey(key)) {
      const next = await this.observeStream(
        key,
        tracked?.kind === 'stream' ? tracked.state : undefined,
      )
      if (next === undefined && !this.tracked.has(id)) {
        this.seedStream(key, EMPTY_STREAM)
      }
      if (next === undefined || this.backend.bus.isWritingLocally(id)) return
      const cur = this.tracked.get(id)
      if ((cur?.revision ?? 0) !== revision) return
      const prev = cur?.kind === 'stream' ? cur.state : EMPTY_STREAM
      this.tracked.set(id, {
        key,
        kind: 'stream',
        state: mergeDelivered(key, prev, next),
        revision,
      })
      for (const change of streamRediffChanges(key, prev, next)) {
        this.observedChanges += 1
        this.deliver(ok(change))
      }
      return
    }
    const next = await this.observeValue(
      key,
      tracked?.kind === 'value' ? tracked.state : undefined,
    )
    if (this.backend.bus.isWritingLocally(id)) return
    const cur = this.tracked.get(id)
    if ((cur?.revision ?? 0) !== revision) return
    const prev = cur?.kind === 'value' ? cur.state : undefined
    this.tracked.set(id, { key, kind: 'value', state: next, revision })
    const diff = valueDiff(key, prev, next)
    if (diff !== undefined) {
      this.observedChanges += 1
      this.leafChanged = true
      this.deliver(ok(diff))
    }
  }

  pruneAbsent(): void {
    for (const [id, tracked] of this.tracked) {
      const absent =
        tracked.kind === 'value'
          ? !tracked.state.present
          : !tracked.state.exists
      if (absent && !this.unobservable.has(id)) this.tracked.delete(id)
    }
  }

  deliver(event: unknown): void {
    if (!this.active) return
    try {
      this.onEvent(event)
    } catch (error) {
      logForDebugging(`storage subscriber callback threw: ${error}`, {
        level: 'warn',
      })
    }
  }

  terminate(): void {
    this.active = false
    try {
      this.onEvent(err('Failed'))
    } catch (error) {
      logForDebugging(`storage subscriber callback threw: ${error}`, {
        level: 'warn',
      })
    }
  }

  async stop(): Promise<void> {
    this.active = false
    this.unobservable.clear()
    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer)
      this.pollTimer = undefined
    }
    if (this.strayProbe !== undefined) {
      clearTimeout(this.strayProbe)
      this.strayProbe = undefined
    }
    const handles = this.watchHandles.splice(0)
    await Promise.all(handles.map(handle => handle.release()))
  }
}

/** densable leftover `Fb` @207546305. */
export async function subscribeStorage(
  store: SubscribeStore,
  backend: SubscribeBackend,
  filter: StorageSubscribeFilter,
  listener: (event: unknown) => void,
  opts?: { maxObservationLagMs?: number },
): Promise<
  StorageSubscribeResult<{ unsubscribe: () => void; observationLagMs: number }>
> {
  if (store.closed) return closedErr()
  const lag = opts?.maxObservationLagMs
  const key = filter.target === 'key' ? asRecord(filter.key) : null
  const scope = filter.target === 'scope' ? asRecord(filter.scope) : null
  const invalidFilter =
    filter.target === 'key'
      ? key === null
        ? invalid('key', 'expected a key object')
        : (validateStorageKey(key) ??
          validateBridgeSpawnRoot(store.roots, key, 'key'))
      : scope === null
        ? invalid('scope', 'expected a scope object')
        : (validateStorageScope(scope) ??
          validateBridgeSpawnRoot(store.roots, scope, 'scope'))
  const first = invalidFilter ?? validateMaxObservationLagMs(lag)
  if (first !== undefined) return err(first.code, { argument: first.argument })
  const refused = validateSubscribeFilter(filter)
  if (refused !== undefined)
    return err(refused.code, { argument: refused.argument })
  const sub = new StorageSubscription(backend, filter, listener, lag)
  store.subscriptions.add(sub)
  const started = await sub.start()
  if (!started.ok || !started.value || store.closed) {
    store.subscriptions.delete(sub)
    await sub.stop()
    return started.ok ? closedErr() : err(started.error.code)
  }
  return ok({
    unsubscribe: () => {
      void unsubscribeStorage(store, sub)
    },
    observationLagMs: sub.observationLagMs,
  })
}

/** densable leftover `Eb`. */
export async function unsubscribeStorage(
  store: SubscribeStore,
  sub: StorageSubscription,
): Promise<void> {
  store.subscriptions.delete(sub)
  await sub.stop()
}

/** densable leftover `Lb` @207546900. */
export async function closeStorageSubscriptions(
  store: SubscribeStore,
): Promise<StorageSubscribeResult<undefined>> {
  if (store.closed) return ok(undefined)
  store.closed = true
  store.unlisten()
  const subs = [...store.subscriptions]
  store.subscriptions.clear()
  for (const sub of subs) {
    await sub.stop()
    sub.terminate()
  }
  await releaseStorageWatchBus(store.roots.configHome)
  return ok(undefined)
}
