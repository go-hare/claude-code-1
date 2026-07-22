import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import * as realModifiersNapi from 'modifiers-napi'

let nativePrewarmCalls = 0
let nativeReturnValue = false
let nativeShouldThrow = false

// Capture real exports as plain functions BEFORE mock.module — namespace
// live-bindings re-point into the mock registry under Bun mock.module.
const realPrewarm = realModifiersNapi.prewarm
const realIsModifierPressed = realModifiersNapi.isModifierPressed

const nativeIsModifierPressed = mock((modifier: string) => {
  if (nativeShouldThrow) {
    throw new Error('native modifier failure')
  }
  return nativeReturnValue
})

function installPackageMock(): void {
  mock.module('modifiers-napi', () => ({
    prewarm: async () => {
      nativePrewarmCalls++
    },
    isModifierPressed: nativeIsModifierPressed,
  }))
}

function restoreRealPackage(): void {
  mock.module('modifiers-napi', () => ({
    prewarm: realPrewarm,
    isModifierPressed: realIsModifierPressed,
  }))
}

installPackageMock()

const originalPlatform = process.platform

async function loadModule() {
  return import(`../modifiers.ts?case=${Math.random()}`)
}

beforeEach(() => {
  nativePrewarmCalls = 0
  nativeReturnValue = false
  nativeShouldThrow = false
  nativeIsModifierPressed.mockClear()
  // Re-apply package mock each test — afterEach restores real for co-suites.
  installPackageMock()
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
    configurable: true,
  })
})

afterEach(() => {
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
    configurable: true,
  })
  // Restore immediately so packages/modifiers-napi (and any other co-suite)
  // never sees the throwing mock if files interleave or afterAll is late.
  restoreRealPackage()
})

afterAll(() => {
  restoreRealPackage()
})

describe('src/utils/modifiers', () => {
  test('does not touch the native module on non-darwin', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    })
    const mod = await loadModule()

    mod.prewarmModifiers()
    expect(nativePrewarmCalls).toBe(0)
    expect(mod.isModifierPressed('shift')).toBe(false)
    expect(nativeIsModifierPressed).not.toHaveBeenCalled()
  })

  test('caches native prewarm after the first darwin call', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    })
    const mod = await loadModule()

    mod.prewarmModifiers()
    mod.prewarmModifiers()

    // prewarm is fire-and-forget async — flush microtasks
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(nativePrewarmCalls).toBe(1)
  })

  test('forwards modifier checks to the native module on darwin', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    })
    nativeReturnValue = true
    const mod = await loadModule()

    expect(mod.isModifierPressed('shift')).toBe(true)
    expect(nativeIsModifierPressed).toHaveBeenCalledWith('shift')
  })

  test('returns false when native modifier checks throw on darwin', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    })
    nativeShouldThrow = true
    const mod = await loadModule()

    expect(mod.isModifierPressed('shift')).toBe(false)
  })
})
