import { AsyncLocalStorage } from 'async_hooks'
import { realpathSync } from 'fs'
import { realpath as realpathAsync } from 'fs/promises'
import { getCwdState, getOriginalCwd, setCwdState } from '../bootstrap/state.js'
import { getBootstrapSession, isDisklessLaunch } from './sessionHost.js'

export const WALKED_PHYSICAL_PREFIX = 'walked:'

export type CwdLookupFailure = {
  kind: 'lookup'
  code: string | undefined
}

export type CwdLook =
  | { physical: string | null | undefined; notVouched?: undefined }
  | { physical: false; notVouched: CwdLookupFailure }

export type CwdLookMismatch =
  | { atHold: boolean; found: CwdLookupFailure }
  | {
      atHold: false
      found: 'deleted' | 'unexaminable' | 'identity_changed' | 'led_elsewhere'
    }

export type CwdCallFrame = {
  outer: CwdAlsStore | undefined
  isOver: boolean
  look: CwdLook
  staysPut: boolean
  movedInside?: string
}

export type CwdAlsStore = {
  cwd: string
  call?: CwdCallFrame
}

/**
 * Official 2.1.331 `o = new AsyncLocalStorage()` (`03_cwd_als.js`) —
 * per-host / per-call working directory store.
 */
const cwdAls = new AsyncLocalStorage<CwdAlsStore>()

type CwdVersionTracker = {
  version: number
  lastObservedCwd: string | null
}

const cwdVersionByScope = new WeakMap<object, CwdVersionTracker>()
const fallbackCwdScopeKey: object = {}

function nfcPath(value: string): string {
  return value.normalize('NFC')
}

function isDisklessSafe(): boolean {
  try {
    return typeof isDisklessLaunch === 'function' ? isDisklessLaunch() : false
  } catch {
    return false
  }
}

type RealpathProbeResult =
  | { real: string; code?: undefined }
  | { real?: undefined; code: string | undefined }

function extractErrnoCode(err: unknown): string | undefined {
  if (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    typeof err.code === 'string'
  ) {
    return err.code
  }
  return undefined
}

function probeRealpathSync(target: string): RealpathProbeResult {
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- official RYt/ODe sync cwd look capture
    return { real: nfcPath(realpathSync(target)) }
  } catch (err) {
    return { code: extractErrnoCode(err) }
  }
}

async function probeRealpathAsync(
  target: string,
): Promise<RealpathProbeResult> {
  try {
    return { real: nfcPath(await realpathAsync(target)) }
  } catch (err) {
    return { code: extractErrnoCode(err) }
  }
}

function notVouchedLook(failure: CwdLookupFailure): CwdLook {
  return { physical: false, notVouched: failure }
}

function classifyLook(result: RealpathProbeResult): CwdLook {
  if (result.real !== undefined) {
    return { physical: result.real }
  }
  switch (result.code) {
    case 'EPERM':
    case 'EACCES':
      return { physical: undefined }
    case 'ENOENT':
      return { physical: null }
    default:
      return notVouchedLook({ kind: 'lookup', code: result.code })
  }
}

/** Official `f(e)` — skip completed (`isOver === true`) scoped call frames. */
function unwrapActiveFrame(
  store: CwdAlsStore | undefined,
): CwdAlsStore | undefined {
  let cur = store
  while (cur?.call?.isOver === true) {
    cur = cur.call.outer
  }
  return cur
}

/** Official `r()` — active ALS frame (skipping finished call frames). */
function getActiveCwdStore(): CwdAlsStore | undefined {
  return unwrapActiveFrame(cwdAls.getStore())
}

/** Official `C()` — root `runWithCwd` ALS frame (stripping all `call` frames). */
function getRootCwdStore(): CwdAlsStore | undefined {
  let cur = getActiveCwdStore()
  while (cur?.call !== undefined) {
    cur = unwrapActiveFrame(cur.call.outer)
  }
  return cur
}

function getCwdOrNull(): string | null {
  try {
    return getCwd()
  } catch {
    return null
  }
}

function getVersionTracker(): CwdVersionTracker {
  let scopeKey: object = fallbackCwdScopeKey
  const activeStore = getActiveCwdStore()
  if (activeStore !== undefined) {
    scopeKey = activeStore
  } else {
    try {
      const session = getBootstrapSession()
      if (
        session !== null &&
        (typeof session === 'object' || typeof session === 'function')
      ) {
        scopeKey = session
      }
    } catch {
      // Fall back to module-local sentinel when sessionHost is mocked in tests
    }
  }
  let tracker = cwdVersionByScope.get(scopeKey)
  if (tracker === undefined) {
    tracker = { version: 0, lastObservedCwd: null }
    cwdVersionByScope.set(scopeKey, tracker)
  }
  return tracker
}

