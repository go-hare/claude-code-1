import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as darwinSwift from '../../../../packages/@ant/computer-use-swift/src/backends/darwin.js'
import * as linuxSwift from '../../../../packages/@ant/computer-use-swift/src/backends/linux.js'
import * as win32Swift from '../../../../packages/@ant/computer-use-swift/src/backends/win32.js'
import {
  createCrossPlatformExecutor,
  unhideComputerUseAppsCrossPlatform,
} from '../executorCrossPlatform.js'
import {
  isComputerUseSystemKeyCombosGranted,
  setComputerUseSystemKeyCombosReader,
} from '../hostAdapter.js'
import { platform as linuxPlatform } from '../platforms/linux.js'
import {
  callSync,
  ensureBridge,
  stopAllBridges,
  stopBridge,
} from '../win32/bridgeClient.js'
import { closeExcel, readCell } from '../win32/comExcel.js'
import { closeWord, readText } from '../win32/comWord.js'
import {
  hideAllIndicators,
  hideIndicator,
  indicateClick,
  indicateDone,
  indicateKey,
  indicateScroll,
  indicateTyping,
  showIndicator,
  updateIndicator,
} from '../win32/inputIndicator.js'
import {
  getTmpDir,
  MODIFIER_KEYS,
  runPs,
  VK_MAP,
  validateHwnd,
} from '../win32/shared.js'
import {
  hideAllVirtualCursors,
  hideVirtualCursor,
  isVirtualCursorActive,
  moveVirtualCursor,
  showVirtualCursor,
} from '../win32/virtualCursor.js'
import { captureWindow } from '../win32/windowCapture.js'

const REPO_ROOT = resolve(import.meta.dir, '../../../..')

const NODE_COMPAT_COMPUTER_USE_FILES = [
  'packages/@ant/computer-use-input/src/backends/linux.ts',
  'packages/@ant/computer-use-input/src/backends/win32.ts',
  'packages/@ant/computer-use-swift/src/backends/darwin.ts',
  'packages/@ant/computer-use-swift/src/backends/linux.ts',
  'packages/@ant/computer-use-swift/src/backends/win32.ts',
  'src/utils/computerUse/executorCrossPlatform.ts',
  'src/utils/computerUse/hostAdapter.ts',
  'src/utils/computerUse/platforms/linux.ts',
  'src/utils/computerUse/win32/bridgeClient.ts',
  'src/utils/computerUse/win32/comExcel.ts',
  'src/utils/computerUse/win32/comWord.ts',
  'src/utils/computerUse/win32/inputIndicator.ts',
  'src/utils/computerUse/win32/shared.ts',
  'src/utils/computerUse/win32/virtualCursor.ts',
  'src/utils/computerUse/win32/windowCapture.ts',
  'src/utils/computerUse/win32/windowEnum.ts',
] as const

