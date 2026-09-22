/**
 * Official Ut @179163791 / _Ke @179162866 / uo @179163180 (densable 2.1.248).
 * Leftover names: RemoteSettingsBackendView / primeRemoteSettingsBackendView /
 * runRemoteSettingsBackendPrime. Host bag ≈ official xt via w()=Ndr.of(host);
 * tip holds backendView here + sessionCache from syncCacheState.
 *
 * Gold: gold-248-_Ke-Ut-uo.txt / gold-248-_Ke-Gqe-parent.txt
 * Official Yv(){return} @179161925 — tip SEA empty (override skipped only if
 * non-empty; leftover getRemoteSettingsPath stays for disk path, not Yv).
 */
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { FLAG_SETTINGS_MAX_BYTES } from './constants.js'
import type { StorageV5 } from '../storageV5/createLocalFsBackend.js'
import { digestStringifyCanonKey } from '../storageV5/digestLog.js'
import { isHoverRestOn } from '../storageV5/hoverRestPin.js'
import {
  getSessionCache,
  getRemoteSettingsBackendViewSlot,
  setRemoteSettingsBackendViewSlot,
} from '../../services/remoteManagedSettings/syncCacheState.js'

/** Official ce @179159220 — 2 MiB remote-settings storage view cap. */
const REMOTE_SETTINGS_MAX_BYTES = FLAG_SETTINGS_MAX_BYTES

/** Official gKe @179159232. */
const HELPER_CONSENT_STATE_ID = 'remote-settings-helper-consent'

/** Official co @179162824. */
const MAX_OBSERVATION_LAG_MS = 2000

/** Official Se.state(id) — storageV5 state key. */
function stateKey(id: string): { namespace: 'state'; id: string } {
  return { namespace: 'state', id }
}

const CACHE_KEY = stateKey('remote-settings')
const SIDECAR_KEY = stateKey(HELPER_CONSENT_STATE_ID)

/** Official Yv(){return} @179161925 — tip SEA empty. */
function remoteSettingsPathOverride(): undefined {
  return undefined
}

/** Official Pu — key id for heldOf. */
function storageKeyId(key: unknown): string {
  if (key && typeof key === 'object') {
    const id = digestStringifyCanonKey(key as Record<string, unknown>)
    if (id !== undefined) return id
  }
  return JSON.stringify(key)
}

/** Official Ge — storage error string for logs. */
function formatStorageError(error: unknown): string {
  if (error && typeof error === 'object') {
    const rec = error as Record<string, unknown>
    if (typeof rec.telemetryCode === 'string') return rec.telemetryCode
    if (typeof rec.code === 'string') return rec.code
    if (typeof rec.message === 'string') return rec.message
  }
  return errorMessage(error)
}

/** Official Hc — errno-ish code (ELOOP etc.). */
function storageErrno(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const rec = error as Record<string, unknown>
    if (typeof rec.telemetryCode === 'string') return rec.telemetryCode
    if (typeof rec.code === 'string') return rec.code
  }
  return undefined
}

/** Official Ht @179167023 — safe unsubscribe. */
function unsubscribeQuiet(sub: { unsubscribe: () => void }): void {
  try {
    sub.unsubscribe()
  } catch (t) {
    logForDebugging(
      `Remote settings: storage unsubscribe failed: ${errorMessage(t)}`,
      { level: 'warn' },
    )
  }
}

/** Official zt @179167265 — content size label. */
function contentLabel(e: string | null): string {
  return e === null ? 'absent' : `${e.length} chars`
}