function syncCwdVersion(): number {
  const tracker = getVersionTracker()
  const current = getCwd()
  if (tracker.lastObservedCwd === null) {
    tracker.lastObservedCwd = current
  } else if (tracker.lastObservedCwd !== current) {
    tracker.lastObservedCwd = current
    tracker.version++
  }
  return tracker.version
}

/** Official `pYl(e)` — strip `walked:<dev>:<ino>:` physical identity prefix. */
export function stripWalkedPhysicalPrefix(physical: string): string {
  return physical.startsWith(WALKED_PHYSICAL_PREFIX)
    ? physical.split(':').slice(3).join(':')
    : physical
}

/** Official `RYt(e)` — capture sync physical look of `cwd`. */
export function inspectCwdLookSync(cwd: string): CwdLook {
  return isDisklessSafe()
    ? { physical: undefined }
    : classifyLook(probeRealpathSync(cwd))
}

/** Official `ZWo(e)` — capture async physical look of `cwd`. */
export async function inspectCwdLook(cwd: string): Promise<CwdLook> {
  return isDisklessSafe()
    ? { physical: undefined }
    : classifyLook(await probeRealpathAsync(cwd))
}

/**
 * Official 2.1.331 `Ff(e, t)` — run `fn` with an ALS-scoped root working
 * directory for the current async execution chain.
 */
export function runWithCwd<T>(cwd: string, fn: () => T): T {
  return cwdAls.run({ cwd: nfcPath(cwd) }, fn)
}

/** Official `ega(e, t)` — run with `cwd ?? getCwd()`. */
export function runWithCwdOrCurrent<T>(
  cwd: string | undefined,
  fn: () => T,
): T {
  return runWithCwd(cwd ?? getCwd(), fn)
}

/** Official `mCe(e, t)` — run with `project.cwd` when `project` is non-null. */
export function runWithOptionalProjectCwd<T>(
  project: { readonly cwd: string } | null,
  fn: () => T,
): T {
  return project === null ? fn() : runWithCwdOrCurrent(project.cwd, fn)
}

/**
 * Backwards-compatible alias for `runWithCwd` (`Ff`).
 * All calls to `pwd()` / `getCwd()` within `fn` (and its async descendants)
 * see the scoped `cwd`, and `setCwd()` mutates only this ALS scope.
 */
export function runWithCwdOverride<T>(cwd: string, fn: () => T): T {
  return runWithCwd(cwd, fn)
}

/**
 * Official 2.1.331 `vqe(e)` — run an async call inside a per-call CWD frame
 * (`{ outer, isOver, look, staysPut, movedInside }`), marking `isOver = true`
 * in `finally` so detached continuations unwrap back to `outer`.
 */
export async function withScopedCallCwd<T>(fn: () => Promise<T>): Promise<T> {
  const startCwd = getActiveCwdStore()?.call?.movedInside ?? getCwdOrNull()
  if (startCwd === null) {
    return fn()
  }
  const callFrame: CwdCallFrame = {
    outer: getActiveCwdStore(),
    isOver: false,
    look: inspectCwdLookSync(startCwd),
    staysPut: false,
  }
  try {
    return await cwdAls.run({ cwd: startCwd, call: callFrame }, fn)
  } finally {
    callFrame.isOver = true
  }
}

/** Official 2.1.331 `mYl()` — pin the current scoped call's `cwd` (`staysPut = true`). */
export function pinScopedCallCwd(): void {
  const call = getActiveCwdStore()?.call
  if (call !== undefined) {
    call.staysPut = true
  }
}

/** Official 2.1.331 `CYt()` — unpin the current scoped call's `cwd` (`staysPut = false`). */
export function unpinScopedCallCwd(): void {
  const call = getActiveCwdStore()?.call
  if (call !== undefined) {
    call.staysPut = false
  }
}

/**
 * Official 2.1.331 `AYt(e)` — strip transient `withScopedCallCwd` frames while
 * preserving any enclosing `runWithCwd` root scope across async boundaries.
 */
export function preserveRootCwdAcrossAsync<T>(fn: () => T): T {
  const root = getRootCwdStore()
  return root === undefined ? cwdAls.exit(fn) : cwdAls.run(root, fn)
}

/**
 * Official 2.1.331 `ejo(e)` — exit `cwdAls` for the duration of `fn`, falling
 * back to `getCwdState()` (`getBootstrapSession().project.cwd`).
 */
export function exitScopedCwd<T>(fn: () => T): T {
  return cwdAls.exit(fn)
}

