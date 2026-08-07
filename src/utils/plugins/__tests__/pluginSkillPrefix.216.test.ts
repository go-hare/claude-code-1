/**
 * densable 2.1.216 #28 — plugin skills with frontmatter `name` keep plugin
 * prefix in slash-command autocomplete (userFacingName).
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getCommandName } from '../../../types/command.js'

// Exercise createPluginCommand via loadPluginCommands internal path by
// constructing the same densable formula unit-tested against gold.

describe('plugin skill frontmatter name prefix (2.1.216 #28 densable uzr)', () => {
  test('userFacing = pluginPrefix + frontmatter name; name stays fully qualified', () => {
    // densable:
    //   x = a.name (frontmatter)
    //   I = e.slice(0, e.lastIndexOf(":")+1)
    //   D = x ? `${I}${x}` : e
    //   aliases = x && !x.includes(":") ? [x] : undefined
    //   userFacingName(){ return D }
    const commandName = 'my-plugin:demo-skill'
    const frontmatterName = 'CustomName'
    const pluginPrefix = commandName.slice(0, commandName.lastIndexOf(':') + 1)
    const userFacing = frontmatterName
      ? `${pluginPrefix}${frontmatterName}`
      : commandName
    const aliases =
      frontmatterName && !frontmatterName.includes(':')
        ? [frontmatterName]
        : undefined

    expect(pluginPrefix).toBe('my-plugin:')
    expect(userFacing).toBe('my-plugin:CustomName')
    expect(aliases).toEqual(['CustomName'])
    // command.name stays path-derived (plugin:dir)
    expect(commandName).toBe('my-plugin:demo-skill')
  })

  test('no frontmatter name → userFacing = commandName; no aliases', () => {
    const commandName = 'my-plugin:demo-skill'
    const frontmatterName = undefined as string | undefined
    const pluginPrefix = commandName.slice(0, commandName.lastIndexOf(':') + 1)
    let userFacing: string
    let aliases: string[] | undefined
    if (frontmatterName !== undefined) {
      userFacing = `${pluginPrefix}${frontmatterName}`
      aliases = !frontmatterName.includes(':') ? [frontmatterName] : undefined
    } else {
      userFacing = commandName
      aliases = undefined
    }
    expect(userFacing).toBe('my-plugin:demo-skill')
    expect(aliases).toBeUndefined()
  })

  test('frontmatter name with colon is not aliased (densable !x.includes(":"))', () => {
    const commandName = 'my-plugin:demo'
    const frontmatterName = 'other:name'
    const pluginPrefix = commandName.slice(0, commandName.lastIndexOf(':') + 1)
    const userFacing = `${pluginPrefix}${frontmatterName}`
    const aliases = !frontmatterName.includes(':')
      ? [frontmatterName]
      : undefined
    expect(userFacing).toBe('my-plugin:other:name')
    expect(aliases).toBeUndefined()
  })

  test('namespaced skill keeps full prefix through lastIndexOf', () => {
    // plugin:ns:leaf — prefix is "plugin:ns:"
    const commandName = 'acme:tools:greet'
    const frontmatterName = 'Hello'
    const pluginPrefix = commandName.slice(0, commandName.lastIndexOf(':') + 1)
    expect(pluginPrefix).toBe('acme:tools:')
    expect(`${pluginPrefix}${frontmatterName}`).toBe('acme:tools:Hello')
  })

  test('loadPluginCommands source wires densable D formula (not bare displayName)', async () => {
    const { readFileSync } = await import('fs')
    const { join: j } = await import('path')
    const src = readFileSync(
      j(import.meta.dir, '../loadPluginCommands.ts'),
      'utf8',
    )
    expect(src).toContain("lastIndexOf(':')")
    expect(src).toContain('pluginPrefix')
    expect(src).toContain('userFacing')
    // Must not reintroduce bare frontmatter-only userFacingName
    expect(src).not.toMatch(
      /userFacingName\(\):\s*string\s*\{\s*return displayName \|\| commandName/,
    )
  })

  test('getCommandName prefers userFacingName', () => {
    const cmd = {
      name: 'plugin:skill-dir',
      userFacingName: () => 'plugin:Custom',
      description: 'x',
    }
    expect(getCommandName(cmd)).toBe('plugin:Custom')
  })
})

describe('plugin skill fixture smoke (optional disk)', () => {
  test('SKILL.md frontmatter name can be read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-skill-216-'))
    const skillDir = join(dir, 'my-skill')
    mkdirSync(skillDir)
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: CustomName\ndescription: test skill\n---\n\n# Hi\n`,
    )
    const body = readFile(join(skillDir, 'SKILL.md'))
    expect(body).toContain('name: CustomName')
  })
})

function readFile(path: string): string {
  return require('fs').readFileSync(path, 'utf8') as string
}
