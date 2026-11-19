import { describe, expect, test } from 'bun:test'
import { execFile } from 'child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import {
  formatHeadlessPluginErrors,
  formatPluginAgentStartupNotice,
  getPluginErrorMessage,
  getPluginWarningHint,
  getPluginWarningMessage,
  MANAGED_PLUGIN_ERROR_REDACTED_MESSAGE,
  PLUGIN_AGENT_SETTING_DEPRECATED_MESSAGE,
  type PluginError,
  type PluginWarning,
  selectInitPluginErrors,
} from '../../../types/plugin.js'
import {
  GIT_LONGPATHS_ARGS,
  verifySubmoduleShaPins,
} from '../marketplaceManager.js'
import {
  formatCommandSourceStderrNote,
  formatCommandSourceWarningHint,
  runPluginCommandSourceWithOutput,
} from '../pluginCommandSource.js'
import {
  checkClaudeCodeEngineRange,
  filterPluginsByEngineRange,
  selectOlderCompatibleVersionCandidates,
} from '../pluginEngineRange.js'
import {
  analyzeEngineCreateHookInSource,
  formatEngineCreateNounNotes,
  typeCheckPluginHooksModule,
} from '../pluginHooksValidate.js'
import {
  isClaudeAiChatCloudSession,
  isSyncedPluginEnabled,
} from '../pluginIdentifier.js'
import {
  PluginManifestSchema,
  PluginMarketplaceSchema,
  sanitizeMarketplaceRenames,
} from '../schemas.js'
import {
  isSkillAttachmentPath,
  validateSkillAttachmentForUpload,
} from '../skillUploadValidation.js'
import {
  formatPluginsPageCapNote,
  LIST_PLUGINS_MAX_ITEMS,
} from '../syncedPluginCloudSync.js'
import {
  pluginValidationOutcome,
  validateManifest,
  validatePluginContents,
} from '../validatePlugin.js'

const execFileAsync = promisify(execFile)