/** Official $ue / t4t — decode storage bytes to NFC-normalized text. */
function decodeSettingsBytes(bytes: Uint8Array): string {
  let encoding: BufferEncoding = 'utf8'
  if (bytes.byteLength >= 2 && bytes[0] === 255 && bytes[1] === 254) {
    encoding = 'utf16le'
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .toString(encoding)
    .replaceAll('\r\n', '\n')
}

/** Official po @179167141 — extract payload from watch event value. */
function payloadFromWatchEvent(
  e: Record<string, unknown>,
): Uint8Array | undefined {
  switch (e.kind) {
    case 'snapshot':
      return 'absent' in e ? undefined : (e.value as Uint8Array | undefined)
    case 'updated':
      return e.value as Uint8Array | undefined
    default:
      return undefined
  }
}

/** Official vt @179166922 — held cache/sidecar slot. */
type HeldSlot = {
  key: { namespace: 'state'; id: string }
  id: string
  label: string
  observed: boolean
  begun: boolean
  pendingRead: number | undefined
  generation: number
}

function heldSlot(
  key: { namespace: 'state'; id: string },
  label: string,
): HeldSlot {
  return {
    key,
    id: storageKeyId(key),
    label,
    observed: false,
    begun: false,
    pendingRead: undefined,
    generation: 0,
  }
}

/** Official Dde @178588201 — config home still matches view snapshot. */
function configHomeUnchanged(configHome: string): boolean {
  return getClaudeConfigHomeDir() === configHome
}

type StorageSubscribeHandle = { unsubscribe: () => void }

type WatchEvent =
  | { ok: false; error: unknown }
  | {
      ok: true
      value: Record<string, unknown> & { key: unknown; kind: string }
    }

/**
 * Official Ut @179163791 sha=960bdef83d78a58e.
 * Leftover RemoteSettingsBackendView.
 */
export class RemoteSettingsBackendView {
  storageV5: StorageV5
  content: string | null = null
  attestation: string | undefined = undefined
  ready = false
  priming: Promise<void> = Promise.resolve()
  stoodDown = false
  configHome = getClaudeConfigHomeDir()
  subscriptions: StorageSubscribeHandle[] = []
  cache = heldSlot(CACHE_KEY, 'cache file')
  sidecar = heldSlot(SIDECAR_KEY, 'helper consent sidecar')
  work: Promise<boolean> = Promise.resolve(true)
  steps = 0
  lastCacheStep = 0

  constructor(storageV5: StorageV5) {
    this.storageV5 = storageV5
  }

  onEvent(e: WatchEvent): void {
    if (this.stoodDown) return
    if (!e.ok) {
      this.standDown(`watch ended: ${formatStorageError(e.error)}`)
      return
    }
    const t = this.heldOf(e.value.key)
    if (t === undefined) return
    if (e.value.kind === 'snapshot' && t.begun) return
    this.take(t, payloadFromWatchEvent(e.value))
  }

  settled(): Promise<boolean> {
    return this.work.then(e => e && !this.stoodDown)
  }

  readUnobserved(): Promise<boolean> {
    for (const e of [this.cache, this.sidecar]) {
      if (!e.observed) this.take(e)
    }
    return this.settled()
  }

  written(e: { namespace: 'state'; id: string }, t: string | null): void {
    const o = this.stoodDown ? undefined : this.heldOf(e)
    if (o === undefined) return
    o.begun = true
    o.generation++
    if (o === this.cache) this.sidecar.generation++
    this.advance(o)
    if (
      t !== null &&
      Buffer.byteLength(t, 'utf8') > REMOTE_SETTINGS_MAX_BYTES
    ) {
      this.standDown(`oversize ${o.label}`)
      return
    }
    this.install(o, t)
    this.follow(o, t === null)
  }

  heldOf(e: unknown): HeldSlot | undefined {
    const t = storageKeyId(e)
    return t === this.cache.id
      ? this.cache
      : t === this.sidecar.id
        ? this.sidecar
        : undefined
  }

  take(e: HeldSlot, t?: Uint8Array | undefined): Promise<boolean> {
    e.begun = true
    if (t !== undefined) {
      e.pendingRead = undefined
      const o = e.generation
      this.queue(e, () =>
        e.generation === o ? this.fill(e, t) : !this.stoodDown,
      )
    }
    return this.follow(e, t === undefined)
  }

  follow(e: HeldSlot, t: boolean): Promise<boolean> {
    if (t && e.pendingRead === undefined) {
      const o = this.queue(e, () => {
        if (e.pendingRead === o) e.pendingRead = undefined
        return this.read(e)
      })
      e.pendingRead = o
    }
    if (
      e === this.cache &&
      (this.sidecar.pendingRead ?? 0) < this.lastCacheStep
    ) {
      this.sidecar.pendingRead = undefined
      return this.take(this.sidecar)
    }
    return this.work
  }

  queue(e: HeldSlot, t: () => boolean | Promise<boolean>): number {
    const o = this.advance(e)
    this.work = this.work.then(t).catch(s => {
      this.standDown(`refresh failed: ${errorMessage(s)}`)
      return false
    })
    return o
  }

  advance(e: HeldSlot): number {
    const t = ++this.steps
    if (e === this.cache) this.lastCacheStep = t
    return t
  }

  async read(e: HeldSlot): Promise<boolean> {
    if (this.stoodDown) return false
    const t = e.generation
    try {
      const o = await this.storageV5.read([
        {
          key: e.key,
          offset: 0,
          length: REMOTE_SETTINGS_MAX_BYTES + 1,
        },
      ])
      if (e.generation !== t) {
        if (!o.ok) {
          logForDebugging(
            `Remote settings: a superseded read of the ${e.label} failed (${formatStorageError(o.error)}); ignored`,
          )
        }
        return !this.stoodDown
      }
      if (!o.ok) {
        if (storageErrno(o.error) === 'ELOOP') {
          logForDebugging(
            `Remote settings: the ${e.label} is a symlink; not read with the storage flag on (strict rule for files only Claude Code writes)`,
            { level: 'warn' },
          )
          return this.fill(e, null)
        }
        this.standDown(`read failed: ${formatStorageError(o.error)}`)
        return false
      }
      const s = o.value.items[0]!
      if (s.found && s.totalBytes > REMOTE_SETTINGS_MAX_BYTES) {
        this.standDown(`oversize ${e.label}`)
        return false
      }
      return this.fill(e, s.found ? (s.value ?? null) : null)
    } catch (o) {
      this.standDown(`read failed: ${errorMessage(o)}`)
      return false
    }
  }

  fill(e: HeldSlot, t: Uint8Array | null): boolean {
    if (this.stoodDown) return false
    if (t !== null && t.byteLength > REMOTE_SETTINGS_MAX_BYTES) {
      this.standDown(`oversize ${e.label}`)
      return false
    }
    this.install(e, t === null ? null : decodeSettingsBytes(t))
    return true
  }

  install(e: HeldSlot, t: string | null): void {
    if (e === this.cache) {
      if (e.observed && this.ready) {
        logForDebugging(
          `Remote settings: storage view refreshed (${contentLabel(t)})`,
        )
      }
      this.content = t
      this.attestation = undefined
    } else {
      this.attestation = t?.trim() || undefined
    }
    e.observed = true
  }

  standDown(e: string, t: 'debug' | 'warn' = 'debug'): void {
    const o = getRemoteSettingsHost()
    if (o.backendView === this) o.backendView = undefined
    if (this.stoodDown) return
    this.stoodDown = true
    this.content = null
    this.attestation = undefined
    for (const s of this.subscriptions.splice(0)) unsubscribeQuiet(s)
    logForDebugging(
      `Remote settings: storage view stood down (${e}); disk probe serves`,
      { level: t },
    )
  }
}

/**
 * Official host bag fields needed by Ut/_Ke/uo (xt.backendView + sessionCache).
 * Leftover getRemoteSettingsHost ≈ w().
 */
export type RemoteSettingsHost = {
  backendView: RemoteSettingsBackendView | undefined
  readonly sessionCache: ReturnType<typeof getSessionCache>
}

export function getRemoteSettingsHost(): RemoteSettingsHost {
  return {
    get backendView() {
      return getRemoteSettingsBackendViewSlot()
    },
    set backendView(v: RemoteSettingsBackendView | undefined) {
      setRemoteSettingsBackendViewSlot(v)
    },
    get sessionCache() {
      return getSessionCache()
    },
  }
}

/**
 * Official uo @179163180 — subscribe cache+sidecar, settle, mark ready.
 * Leftover runRemoteSettingsBackendPrime.
 */
export async function runRemoteSettingsBackendPrime(
  view: RemoteSettingsBackendView,
  storageV5: StorageV5,
  host: RemoteSettingsHost,
): Promise<void> {
  try {
    for (const s of [SIDECAR_KEY, CACHE_KEY]) {
      const r = await storageV5.subscribe(
        { target: 'key', key: s },
        p => view.onEvent(p as WatchEvent),
        { maxObservationLagMs: MAX_OBSERVATION_LAG_MS },
      )
      if (!r.ok) {
        view.standDown(`watch refused: ${formatStorageError(r.error)}`, 'warn')
        return
      }
      if (view.stoodDown) {
        unsubscribeQuiet(r.value)
        return
      }
      view.subscriptions.push(r.value)
    }
    if (!(await view.settled()) || !(await view.readUnobserved())) return
    if (view.stoodDown) return
    view.ready = true
    logForDebugging(
      `Remote settings: primed from storage (${contentLabel(view.content)}; helper consent ${view.attestation === undefined ? 'not attested' : 'attested'}${host.sessionCache !== null ? '; cache already loaded, serving later loads' : ''})`,
    )
  } catch (s) {
    view.standDown(`prime failed: ${errorMessage(s)}`)
  }
}

/**
 * Official _Ke @179162866 — create Ut + start uo priming.
 * Leftover primeRemoteSettingsBackendView.
 */
export async function primeRemoteSettingsBackendView(
  storageV5: StorageV5 | undefined,
): Promise<void> {
  if (!isHoverRestOn() || storageV5 === undefined) return
  const t = getRemoteSettingsHost()
  if (t.backendView !== undefined) return t.backendView.priming
  if (remoteSettingsPathOverride() !== undefined) {
    logForDebugging(
      'Remote settings: storage prime skipped (CLAUDE_CODE_REMOTE_SETTINGS_PATH override); disk probe stays',
    )
    return
  }
  const o = new RemoteSettingsBackendView(storageV5)
  t.backendView = o
  o.priming = runRemoteSettingsBackendPrime(o, storageV5, t)
  return o.priming
}

/**
 * Official Ie @179162567 — ready backendView when config home stable.
 */
export function getReadyRemoteSettingsBackendView():
  | RemoteSettingsBackendView
  | undefined {
  const e = getRemoteSettingsHost().backendView
  if (
    !isHoverRestOn() ||
    e === undefined ||
    !e.ready ||
    e.stoodDown ||
    remoteSettingsPathOverride() !== undefined
  ) {
    return
  }
  if (!configHomeUnchanged(e.configHome)) {
    e.standDown('config home changed')
    return
  }
  return e
}

/**
 * Official fue @179162802 — notify view of a written cache/sidecar payload.
 */
export function remoteSettingsFileWritten(
  kind: 'cache' | 'sidecar',
  content: string | null,
): void {
  getRemoteSettingsHost().backendView?.written(
    kind === 'cache' ? CACHE_KEY : SIDECAR_KEY,
    content,
  )
}

/** Test helper — clear host backendView. */
export function resetRemoteSettingsBackendViewForTests(): void {
  const host = getRemoteSettingsHost()
  const view = host.backendView
  if (view !== undefined) {
    view.standDown('test reset')
  }
  host.backendView = undefined
}
