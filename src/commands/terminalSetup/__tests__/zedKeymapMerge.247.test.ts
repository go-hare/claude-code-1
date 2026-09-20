/**
 * densable 2.1.247 #12 — ut/me jsonc merge, do not overwrite keymap.json.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  installZedShiftEnterKeymap,
  isZedTerminalKeymapContext,
} from '../terminalSetup.js'

const dirs: string[] = []

function tempZed(): { zedDir: string; keymapPath: string } {
  const zedDir = mkdtempSync(join(tmpdir(), 'zed-247-'))
  dirs.push(zedDir)
  return { zedDir, keymapPath: join(zedDir, 'keymap.json') }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('densable 2.1.247 #12 Zed keymap merge', () => {
  test('me recognizes Terminal shift-enter context', () => {
    expect(
      isZedTerminalKeymapContext({
        context: 'Terminal',
        bindings: { 'shift-enter': ['terminal::SendText', '\x1b\r'] },
      }),
    ).toBe(true)
    expect(
      isZedTerminalKeymapContext({
        context: 'Editor',
        bindings: { 'shift-enter': 'editor::Newline' },
      }),
    ).toBe(false)
  })

  test('missing keymap writes a new Terminal binding', async () => {
    const { zedDir, keymapPath } = tempZed()
    const result = await installZedShiftEnterKeymap('dark', zedDir, keymapPath)
    expect(result.installed).toBe(true)
    expect(result.message).toContain('Installed Zed Shift+Enter key binding')
    const parsed = JSON.parse(readFileSync(keymapPath, 'utf8')) as unknown[]
    expect(parsed.some(isZedTerminalKeymapContext)).toBe(true)
  })

  test('already configured is a no-op', async () => {
    const { zedDir, keymapPath } = tempZed()
    const original = `[
  { "context": "Terminal", "bindings": { "shift-enter": ["terminal::SendText", "\\u001b\\r"] } }
]
`
    writeFileSync(keymapPath, original)
    const result = await installZedShiftEnterKeymap('dark', zedDir, keymapPath)
    expect(result.installed).toBe(true)
    expect(result.message).toContain('already configured')
    expect(readFileSync(keymapPath, 'utf8')).toBe(original)
  })

  test('jsonc comments and other contexts survive merge', async () => {
    const { zedDir, keymapPath } = tempZed()
    writeFileSync(
      keymapPath,
      `[
  // keep this comment
  { "context": "Editor", "bindings": { "ctrl-s": "file::Save" } }
]
`,
    )
    const result = await installZedShiftEnterKeymap('dark', zedDir, keymapPath)
    expect(result.installed).toBe(true)
    const after = readFileSync(keymapPath, 'utf8')
    expect(after).toContain('keep this comment')
    expect(after).toContain('file::Save')
    expect(after).toContain('shift-enter')
    expect(after).toContain('terminal::SendText')
  })

  test('existing Terminal bindings get shift-enter merged in', async () => {
    const { zedDir, keymapPath } = tempZed()
    writeFileSync(
      keymapPath,
      `[
  { "context": "Terminal", "bindings": { "ctrl-c": "terminal::Interrupt" } }
]
`,
    )
    const result = await installZedShiftEnterKeymap('dark', zedDir, keymapPath)
    expect(result.installed).toBe(true)
    const after = readFileSync(keymapPath, 'utf8')
    expect(after).toContain('terminal::Interrupt')
    expect(after).toContain('shift-enter')
    const parsed = JSON.parse(after) as unknown[]
    expect(parsed).toHaveLength(1)
    expect(parsed.some(isZedTerminalKeymapContext)).toBe(true)
  })

  test('non-array keymap is left unchanged', async () => {
    const { zedDir, keymapPath } = tempZed()
    const original = '{ "bindings": {} }\n'
    writeFileSync(keymapPath, original)
    const result = await installZedShiftEnterKeymap('dark', zedDir, keymapPath)
    expect(result.installed).toBe(false)
    expect(result.message).toContain("isn't a readable list of keybindings")
    expect(readFileSync(keymapPath, 'utf8')).toBe(original)
  })
})
