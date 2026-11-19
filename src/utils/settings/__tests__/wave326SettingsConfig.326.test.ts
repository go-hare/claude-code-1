import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  checkMidSessionSettingsFileErrors,
  getActiveSettingsFileErrorNotices,
  resetForTesting as resetChangeDetectorForTesting,
  subscribeSettingsFileErrorNotices,
} from '../changeDetector.js'
import {
  applyHostManagedPolicyModelPrecedence,
  envSelectsProviderOrGateway,
  MANAGED_SUBAGENT_MODEL_ENV_KEYS,
} from '../hostModelOverlay.js'
import {
  filterUntrustedRepoSettings,
  parseSettingsFileContent,
  settingsMergeCustomizer,
} from '../settings.js'
import {
  buildDeepNestingWarnings,
  findJsonSyntaxErrorLocation,
  isSafeGlobPattern,
  locateFirstJsonSyntaxErrorOffset,
  MAX_SETTINGS_NESTING_DEPTH,
  pruneDeepSettings,
  validateSettingsFileContent,
} from '../validation.js'

describe('Wave 326 Group 2 — Settings / Config / Glob / JSON', () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(async () => {
    for (const k of [
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_REMOTE',
      'CLAUDE_CODE_IS_COWORK',
      'CLAUDE_CODE_IGNORE_PERSISTED_TRUST',
    ]) {
      savedEnv[k] = process.env[k]
    }
    await resetChangeDetectorForTesting()
  })

  afterEach(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await resetChangeDetectorForTesting()
  })

  test('#18 prototype-pollution keys (__proto__, constructor, prototype) do not pollute or crash settings parsing/merging', () => {
    const rawJson =
      '{"__proto__":{"polluted":true},"env":{"FOO":"bar","__proto__":"bad","constructor":"bad"}}'
    const parsed = parseSettingsFileContent(
      rawJson,
      '/tmp/managed-settings.json',
    )
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(parsed.settings?.env?.FOO).toBe('bar')
    expect(Object.hasOwn(parsed.settings?.env ?? {}, '__proto__')).toBe(false)
    expect(
      settingsMergeCustomizer({ a: 1 }, { evil: true }, '__proto__'),
    ).toEqual({
      a: 1,
    })
  })

  test('#19 settings nested more than 64 levels deep are pruned with warnings without stack overflow', () => {
    let deep: Record<string, unknown> = { leaf: 'ok' }
    for (let i = 0; i < MAX_SETTINGS_NESTING_DEPTH + 10; i++) {
      deep = { child: deep }
    }
    const raw = { customDeep: deep, env: { OK: '1' } }
    const { value, dropped, tooManyNodes } = pruneDeepSettings(raw)
    expect(tooManyNodes).toBe(false)
    expect(dropped.length).toBeGreaterThan(0)
    expect(dropped[0]?.key).toBe('customDeep')
    expect((value as { env?: Record<string, string> }).env?.OK).toBe('1')

    const warnings = buildDeepNestingWarnings(dropped, '/tmp/settings.json')
    expect(warnings[0]?.severity).toBe('warning')
    expect(warnings[0]?.message).toContain('more than 64 levels deep')

    const validation = validateSettingsFileContent(JSON.stringify(raw))
    expect(validation.isValid).toBe(false)
    if (!validation.isValid) {
      expect(validation.error).toContain('more than 64 levels deep')
    }
  })

  test('#20 mid-session broken settings file emits warning naming the file and clears when fixed', () => {
    const received: Array<{
      fileName: string
      message: string
      cleared?: boolean
    }> = []
    const unsub = subscribeSettingsFileErrorNotices(n => {
      received.push({
        fileName: n.fileName,
        message: n.message,
        cleared: n.cleared,
      })
    })
    try {
      const first = checkMidSessionSettingsFileErrors('projectSettings', [
        {
          file: '/repo/.claude/settings.json',
          path: '',
          message: 'Invalid or malformed JSON (line 2, column 4)',
          severity: 'fatal',
        },
      ])
      expect(first).toHaveLength(1)
      expect(first[0]?.message).toContain(
        ".claude/settings.json has an error and didn't load",
      )
      expect(getActiveSettingsFileErrorNotices()).toHaveLength(1)

      // Once fixed, notice is cleared
      const cleared = checkMidSessionSettingsFileErrors('projectSettings', [])
      expect(cleared).toHaveLength(1)
      expect(cleared[0]?.cleared).toBe(true)
      expect(getActiveSettingsFileErrorNotices()).toHaveLength(0)
      expect(received).toHaveLength(2)
    } finally {
      unsub()
    }
  })

  test('#21 CLAUDE_CODE_SUBAGENT_MODEL* preserved in Desktop Code tab unless settings env chooses provider/gateway', () => {
    expect(
      MANAGED_SUBAGENT_MODEL_ENV_KEYS.has('CLAUDE_CODE_SUBAGENT_MODEL'),
    ).toBe(true)
    expect(
      MANAGED_SUBAGENT_MODEL_ENV_KEYS.has(
        'CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL',
      ),
    ).toBe(true)

    expect(
      envSelectsProviderOrGateway({ CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' }),
    ).toBe(false)
    expect(
      envSelectsProviderOrGateway({
        CLAUDE_CODE_SUBAGENT_MODEL: 'haiku',
        CLAUDE_CODE_USE_BEDROCK: '1',
      }),
    ).toBe(true)
    expect(
      envSelectsProviderOrGateway({
        ANTHROPIC_BASE_URL: 'https://gateway.corp.internal',
      }),
    ).toBe(true)
    expect(
      envSelectsProviderOrGateway({
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      }),
    ).toBe(false)

    // First-party Desktop Code tab without provider/gateway -> keeps subagent model
    const kept = applyHostManagedPolicyModelPrecedence(
      {
        model: 'opus',
        env: {
          ANTHROPIC_MODEL: 'opus',
          CLAUDE_CODE_SUBAGENT_MODEL: 'haiku',
          CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: 'sonnet',
        },
      },
      null,
      true,
      false,
      true,
    )
    expect(kept?.model).toBeUndefined()
    expect(kept?.env?.ANTHROPIC_MODEL).toBeUndefined()
    expect(kept?.env?.CLAUDE_CODE_SUBAGENT_MODEL).toBe('haiku')
    expect(kept?.env?.CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL).toBe('sonnet')

    // When the same managed settings env selects Bedrock -> strips subagent model too
    const stripped = applyHostManagedPolicyModelPrecedence(
      {
        env: {
          CLAUDE_CODE_USE_BEDROCK: '1',
          CLAUDE_CODE_SUBAGENT_MODEL: 'haiku',
        },
      },
      null,
      true,
      false,
      true,
    )
    expect(stripped?.env?.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined()
  })

  test('#122 malformed or pathological glob patterns fail fast without hanging', async () => {
    expect(isSafeGlobPattern('**/*.{ts,tsx}').safe).toBe(true)
    expect(isSafeGlobPattern('a'.repeat(70_000)).safe).toBe(false)
    expect(isSafeGlobPattern('{'.repeat(40) + '}'.repeat(40)).safe).toBe(false)
    expect(isSafeGlobPattern('*.{ts,tsx').safe).toBe(false)
    expect(isSafeGlobPattern('[unterminated').safe).toBe(false)
    expect(isSafeGlobPattern('*'.repeat(25)).safe).toBe(false)

    const { GrepTool } = await import(
      '@claude-code/builtin-tools/tools/GrepTool/GrepTool.js'
    )
    const grepValidation = await GrepTool.validateInput({
      pattern: 'foo',
      glob: '*.{ts,tsx',
    })
    expect(grepValidation.result).toBe(false)
    if (!grepValidation.result) {
      expect(grepValidation.message).toContain('Invalid glob pattern')
    }
  })

  test('#261 broken JSON reports 1-based line and column', () => {
    const broken = '{\n  "model": "opus",\n  "env": {\n    "A": 1,\n  }\n}'
    const loc = findJsonSyntaxErrorLocation(broken)
    expect(loc).toBeDefined()
    expect(loc!.line).toBeGreaterThanOrEqual(4)
    expect(loc!.column).toBeGreaterThanOrEqual(1)

    const parsed = parseSettingsFileContent(
      broken,
      '/repo/.claude/settings.json',
    )
    expect(parsed.settings).toBeNull()
    expect(parsed.errors[0]?.line).toBe(loc?.line)
    expect(parsed.errors[0]?.column).toBe(loc?.column)
    expect(parsed.errors[0]?.message).toContain(
      `line ${loc?.line}, column ${loc?.column}`,
    )
  })

  test('#324 untrusted repo settings strip Zvl keys, credential helpers, and non-restrictive overrides while keeping stricter settings', () => {
    const filtered = filterUntrustedRepoSettings(
      {
        enabledPlugins: { 'foo@bar': true },
        apiKeyHelper: '/tmp/evil.sh',
        otelHeadersHelper: '/tmp/otel.sh',
        skipDangerousModePermissionPrompt: true, // looser -> stripped
        disableAllHooks: false, // looser -> stripped (also in Zvl)
        allowManagedPermissionRulesOnly: true, // stricter -> kept
        permissions: {
          denyInsteadOfPrompting: false, // looser -> stripped
          blockReadsOutsideWorkingDirectories: true, // stricter -> kept
        },
      } as never,
      'projectSettings',
    ) as Record<string, unknown>

    expect(filtered.enabledPlugins).toBeUndefined()
    expect(filtered.apiKeyHelper).toBeUndefined()
    expect(filtered.otelHeadersHelper).toBeUndefined()
    expect(filtered.skipDangerousModePermissionPrompt).toBeUndefined()
    expect(filtered.allowManagedPermissionRulesOnly).toBe(true)
    expect(
      (filtered.permissions as Record<string, unknown>)?.denyInsteadOfPrompting,
    ).toBeUndefined()
    expect(
      (filtered.permissions as Record<string, unknown>)
        ?.blockReadsOutsideWorkingDirectories,
    ).toBe(true)
  })

  test('#261 review fix: deeply nested malformed JSON does not stack-overflow locateFirstJsonSyntaxErrorOffset or findJsonSyntaxErrorLocation', () => {
    const deepArrays = `${'['.repeat(2000)}!`
    const deepObjects = `${'{"a":'.repeat(2000)}!`
    expect(() => locateFirstJsonSyntaxErrorOffset(deepArrays)).not.toThrow()
    expect(locateFirstJsonSyntaxErrorOffset(deepArrays)).toBeUndefined()
    expect(() => locateFirstJsonSyntaxErrorOffset(deepObjects)).not.toThrow()
    expect(locateFirstJsonSyntaxErrorOffset(deepObjects)).toBeUndefined()
    expect(() => findJsonSyntaxErrorLocation(deepArrays)).not.toThrow()
    expect(() => findJsonSyntaxErrorLocation(deepObjects)).not.toThrow()
  })
})
