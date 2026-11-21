import { describe, expect, test } from 'bun:test'
import { createCrossPlatformExecutor } from '../executorCrossPlatform.js'
import { getActiveHeldKeys, trackHeldChord } from '../keyChordSafety.js'
import type { loadPlatform } from '../platforms/index.js'

type PlatformBackend = ReturnType<typeof loadPlatform>

function makeStubPlatform(
  events: string[],
  hooks?: {
    onKey?: (k: string, action: 'press' | 'release') => Promise<void>
    onKeys?: (parts: string[]) => Promise<void>
    onTypeText?: (text: string) => Promise<void>
    onClick?: (x: number, y: number, button: string) => Promise<void>
  },
): PlatformBackend {
  return {
    display: {
      getSize: () => ({
        width: 1920,
        height: 1080,
        scaleFactor: 1,
        displayId: 0,
      }),
      listAll: () => [],
    },
    screenshot: {
      captureScreen: async () => ({ base64: '', width: 1920, height: 1080 }),
      captureRegion: async () => ({ base64: '', width: 100, height: 100 }),
    },
    input: {
      keys: async (parts: string[]) => {
        events.push(
          `keys:${parts.join('+')}:held=[${getActiveHeldKeys().join(',')}]`,
        )
        await hooks?.onKeys?.(parts)
      },
      key: async (k: string, action: 'press' | 'release') => {
        events.push(
          `key:${action}:${k}:held=[${getActiveHeldKeys().join(',')}]`,
        )
        await hooks?.onKey?.(k, action)
      },
      typeText: async (text: string) => {
        events.push(`type:${text}:held=[${getActiveHeldKeys().join(',')}]`)
        await hooks?.onTypeText?.(text)
      },
      moveMouse: async () => {},
      click: async (
        x: number,
        y: number,
        button: 'left' | 'right' | 'middle',
      ) => {
        events.push(
          `click:${button}@${x},${y}:held=[${getActiveHeldKeys().join(',')}]`,
        )
        await hooks?.onClick?.(x, y, button)
      },
      mouseLocation: async () => ({ x: 0, y: 0 }),
      scroll: async () => {},
    },
    apps: {
      listInstalled: async () => [],
      listRunning: async () => [],
      getFrontmost: async () => null,
      launch: async () => {},
      activate: async () => {},
    },
  } as unknown as PlatformBackend
}

describe('executorCrossPlatform keyChordSafety & tracking (P1-#40)', () => {
  test('honors opts.getAllowSystemKeyCombos across key, holdKey, and click', async () => {
    const events: string[] = []
    let allowSystem = false
    const exec = createCrossPlatformExecutor({
      getMouseAnimationEnabled: () => false,
      getHideBeforeActionEnabled: () => false,
      getAllowSystemKeyCombos: () => allowSystem,
      platformOverride: makeStubPlatform(events),
    })

    const sysCombo = process.platform === 'darwin' ? 'cmd+q' : 'alt+f4'
    const sysParts = sysCombo.split('+')

    await expect(exec.key(sysCombo)).rejects.toThrow(/systemKeyCombos/i)
    await expect(exec.holdKey(sysParts, 1)).rejects.toThrow(/systemKeyCombos/i)
    await expect(exec.click(10, 20, 'left', 1, sysParts)).rejects.toThrow(
      /systemKeyCombos/i,
    )
    expect(events).toEqual([])
    expect(getActiveHeldKeys()).toEqual([])

    allowSystem = true
    await exec.key(sysCombo)
    expect(events[0]).toContain(`keys:${sysCombo}:held=[${sysParts.join(',')}]`)
    expect(getActiveHeldKeys()).toEqual([])
  })

  test('holdKey keeps tracking active UNTIL AFTER held keys are released in finally', async () => {
    const events: string[] = []
    const exec = createCrossPlatformExecutor({
      getMouseAnimationEnabled: () => false,
      getHideBeforeActionEnabled: () => false,
      platformOverride: makeStubPlatform(events),
    })

    await exec.holdKey(['shift', 'a'], 1)
    expect(events).toEqual([
      'key:press:shift:held=[shift,a]',
      'key:press:a:held=[shift,a]',
      // CRITICAL: tracking MUST still show shift,a while keys are being released!
      'key:release:a:held=[shift,a]',
      'key:release:shift:held=[shift,a]',
    ])
    // Tracking released only AFTER all keys released
    expect(getActiveHeldKeys()).toEqual([])
  })

  test('type refuses space while Control is held and tracks typed chars', async () => {
    const events: string[] = []
    const exec = createCrossPlatformExecutor({
      getMouseAnimationEnabled: () => false,
      getHideBeforeActionEnabled: () => false,
      platformOverride: makeStubPlatform(events),
    })

    const release = trackHeldChord(['ctrl'])
    try {
      await expect(exec.type('a b', { viaClipboard: false })).rejects.toThrow(
        /app launcher|refused/i,
      )
    } finally {
      release()
    }

    await exec.type('hi', { viaClipboard: false })
    expect(events).toEqual(['type:hi:held=[h,i]'])
    expect(getActiveHeldKeys()).toEqual([])
  })

  test('click presses/releases validated modifiers and keeps tracking until after release', async () => {
    const events: string[] = []
    const exec = createCrossPlatformExecutor({
      getMouseAnimationEnabled: () => false,
      getHideBeforeActionEnabled: () => false,
      platformOverride: makeStubPlatform(events),
    })

    await exec.click(100, 200, 'left', 1, ['shift'])
    expect(events).toEqual([
      'key:press:shift:held=[shift]',
      'click:left@100,200:held=[shift]',
      'key:release:shift:held=[shift]',
    ])
    expect(getActiveHeldKeys()).toEqual([])
  })
})
