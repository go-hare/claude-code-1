/**
 * densable 2.1.236 #28 — ZFt/QFt slash typo suggestion (no fuzzy execute).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  slashCommandEditDistance,
  suggestSlashCommand,
} from '../slashCommandSuggest.js'

describe('densable ZFt/QFt slashCommandSuggest', () => {
  test('QFt is 0 for equal strings and 1 for a substitute', () => {
    expect(slashCommandEditDistance('compact', 'compact')).toBe(0)
    expect(slashCommandEditDistance('compact', 'compacx')).toBe(1)
  })

  test('QFt counts a transposition as one edit', () => {
    expect(slashCommandEditDistance('help', 'hlep')).toBe(1)
  })

  test('ZFt returns nearest alias/name within maxEditDistance 2', () => {
    const commands = [
      { name: 'compact', aliases: ['c'] },
      { name: 'help', aliases: ['h'] },
    ]
    expect(
      suggestSlashCommand('compac', commands, { maxEditDistance: 2 }),
    ).toBe('compact')
    expect(suggestSlashCommand('hlep', commands, { maxEditDistance: 2 })).toBe(
      'help',
    )
    expect(
      suggestSlashCommand('zzzzzzzz', commands, { maxEditDistance: 2 }),
    ).toBeUndefined()
  })

  test('processSlashCommand unknown path uses Did you mean + does not execute', () => {
    const src = readFileSync(
      join(import.meta.dir, '../processUserInput/processSlashCommand.tsx'),
      'utf8',
    )
    expect(src).toContain('suggestSlashCommand(')
    expect(src).toContain('Did you mean /')
    expect(src).toContain('Unknown command: /')
    expect(src).toContain('had_suggestion')
    expect(src).toContain('suggestion_distance')
    expect(src).toContain('is_mcp_template_unmatched')
    expect(src).toContain("logCmdDispatch('cmd_unknown')")
    expect(src).toContain("logCmdDispatch('cmd_unavailable_headless')")
    expect(src).toContain("logCmdDispatch('cmd_parse_failed')")
    expect(src).toContain("isn't available in this environment.")
    expect(src).toContain('isSlashCommandOff')
    expect(src).toContain('maxEditDistance: 2')
    expect(src).toContain('isNonInteractiveSession')
    expect(src).toContain('<local-command-stdout>')
    expect(src).toContain('createCommandInputMessage')
    expect(src).toContain("createSystemMessage(unknownMessage, 'warning')")
  })
})