/**
 * Official 2.1.331 `Z6()` — true when running inside a `runWithCwd` root ALS scope.
 */
export function hasScopedCwd(): boolean {
  return getRootCwdStore() !== undefined
}

/** Official `vtt()` — active `withScopedCallCwd` directory, or `undefined` outside a call frame. */
export function getScopedCallCwd(): string | undefined {
  const active = getActiveCwdStore()
  return active?.call === undefined ? undefined : active.cwd
}

/** Official `hYl()` — captured physical path of the active scoped call frame. */
export function getScopedCallPhysicalCwd(): string | false | null | undefined {
  return getActiveCwdStore()?.call?.look.physical
}

/** Official `rjr(e)` — true when outside a call frame or when `physical` matches the held look. */
export function matchesScopedCallPhysicalCwd(
  physical: string | false | null | undefined,
): boolean {
  const call = getActiveCwdStore()?.call
  return (
    call === undefined ||
    (physical !== false && call.look.physical === physical)
  )
}

/** Official `sjr(e)` — classify why `current` differs from the held scoped call look. */
export function describeScopedCallLookMismatch(
  current: CwdLook,
): CwdLookMismatch {
  const heldLook = getActiveCwdStore()?.call?.look
  if (heldLook?.notVouched !== undefined) {
    return { atHold: true, found: heldLook.notVouched }
  }
  if (current.notVouched !== undefined) {
    return { atHold: false, found: current.notVouched }
  }
  if (current.physical === null) {
    return { atHold: false, found: 'deleted' }
  }
  if (current.physical === undefined) {
    return { atHold: false, found: 'unexaminable' }
  }
  return {
    atHold: false,
    found:
      typeof heldLook?.physical === 'string' &&
      heldLook.physical.startsWith(WALKED_PHYSICAL_PREFIX) &&
      current.physical.startsWith(WALKED_PHYSICAL_PREFIX)
        ? 'identity_changed'
        : 'led_elsewhere',
  }
}

/**
 * densable 2.1.216 worktree git isolation — agent isolation cwd when set via
 * `runWithCwd` / `runWithCwdOverride`. `undefined` outside a root ALS scope.
 */
export function getCwdOverride(): string | undefined {
  return hasScopedCwd() ? getActiveCwdStore()?.cwd : undefined
}

/**
 * Official 2.1.331 `RDt(e)` — update working directory inside the active
 * `cwdAls` scope (honoring `staysPut` / `movedInside` across nested call frames
 * and updating any enclosing `runWithCwd` frame), or fall back to `setCwdState`
 * (`getBootstrapSession().project.cwd`) when outside a root `runWithCwd` scope.
 */
export function setCwd(cwd: string): void {
  const normalized = nfcPath(cwd)
  let frame = getActiveCwdStore()
  if (frame?.call !== undefined) {
    const look = inspectCwdLookSync(normalized)
    while (frame?.call !== undefined) {
      if (frame.call.staysPut) {
        frame.call.movedInside = normalized
      } else {
        frame.cwd = normalized
        frame.call.look = look
        frame.call.movedInside = undefined
      }
      frame = unwrapActiveFrame(frame.call.outer)
    }
  }
  if (frame) {
    frame.cwd = normalized
  } else {
    setCwdState(cwd)
  }
}

/**
 * Official 2.1.331 `tjo()` — get the current working directory from the active
 * `cwdAls` frame or fall back to `getCwdState()`.
 */
export function pwd(): string {
  return getActiveCwdStore()?.cwd ?? getCwdState()
}

/**
 * Official 2.1.331 `ue()` — get the current working directory, or fall back to
 * `getOriginalCwd()` if `pwd()` throws.
 */
export function getCwd(): string {
  try {
    return pwd()
  } catch {
    return getOriginalCwd()
  }
}

/**
 * Monotonic version counter that increments whenever the active working
 * directory changes (via setCwd / setCwdState / session.setCwd).
 */
export function getCwdVersion(): number {
  return syncCwdVersion()
}

/**
 * Subscribe to working directory changes on the active bootstrap session.
 * Compatible with React's `useSyncExternalStore` so UI components such as
 * StatusLine refresh immediately when `/cd` updates the working directory.
 */
export function subscribeCwd(listener: () => void): () => void {
  let lastCwd = getCwd()
  syncCwdVersion()
  const session = getBootstrapSession()
  if (typeof session?.subscribe !== 'function') {
    return () => {}
  }
  return session.subscribe(() => {
    const nextCwd = getCwd()
    if (nextCwd !== lastCwd) {
      lastCwd = nextCwd
      syncCwdVersion()
      listener()
    }
  })
}
