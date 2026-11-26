// Store all instances of Ink (instance.js) to ensure that consecutive render() calls
// use the same instance of Ink and don't create a new one
//
// This map has to be stored in a separate file, because render.js creates instances,
// but instance.js should delete itself from the map on unmount
//
// densable `$yf` / `Yp` (SEA): claimForStandaloneRender + pendingStandaloneRender so
// createRoot/wrappedRender wait out a managed-settings standalone consent dialog
// before claiming stdout. everMounted mirrors densable Zjn/Yhp process flag.

import type Ink from './ink.js'

type SessionRootModule =
  typeof import('../../../../../src/utils/sessionRoot.js')
type InkSessionObject = { host: object; root?: object }

let cachedSessionRootModule: SessionRootModule | null | undefined

function getSessionRootModule(): SessionRootModule | undefined {
  if (cachedSessionRootModule !== undefined) {
    return cachedSessionRootModule ?? undefined
  }
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    cachedSessionRootModule =
      require('../../../../../src/utils/sessionRoot.js') as SessionRootModule
    /* eslint-enable @typescript-eslint/no-require-imports */
    return cachedSessionRootModule
  } catch {
    cachedSessionRootModule = null
    return undefined
  }
}

/**
 * densable `U()` — `return n()`. Local `n()` is `getBootstrapSession()`.
 * Standalone Ink tests fall back to a process object when src is unbound.
 */
const inkDefaultHost: object = {}
/** densable `U()` fallback when src is unbound — stable so `C.of(U())` keys. */
const inkDefaultSession: InkSessionObject = { host: inkDefaultHost }
let getInkSessionHostOverride: (() => object) | undefined

const overrideSessions = new WeakMap<object, InkSessionObject>()

function unwrapSessionRoot(session: InkSessionObject): InkSessionObject {
  const maybeRoot = session.root
  return typeof maybeRoot === 'object' && maybeRoot !== null
    ? (maybeRoot as InkSessionObject)
    : session
}

function U(): InkSessionObject {
  if (getInkSessionHostOverride) {
    const host = getInkSessionHostOverride()
    const existing = overrideSessions.get(host)
    if (existing) return existing
    const session: InkSessionObject = { host }
    overrideSessions.set(host, session)
    return session
  }
  const mod = getSessionRootModule()
  if (mod) {
    return unwrapSessionRoot(mod.getBootstrapSession())
  }
  return inkDefaultSession
}

/**
 * True when running inside an active ALS session/subconversation context or
 * when a standalone Ink test has bound a host override via `bindInkSessionHost`.
 */
export function hasInkActiveSessionAls(): boolean {
  if (getInkSessionHostOverride !== undefined) return true
  return getSessionRootModule()?.hasActiveSessionAls() ?? false
}

/**
 * Capture the active ALS `Session` (if any) without falling back to the
 * process-default bootstrap session, so non-ALS single-host CLI mode keeps
 * `hasActiveSessionAls() === false`.
 */
export function captureInkAlsSession(): object | undefined {
  return getSessionRootModule()?.getActiveSessionFromAls()
}

/**
 * Re-enter a previously captured ALS `Session` only when it is defined and
 * differs from the currently active ALS session.
 */
export function runWithCapturedInkAlsSession<T>(
  captured: object | undefined,
  fn: () => T,
): T {
  if (captured === undefined) return fn()
  const mod = getSessionRootModule()
  if (!mod || mod.getActiveSessionFromAls() === captured) return fn()
  return mod.runWithSession(
    captured as Parameters<SessionRootModule['runWithSession']>[0],
    fn,
  )
}

/** Test helper — gold has no bind; tests pin `U().host`. */
export function bindInkSessionHost(getHost: () => object): void {
  getInkSessionHostOverride = getHost
}

/** Test helper — restore densable `U()`. */
export function resetInkSessionHostForTests(): void {
  getInkSessionHostOverride = undefined
}

