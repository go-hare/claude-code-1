/**
 * densable 2.1.216 #16 — GUI editor handoff (mouse/focus) + /memory no-wait.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  DFE,
  DISABLE_MOUSE_TRACKING,
  EFE,
  enableMouseTracking,
} from '@anthropic/ink'

const root = join(import.meta.dir, '../../..')

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), 'utf8')
}

describe('densable prepareTerminalForHandoff sequences', () => {
  test('handoff disable = mouse (when on) + focus off', () => {
    // densable: (altScreenMouseTracking!=="off"?dde:"")+hHt
    const fullHandoff = DISABLE_MOUSE_TRACKING + DFE
    expect(fullHandoff).toContain('?1006l')
    expect(fullHandoff).toContain('?1000l')
    expect(fullHandoff).toContain('?1004l')
    expect(fullHandoff).not.toContain('?1004h')
  })

  test('restore = mouse mode + focus on', () => {
    // densable: UNe(mode)+pKr
    const restored = enableMouseTracking('full') + EFE
    expect(restored).toContain('?1000h')
    expect(restored).toContain('?1006h')
    expect(restored).toContain('?1004h')
  })

  test('ink.tsx defines prepare/restore handoff APIs', () => {
    const ink = readSrc('packages/@ant/ink/src/core/ink.tsx')
    expect(ink).toContain('prepareTerminalForHandoff()')
    expect(ink).toContain('restoreTerminalAfterHandoff()')
    expect(ink).toContain('DISABLE_MOUSE_TRACKING')
    expect(ink).toContain('DFE')
    expect(ink).toContain('EFE')
  })
})

describe('editFileInEditor densable Wut GUI path', () => {
  test('promptEditor uses handoff APIs for GUI, not bare pause/suspend', () => {
    const src = readSrc('src/utils/promptEditor.ts')
    expect(src).toContain('prepareTerminalForHandoff()')
    expect(src).toContain('restoreTerminalAfterHandoff()')
    expect(src).toContain('spawnSync')
    expect(src).toContain("Couldn't open")
    expect(src).toContain('closed unexpectedly')
    expect(src).toContain('quit unexpectedly')
    // must not leave the pre-216 bare pause+suspend path as the GUI branch body
    expect(src).not.toMatch(
      /else \{\s*\/\/ GUI editors[\s\S]*?inkInstance\.pause\(\)\s*inkInstance\.suspendStdin\(\)/,
    )
  })
})

describe('/memory densable COb no-wait', () => {
  test('memory command uses openFileInExternalEditor (jCo), not editFileInEditor', () => {
    const src = readSrc('src/commands/memory/memory.tsx')
    expect(src).toContain('openFileInExternalEditor')
    expect(src).not.toContain('editFileInEditor')
    expect(src).toContain("Couldn't open the memory file at")
    expect(src).toContain('then run /memory again')
  })

  test('openFileInExternalEditor GUI spawn sets windowsHide + detached', () => {
    const src = readSrc('src/utils/editor.ts')
    expect(src).toContain('windowsHide: true')
    expect(src).toContain('detached: true')
    expect(src).toContain("stdio: 'ignore'")
  })
})
