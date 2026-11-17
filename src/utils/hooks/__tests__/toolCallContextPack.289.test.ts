import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  bootstrapSessionEffort,
  pdSessionEffort,
  teSettingsEffortTable,
} from '../../effort.js'
import {
  TOOL_CALL_CONTEXT_DISPATCH_CHARS,
  TOOL_CALL_CONTEXT_ENTRY_CHARS,
  TOOL_CALL_CONTEXT_PACK_FLOOR,
  listOfContextTexts,
  packToolCallContext,
  rewrittenToolCallContext,
} from '../toolCallContextPack.js'

describe('densable IVt', () => {
  test('keeps original when unmanaged', () => {
    expect(
      rewrittenToolCallContext(['a', 'b'], {
        rewritten: false,
        output: 'x',
      }),
    ).toEqual(['a', 'b'])
  })

  test('string rewrite becomes a one-entry list', () => {
    expect(
      rewrittenToolCallContext(['a'], {
        rewritten: true,
        output: 'rewritten',
      }),
    ).toEqual(['rewritten'])
  })

  test('list of texts is kept; mixed list is dropped', () => {
    expect(
      rewrittenToolCallContext(['a'], {
        rewritten: true,
        output: ['x', 'y'],
      }),
    ).toEqual(['x', 'y'])
    expect(
      rewrittenToolCallContext(['a'], {
        rewritten: true,
        output: ['x', 1],
      }),
    ).toBeUndefined()
  })
})

describe('densable rL / kcn constants', () => {
  test('rL rejects sparse or non-string lists', () => {
    expect(listOfContextTexts(['a', 'b'])).toEqual(['a', 'b'])
    const sparse: string[] = []
    sparse[1] = 'b'
    expect(listOfContextTexts(sparse)).toBeUndefined()
  })

  test('matches gold MEn / z6t / PVt', () => {
    expect(TOOL_CALL_CONTEXT_DISPATCH_CHARS).toBe(200_000)
    expect(TOOL_CALL_CONTEXT_ENTRY_CHARS).toBe(100_000)
    expect(TOOL_CALL_CONTEXT_PACK_FLOOR).toBe(4_000)
  })

  test('small entries stay inline', async () => {
    expect(await packToolCallContext(['one', 'two'])).toEqual(['one', 'two'])
  })
})

describe('densable Pd', () => {
  test('level tag returns the value', () => {
    expect(
      pdSessionEffort({ sessionEffort: { kind: 'level', value: 'low' } }),
    ).toBe('low')
  })

  test('default tag returns undefined', () => {
    expect(pdSessionEffort({ sessionEffort: { kind: 'default' } })).toBe(
      undefined,
    )
  })

  test('untagged esfuerzoValue is level; inherit + no table is undefined', () => {
    expect(pdSessionEffort({ effortValue: 'high' })).toBe('high')
    expect(pdSessionEffort({})).toBeUndefined()
    expect(
      pdSessionEffort({
        sessionEffort: { kind: 'inherit' },
        effortValue: 'high',
      }),
    ).toBeUndefined()
  })

  test('inherit looks up canonical model key in settingsEffortTable', () => {
    expect(
      pdSessionEffort(
        {
          sessionEffort: { kind: 'inherit' },
          settingsEffortTable: {
            default: 'medium',
            byModel: { 'claude-opus-4-6': 'xhigh' },
          },
        },
        'claude-opus-4-6-20250514',
      ),
    ).toBe('xhigh')
  })

  test('d_t bootstrapSessionEffort parses CLI --effort only', () => {
    expect(bootstrapSessionEffort(undefined)).toEqual({ kind: 'inherit' })
    expect(bootstrapSessionEffort('low')).toEqual({
      kind: 'level',
      value: 'low',
    })
  })

  test('te() puts userSettings.effortLevel in legacyUserEffort and clears it when a higher source sets effortLevel', () => {
    const userOnly = teSettingsEffortTable([
      { source: 'userSettings', settings: { effortLevel: 'low' } },
    ])
    expect(userOnly?.default).toBeUndefined()
    expect(userOnly?.legacyUserEffort).toBe('low')
    expect(
      pdSessionEffort(
        {
          sessionEffort: { kind: 'inherit' },
          settingsEffortTable: userOnly,
        },
        'claude-opus-4-6',
      ),
    ).toBe('low')

    const overridden = teSettingsEffortTable([
      { source: 'userSettings', settings: { effortLevel: 'low' } },
      { source: 'projectSettings', settings: { effortLevel: 'high' } },
    ])
    expect(overridden?.default).toBe('high')
    expect(overridden?.legacyUserEffort).toBeUndefined()
  })
})

describe('densable ck(h, Pd, Ly) hook stdin', () => {
  test('iw slots turnEffort before Pd, model default last', () => {
    const src = readFileSync(
      new URL('../../effort.ts', import.meta.url),
      'utf8',
    )
    expect(src).toContain('export function resolveHookStdinEffort')
    expect(src).toContain('turnEffort ??')
    expect(src).toContain('appStateEffortValue ??')
    expect(src).toContain('modelDefault')
  })

  test('AppState carries sessionEffort and settingsEffortTable', () => {
    const store = readFileSync(
      new URL('../../../state/AppStateStore.ts', import.meta.url),
      'utf8',
    )
    expect(store).toContain("sessionEffort: { kind: 'inherit' }")
    expect(store).toContain('settingsEffortTable:')
  })

  test('listOfContextTexts is the Iyo rL host in toolExecution', () => {
    const src = readFileSync(
      new URL('../../../services/tools/toolExecution.ts', import.meta.url),
      'utf8',
    )
    expect(src).toContain('listOfContextTexts(out.context)')
    expect(src).toContain('managedRan')
    expect(src).not.toContain("typeof entry === 'string' && entry !== ''")
  })
})