/**
 * Synchronously execute `fn` with `inkSessionHost()` pinned to `host`.
 * Fast-paths when `host` is already active so non-ALS single-host CLI mode
 * keeps `hasInkActiveSessionAls() === false`.
 */
export function runWithInkSessionHost<T>(host: object, fn: () => T): T {
  if (inkSessionHost() === host) return fn()
  const prevOverride = getInkSessionHostOverride
  getInkSessionHostOverride = () => host
  try {
    return fn()
  } finally {
    getInkSessionHostOverride = prevOverride
  }
}

/**
 * densable `$yf` / `it extends Map` — Ink registry keyed by stdout WriteStream.
 * Gold `set` throws when a second root is registered while the occupant
 * `holdsRawMode` (`(appRef.current?.rawModeEnabledCount??0)>0`).
 */
class InkInstancesMap extends Map<NodeJS.WriteStream, Ink> {
  standaloneRender: Promise<unknown> | null = null
  /** Official 2.1.327 (#448/#449): last Ink instance restored during shutdown so drainStdin still works after detach. */
  restoredAtExit: Ink | undefined = undefined
  /** densable `it.treeRoots` — stdout → Ink for `tree()` roots. */
  readonly treeRoots = new Map<NodeJS.WriteStream, Ink>()
  /** Per-host everMounted flag (densable Zjn/Yhp) — set on first instances.set. */
  everMounted = false

  set(key: NodeJS.WriteStream, value: Ink): this {
    this.everMounted = true
    const occupant = this.get(key)
    if (
      occupant &&
      occupant !== value &&
      !occupant.hasUnmounted &&
      occupant.holdsRawMode
    ) {
      throw new Error(
        'ink: second root created on a stream whose mounted root still holds stdin (raw mode); unmount the previous root first',
      )
    }
    return super.set(key, value)
  }

  /**
   * densable claimForStandaloneRender — store promise.then(clear, clear) so
   * createRoot / wrappedRender can await pendingStandaloneRender.
   */
  claimForStandaloneRender(promise: Promise<unknown>): void {
    const clear = (): void => {
      if (this.standaloneRender === claimed) {
        this.standaloneRender = null
      }
    }
    const claimed = promise.then(clear, clear)
    this.standaloneRender = claimed
  }

  get pendingStandaloneRender(): Promise<unknown> | null {
    return this.standaloneRender
  }
}

/**
 * densable `z` — WeakMap factory keyed by session host. Do not export.
 */
class HostKeyedFactory<K extends object, V> {
  #create: () => V
  #map = new WeakMap<K, V>()
  constructor(create: () => V) {
    this.#create = create
  }
  of(key: K): V {
    const existing = this.#map.get(key)
    if (existing !== undefined) return existing
    const created = this.#create()
    this.#map.set(key, created)
    return created
  }
}

/**
 * Host-keyed WeakMap slot for Ink modules (official 2.1.331 `HostSlot` parity).
 * Defaults to the active `inkSessionHost()` (`U().host`).
 */
export class InkHostSlot<T> {
  #create: () => T
  #map = new WeakMap<object, T>()

  constructor(create: () => T) {
    this.#create = create
  }

  of(host: object = inkSessionHost()): T {
    const existing = this.#map.get(host)
    if (existing !== undefined) return existing
    if (this.#map.has(host)) return existing as T
    const created = this.#create()
    this.#map.set(host, created)
    return created
  }

  peek(host: object = inkSessionHost()): T | undefined {
    return this.#map.get(host)
  }

  delete(host: object = inkSessionHost()): boolean {
    return this.#map.delete(host)
  }
}

/**
 * Root-session-keyed WeakMap slot for Ink modules (official 2.1.331
 * `RootSessionSlot` parity). Unwraps `session.root ?? session` so
 * `withProject` forks share the root session slot.
 */
export class InkSessionSlot<T> {
  #create: () => T
  #map = new WeakMap<object, T>()

  constructor(create: () => T) {
    this.#create = create
  }

