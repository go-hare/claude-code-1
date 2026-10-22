import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const BIDI = join(import.meta.dir, '../bidi.ts')
const TITLE = join(import.meta.dir, '../../hooks/use-terminal-title.ts')
const INK = join(import.meta.dir, '../ink.tsx')

describe('densable 2.1.289 cv / phe / O() leftover', () => {
  test('cv.isNeeded is WT_SESSION string or vscode, keyed by U().host', async () => {
    const src = await Bun.file(BIDI).text()
    expect(src).toContain("typeof process.env.WT_SESSION === 'string'")
    expect(src).toContain("process.env.TERM_PROGRAM === 'vscode'")
    expect(src).not.toContain("process.platform === 'win32'")
    expect(src).toContain('inkSessionHost()')
    expect(src).toContain('softwareBidiByHost')
  })

  test('phe applyTerminalTitle is OSC 0 only (no process.title)', async () => {
    const src = await Bun.file(TITLE).text()
    expect(src).toContain('if (!writeRaw) return')
    expect(src).toContain('OSC.SET_TITLE_AND_ICON')
    expect(src).not.toContain('process.title =')
    expect(src).not.toContain('win32TitleEpoch')
  })

  test('Ink ctor bgWorkerForceShowCursor is O()==="windows"', async () => {
    const src = await Bun.file(INK).text()
    expect(src).toContain("O() === 'windows'")
    expect(src).toContain('bgWorkerForceShowCursor')
    expect(src).not.toContain(
      "process.env.CLAUDE_CODE_SESSION_KIND === 'bg' &&\n      process.platform === 'win32'",
    )
  })

  test('enterAlternateScreen kitty pop is eAe not always DISABLE_KITTY', async () => {
    const src = await Bun.file(INK).text()
    expect(src).toContain('ENTER_ALT_SCREEN + kittyKeyboardPopSeq()')
    expect(src).not.toContain('ENTER_ALT_SCREEN + DISABLE_KITTY_KEYBOARD')
  })
})
