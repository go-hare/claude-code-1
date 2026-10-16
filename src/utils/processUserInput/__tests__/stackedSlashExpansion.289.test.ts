import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Command, PromptCommand } from '../../../types/command.js'
import {
  parseStackedSlashCommands,
  shouldParseStackedSlash,
  STACKED_SLASH_LIMIT,
} from '../stackedSlashExpansion.js'

function prompt(name: string, extra?: Partial<PromptCommand>): Command {
  return {
    type: 'prompt',
    name,
    description: name,
    progressMessage: 'loading',
    contentLength: 1,
    source: 'bundled',
    getPromptForCommand: async () => [],
    ...extra,
  }
}

describe('densable 2.1.289 kt stacked slash expansion', () => {
  test('limit is gold tt=5', () => {
    expect(STACKED_SLASH_LIMIT).toBe(5)
  })

  test('both reconstructed and skip unset → empty stacked', () => {
    const commands = [prompt('b')]
    expect(
      parseStackedSlashCommands('/b leftover', undefined, commands),
    ).toEqual({
      stacked: [],
      trailingArgs: '/b leftover',
      capped: false,
    })
  })

  test('peels nested prompt skills; trailing args remain', () => {
    const a = prompt('a')
    const b = prompt('b')
    const parsed = parseStackedSlashCommands('/b /c foo', '/b /c foo', [
      a,
      b,
      prompt('c'),
    ])
    expect(parsed.stacked.map(c => c.name)).toEqual(['b', 'c'])
    expect(parsed.trailingArgs).toBe('foo')
    expect(parsed.capped).toBe(false)
  })

  test('fork / getContext / argsMayContainSlashCommands do not peel', () => {
    expect(shouldParseStackedSlash(prompt('a', { context: 'fork' }))).toBe(
      false,
    )
    expect(
      shouldParseStackedSlash(prompt('a', { getContext: () => 'inline' })),
    ).toBe(false)
    expect(
      shouldParseStackedSlash(
        prompt('a', { argsMayContainSlashCommands: true }),
      ),
    ).toBe(false)
    expect(shouldParseStackedSlash(prompt('a'))).toBe(true)
  })

  test('stops at non-prompt, disabled, or userInvocable false', () => {
    const nested = prompt('secret', { userInvocable: false })
    const parsed = parseStackedSlashCommands('/secret foo', '/secret foo', [
      nested,
    ])
    expect(parsed.stacked).toEqual([])
    expect(parsed.trailingArgs).toBe('/secret foo')
  })

  test('skip filter consumes tokens without stacking', () => {
    const parsed = parseStackedSlashCommands(
      '/b foo',
      '/b foo',
      [prompt('b')],
      () => true,
    )
    expect(parsed.stacked).toEqual([])
    expect(parsed.trailingArgs).toBe('foo')
  })

  test('caps at 5 and leaves remainder', () => {
    const cmds = ['a', 'b', 'c', 'd', 'e', 'f'].map(n => prompt(n))
    const parsed = parseStackedSlashCommands(
      '/a /b /c /d /e /f rest',
      '/a /b /c /d /e /f rest',
      cmds,
    )
    expect(parsed.stacked.map(c => c.name)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(parsed.capped).toBe(true)
    expect(parsed.trailingArgs.startsWith('/f')).toBe(true)
  })

  test('processSlashCommand hosts gold unique English', () => {
    const src = readFileSync(
      join(import.meta.dir, '../processSlashCommand.tsx'),
      'utf8',
    )
    expect(src).toContain('stacked slash command expansion threw')
    expect(src).toContain(
      'Stacked command limit (${STACKED_SLASH_LIMIT}) reached — remaining input passed as arguments',
    )
    expect(src).toContain('tengu_stacked_slash_commands')
    expect(src).toContain('stackedExpansion')
    expect(src).toContain('stackedOriginalInput')
  })
})