  #resolveKey(session: object): object {
    const maybeRoot = (session as { root?: unknown }).root
    return typeof maybeRoot === 'object' && maybeRoot !== null
      ? maybeRoot
      : session
  }

  of(session: object = inkSession()): T {
    const key = this.#resolveKey(session)
    const existing = this.#map.get(key)
    if (existing !== undefined) return existing
    if (this.#map.has(key)) return existing as T
    const created = this.#create()
    this.#map.set(key, created)
    return created
  }

  peek(session: object = inkSession()): T | undefined {
    return this.#map.get(this.#resolveKey(session))
  }

  delete(session: object = inkSession()): boolean {
    return this.#map.delete(this.#resolveKey(session))
  }
}

/** densable `Ht` — `new z(() => new it)`. */
const Ht = new HostKeyedFactory<object, InkInstancesMap>(
  () => new InkInstancesMap(),
)

/** densable `Ns` — `return Ht.of(U().host)`. */
export function Ns(): InkInstancesMap {
  return Ht.of(U().host)
}

/** densable `U().host` — session key for `Ns` / `Jk`. */
export function inkSessionHost(): object {
  return U().host
}

/** densable `U()` — root session bag key for `Oo` (`r.of(U())`). */
export function inkSession(): object {
  return unwrapSessionRoot(U())
}

/**
 * densable DualInk `class f{current=void 0}`. Never export minify `f`.
 */
class DualInkCurrentBag {
  current: Record<string, unknown> | undefined = undefined
}

/** densable DualInk `C = new Ct(() => new f)`. */
const dualInkCurrentFactory = new HostKeyedFactory<object, DualInkCurrentBag>(
  () => new DualInkCurrentBag(),
)

/**
 * densable DualInk `a()` — `C.of(U())`. Never `export function a`.
 */
export function getDualInkCurrentBag(): {
  current: Record<string, unknown> | undefined
} {
  return dualInkCurrentFactory.of(U())
}

/**
 * densable DualInk `FPe()` — `a().current!==void 0`. Never `export function FPe`.
 */
export function isDualInkCurrentPresent(): boolean {
  return getDualInkCurrentBag().current !== undefined
}

/**
 * densable DualInk `A()` mint. Gold live/autoReact maps stay unhosted;
 * liveReplicas DualInk `se`/`also` slots are void 0. `authoringProgress` and
 * `artifactPolicyFetchAnswer` live on this mint (not SessionHost / `nt.of`).
 * Never `export function A`.
 */
function mintDualInkCurrent(): Record<string, unknown> {
  return {
    liveReplicas: {
      workingCopyPath: undefined,
      settleFileChange: undefined,
      liveFileEnded: undefined,
      pushHeldSaves: undefined,
      heldSavesExitCleanup: undefined,
    },
    authoringProgress: {
      slotsByBlockIndex: new Map(),
      failureReported: false,
    },
    artifactPolicyFetchAnswer: null,
  }
}

/**
 * densable DualInk `X()` — `e.current??=A()`. Never `export function X`.
 */
export function ensureDualInkCurrent(): Record<string, unknown> {
  const bag = getDualInkCurrentBag()
  bag.current ??= mintDualInkCurrent()
  return bag.current
}

const instances = Ns()
export default instances

/** Test helper — DualInk `a().current` back to void 0. */
export function resetDualInkCurrentForTests(): void {
  getDualInkCurrentBag().current = undefined
}

/** Test helper — reset densable everMounted state. */
export function resetEverMountedForTests(): void {
  const clearMap = (map: InkInstancesMap): void => {
    map.everMounted = false
    map.standaloneRender = null
    map.restoredAtExit = undefined
    map.treeRoots.clear()
    map.clear()
  }
  const current = Ns()
  clearMap(current)
  if (instances !== current) {
    clearMap(instances)
  }
  resetDualInkCurrentForTests()
  resetInkSessionHostForTests()
  const afterReset = Ns()
  if (afterReset !== current && afterReset !== instances) {
    clearMap(afterReset)
  }
  resetDualInkCurrentForTests()
}
