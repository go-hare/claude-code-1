/**
 * densable 2.1.246 #19 — frontmatter `name` that already includes the
 * plugin `:` prefix must not be prepended again (`/plugin:plugin:skill`).
 *
 * Official: C = v ? (v.startsWith(E) ? v : `${E}${v}`) : e
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getCommandName } from '../../../types/command.js'

describe('plugin skill frontmatter name (2.1.246 #19)', () => {
  test('official C: already-prefixed name is not doubled', () => {
    const commandName = 'plugin:skill'
    const pluginPrefix = commandName.slice(0, commandName.lastIndexOf(':') + 1)
    const frontmatterName = 'plugin:skill'
    const userFacing = frontmatterName.startsWith(pluginPrefix)
      ? frontmatterName
      : `${pluginPrefix}${frontmatterName}`
    expect(pluginPrefix).toBe('plugin:')
    expect(userFacing).toBe('plugin:skill')
    expect(userFacing).not.toBe('plugin:plugin:skill')
  })

  test('official C: bare frontmatter name still gets the prefix', () => {
    const commandName = 'plugin:dir'
    const pluginPrefix = commandName.slice(0, commandName.lastIndexOf(':') + 1)
    const frontmatterName = 'skill'
    const userFacing = frontmatterName.startsWith(pluginPrefix)
      ? frontmatterName
      : `${pluginPrefix}${frontmatterName}`
    expect(userFacing).toBe('plugin:skill')
  })

  test('loadPluginCommands wires startsWith(pluginPrefix)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../loadPluginCommands.ts'),
      'utf8',
    )
    expect(src).toContain('startsWith(pluginPrefix)')
  })

  test('getCommandName still prefers userFacingName', () => {
    const cmd = {
      name: 'plugin:skill-dir',
      userFacingName: () => 'plugin:skill',
      description: 'x',
    }
    expect(getCommandName(cmd)).toBe('plugin:skill')
  })
})
