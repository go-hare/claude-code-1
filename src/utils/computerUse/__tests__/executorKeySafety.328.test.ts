import { afterEach, describe, expect, test } from 'bun:test'
import { createCliExecutor } from '../executor.js'
import {
  isComputerUseSystemKeyCombosGranted,
  setComputerUseSystemKeyCombosReader,
} from '../hostAdapter.js'
import { getActiveHeldKeys } from '../keyChordSafety.js'

function createFakeInput() {
  const events: string[] = []
  let keyInFlightResolve: (() => void) | undefined
  let releaseInFlightResolve: (() => void) | undefined
  let typeInFlightResolve: (() => void) | undefined

  const input = {
    isSupported: true,
    moveMouse: async () => {},
    mouseLocation: async () => ({ x: 0, y: 0 }),
    mouseButton: async () => {},
    mouseScroll: async () => {},
    getFrontmostAppInfo: () => null,
    keys: async (parts: string[]) => {
      events.push(`keys:${parts.join('+')}`)
      if (keyInFlightResolve) {
        await new Promise<void>(resolve => {
          const prev = keyInFlightResolve
          keyInFlightResolve = () => {
            prev?.()
            resolve()
          }
        })
      }
    },
    key: async (k: string, dir: 'press' | 'release') => {
      events.push(`key:${dir}:${k}`)
      if (dir === 'release' && releaseInFlightResolve) {
        await new Promise<void>(resolve => {
          const prev = releaseInFlightResolve
          releaseInFlightResolve = () => {
            prev?.()
            resolve()
          }
        })
      }
    },
    typeText: async (text: string) => {
      events.push(`type:${text}`)
      if (typeInFlightResolve) {
        await new Promise<void>(resolve => {
          const prev = typeInFlightResolve
          typeInFlightResolve = () => {
            prev?.()
            resolve()
          }
        })
      }
    },
  }

  return {
    input,
    events,
    pauseNextKeys() {
      keyInFlightResolve = () => {}
      return () => {
        const fn = keyInFlightResolve
        keyInFlightResolve = undefined
        fn?.()
      }
    },
    pauseNextRelease() {
      releaseInFlightResolve = () => {}
      return () => {
        const fn = releaseInFlightResolve
        releaseInFlightResolve = undefined
        fn?.()
      }
    },
    pauseNextType() {
      typeInFlightResolve = () => {}
      return () => {
        const fn = typeInFlightResolve
        typeInFlightResolve = undefined
        fn?.()
      }
    },
  }
}

describe('2.1.328 ComputerUse systemKeyCombos grant & concurrent key tracking', () => {
  afterEach(() => {
    setComputerUseSystemKeyCombosReader(undefined)
  })

  test('hostAdapter systemKeyCombos grant reader controls whether system combos succeed', async () => {
    if (process.platform !== 'darwin') return
    let granted = false
    setComputerUseSystemKeyCombosReader(() => granted)

    const fake = createFakeInput()
    const executor = createCliExecutor({
      getMouseAnimationEnabled: () => false,
      getHideBeforeActionEnabled: () => false,
      getAllowSystemKeyCombos: isComputerUseSystemKeyCombosGranted,
      getInput: () => fake.input as never,
      swiftOverride: {} as never,
      runOnMainLoop: fn => fn(),
    })

    // Unapproved: cmd+q is rejected
    await expect(executor.key('cmd+q')).rejects.toThrow(/systemKeyCombos/)
    expect(fake.events).toEqual([])

    // Approved: cmd+q succeeds
    granted = true
    await executor.key('cmd+q')
    expect(fake.events).toEqual(['keys:cmd+q'])
  })

  test('holdKey stays tracked until after releasePressed completes', async () => {
    if (process.platform !== 'darwin') return
    const fake = createFakeInput()
    const executor = createCliExecutor({
      getMouseAnimationEnabled: () => false,
      getHideBeforeActionEnabled: () => false,
      getAllowSystemKeyCombos: () => false,
      getInput: () => fake.input as never,
      swiftOverride: {} as never,
      runOnMainLoop: fn => fn(),
    })

    const resumeRelease = fake.pauseNextRelease()
    const holdPromise = executor.holdKey(['cmd'], 5)

    // Wait until release has started (hold duration elapsed, release in flight)
    while (!fake.events.includes('key:release:cmd')) {
      await new Promise(r => setTimeout(r, 2))
    }

    // Tracking MUST STILL be active while release is in flight!
    expect(getActiveHeldKeys()).toContain('cmd')
    await expect(executor.key('q')).rejects.toThrow(/system shortcut/)

    // Now finish releasing cmd
    resumeRelease()
    await holdPromise
    expect(getActiveHeldKeys()).toEqual([])

    // After release finishes, key('q') succeeds
    await executor.key('q')
    expect(fake.events).toContain('keys:q')
  })

  test('key() and type() track concurrent active keys across their lifecycles', async () => {
    if (process.platform !== 'darwin') return
    const fake = createFakeInput()
    const executor = createCliExecutor({
      getMouseAnimationEnabled: () => false,
      getHideBeforeActionEnabled: () => false,
      getAllowSystemKeyCombos: () => false,
      getInput: () => fake.input as never,
      swiftOverride: {} as never,
      runOnMainLoop: fn => fn(),
    })

    // 1. In-flight key('cmd') blocks concurrent type('q')
    const resumeKeys = fake.pauseNextKeys()
    const keyPromise = executor.key('cmd')
    while (!fake.events.includes('keys:cmd')) {
      await new Promise(r => setTimeout(r, 2))
    }
    await expect(executor.type('q', { viaClipboard: false })).rejects.toThrow(
      /system shortcut/,
    )
    resumeKeys()
    await keyPromise
    expect(getActiveHeldKeys()).toEqual([])

    // 2. In-flight type('hello world') (contains Space) blocks concurrent key('control')
    const resumeType = fake.pauseNextType()
    const typePromise = executor.type('hello world', { viaClipboard: false })
    while (!fake.events.includes('type:hello world')) {
      await new Promise(r => setTimeout(r, 2))
    }
    await expect(executor.key('control')).rejects.toThrow(/app launcher/)
    resumeType()
    await typePromise
    expect(getActiveHeldKeys()).toEqual([])
  })
})
