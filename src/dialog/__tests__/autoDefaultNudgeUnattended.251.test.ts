import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isUnattendedAutoDefaultNudgeSession } from '../shouldShowAutoDefaultNudge.js'

describe('auto-default nudge skips unattended sessions (2.1.251 #42)', () => {
  test('bg sessions skip', () => {
    expect(
      isUnattendedAutoDefaultNudgeSession({
        sessionKind: 'bg',
        teammateAgentId: undefined,
        replBridgeActive: false,
      }),
    ).toBe(true)
  })

  test('teammates skip', () => {
    expect(
      isUnattendedAutoDefaultNudgeSession({
        sessionKind: undefined,
        teammateAgentId: 'worker',
        replBridgeActive: false,
      }),
    ).toBe(true)
  })

  test('an interactive session can still open it', () => {
    expect(
      isUnattendedAutoDefaultNudgeSession({
        sessionKind: undefined,
        teammateAgentId: undefined,
        replBridgeActive: false,
      }),
    ).toBe(false)
  })

  test('repl bridge active skips (oc)', () => {
    expect(
      isUnattendedAutoDefaultNudgeSession({
        sessionKind: undefined,
        teammateAgentId: undefined,
        replBridgeActive: true,
      }),
    ).toBe(true)
  })

  test('the opener consults the gate before the dialog', () => {
    const src = readFileSync(
      join(import.meta.dir, '../openAutoDefaultNudge.ts'),
      'utf8',
    )
    const gate = src.indexOf('isUnattendedAutoDefaultNudgeSession')
    const dialog = src.indexOf('shouldShowAutoDefaultNudge(getContext())')
    expect(gate).toBeGreaterThan(-1)
    expect(dialog).toBeGreaterThan(gate)
    expect(src).toContain('isReplBridgeActive()')
  })
})
