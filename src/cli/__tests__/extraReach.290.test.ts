import { describe, expect, test } from 'bun:test'
import {
  nestedShellUnreadRefuse,
  shellCodeNestedTooDeepRefuseCopy,
  type ShellScanContext,
} from '../extraReach.js'

const BASE_CTX: ShellScanContext = {
  roots: ['/repo'],
  home: '/home/user',
}

describe('2.1.290 #52 Qt scan (nestedShellUnreadRefuse)', () => {
  test('forwards parser flags to parseShell seam', () => {
    const seenOpts: Array<Record<string, unknown>> = []
    nestedShellUnreadRefuse(
      'echo ok',
      true,
      {
        ...BASE_CTX,
        commandAfterConditional: true,
        quotedBackslashKept: true,
        closingBraceHeld: true,
        shortLoopLists: true,
        substitutionHeredocs: true,
      },
      0,
      {
        parseShell: (_text, opts) => {
          seenOpts.push(opts)
          return { commands: [], unreadable: null }
        },
        scanCommand: () => undefined,
      },
    )
    expect(seenOpts).toEqual([
      {
        make: true,
        commandAfterConditional: true,
        quotedBackslashKept: true,
        closingBraceHeld: true,
        shortLoopLists: true,
        substitutionHeredocs: true,
      },
    ])
  })

  test('propagates relativeNames into nested payload unless relativeNamedValues is false', () => {
    const seenRelative: Array<{ text: string; names: string[] }> = []
    nestedShellUnreadRefuse('REL=foo; nested', false, BASE_CTX, 0, {
      parseShell: text => ({
        commands:
          text === 'REL=foo; nested'
            ? [
                {
                  program: { text: 'export' },
                  args: [{ text: 'REL=foo' }],
                  assignments: [],
                },
              ]
            : [{ program: { text: 'inner' }, args: [], assignments: [] }],
        unreadable: null,
      }),
      scanCommand: (cmd, nested, ctx) => {
        seenRelative.push({
          text: cmd.program.text,
          names: [...(ctx?.relativeNames ?? [])],
        })
        if (cmd.program.text === 'export') {
          nested.push('inner')
          nested.push('inner')
        }
        return undefined
      },
    })
    expect(seenRelative).toEqual([
      { text: 'export', names: ['REL'] },
      { text: 'inner', names: ['REL'] },
    ])

    const seenDisabled: Array<{ text: string; names: string[] }> = []
    nestedShellUnreadRefuse(
      'REL=foo; nested',
      false,
      { ...BASE_CTX, relativeNamedValues: false },
      0,
      {
        parseShell: text => ({
          commands:
            text === 'REL=foo; nested'
              ? [
                  {
                    program: { text: 'export' },
                    args: [{ text: 'REL=foo' }],
                    assignments: [],
                  },
                ]
              : [{ program: { text: 'inner' }, args: [], assignments: [] }],
          unreadable: null,
        }),
        scanCommand: (cmd, nested, ctx) => {
          seenDisabled.push({
            text: cmd.program.text,
            names: [...(ctx?.relativeNames ?? [])],
          })
          if (cmd.program.text === 'export') {
            nested.push('inner')
          }
          return undefined
        },
      },
    )
    expect(seenDisabled).toEqual([
      { text: 'export', names: ['REL'] },
      { text: 'inner', names: [] },
    ])
  })

  test('refuses nesting depth >= 3 with shellCodeNestedTooDeep copy', () => {
    const out = nestedShellUnreadRefuse('outer', false, BASE_CTX, 3, {
      parseShell: () => ({
        commands: [{ program: { text: 'sh' }, args: [], assignments: [] }],
        unreadable: null,
      }),
      scanCommand: (_cmd, nested) => {
        nested.push('payload')
        return undefined
      },
    })
    expect(out).toBe(shellCodeNestedTooDeepRefuseCopy())
  })
})
