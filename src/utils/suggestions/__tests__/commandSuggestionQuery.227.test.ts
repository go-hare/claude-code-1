/**
 * densable 2.1.227 — createCommandSuggestionItem attaches query for wZt.
 */
import { describe, expect, test } from 'bun:test'
import { generateCommandSuggestions } from '../commandSuggestions.js'
import type { Command } from '../../../commands.js'

function makeCommand(name: string): Command {
  return {
    name,
    description: `${name} command`,
    type: 'local',
    handler: () => {},
  } as unknown as Command
}

describe('generateCommandSuggestions query field', () => {
  test('attaches lowercase query when filtering', () => {
    const cmds = [makeCommand('commit'), makeCommand('config')]
    const items = generateCommandSuggestions('/com', cmds)
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item.query).toBe('com')
      expect(item.displayText.startsWith('/')).toBe(true)
    }
  })

  test('no query when only slash (empty filter)', () => {
    const cmds = [makeCommand('commit')]
    const items = generateCommandSuggestions('/', cmds)
    // empty query path — densable still may omit or set ""
    // local: we omit empty query field
    for (const item of items) {
      expect(item.query === undefined || item.query === '').toBe(true)
    }
  })
})
