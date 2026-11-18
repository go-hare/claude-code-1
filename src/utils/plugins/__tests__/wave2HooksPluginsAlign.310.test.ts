import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { PluginError } from '../../../types/plugin.js'
import { handleHostOp } from '../functionHooksModules.js'
import { loadPluginMonitors } from '../pluginLoader.js'
import { armPluginMonitors, resolvePluginMonitor } from '../pluginMonitors.js'
import { PluginManifestSchema, PluginMonitorsArraySchema } from '../schemas.js'
import {
  getSessionRefsStore,
  resetSessionRefsStoreForTests,
  sessionRefsManifestSchema,
  setSkillManifestGsGetForTests,
} from '../sessionRefsManifest.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
  resetSessionRefsStoreForTests()
})

describe('#1197 plugin monitors/monitors.json loading and auto-arming', () => {
  test('loads default monitors/monitors.json when manifest.monitors is omitted', async () => {
    const root = makeTempDir('plugin-monitors-')
    mkdirSync(join(root, 'monitors'), { recursive: true })
    writeFileSync(
      join(root, 'monitors', 'monitors.json'),
      JSON.stringify([
        {
          name: 'watch-logs',
          command: 'cd "${CLAUDE_PLUGIN_ROOT}" && tail -f app.log',
          description: 'Watch app logs',
        },
      ]),
    )
    const manifest = PluginManifestSchema().parse({ name: 'mon-plugin' })
    const errors: PluginError[] = []
    const monitors = await loadPluginMonitors(
      root,
      manifest,
      'mon-plugin@local',
      errors,
    )
    expect(errors).toEqual([])
    expect(monitors).toEqual([
      {
        name: 'watch-logs',
        command: 'cd "${CLAUDE_PLUGIN_ROOT}" && tail -f app.log',
        description: 'Watch app logs',
        when: 'always',
      },
    ])
  })

  test('rejects path traversal in manifest.monitors', async () => {
    const root = makeTempDir('plugin-monitors-trav-')
    const manifest = PluginManifestSchema().parse({
      name: 'mon-trav',
      monitors: '../outside.json',
    })
    const errors: PluginError[] = []
    const monitors = await loadPluginMonitors(
      root,
      manifest,
      'mon-trav@local',
      errors,
    )
    expect(monitors).toBeUndefined()
    expect(errors).toEqual([
      {
        type: 'path-traversal',
        source: 'mon-trav@local',
        plugin: 'mon-trav',
        path: '../outside.json',
        component: 'monitors',
      },
    ])
  })

  test('rejects duplicate monitor names and invalid on-skill-invoke:', () => {
    expect(() =>
      PluginMonitorsArraySchema().parse([
        { name: 'dup', command: 'echo 1', description: 'one' },
        { name: 'dup', command: 'echo 2', description: 'two' },
      ]),
    ).toThrow('Monitor names must be unique within a plugin')

    expect(() =>
      PluginMonitorsArraySchema().parse([
        {
          name: 'bad-when',
          command: 'echo 1',
          description: 'bad',
          when: 'on-skill-invoke:',
        },
      ]),
    ).toThrow('on-skill-invoke: must specify a skill name')
  })

  test('resolvePluginMonitor rejects ${user_config.*} and substitutes ${CLAUDE_PLUGIN_ROOT}', () => {
    expect(() =>
      resolvePluginMonitor(
        {
          name: 'bad',
          command: 'echo ${user_config.token}',
          description: 'bad',
          when: 'always',
        },
        { name: 'p', source: 'p@m', path: '/tmp/p' },
      ),
    ).toThrow('references ${user_config.*}')

    const resolved = resolvePluginMonitor(
      {
        name: 'ok',
        command: '${CLAUDE_PLUGIN_ROOT}/watch.sh',
        description: 'ok',
        when: 'always',
      },
      { name: 'p', source: 'p@m', path: '/tmp/p' },
    )
    expect(resolved.command).toBe('/tmp/p/watch.sh')
  })

  test('armPluginMonitors arms matching triggers and dedupes via armedKeys', async () => {
    const plugins = [
      {
        name: 'p',
        source: 'p@m',
        path: '/tmp/p',
        monitors: [
          {
            name: 'always-mon',
            command: 'echo always',
            description: 'always',
            when: 'always' as const,
          },
          {
            name: 'skill-mon',
            command: 'echo skill',
            description: 'skill',
            when: 'on-skill-invoke:deploy',
          },
        ],
      },
    ]
    const armedKeys = new Set<string>()
    const armedCalls: string[] = []
    const arm = async (m: { name: string }) => {
      armedCalls.push(m.name)
      return `task-${m.name}`
    }

    const first = await armPluginMonitors(
      plugins,
      m => m.when === 'always',
      arm,
      armedKeys,
    )
    expect(first).toEqual(['task-always-mon'])
    // Second call is deduped
    const second = await armPluginMonitors(
      plugins,
      m => m.when === 'always',
      arm,
      armedKeys,
    )
    expect(second).toEqual([])
    expect(armedCalls).toEqual(['always-mon'])

    // Skill invoke trigger arms skill-mon
    const third = await armPluginMonitors(
      plugins,
      m => m.when === 'on-skill-invoke:deploy',
      arm,
      armedKeys,
    )
    expect(third).toEqual(['task-skill-mon'])
    expect(armedCalls).toEqual(['always-mon', 'skill-mon'])
  })
})

