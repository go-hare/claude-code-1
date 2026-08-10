import { describe, expect, test } from 'bun:test'
import {
  HEADLESS_YIELDABLE_NAMES,
  isCommandAvailableInHeadless,
  stripCollidingPluginAliases,
} from '../commands.js'
import type { Command } from '../types/command.js'

function pluginSkill(name: string, aliases?: string[]): Command {
  return {
    type: 'prompt',
    name,
    description: `plugin skill ${name}`,
    progressMessage: 'loading',
    contentLength: 1,
    source: 'plugin',
    aliases,
    async getPromptForCommand() {
      return [{ type: 'text', text: name }]
    },
  }
}

function localJsx(name: string): Command {
  return {
    type: 'local-jsx',
    name,
    description: `built-in ${name}`,
    load: async () => ({
      call: async () => null,
    }),
  }
}

function localPrompt(name: string): Command {
  return {
    type: 'prompt',
    name,
    description: `builtin prompt ${name}`,
    progressMessage: 'loading',
    contentLength: 1,
    source: 'builtin',
    async getPromptForCommand() {
      return [{ type: 'text', text: name }]
    },
  }
}

describe('densable 2.1.221 Hxb stripCollidingPluginAliases', () => {
  test('HEADLESS_YIELDABLE_NAMES is help+feedback', () => {
    expect([...HEADLESS_YIELDABLE_NAMES].sort()).toEqual(['feedback', 'help'])
  })

  test('local-jsx help/feedback are not headless-available', () => {
    expect(isCommandAvailableInHeadless(localJsx('help'))).toBe(false)
    expect(isCommandAvailableInHeadless(localJsx('feedback'))).toBe(false)
  })

  test('interactive: strips plugin alias that collides with built-in help', () => {
    const plugin = pluginSkill('org-help', ['help', 'org-help-alt'])
    const out = stripCollidingPluginAliases([plugin, localJsx('help')], false)
    const p = out.find(c => c.name === 'org-help')
    expect(p?.aliases).toEqual(['org-help-alt'])
  })

  test('non-interactive: keeps plugin help alias (built-in yields)', () => {
    const plugin = pluginSkill('org-help', ['help'])
    const out = stripCollidingPluginAliases([plugin, localJsx('help')], true)
    const p = out.find(c => c.name === 'org-help')
    expect(p?.aliases).toEqual(['help'])
  })

  test('non-interactive: keeps plugin feedback alias', () => {
    const plugin = pluginSkill('org-feedback', ['feedback'])
    const out = stripCollidingPluginAliases(
      [plugin, localJsx('feedback')],
      true,
    )
    const p = out.find(c => c.name === 'org-feedback')
    expect(p?.aliases).toEqual(['feedback'])
  })

  test('non-interactive: still strips aliases colliding with headless-available commands', () => {
    const plugin = pluginSkill('org-status', ['status'])
    const status = localPrompt('status')
    // prompt without disableNonInteractive is headless-available
    expect(isCommandAvailableInHeadless(status)).toBe(true)
    const out = stripCollidingPluginAliases([plugin, status], true)
    const p = out.find(c => c.name === 'org-status')
    expect(p?.aliases).toBeUndefined()
  })

  test('does not mutate non-plugin commands', () => {
    const builtin = localJsx('help')
    const out = stripCollidingPluginAliases(
      [pluginSkill('x', ['help']), builtin],
      true,
    )
    expect(out.find(c => c.name === 'help')).toBe(builtin)
  })
})
