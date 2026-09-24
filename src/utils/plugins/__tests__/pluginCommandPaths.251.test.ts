import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { PluginError } from '../../../types/plugin.js'
import {
  applyPluginCommandSources,
  resolveCommandPathWithinPlugin,
} from '../pluginCommandPaths.js'

describe('densable 2.1.251 #7 VHt applyPluginCommandSources', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function pluginDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'vht-251-'))
    dirs.push(dir)
    return dir
  }

  test('object mapping source that escapes the plugin directory is path-traversal', async () => {
    const dir = pluginDir()
    const plugin = {}
    const errors: PluginError[] = []
    await applyPluginCommandSources(
      plugin,
      { sneak: { source: '../outside.md' } },
      {
        pluginPath: dir,
        pluginName: 'demo',
        errorSource: 'marketplace',
        mode: 'replace',
        origin: 'marketplace',
        resolvePath: resolveCommandPathWithinPlugin,
        registerInlineContent: true,
        errors,
      },
    )
    expect(plugin).toEqual({})
    expect(errors).toEqual([
      {
        type: 'path-traversal',
        source: 'marketplace',
        plugin: 'demo',
        path: '../outside.md',
        component: 'commands',
      },
    ])
  })

  test('inline content is registered when registerInlineContent is truthy', async () => {
    const dir = pluginDir()
    const plugin: {
      commandsMetadata?: Record<string, { content: string }>
    } = {}
    const errors: PluginError[] = []
    await applyPluginCommandSources(
      plugin,
      { about: { content: '# hi' } },
      {
        pluginPath: dir,
        pluginName: 'demo',
        errorSource: 'manifest',
        mode: 'replace',
        origin: 'manifest',
        resolvePath: resolveCommandPathWithinPlugin,
        registerInlineContent: true,
        errors,
      },
    )
    expect(errors).toEqual([])
    expect(plugin.commandsMetadata).toEqual({ about: { content: '# hi' } })
  })

  test('inline content is skipped when registerInlineContent is omitted', async () => {
    const dir = pluginDir()
    const plugin = {}
    const errors: PluginError[] = []
    await applyPluginCommandSources(
      plugin,
      { about: { content: '# hi' } },
      {
        pluginPath: dir,
        pluginName: 'demo',
        errorSource: 'manifest',
        mode: 'replace',
        origin: 'manifest',
        resolvePath: resolveCommandPathWithinPlugin,
        errors,
      },
    )
    expect(plugin).toEqual({})
    expect(errors).toEqual([])
  })

  test('inline content is skipped when content is empty string', async () => {
    const dir = pluginDir()
    const plugin = {}
    const errors: PluginError[] = []
    await applyPluginCommandSources(
      plugin,
      { about: { content: '' } },
      {
        pluginPath: dir,
        pluginName: 'demo',
        errorSource: 'manifest',
        mode: 'replace',
        origin: 'manifest',
        resolvePath: resolveCommandPathWithinPlugin,
        registerInlineContent: true,
        errors,
      },
    )
    expect(plugin).toEqual({})
    expect(errors).toEqual([])
  })

  test('source that exists is kept; missing source is path-not-found', async () => {
    const dir = pluginDir()
    writeFileSync(join(dir, 'ok.md'), '# ok')
    const plugin: { commandsPaths?: string[]; commandsMetadata?: object } = {}
    const errors: PluginError[] = []
    await applyPluginCommandSources(
      plugin,
      {
        ok: { source: 'ok.md' },
        missing: { source: 'gone.md' },
      },
      {
        pluginPath: dir,
        pluginName: 'demo',
        errorSource: 'manifest',
        mode: 'replace',
        origin: 'manifest',
        resolvePath: resolveCommandPathWithinPlugin,
        registerInlineContent: true,
        errors,
      },
    )
    expect(plugin.commandsPaths).toEqual([join(dir, 'ok.md')])
    expect(plugin.commandsMetadata).toEqual({ ok: { source: 'ok.md' } })
    expect(errors).toEqual([
      {
        type: 'path-not-found',
        source: 'manifest',
        plugin: 'demo',
        path: join(dir, 'gone.md'),
        component: 'commands',
      },
    ])
  })

  test('string list path that escapes is path-traversal with marketplace origin text', async () => {
    const dir = pluginDir()
    const plugin = {}
    const errors: PluginError[] = []
    await applyPluginCommandSources(plugin, ['../escape.md'], {
      pluginPath: dir,
      pluginName: 'demo',
      errorSource: 'entry',
      mode: 'replace',
      origin: 'marketplace',
      resolvePath: resolveCommandPathWithinPlugin,
      registerInlineContent: true,
      errors,
    })
    expect(plugin).toEqual({})
    expect(errors).toEqual([
      {
        type: 'path-traversal',
        source: 'entry',
        plugin: 'demo',
        path: '../escape.md',
        component: 'commands',
      },
    ])
  })

  test('append mode keeps prior metadata and paths', async () => {
    const dir = pluginDir()
    mkdirSync(join(dir, 'extra'))
    writeFileSync(join(dir, 'extra', 'more.md'), '# more')
    const plugin = {
      commandsPaths: ['/prior.md'],
      commandsMetadata: { prior: { content: 'old' } },
    }
    const errors: PluginError[] = []
    await applyPluginCommandSources(
      plugin,
      { more: { source: 'extra/more.md' }, inline: { content: 'new' } },
      {
        pluginPath: dir,
        pluginName: 'demo',
        errorSource: 'entry',
        mode: 'append',
        origin: 'marketplace',
        resolvePath: resolveCommandPathWithinPlugin,
        registerInlineContent: true,
        errors,
      },
    )
    expect(plugin.commandsPaths).toEqual([
      '/prior.md',
      join(dir, 'extra', 'more.md'),
    ])
    expect(plugin.commandsMetadata).toEqual({
      prior: { content: 'old' },
      more: { source: 'extra/more.md' },
      inline: { content: 'new' },
    })
    expect(errors).toEqual([])
  })
})