describe('#1294 $.env.set blocks mods from turning compaction back on', () => {
  test('blocks unsetting or falsy DISABLE_COMPACT, allows truthy DISABLE_COMPACT', async () => {
    const prev = process.env.DISABLE_COMPACT
    process.env.DISABLE_COMPACT = '1'
    try {
      await expect(
        handleHostOp(
          'env.set',
          [{ name: 'DISABLE_COMPACT', value: undefined }],
          'evil-mod',
        ),
      ).rejects.toThrow('DISABLE_COMPACT is unchanged')
      expect(process.env.DISABLE_COMPACT).toBe('1')

      await expect(
        handleHostOp(
          'env.set',
          [{ name: 'DISABLE_COMPACT', value: '0' }],
          'evil-mod',
        ),
      ).rejects.toThrow('DISABLE_COMPACT is unchanged')
      expect(process.env.DISABLE_COMPACT).toBe('1')

      await expect(
        handleHostOp(
          'env.set',
          [{ name: 'DISABLE_COMPACT', value: 'false' }],
          'evil-mod',
        ),
      ).rejects.toThrow('DISABLE_COMPACT is unchanged')
      expect(process.env.DISABLE_COMPACT).toBe('1')

      const ok = await handleHostOp(
        'env.set',
        [{ name: 'DISABLE_COMPACT', value: 'true' }],
        'ok-mod',
      )
      expect(ok).toEqual({})
      expect(process.env.DISABLE_COMPACT).toBe('true')
    } finally {
      if (prev === undefined) delete process.env.DISABLE_COMPACT
      else process.env.DISABLE_COMPACT = prev
    }
  })
})

describe('#1369 PluginError.guardHookRefused & sessionRefsManifest startup pinning', () => {
  test('PluginError generic-error accepts guardHookRefused', () => {
    const err: PluginError = {
      type: 'generic-error',
      source: 'p@m',
      error: 'refused',
      guardHookRefused: true,
    }
    expect(err.guardHookRefused).toBe(true)
  })

  test('sessionRefsEntrySchema transforms marketplace_name and is_official', () => {
    const parsed = sessionRefsManifestSchema.parse({
      skills: [],
      plugins: [
        {
          id: 'p1',
          name: 'my-plugin',
          description: 'desc',
          version: '1.0.0',
          directory: 'dir',
          marketplace_name: 'claude-plugins-official',
          is_official: true,
        },
      ],
    })
    expect(parsed.plugins[0]).toEqual({
      id: 'p1',
      name: 'my-plugin',
      description: 'desc',
      version: '1.0.0',
      directory: 'dir',
      marketplaceName: 'claude-plugins-official',
      isOfficial: true,
    })
  })

  test('SessionRefsStore pins startupResponse when startup: true and clears on discardInflight', async () => {
    let fetchCount = 0
    setSkillManifestGsGetForTests(async () => {
      fetchCount++
      return {
        ok: true,
        status: 200,
        data: {
          skills: [
            {
              id: `s${fetchCount}`,
              name: 'skill',
              description: 'd',
              version: '1',
              directory: 'dir',
            },
          ],
          plugins: [],
        },
      }
    })
    const store = getSessionRefsStore()
    const r1 = await store.listEntries('skills', { startup: true })
    const r2 = await store.listEntries('skills', { startup: true })
    expect(fetchCount).toBe(1)
    expect(r1).toEqual(r2)

    store.discardInflight()
    const r3 = await store.listEntries('skills', { startup: true })
    expect(fetchCount).toBe(2)
    expect(r3.success && r3.entries[0]?.id).toBe('s2')
  })
})
