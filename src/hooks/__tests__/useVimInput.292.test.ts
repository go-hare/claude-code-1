import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Cursor } from '@anthropic/ink'
import { repeatVisualOp } from '../../vim/operators.js'
import { transition, visualTransition } from '../../vim/transitions.js'
import type { RecordedChange, WantedColumn } from '../../vim/types.js'

const HOOK_SRC = readFileSync(
  join(import.meta.dir, '../useVimInput.ts'),
  'utf8',
)

describe('Official 2.1.292 #224 & 2.1.293 #320 useVimInput wiring', () => {
  test('useVimInput wires wantedColumn, onEnterVisual, visualTransition, and repeatVisualOp', () => {
    expect(HOOK_SRC).toContain('wantedColumn: state.wanted')
    expect(HOOK_SRC).toContain('onEnterVisual:')
    expect(HOOK_SRC).toContain('visualTransition(')
    expect(HOOK_SRC).toContain("case 'visualOp':")
    expect(HOOK_SRC).toContain('repeatVisualOp(')
    expect(HOOK_SRC).toContain('clampVimNormalOffset(')
  })

  test('#224 j/k preserves wantedColumn across a shorter middle line', () => {
    let text = 'abcdef\nhi\n123456'
    let offset = 4 // 'e' on line 1 (col 4)
    let wanted: WantedColumn | null | undefined

    const makeCtx = () => ({
      cursor: Cursor.fromText(text, 80, offset),
      text,
      setText: (next: string) => {
        text = next
      },
      setOffset: (next: number) => {
        offset = next
      },
      enterInsert: () => {},
      getRegister: () => '',
      getRegisterIsLinewise: () => false,
      setRegister: () => {},
      getLastFind: () => null,
      setLastFind: () => {},
      recordChange: () => {},
      wantedColumn: wanted,
    })

    // j from line 1 col 4 -> line 2 ("hi") clamps to 'i' (offset 8)
    const r1 = transition({ type: 'idle' }, 'j', makeCtx())
    r1.execute?.()
    wanted = r1.wanted
    expect(offset).toBe(8)
    expect(wanted?.column).toBe(4)

    // j from line 2 -> line 3 ("123456") restores col 4 ('5', offset 14)
    const r2 = transition({ type: 'idle' }, 'j', makeCtx())
    r2.execute?.()
    expect(offset).toBe(14)
  })

  test('#320 V + d lands on first non-blank and . repeats line delete', () => {
    let text = '  alpha\n    beta\n  gamma'
    let offset = 4
    const recorded: RecordedChange[] = []
    let register = ''
    let registerLinewise = false

    const makeCtx = () => ({
      cursor: Cursor.fromText(text, 80, offset),
      text,
      setText: (next: string) => {
        text = next
      },
      setOffset: (next: number) => {
        offset = next
      },
      enterInsert: () => {},
      getRegister: () => register,
      getRegisterIsLinewise: () => registerLinewise,
      setRegister: (c: string, l: boolean) => {
        register = c
        registerLinewise = l
      },
      getLastFind: () => null,
      setLastFind: () => {},
      recordChange: (c: RecordedChange) => {
        recorded.push(c)
      },
    })

    // V + d deletes line 1 ("  alpha\n") and lands on first non-blank of "    beta"
    const res = visualTransition({ type: 'idle' }, 'd', offset, true, makeCtx())
    res.execute?.()
    expect(res.exitVisual).toBe(true)
    expect(text).toBe('    beta\n  gamma')
    expect(offset).toBe(4) // first non-blank 'b'
    const lastChange = recorded.at(-1)
    expect(lastChange?.type).toBe('visualOp')

    // Dot-repeat deletes the current line ("    beta\n")
    if (lastChange?.type === 'visualOp') {
      repeatVisualOp(
        lastChange.op,
        lastChange.span,
        lastChange.linewise,
        makeCtx(),
      )
    }
    expect(text).toBe('  gamma')
    expect(offset).toBe(2) // first non-blank 'g'
  })
})
