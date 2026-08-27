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

/** densable process-level everMounted (Zjn/Yhp) — set on first instances.set. */
let everMountedFlag = false

/**
 * densable `$yf extends Map` — Ink registry keyed by stdout WriteStream.
 */
class InkInstancesMap extends Map<NodeJS.WriteStream, Ink> {
  standaloneRender: Promise<unknown> | null = null

  get everMounted(): boolean {
    return everMountedFlag
  }

  set everMounted(value: boolean) {
    everMountedFlag = value
  }

  set(key: NodeJS.WriteStream, value: Ink): this {
    this.everMounted = true
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

const instances = new InkInstancesMap()
export default instances

/** Test helper — reset densable everMounted process flag. */
export function resetEverMountedForTests(): void {
  everMountedFlag = false
  instances.standaloneRender = null
}
