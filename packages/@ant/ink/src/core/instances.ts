// Store all instances of Ink (instance.js) to ensure that consecutive render() calls
// use the same instance of Ink and don't create a new one
//
// This map has to be stored in a separate file, because render.js creates instances,
// but instance.js should delete itself from the map on unmount
//
// densable `$yf` / `Yp` (SEA): claimForStandaloneRender + pendingStandaloneRender so
// createRoot/wrappedRender wait out a managed-settings standalone consent dialog
// before claiming stdout. everMounted mirrors densable Zjn/Yhp process flag.

import { createRequire } from 'node:module'
import type Ink from './ink.js'

/** densable process-level everMounted (Zjn/Yhp) — set on first instances.set. */
let everMountedFlag = false

/**
 * densable `U()` — `return n()`. Local `n()` is `getBootstrapSession()`.
 * Standalone Ink tests fall back to a process object when src is unbound.
 */
const inkDefaultHost: object = {}
/** densable `U()` fallback when src is unbound — stable so `C.of(U())` keys. */
const inkDefaultSession: { host: object } = { host: inkDefaultHost }
let getInkSessionHostOverride: (() => object) | undefined

const overrideSessions = new WeakMap<object, { host: object }>()

function U(): { host: object } {
  if (getInkSessionHostOverride) {
    const host = getInkSessionHostOverride()
    const existing = overrideSessions.get(host)
    if (existing) return existing
    const session = { host }
    overrideSessions.set(host, session)
    return session
  }
  try {
    const require = createRequire(import.meta.url)
    const { getBootstrapSession } =
      require('../../../../../src/utils/sessionRoot.ts') as typeof import('../../../../../src/utils/sessionRoot.ts')
    return getBootstrapSession()
  } catch {
    return inkDefaultSession
  }
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
 * densable `$yf` / `it extends Map` — Ink registry keyed by stdout WriteStream.
 * Gold `set` throws when a second root is registered while the occupant
 * `holdsRawMode` (`(appRef.current?.rawModeEnabledCount??0)>0`).
 */
class InkInstancesMap extends Map<NodeJS.WriteStream, Ink> {
  standaloneRender: Promise<unknown> | null = null
  /** densable `it.treeRoots` — stdout → Ink for `tree()` roots. */
  readonly treeRoots = new Map<NodeJS.WriteStream, Ink>()

  get everMounted(): boolean {
    return everMountedFlag
  }

  set everMounted(value: boolean) {
    everMountedFlag = value
  }

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

  delete(key: NodeJS.WriteStream): boolean {
    this.treeRoots.delete(key)
    return super.delete(key)
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

/** densable `U()` — session bag key for `Oo` (`r.of(U())`). */
export function inkSession(): object {
  return U()
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

/** Test helper — reset densable everMounted process flag. */
export function resetEverMountedForTests(): void {
  everMountedFlag = false
  instances.standaloneRender = null
  instances.treeRoots.clear()
  instances.clear()
  resetInkSessionHostForTests()
  resetDualInkCurrentForTests()
}