describe('Node.js compatibility for ComputerUse (Bun.* elimination)', () => {
  test('zero Bun.* references or as any casts remain across all 16 ComputerUse files', () => {
    for (const relPath of NODE_COMPAT_COMPUTER_USE_FILES) {
      const absPath = resolve(REPO_ROOT, relPath)
      expect(existsSync(absPath)).toBe(true)
      const source = readFileSync(absPath, 'utf8')
      expect(source).not.toMatch(/\bBun\./)
      expect(source).not.toMatch(/\bas any\b/)
      expect(source).toContain('node:child_process')
    }
  })

  test('Linux screenshot backends use node:fs/promises readFile instead of Bun.file', () => {
    for (const relPath of [
      'packages/@ant/computer-use-swift/src/backends/linux.ts',
      'src/utils/computerUse/platforms/linux.ts',
    ]) {
      const source = readFileSync(resolve(REPO_ROOT, relPath), 'utf8')
      expect(source).toContain("from 'node:fs/promises'")
      expect(source).toContain('readFile(')
    }
  })

  test('win32/shared helpers validate HWND, resolve temp dir, expose key maps, and handle missing PowerShell safely', () => {
    expect(validateHwnd('123456')).toBe('123456')
    expect(() => validateHwnd('123; calc')).toThrow('Invalid HWND')
    expect(() => validateHwnd('')).toThrow('Invalid HWND')
    expect(getTmpDir().length).toBeGreaterThan(0)
    expect(VK_MAP.enter).toBe(0x0d)
    expect(VK_MAP.escape).toBe(0x1b)
    expect(MODIFIER_KEYS.has('ctrl')).toBe(true)
    expect(MODIFIER_KEYS.has('shift')).toBe(true)

    if (process.platform !== 'win32') {
      expect(runPs('Write-Output "hi"')).toBeNull()
    }
  })

  test('win32 COM, bridge, indicator, and virtual cursor safe no-op and teardown helpers work cleanly', () => {
    expect(() => closeExcel('/tmp/test.xlsx')).not.toThrow()
    expect(() => closeWord('/tmp/test.docx')).not.toThrow()

    expect(() => stopBridge()).not.toThrow()
    expect(() => stopAllBridges()).not.toThrow()

    expect(isVirtualCursorActive()).toBe(false)
    expect(() => moveVirtualCursor(10, 20, true)).not.toThrow()
    expect(() => hideVirtualCursor()).not.toThrow()
    expect(() => hideAllVirtualCursors()).not.toThrow()

    expect(() => updateIndicator('test')).not.toThrow()
    expect(() => indicateTyping('hello world')).not.toThrow()
    expect(() => indicateKey('Ctrl+S')).not.toThrow()
    expect(() => indicateClick(100, 200, 'right')).not.toThrow()
    expect(() => indicateScroll('down', 3)).not.toThrow()
    expect(() => indicateDone()).not.toThrow()
    expect(() => hideIndicator()).not.toThrow()
    expect(() => hideAllIndicators()).not.toThrow()
  })

  test('hostAdapter systemKeyCombos grant reader toggles cleanly', () => {
    try {
      setComputerUseSystemKeyCombosReader(undefined)
      expect(isComputerUseSystemKeyCombosGranted()).toBe(false)
      setComputerUseSystemKeyCombosReader(() => true)
      expect(isComputerUseSystemKeyCombosGranted()).toBe(true)
      setComputerUseSystemKeyCombosReader(() => {
        throw new Error('boom')
      })
      expect(isComputerUseSystemKeyCombosGranted()).toBe(false)
    } finally {
      setComputerUseSystemKeyCombosReader(undefined)
    }
  })

  test('createCrossPlatformExecutor and unhideComputerUseAppsCrossPlatform work with injected platform stub', async () => {
    const events: string[] = []
    const executor = createCrossPlatformExecutor({
      getMouseAnimationEnabled: () => false,
      getHideBeforeActionEnabled: () => false,
      platformOverride: {
        input: {
          moveMouse: async (x, y) => {
            events.push(`move:${x},${y}`)
          },
          click: async (x, y, btn) => {
            events.push(`click:${x},${y},${btn}`)
          },
          typeText: async text => {
            events.push(`type:${text}`)
          },
          key: async (name, action) => {
            events.push(`key:${name}:${action}`)
          },
          keys: async parts => {
            events.push(`keys:${parts.join('+')}`)
          },
          scroll: async (amount, dir) => {
            events.push(`scroll:${dir}:${amount}`)
          },
          mouseLocation: async () => ({ x: 42, y: 84 }),
        },
        screenshot: {
          captureScreen: async () => ({
            base64: 'ZmFrZQ==',
            width: 800,
            height: 600,
          }),
          captureRegion: async (_x, _y, w, h) => ({
            base64: 'cmVnaW9u',
            width: w,
            height: h,
          }),
        },
        display: {
          listAll: () => [
            { width: 800, height: 600, scaleFactor: 1, displayId: 0 },
          ],
          getSize: () => ({
            width: 800,
            height: 600,
            scaleFactor: 1,
            displayId: 0,
          }),
        },
        apps: {
          listRunning: () => [{ id: '1', pid: 100, title: 'Editor' }],
          listInstalled: async () => [
            { id: 'editor', displayName: 'Editor', path: '/usr/bin/editor' },
          ],
          open: async id => {
            events.push(`open:${id}`)
          },
          getFrontmostApp: () => ({ id: 'editor', appName: 'Editor' }),
          findWindowByTitle: () => null,
        },
      },
    })

    expect(await executor.getDisplaySize()).toEqual({
      width: 800,
      height: 600,
      scaleFactor: 1,
      displayId: 0,
      originX: 0,
      originY: 0,
    })
    expect(await executor.getCursorPosition()).toEqual({ x: 42, y: 84 })
    expect(await executor.listRunningApps()).toEqual([
      { bundleId: '1', displayName: 'Editor' },
    ])
    expect(await executor.listInstalledApps()).toEqual([
      { bundleId: 'editor', displayName: 'Editor', path: '/usr/bin/editor' },
    ])
    await executor.moveMouse(10, 20)
    await executor.click(30, 40, 'left', 1)
    await executor.scroll(0, 0, 2, -3)
    await unhideComputerUseAppsCrossPlatform(['editor'])
    expect(events).toEqual([
      'move:10,20',
      'click:30,40,left',
      'scroll:vertical:-3',
      'scroll:horizontal:2',
    ])
  })

  test('computer-use-swift darwin, linux, and win32 backends expose expected cross-runtime helpers', async () => {
    expect(darwinSwift.apps.iconDataUrl('/Applications/Safari.app')).toBeNull()
    expect(darwinSwift.screenshot.captureWindowTarget('Safari')).toBeNull()
    expect(await darwinSwift.apps.prepareDisplay([], '', 1)).toEqual({
      activated: '',
      hidden: [],
    })
    expect(await darwinSwift.apps.previewHideSet([], 1)).toEqual([])
    expect(await darwinSwift.apps.findWindowDisplays(['com.test.app'])).toEqual(
      [{ bundleId: 'com.test.app', displayIds: [1] }],
    )

    expect(linuxSwift.apps.iconDataUrl('/usr/bin/foo')).toBeNull()
    expect(linuxSwift.screenshot.captureWindowTarget('Firefox')).toBeNull()
    expect(await linuxSwift.apps.prepareDisplay([], '', 0)).toEqual({
      activated: '',
      hidden: [],
    })
    expect(await linuxSwift.apps.previewHideSet([], 0)).toEqual([])
    expect(await linuxSwift.apps.findWindowDisplays(['firefox'])).toEqual([
      { bundleId: 'firefox', displayIds: [0] },
    ])

    expect(win32Swift.apps.iconDataUrl('C:\\app.exe')).toBeNull()
    expect(await win32Swift.apps.prepareDisplay([], '', 0)).toEqual({
      activated: '',
      hidden: [],
    })
    expect(await win32Swift.apps.previewHideSet([], 0)).toEqual([])
    expect(await win32Swift.apps.findWindowDisplays(['notepad'])).toEqual([
      { bundleId: 'notepad', displayIds: [0] },
    ])

    // Linux platform display fallback when xrandr is unavailable (e.g. macOS/headless)
    const linuxSize = linuxPlatform.display.getSize()
    expect(linuxSize.width).toBeGreaterThan(0)
    expect(linuxSize.height).toBeGreaterThan(0)
  })

  test('R4-P0-1 & R4-P1-6: spawnSync callers configure explicit maxBuffer and reject error/non-zero status before parsing stdout', () => {
    const bufferChecks: Array<{ relPath: string; expectedMaxBuffer: string }> =
      [
        {
          relPath: 'src/utils/computerUse/win32/windowCapture.ts',
          expectedMaxBuffer: '64 * 1024 * 1024',
        },
        {
          relPath: 'src/utils/computerUse/win32/bridgeClient.ts',
          expectedMaxBuffer: '64 * 1024 * 1024',
        },
        {
          relPath: 'src/utils/computerUse/win32/comExcel.ts',
          expectedMaxBuffer: '32 * 1024 * 1024',
        },
        {
          relPath: 'src/utils/computerUse/win32/comWord.ts',
          expectedMaxBuffer: '32 * 1024 * 1024',
        },
        {
          relPath: 'src/utils/computerUse/win32/shared.ts',
          expectedMaxBuffer: '32 * 1024 * 1024',
        },
        {
          relPath: 'src/utils/computerUse/executorCrossPlatform.ts',
          expectedMaxBuffer: '32 * 1024 * 1024',
        },
      ]

    for (const { relPath, expectedMaxBuffer } of bufferChecks) {
      const src = readFileSync(resolve(REPO_ROOT, relPath), 'utf8')
      expect(src).toContain(expectedMaxBuffer)
      expect(src).toContain('maxBuffer')
      expect(src).toMatch(/result\.status\s*!==\s*0/)
      expect(src).toContain('result.error')
    }

    if (process.platform !== 'win32') {
      expect(captureWindow('NonExistentWindow')).toBeNull()
      expect(callSync('ping')).toBeNull()
      expect(() => readCell('/tmp/missing.xlsx', 1, 1, 1)).toThrow()
    }
  })

  test('R4-P0-2: openTerminal avoids nested PowerShell quote interpolation using direct spawn + -EncodedCommand', () => {
    const src = readFileSync(
      resolve(REPO_ROOT, 'src/utils/computerUse/executorCrossPlatform.ts'),
      'utf8',
    )
    expect(src).not.toContain('Start-Process powershell -ArgumentList')
    expect(src).toContain("'-NoExit', '-EncodedCommand', encodedCmd")
    expect(src).toContain("Buffer.from(cmd, 'utf16le').toString('base64')")
    expect(src).toContain('windowsHide: false')
  })

  test('R4-P0-3: darwin and win32 computer-use-swift backends avoid shell and script interpolation', async () => {
    const darwinSrc = readFileSync(
      resolve(
        REPO_ROOT,
        'packages/@ant/computer-use-swift/src/backends/darwin.ts',
      ),
      'utf8',
    )
    expect(darwinSrc).toContain('on run argv')
    expect(darwinSrc).toContain('item 1 of argv')
    expect(darwinSrc).not.toContain('tell application id "${bundleId}"')
    expect(darwinSrc).not.toContain("spawnCollectStdout('bash'")
    expect(darwinSrc).toContain("from 'node:fs/promises'")
    expect(darwinSrc).toContain("spawnCollectStdout('mdls'")

    const win32Src = readFileSync(
      resolve(
        REPO_ROOT,
        'packages/@ant/computer-use-swift/src/backends/win32.ts',
      ),
      'utf8',
    )
    expect(win32Src).toContain("Get-Process -Name '${escaped}'")
    expect(win32Src).not.toContain('Get-Process -Name "${name}"')

    if (process.platform === 'darwin') {
      const installed = await darwinSwift.apps.listInstalled()
      expect(Array.isArray(installed)).toBe(true)
    }
  })

  test('R4-P1-2 & R4-P2-4: bridgeClient, inputIndicator, and virtualCursor guard missing pid and reject pending bridge requests on stop', async () => {
    const bridgeSrc = readFileSync(
      resolve(REPO_ROOT, 'src/utils/computerUse/win32/bridgeClient.ts'),
      'utf8',
    )
    expect(bridgeSrc).toContain('if (proc.pid == null)')
    expect(bridgeSrc).toContain('timer.unref?.()')
    expect(bridgeSrc).toContain(
      'const pending = [...state.pendingRequests.values()]',
    )

    const indicatorSrc = readFileSync(
      resolve(REPO_ROOT, 'src/utils/computerUse/win32/inputIndicator.ts'),
      'utf8',
    )
    expect(indicatorSrc).toContain('if (proc.pid == null)')

    const cursorSrc = readFileSync(
      resolve(REPO_ROOT, 'src/utils/computerUse/win32/virtualCursor.ts'),
      'utf8',
    )
    expect(cursorSrc).toContain('if (proc.pid == null)')

    if (process.platform !== 'win32') {
      expect(showIndicator('12345')).toBe(false)
      expect(showVirtualCursor('12345')).toBe(false)
      expect(isVirtualCursorActive()).toBe(false)
      expect(await readText('/tmp/missing.docx')).toBe('')
      // Ensure ensureBridge never throws even if python is missing or present
      const started = ensureBridge()
      expect(typeof started).toBe('boolean')
      stopBridge()
    }
  })

  test('R4-P2-1 & R4-P2-5: xdotool commands terminate flags with -- and dead async helpers are removed', () => {
    const inputLinuxSrc = readFileSync(
      resolve(
        REPO_ROOT,
        'packages/@ant/computer-use-input/src/backends/linux.ts',
      ),
      'utf8',
    )
    expect(inputLinuxSrc).toContain(
      "run(['xdotool', 'type', '--delay', '12', '--', text])",
    )
    expect(inputLinuxSrc).not.toContain('function runAsync')

    const inputWin32Src = readFileSync(
      resolve(
        REPO_ROOT,
        'packages/@ant/computer-use-input/src/backends/win32.ts',
      ),
      'utf8',
    )
    expect(inputWin32Src).not.toContain('function psAsync')

    const platformLinuxSrc = readFileSync(
      resolve(REPO_ROOT, 'src/utils/computerUse/platforms/linux.ts'),
      'utf8',
    )
    expect(platformLinuxSrc).toContain(
      "run(['xdotool', 'type', '--delay', '12', '--', text])",
    )
    expect(platformLinuxSrc).toContain(
      "run(['xdotool', 'search', '--name', '--', title])",
    )
  })
})