describe('Wave 323 Group 5B — Plugins Validation, Loading & Cloud Sync', () => {
  test('#1965 engines["claude-code"] semver parsing, filtering & older candidate selection', () => {
    const ok = checkClaudeCodeEngineRange('>=2.0.0', '2.1.323')
    expect(ok.kind).toBe('fits')

    const miss = checkClaudeCodeEngineRange('>=3.0.0', '2.1.323')
    expect(miss.kind).toBe('outside')

    const invalid = checkClaudeCodeEngineRange('not-a-range', '2.1.323')
    expect(invalid.kind).toBe('unreadable')

    const parsed = PluginManifestSchema().safeParse({
      name: 'demo',
      engines: { 'claude-code': '>=2.1.300' },
    })
    expect(parsed.success).toBe(true)

    const errors: PluginError[] = []
    const warnings: PluginWarning[] = []
    const plugins = [
      {
        name: 'ok-plugin',
        source: 'ok-plugin@mp',
        path: '/tmp/ok',
        enabled: true,
        manifest: {
          name: 'ok-plugin',
          engines: { 'claude-code': '>=2.0.0' },
        },
      },
      {
        name: 'future-plugin',
        source: 'future-plugin@mp',
        path: '/tmp/future',
        enabled: true,
        manifest: {
          name: 'future-plugin',
          engines: { 'claude-code': '>=99.0.0' },
        },
      },
    ]
    filterPluginsByEngineRange(
      plugins as unknown as Parameters<typeof filterPluginsByEngineRange>[0],
      errors,
      warnings,
      '2.1.323',
    )
    expect(plugins.filter(p => p.enabled).map(p => p.name)).toEqual([
      'ok-plugin',
    ])
    expect(errors.some(e => e.type === 'engine-range-unsatisfied')).toBe(true)

    const candidates = selectOlderCompatibleVersionCandidates(
      ['3.0.0', '2.5.0', '2.1.0', '2.0.0-beta.1'],
      { below: '3.0.0' },
    )
    expect(candidates).toEqual(['2.5.0', '2.1.0'])
  })

  test('#1967 & #2184 engine.create AST validation and $ noun notes', () => {
    const validSrc = `
      const makeFallback = () => ({ ok: true })
      export function register(on: any) {
        on('engine.create', async (_api: any, e: any, next: any) => {
          const { legacy, ...base } = await next(e)
          return {
            maybeFallback: makeFallback(),
            ...base,
            brandNew: { run: () => 1 },
          }
        })
      }
    `
    const validRes = analyzeEngineCreateHookInSource('hooks.ts', validSrc)
    expect(validRes?.isInForm).toBe(true)
    if (validRes?.isInForm) {
      const notes = formatEngineCreateNounNotes(validRes)
      expect(
        notes.some(n => n.includes('adds to $') && n.includes('brandNew')),
      ).toBe(true)
      expect(
        notes.some(
          n => n.includes("unless it's there") && n.includes('maybeFallback'),
        ),
      ).toBe(true)
      expect(
        notes.some(n => n.includes('withholds from $') && n.includes('legacy')),
      ).toBe(true)
    }

    const invalidSrc = `
      export function register(on: any) {
        on('engine.create', async (_api: any, e: any, next: any) => {
          let base = await next(e)
          e.foo = 1
          return { ...base, x: 1 }
        })
      }
    `
    const invalidRes = analyzeEngineCreateHookInSource('hooks.ts', invalidSrc)
    expect(invalidRes?.isInForm).toBe(false)
  })

  test('#1966 & #2211 validatePlugin runs TS type-check (--strict fails on warnings) and warns on settings.agent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'w323-val-'))
    try {
      await mkdir(join(dir, '.claude-plugin'), { recursive: true })
      await mkdir(join(dir, 'hooks'), { recursive: true })
      await writeFile(
        join(dir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({
          name: 'ts-check-demo',
          settings: { agent: 'my-agent' },
        }),
      )
      await writeFile(
        join(dir, 'hooks', 'hooks.json'),
        JSON.stringify({ modules: ['../hooks.ts'] }),
      )
      await writeFile(
        join(dir, 'hooks.ts'),
        `export function register(on: (e: string, h: unknown) => void) {
          const n: number = "not-a-number"
          on('tool.call', () => n)
        }\n`,
      )

      const tsDiag = typeCheckPluginHooksModule({
        pluginRoot: dir,
        moduleSpec: './hooks.ts',
        entryPath: join(dir, 'hooks.ts'),
      })
      const fileWarnings = tsDiag.files.flatMap(f => f.warnings)
      expect(fileWarnings.length).toBeGreaterThan(0)
      expect(
        fileWarnings.some(w =>
          w.message.includes(
            "Type 'string' is not assignable to type 'number'",
          ),
        ),
      ).toBe(true)

      const manifestValidation = await validateManifest(dir)
      const contentValidations = await validatePluginContents(dir)
      const allValidations = [manifestValidation, ...contentValidations]
      const allWarnings = allValidations.flatMap(v => v.warnings)
      expect(
        allWarnings.some(w =>
          w.message.includes(
            "Type 'string' is not assignable to type 'number'",
          ),
        ),
      ).toBe(true)
      expect(
        allWarnings.some(w =>
          w.message.includes(PLUGIN_AGENT_SETTING_DEPRECATED_MESSAGE),
        ),
      ).toBe(true)

      expect(
        pluginValidationOutcome(allValidations, { strict: false }).allSuccess,
      ).toBe(true)
      expect(
        pluginValidationOutcome(allValidations, { strict: true }).allSuccess,
      ).toBe(false)

      const notice = formatPluginAgentStartupNotice('ts-check-demo')
      expect(notice).toContain('stop working in a future release')
      expect(notice).toContain('ts-check-demo')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('#2035 defaultEnabled: false stays on in claude.ai chat cloud sessions', () => {
    const cloudChatEnv = {
      CLAUDE_CODE_SESSION_ORIGIN: 'claude_ai_chat',
      CLAUDE_CODE_REMOTE: '1',
    }
    expect(isClaudeAiChatCloudSession(cloudChatEnv)).toBe(true)
    expect(
      isClaudeAiChatCloudSession({
        CLAUDE_CODE_SESSION_ORIGIN: 'claude_ai_chat',
      }),
    ).toBe(false)
    expect(
      isSyncedPluginEnabled('p@synced', false, {}, { env: cloudChatEnv }),
    ).toBe(true)
    expect(isSyncedPluginEnabled('p@synced', false, {}, { env: {} })).toBe(
      false,
    )
  })

  test('#2038 plugin-not-installed error message & headless formatter', () => {
    const err: PluginError = {
      type: 'plugin-not-installed',
      source: 'demo@mp',
      plugin: 'demo',
    }
    const msg = getPluginErrorMessage(err)
    expect(msg).toContain('claude plugin install demo@mp --scope project')
    const rows = selectInitPluginErrors([err])
    const headless = formatHeadlessPluginErrors(rows)
    expect(headless).toContain('demo@mp')
  })

  test('#2043 selectInitPluginErrors includes managed errors and redacts on persisted transport', () => {
    const errors: PluginError[] = [
      {
        type: 'plugin-cache-miss',
        source: 'managed@mp',
        plugin: 'managed',
        installPath: '/etc/corp/secret-plugin',
      },
      {
        type: 'plugin-cache-miss',
        source: 'user@mp',
        plugin: 'user',
        installPath: '/tmp/user-plugin',
      },
    ]
    const live = selectInitPluginErrors(errors, {
      policyEnabledPluginIds: new Set(['managed@mp']),
      isPersistedTransport: false,
    })
    expect(live).toHaveLength(1)
    expect(live[0]?.message).toContain('/etc/corp/secret-plugin')

    const persisted = selectInitPluginErrors(errors, {
      policyEnabledPluginIds: new Set(['managed@mp']),
      isPersistedTransport: true,
    })
    expect(persisted).toHaveLength(1)
    expect(persisted[0]?.message).toBe(MANAGED_PLUGIN_ERROR_REDACTED_MESSAGE)
  })

  test('#2044 & #2189 plugin command source exit-0 stderr capture and warning notes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'w323-cmdsrc-'))
    try {
      await mkdir(join(dir, '.claude-plugin'), { recursive: true })
      await writeFile(
        join(dir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'cmd-demo' }),
      )
      const res = await runPluginCommandSourceWithOutput({
        source: 'command',
        command: `echo "warn on stderr" 1>&2; echo ${JSON.stringify(dir)}`,
      })
      expect(await realpath(res.dir)).toBe(await realpath(dir))
      expect(res.stderr).toContain('warn on stderr')
      expect(formatCommandSourceStderrNote(res.stderr ?? '')).toContain(
        'warn on stderr',
      )
      expect(formatCommandSourceWarningHint()).toContain('install command')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('#2045 marketplace renames tolerates malformed entries & rejects own __proto__', () => {
    const raw = { 'old-a': 'new-a', 'bad-num': 123, 'bad-obj': { x: 1 } }
    const cleaned = sanitizeMarketplaceRenames(raw) as Record<string, string>
    expect(cleaned['old-a']).toBe('new-a')
    expect(cleaned['bad-num']).toBe('bad-num')
    expect(cleaned['bad-obj']).toBe('bad-obj')

    const withProto = JSON.parse('{"old-a":"new-a","__proto__":"evil"}')
    expect(sanitizeMarketplaceRenames(withProto)).toBeUndefined()

    const parsed = PluginMarketplaceSchema().safeParse({
      name: 'mp',
      owner: { name: 'owner' },
      plugins: [],
      renames: raw,
    })
    expect(parsed.success).toBe(true)
  })

  test('#2049 version-list-not-enabled warning message and hint', () => {
    const warning = {
      type: 'version-list-not-enabled' as const,
      source: 'demo@mp',
      plugin: 'demo',
    }
    expect(getPluginWarningMessage(warning)).toContain('version')
    expect(getPluginWarningHint(warning)).toContain('"demo@mp": true')
  })

  test('#2050 core.longpaths=true & #2185 submodule sha_pin_mismatch verification', async () => {
    expect(GIT_LONGPATHS_ARGS).toEqual(['-c', 'core.longpaths=true'])
    const root = await mkdtemp(join(tmpdir(), 'w323-submod-'))
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    }
    try {
      const subOrigin = join(root, 'sub-origin')
      const parent = join(root, 'parent')
      await mkdir(subOrigin, { recursive: true })
      await mkdir(parent, { recursive: true })
      await execFileAsync('git', ['init', subOrigin], { env: gitEnv })
      await writeFile(join(subOrigin, 'a.txt'), 'v1\n')
      await execFileAsync('git', ['-C', subOrigin, 'add', '.'], { env: gitEnv })
      await execFileAsync('git', ['-C', subOrigin, 'commit', '-m', 'c1'], {
        env: gitEnv,
      })

      await execFileAsync('git', ['init', parent], { env: gitEnv })
      await execFileAsync(
        'git',
        [
          '-C',
          parent,
          '-c',
          'protocol.file.allow=always',
          'submodule',
          'add',
          subOrigin,
          'sub',
        ],
        { env: gitEnv },
      )
      await execFileAsync('git', ['-C', parent, 'commit', '-m', 'add sub'], {
        env: gitEnv,
      })

      expect(
        await verifySubmoduleShaPins(parent, { env: gitEnv }),
      ).toBeUndefined()

      // Advance submodule HEAD without updating parent pin → sha_pin_mismatch
      const subDir = join(parent, 'sub')
      await writeFile(join(subDir, 'b.txt'), 'v2\n')
      await execFileAsync('git', ['-C', subDir, 'add', '.'], { env: gitEnv })
      await execFileAsync('git', ['-C', subDir, 'commit', '-m', 'c2'], {
        env: gitEnv,
      })

      const mismatch = await verifySubmoduleShaPins(parent, { env: gitEnv })
      expect(mismatch?.errorKind).toBe('sha_pin_mismatch')
      expect(mismatch?.message).toContain('sub')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('#2146 Cowork skill file upload validation catches unsaveable skills', () => {
    expect(isSkillAttachmentPath('/tmp/my.skill')).toBe(true)
    expect(isSkillAttachmentPath('/tmp/foo/SKILL.md')).toBe(true)
    expect(isSkillAttachmentPath('/tmp/readme.md')).toBe(false)

    const enc = new TextEncoder()
    const badReserved = validateSkillAttachmentForUpload(
      '/tmp/SKILL.md',
      enc.encode('---\nname: claude-helper\ndescription: Helps\n---\nBody'),
    )
    expect(badReserved?.rule).toBe('reserved_word_in_name')

    const badXml = validateSkillAttachmentForUpload(
      '/tmp/SKILL.md',
      enc.encode(
        '---\nname: code-helper\ndescription: Uses <script> tag\n---\nBody',
      ),
    )
    expect(badXml?.rule).toBe('description_has_xml_tag')

    const good = validateSkillAttachmentForUpload(
      '/tmp/SKILL.md',
      enc.encode(
        '---\nname: code-reviewer\ndescription: Reviews TypeScript code cleanly.\n---\nBody',
      ),
    )
    expect(good).toBeUndefined()
  })

  test('#2154 >2,000 plugins page-cap note', () => {
    expect(LIST_PLUGINS_MAX_ITEMS).toBe(2000)
    expect(formatPluginsPageCapNote()).toContain('2,000')
  })

  test('#2185 gitSubmoduleUpdate always verifies SHA pins even when git submodule update exits non-zero', async () => {
    const mmSrc = await import('fs/promises').then(m =>
      m.readFile(join(import.meta.dir, '../marketplaceManager.ts'), 'utf8'),
    )
    const start = mmSrc.indexOf('async function gitSubmoduleUpdate(')
    expect(start).toBeGreaterThan(-1)
    const body = mmSrc.slice(start, start + 2600)
    expect(body).not.toMatch(
      /if\s*\(result\.code !== 0\)\s*\{[\s\S]*?\}\s*else\s*\{[\s\S]*?verifySubmoduleShaPins/,
    )
    expect(body).toContain('verifySubmoduleShaPins(cwd, { env })')

    // Functional check: when one submodule is uninitialized (failed checkout)
    // and another checked-out submodule has a SHA pin mismatch, verifySubmoduleShaPins
    // still detects and rejects the mismatch.
    const root = await mkdtemp(join(tmpdir(), 'w323-submod-partial-'))
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    }
    try {
      const sub1Origin = join(root, 'sub1-origin')
      const sub2Origin = join(root, 'sub2-origin')
      const parent = join(root, 'parent')

      for (const origin of [sub1Origin, sub2Origin]) {
        await execFileAsync('git', ['init', origin], { env: gitEnv })
        await writeFile(join(origin, 'a.txt'), 'v1\n')
        await execFileAsync('git', ['-C', origin, 'add', '.'], { env: gitEnv })
        await execFileAsync('git', ['-C', origin, 'commit', '-m', 'c1'], {
          env: gitEnv,
        })
      }

      await execFileAsync('git', ['init', parent], { env: gitEnv })
      for (const [origin, name] of [
        [sub1Origin, 'sub1'],
        [sub2Origin, 'sub2'],
      ] as const) {
        await execFileAsync(
          'git',
          [
            '-C',
            parent,
            '-c',
            'protocol.file.allow=always',
            'submodule',
            'add',
            origin,
            name,
          ],
          { env: gitEnv },
        )
      }
      await execFileAsync('git', ['-C', parent, 'commit', '-m', 'add subs'], {
        env: gitEnv,
      })

      // Simulate sub2 failing to check out (empty dir without .git) while sub1 is tampered
      await rm(join(parent, 'sub2', '.git'), { recursive: true, force: true })
      const sub1Dir = join(parent, 'sub1')
      await writeFile(join(sub1Dir, 'b.txt'), 'tampered\n')
      await execFileAsync('git', ['-C', sub1Dir, 'add', '.'], { env: gitEnv })
      await execFileAsync('git', ['-C', sub1Dir, 'commit', '-m', 'tamper'], {
        env: gitEnv,
      })

      const failure = await verifySubmoduleShaPins(parent, { env: gitEnv })
      expect(failure?.errorKind).toBe('sha_pin_mismatch')
      expect(failure?.message).toContain('sub1')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
