/**
 * densable 2.1.248 #12 — after detach / win32-input-mode, agents list keys.
 *
 * Gold @187972832: wf.WIN32_INPUT_MODE:9001; CH=`?${E}h`; Hj=`?${E}l`;
 * Yot=Hj(wf.WIN32_INPUT_MODE). Attach finish writes (windows?Yot:"") so
 * fleet remount is not left in ?9001h. Local leftover: handoffRawMode only.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  DEC,
  Yot,
  decreset,
  decset,
} from '../../../packages/@ant/ink/src/core/termio/dec.js'

const SCREENS = join(import.meta.dir, '..')
const DAEMON = join(import.meta.dir, '../../daemon')

describe('densable 2.1.248 #12 WIN32_INPUT_MODE / Yot', () => {
  test('gold wf/CH/Hj: WIN32_INPUT_MODE 9001 and Yot is ?9001l', () => {
    expect(DEC.WIN32_INPUT_MODE).toBe(9001)
    expect(decset(DEC.WIN32_INPUT_MODE)).toBe('\x1B[?9001h')
    expect(decreset(DEC.WIN32_INPUT_MODE)).toBe('\x1B[?9001l')
    expect(Yot).toBe(decreset(DEC.WIN32_INPUT_MODE))
    expect(Yot).toBe('\x1B[?9001l')
    expect(Yot).not.toContain('h')
  })

  test('attach finish writes Yot on Windows and not otherwise', () => {
    const src = readFileSync(join(DAEMON, 'clientAttach.ts'), 'utf8')
    expect(src).toContain("import { Yot } from '@anthropic/ink'")
    expect(src).toContain("(isWindows ? Yot : '')")
    expect(src).toContain('restoreModes +')
    expect(src).toContain("'\\x1B[0m\\x1B7\\x1B[r\\x1B8'")
  })

  test('AgentView leftover is handoffRawMode only — does not invent Yot there', () => {
    const src = readFileSync(join(SCREENS, 'AgentView.tsx'), 'utf8')
    expect(src).toContain('handoffRawMode()')
    expect(src).toContain('applyFleetViewHostWindowsEnv')
    expect(src).not.toContain('Yot')
    expect(src).not.toContain('WIN32_INPUT_MODE')
    expect(src).not.toContain('?9001l')
  })
})
