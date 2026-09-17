import { describe, expect, test } from 'bun:test'
import { looksLikeCommand } from '../processSlashCommand.js'
import { parseSlashCommand } from '../../slashCommandParsing.js'

describe('looksLikeCommand densable 2.1.246 (#29)', () => {
  test('`--…` is not a command name so `/--foo` is a prompt', () => {
    const parsed = parseSlashCommand('/--foo')
    expect(parsed?.commandName).toBe('--foo')
    expect(looksLikeCommand('--foo')).toBe(false)
    expect(looksLikeCommand('--')).toBe(false)
  })

  test('normal slash names still look like commands', () => {
    expect(looksLikeCommand('help')).toBe(true)
    expect(looksLikeCommand('mcp:tool')).toBe(true)
    expect(looksLikeCommand('_hidden')).toBe(true)
    expect(looksLikeCommand('foo-bar')).toBe(true)
  })
})
