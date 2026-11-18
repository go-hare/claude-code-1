import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Command } from '@commander-js/extra-typings'
import { registerCliHostCommands } from '../../../cli/registerCliHostCommands.js'
import { getAskUserQuestionSurfacePolicy } from '../../../components/PluginRasterPanes.js'
import {
  createPluginAuthoringMcpServer,
  scanModSecretsFolder,
} from '../../../plugins/bundled/pluginAuthoring.js'
import {
  createPluginTestKit,
  SERVED_METHOD_TIMEOUT_MS,
  stampUiRenderPluginPart,
} from '../../../services/plugins/pluginTestRunner.js'
import { SKILL_FILES } from '../../../skills/bundled/claudeApiContent.js'
import {
  applySkillPromptFunctionHook,
  getSkillPromptBlocks,
} from '../../skills/skillPromptHook.js'
import { setLoadedFunctionHooksModules } from '../functionHooksModules.js'
import {
  classifyFileStampChange,
  compareFileStamp,
  createDevModStampTracker,
} from '../pluginDevMods.js'

describe('Mods / Plugins / PluginAuthoring / ClaudeApiContent / PluginEval v2.1.299-301 alignment', () => {
  test('#572 skill.prompt receives frontmatter, source, pluginName, and path', async () => {
    setLoadedFunctionHooksModules([])
    const captured: Array<Record<string, unknown>> = []
    setLoadedFunctionHooksModules([
      {
        name: 'test-skill-hook',
        patterns: ['skill.prompt'],
        hooks: [
          {
            pattern: 'skill.prompt',
            hook: async (_$, event, next) => {
              captured.push({ ...event })
              return next({
                ...event,
                text: `${String(event.text)} [rewritten]`,
              })
            },
          },
        ],
      },
    ])

    try {
      const blocks = await getSkillPromptBlocks(
        {
          name: 'my-skill',
          type: 'prompt',
          source: 'plugin',
          pluginInfo: { pluginManifest: { name: 'my-plugin' } },
          skillFile: {
            path: '/tmp/my-plugin/skills/my-skill/SKILL.md',
            frontmatterAsWritten: {
              description: 'Demo skill',
              'allowed-tools': ['Read'],
            },
          },
          getPromptForCommand: async () => [{ type: 'text', text: 'hello' }],
        },
        '',
        {} as never,
      )
      expect(blocks).toEqual([{ type: 'text', text: 'hello [rewritten]' }])
      expect(captured).toHaveLength(1)
      expect(captured[0]).toMatchObject({
        skill: 'my-skill',
        text: 'hello',
        source: 'plugin',
        pluginName: 'my-plugin',
        path: '/tmp/my-plugin/skills/my-skill/SKILL.md',
        frontmatter: {
          description: 'Demo skill',
          'allowed-tools': ['Read'],
        },
      })

      const builtinBlocks = await applySkillPromptFunctionHook(
        'builtin-skill',
        [{ type: 'text', text: 'hi' }],
        { type: 'prompt', source: 'bundled' },
      )
      expect(builtinBlocks).toEqual([{ type: 'text', text: 'hi [rewritten]' }])
      expect(captured[1]).toMatchObject({
        source: 'built-in',
        frontmatter: {},
      })
    } finally {
      setLoadedFunctionHooksModules([])
    }
  })

  test('#576 CLI plugin eval registers --disallow-tools option', () => {
    const program = new Command()
    registerCliHostCommands(program, {
      createSortedHelpConfig: () => ({}),
    } as never)
    const pluginCmd = program.commands.find(c => c.name() === 'plugin')
    const evalCmd = pluginCmd?.commands.find(c => c.name() === 'eval')
    expect(evalCmd).toBeDefined()
    const disallowOpt = evalCmd?.options.find(
      o => o.long === '--disallow-tools',
    )
    expect(disallowOpt).toBeDefined()
  })

  test('#635 dev mod stamp tracker skips unchanged saves and recovers after failed reload', () => {
    expect(
      compareFileStamp({ size: 10, hash: 'abc' }, { size: 10, hash: 'abc' }),
    ).toBe('same')
    expect(
      compareFileStamp({ size: 10, hash: 'abc' }, { size: 11, hash: 'abc' }),
    ).toBe('other')
    expect(compareFileStamp(undefined, { size: 10, hash: 'abc' })).toBe(
      'unknown',
    )

    let now = 100
    const tracker = createDevModStampTracker(() => now)
    const file = '/tmp/mod/index.js'

    // Initial save -> reload
    expect(
      tracker.shouldReload(file, {
        ctimeMs: 110,
        stamp: { size: 50, hash: 'h1' },
      }),
    ).toBe(true)
    tracker.markReloaded(true)

    // Saving without changing content -> skipped as 'served'
    now = 200
    expect(
      tracker.shouldReload(file, {
        ctimeMs: 210,
        stamp: { size: 50, hash: 'h1' },
      }),
    ).toBe(false)
    expect(
      classifyFileStampChange(
        { ctimeMs: 210, stamp: { size: 50, hash: 'h1' } },
        tracker.getState(file)!,
        now,
      ),
    ).toBe('served')

    // Broken edit -> reload fails
    now = 300
    expect(
      tracker.shouldReload(file, {
        ctimeMs: 310,
        stamp: { size: 55, hash: 'h-bad' },
      }),
    ).toBe(true)
    tracker.markReloaded(false)

    // Fix saved right after failed reload (even if reverting to h1) -> reloads!
    now = 400
    expect(
      tracker.shouldReload(file, {
        ctimeMs: 410,
        stamp: { size: 50, hash: 'h1' },
      }),
    ).toBe(true)
    tracker.markReloaded(true)
    expect(tracker.getState(file)?.isServed).toBe(true)
  })

  test('#719 & #721 pluginTestRunner stamps part:{plugin} on ui.render and enforces 10s served $ timeout', async () => {
    expect(SERVED_METHOD_TIMEOUT_MS).toBe(10_000)

    const stampedBox: unknown = stampUiRenderPluginPart(
      { type: 'Box', props: {}, children: [] },
      'my-mod',
    )
    expect(stampedBox).toEqual({
      type: 'Box',
      props: {},
      children: [],
      part: { plugin: 'my-mod' },
    })

    const kit = createPluginTestKit()
    kit.test(
      'stamps ui.render and times out slow served $ method',
      async ($, on) => {
        on('ui.render', async () => ({
          type: 'Text',
          props: {},
          children: ['hello'],
        }))
        const rendered = await $.ui.render({
          component: 'AbovePrompt',
          plugin: 'demo-mod',
        })
        expect(rendered).toEqual({
          type: 'Text',
          props: {},
          children: ['hello'],
          part: { plugin: 'demo-mod' },
        })

        $.serve.register(
          'slowMethod',
          () => new Promise(() => undefined),
          'demo-mod',
        )
        let errMsg = ''
        try {
          await $.serve.call('slowMethod', [], 25)
        } catch (err) {
          errMsg = err instanceof Error ? err.message : String(err)
        }
        kit
          .expect(errMsg)
          .toContain('demo-mod: slowMethod did not answer within 25ms')
      },
    )

    const results = await kit.runRecorded()
    expect(results).toHaveLength(1)
    expect(results[0]?.failure).toBeNull()
  })

  test('#806 scanModSecretsFolder detects keys, redacts filenames, skips .git/symlinks, and MCP server registers scan_secrets', async () => {
    const server = createPluginAuthoringMcpServer()
    expect(server.type).toBe('sdk')
    expect(server.name).toBe('plugin-authoring')

    const dir = mkdtempSync(join(tmpdir(), 'scan-secrets-'))
    try {
      mkdirSync(join(dir, '.git'))
      writeFileSync(
        join(dir, '.git', 'config'),
        'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      )
      writeFileSync(join(dir, 'clean.ts'), 'export const x = 1\n')
      writeFileSync(
        join(dir, 'leak.env'),
        'ANTHROPIC_API_KEY=sk-ant-api03-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n',
      )
      const secretName =
        'sk-ant-api03-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC.txt'
      writeFileSync(join(dir, secretName), 'hello')
      symlinkSync(join(dir, 'clean.ts'), join(dir, 'linked.ts'))

      const res = await scanModSecretsFolder(dir)
      expect(res.isError).toBe(false)
      expect(res.text.startsWith('Result: ')).toBe(true)
      expect(res.text.trimEnd().endsWith(res.text.split('\n')[0]!)).toBe(true)
      expect(res.findings).toEqual(
        expect.arrayContaining([
          { path: 'leak.env', kinds: ['Anthropic Key'] },
          { path: '<name holding a secret>', kinds: ['Anthropic Key'] },
        ]),
      )
      expect(res.findings).toHaveLength(2)
      expect(res.notScanned).toEqual([{ path: 'linked.ts', reason: 'link' }])
      expect(res.text).not.toContain('CCCCCCCC')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#844 claudeApiContent SKILL_FILES exports all opentelemetry.md and claude-platform-on-aws.md', () => {
    const requiredKeys = [
      'shared/opentelemetry.md',
      'shared/claude-platform-on-aws.md',
      'csharp/claude-api/opentelemetry.md',
      'go/claude-api/opentelemetry.md',
      'java/claude-api/opentelemetry.md',
      'php/claude-api/opentelemetry.md',
      'python/claude-api/opentelemetry.md',
      'ruby/claude-api/opentelemetry.md',
      'typescript/claude-api/opentelemetry.md',
    ]
    for (const key of requiredKeys) {
      expect(typeof SKILL_FILES[key]).toBe('string')
      expect(SKILL_FILES[key]!.length).toBeGreaterThan(100)
    }
  })

  test('#885 getAskUserQuestionSurfacePolicy gives 48 rows + Markdown on desktop/vscode/mobile and 12 plain rows on terminal', () => {
    expect(getAskUserQuestionSurfacePolicy('terminal')).toEqual({
      rowsMax: 12,
      isMarkdownDrawn: false,
    })
    expect(getAskUserQuestionSurfacePolicy(undefined)).toEqual({
      rowsMax: 12,
      isMarkdownDrawn: false,
    })
    for (const surface of ['desktop', 'vscode', 'mobile']) {
      expect(getAskUserQuestionSurfacePolicy(surface)).toEqual({
        rowsMax: 48,
        isMarkdownDrawn: true,
      })
    }
  })
})
