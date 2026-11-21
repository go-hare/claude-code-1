import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getOriginalCwd,
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
} from '../../bootstrap/state.js'
import {
  _resetOutsideReadBlockLatchForTests,
  isAutoMemoryHeldByOutsideReadBlock,
  latchBlockReadsOutsideWorkingDirectories,
} from '../../memdir/paths.js'
import * as growthbook from '../../services/analytics/growthbook.js'
import type { ToolPermissionContext } from '../../Tool.js'
import { validateForceLoginOrg } from '../auth.js'
import {
  clearMemoryFileCaches,
  createMemoryPermissionReader,
  drainWithheldMemoryOwed,
  getMemoryFiles,
  registerClaudeMdPermissionContextSource,
  resetWithheldMemoryStateForTests,
  setClaudeMdPermissionContext,
} from '../claudemd.js'
import {
  enableConfigs,
  getGlobalConfig,
  resetEnableConfigsForTesting,
  resetGlobalConfigWriteFlagsForTesting,
} from '../config.js'
import {
  clearSessionOrgEffortCaps,
  getSessionOrgEffortCap,
  stepDownOrgEffortCap,
} from '../effort.js'
import {
  isFableModelBilledToCredits,
  isKSlFableCreditsRequired,
  isMagicalClockActive,
} from '../extraUsage.js'
import { getFsImplementation } from '../fsOperations.js'
import { getBootstrapSessionHost } from '../sessionHost.js'
import {
  resetSettingsCache,
  setCachedSettingsForSource,
} from '../settings/settingsCache.js'
import type { StorageV5 } from '../storageV5/createLocalFsBackend.js'
import {
  pinHoverRest,
  resetHoverRestPinForTests,
} from '../storageV5/hoverRestPin.js'

function makeContext(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  }
}

describe('Wave 1C: claudemd.ts & memdir/paths.ts [P0-13]', () => {
  const savedCwd = getOriginalCwd()
  const tempDirs: string[] = []

  beforeEach(() => {
    resetWithheldMemoryStateForTests()
    _resetOutsideReadBlockLatchForTests()
    setClaudeMdPermissionContext(undefined)
    registerClaudeMdPermissionContextSource(undefined)
    clearMemoryFileCaches()
  })

  afterEach(() => {
    setClaudeMdPermissionContext(undefined)
    registerClaudeMdPermissionContextSource(undefined)
    clearMemoryFileCaches()
    resetWithheldMemoryStateForTests()
    _resetOutsideReadBlockLatchForTests()
    resetSettingsCache()
    setOriginalCwd(savedCwd)
    setCwdState(savedCwd)
    setProjectRoot(savedCwd)
    for (const d of tempDirs.splice(0)) {
      rmSync(d, { recursive: true, force: true })
    }
  })

  test('per-ancestor above(dir) exempts only ancestor direct memory paths and blocks recursive @include & symlink escapes', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'wave1c-above-')))
    tempDirs.push(root)
    const subCwd = join(root, 'packages', 'app')
    mkdirSync(subCwd, { recursive: true })
    mkdirSync(join(root, '.claude', 'rules'), { recursive: true })

    const outsideSecret = join(root, 'secret.md')
    const inCwdAllowed = join(subCwd, 'allowed-in-cwd.md')
    const ancestorClaude = join(root, 'CLAUDE.md')
    const ancestorLocalLink = join(root, 'CLAUDE.local.md')
    const ancestorRule = join(root, '.claude', 'rules', 'direct.md')
    const ancestorRuleLink = join(root, '.claude', 'rules', 'escape.md')

    writeFileSync(outsideSecret, 'TOP-SECRET-OUTSIDE')
    writeFileSync(inCwdAllowed, 'ALLOWED-INSIDE-CWD')
    writeFileSync(
      ancestorClaude,
      `ANCESTOR-DIRECT\n@./secret.md\n@./packages/app/allowed-in-cwd.md\n`,
    )
    symlinkSync(outsideSecret, ancestorLocalLink)
    writeFileSync(ancestorRule, 'ANCESTOR-DIRECT-RULE')
    symlinkSync(outsideSecret, ancestorRuleLink)

    setOriginalCwd(subCwd)
    setCwdState(subCwd)
    setProjectRoot(subCwd)

    setClaudeMdPermissionContext(
      makeContext({
        blockReadsOutsideWorkingDirectories: true,
      }),
    )

    const files = await getMemoryFiles(true)
    const joined = files.map(f => f.content).join('\n')

    expect(joined).toContain('ANCESTOR-DIRECT')
    expect(joined).toContain('ANCESTOR-DIRECT-RULE')
    expect(joined).toContain('ALLOWED-INSIDE-CWD')
    expect(joined).not.toContain('TOP-SECRET-OUTSIDE')

    const withheld = drainWithheldMemoryOwed([])
    expect(
      withheld.some(w => w.path === outsideSecret && w.why === 'outside'),
    ).toBe(true)
    expect(
      withheld.some(w => w.path === ancestorLocalLink && w.why === 'outside'),
    ).toBe(true)
  })

  test('createMemoryPermissionReader stats file before calling fs.readFile to avoid OOM on oversize files', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wave1c-stat-')))
    tempDirs.push(dir)
    const bigFile = join(dir, 'CLAUDE.md')
    writeFileSync(bigFile, 'x'.repeat(256))

    setOriginalCwd(dir)
    setCwdState(dir)

    const fsImpl = getFsImplementation()
    const readFileSpy = spyOn(fsImpl, 'readFile')
    try {
      const reader = createMemoryPermissionReader(makeContext())
      const result = await reader(bigFile, 64)
      expect(result).toBeUndefined()
      expect(readFileSpy).not.toHaveBeenCalled()
    } finally {
      readFileSpy.mockRestore()
    }
  })

  test('getMemoryFiles invalidates memo cache when permission hold state changes', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wave1c-memo-')))
    tempDirs.push(dir)
    writeFileSync(join(dir, 'CLAUDE.md'), 'ROOT-MEMO-CHECK\n@./secret.md\n')
    writeFileSync(join(dir, 'secret.md'), 'SECRET-MEMO-PAYLOAD')

    setOriginalCwd(dir)
    setCwdState(dir)
    setProjectRoot(dir)

    let liveCtx: ToolPermissionContext = makeContext()
    registerClaudeMdPermissionContextSource(() => liveCtx)

    const first = await getMemoryFiles(false)
    expect(first.map(f => f.content).join('\n')).toContain(
      'SECRET-MEMO-PAYLOAD',
    )

    // Change permission hold state WITHOUT manually clearing the memo cache
    liveCtx = makeContext({
      alwaysDenyRules: { userSettings: ['Read(**/secret.md)'] },
    })

    const second = await getMemoryFiles(false)
    expect(second.map(f => f.content).join('\n')).not.toContain(
      'SECRET-MEMO-PAYLOAD',
    )
    expect(second.map(f => f.content).join('\n')).toContain('ROOT-MEMO-CHECK')
  })

  test('isAutoMemoryHeldByOutsideReadBlock gates AutoMem when blockReadsOutsideWorkingDirectories is latched and localSettings.autoMemoryDirectory is repo-scoped', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wave1c-automem-')))
    tempDirs.push(dir)
    // Symlinked .claude makes isLocalSettingsGitTracked return 'tracked'
    const targetDotClaude = join(dir, 'real-claude')
    mkdirSync(targetDotClaude, { recursive: true })
    symlinkSync(targetDotClaude, join(dir, '.claude'))

    setOriginalCwd(dir)
    setCwdState(dir)
    setProjectRoot(dir)

    setCachedSettingsForSource('localSettings', {
      autoMemoryDirectory: join(dir, 'evil-mem'),
    })

    // Without outside-read block active, AutoMem is not held
    expect(isAutoMemoryHeldByOutsideReadBlock()).toBe(false)

    // Once latched (or context has blockReadsOutsideWorkingDirectories: true), AutoMem is held
    expect(
      isAutoMemoryHeldByOutsideReadBlock({
        blockReadsOutsideWorkingDirectories: true,
      }),
    ).toBe(true)

    latchBlockReadsOutsideWorkingDirectories()
    expect(isAutoMemoryHeldByOutsideReadBlock()).toBe(true)
  })
})

describe('Wave 1C: auth.ts validateForceLoginOrg [P0-16]', () => {
  afterEach(() => {
    resetSettingsCache()
  })

  test('rejects disallowed API provider with reason provider_not_allowed', async () => {
    setCachedSettingsForSource('policySettings', {
      allowedProviders: ['bedrock'],
    })

    const res = await validateForceLoginOrg()
    expect(res.valid).toBe(false)
    if (!res.valid) {
      expect(res.reason).toBe('provider_not_allowed')
      expect(res.message).toContain('anthropic')
      expect(res.message).toContain('bedrock')
    }
  })
})

describe('Wave 1C: effort.ts clearSessionOrgEffortCaps [P1-#24]', () => {
  afterEach(() => {
    clearSessionOrgEffortCaps()
  })

  test('clears recorded session org effort caps', () => {
    stepDownOrgEffortCap('claude-opus-4-6', 'max')
    expect(getSessionOrgEffortCap('claude-opus-4-6')).toBeDefined()
    clearSessionOrgEffortCaps()
    expect(getSessionOrgEffortCap('claude-opus-4-6')).toBeUndefined()
  })
})

describe('Wave 1C: extraUsage.ts official rQr(e) logic [P1-#27]', () => {
  const savedEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT

  afterEach(() => {
    if (savedEntrypoint === undefined) {
      delete process.env.CLAUDE_CODE_ENTRYPOINT
    } else {
      process.env.CLAUDE_CODE_ENTRYPOINT = savedEntrypoint
    }
    getBootstrapSessionHost().accountCreditLatches.replaceFableCreditsRequired(
      false,
    )
  })

  test('does not reference invented tengu_fable_included_in_plan flag', async () => {
    const src = await Bun.file(
      new URL('../extraUsage.ts', import.meta.url),
    ).text()
    expect(src).not.toContain('tengu_fable_included_in_plan')
    expect(src).toContain('tengu_saffron_lattice')
    expect(src).toContain('tengu_hazy_horizon')
    expect(src).toContain('tengu_magical_clock')
  })

  test('evaluates tengu_saffron_lattice, tengu_hazy_horizon, tengu_magical_clock per official rQr(e)', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    const gbCachedSpy = spyOn(
      growthbook,
      'getFeatureValue_CACHED_MAY_BE_STALE',
    ).mockImplementation(((flag: string, fallback: unknown) => {
      if (flag === 'tengu_hazy_horizon') return true
      if (flag === 'tengu_magical_clock') return ['cli']
      if (flag === 'tengu_saffron_lattice') {
        return {
          overageConsentRequired: true,
          perModel: { 'claude-fable-5': { enabled: false } },
        }
      }
      return fallback
    }) as typeof growthbook.getFeatureValue_CACHED_MAY_BE_STALE)
    const gbSourceSpy = spyOn(
      growthbook,
      'getFeatureValueWithSource',
    ).mockImplementation(((flag: string, fallback: unknown) => {
      if (flag === 'tengu_saffron_lattice') {
        return {
          value: {
            enabled: false,
            perModel: { 'claude-fable-5': { enabled: false } },
          },
          source: 'override' as const,
        }
      }
      return { value: fallback, source: 'fallback' as const }
    }) as typeof growthbook.getFeatureValueWithSource)

    try {
      expect(isMagicalClockActive()).toBe(true)
      // perModel explicitly disables claude-fable-5
      expect(isFableModelBilledToCredits('claude-fable-5')).toBe(false)
      // Another fable model falls back to overageConsentRequired: true
      expect(isFableModelBilledToCredits('claude-fable-5-1')).toBe(true)
      // Admin-billed with authoritative disabled lattice does not require credits
      expect(
        isKSlFableCreditsRequired({
          planStatus: 'admin_billed',
          model: 'claude-fable-5',
        }),
      ).toBe(false)
    } finally {
      gbCachedSpy.mockRestore()
      gbSourceSpy.mockRestore()
    }
  })
})

describe('Wave 1C: config.ts enableConfigs(storageV5) [P2-#10c]', () => {
  beforeEach(() => {
    resetHoverRestPinForTests()
    resetEnableConfigsForTesting()
    resetGlobalConfigWriteFlagsForTesting()
  })

  afterEach(() => {
    resetHoverRestPinForTests()
    resetEnableConfigsForTesting()
    resetGlobalConfigWriteFlagsForTesting()
  })

  test('refreshes global config from storageV5 on initial enableConfigs(storageV5) call', async () => {
    const savedNodeEnv = process.env.NODE_ENV
    pinHoverRest(true)
    let readCount = 0
    const mockStorageV5 = {
      readText: async () => {
        readCount++
        return {
          ok: true as const,
          value: {
            items: [
              {
                found: true as const,
                value: JSON.stringify({ numStartups: 777 }),
                mtimeMs: Date.now(),
              },
            ],
          },
        }
      },
    } as unknown as StorageV5

    try {
      enableConfigs(mockStorageV5)
      // Allow microtasks from async storage refresh to settle
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(readCount).toBe(1)
      process.env.NODE_ENV = 'production'
      expect(getGlobalConfig().numStartups).toBe(777)

      // Calling enableConfigs(mockStorageV5) again does not double-refresh
      enableConfigs(mockStorageV5)
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(readCount).toBe(1)
    } finally {
      if (savedNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = savedNodeEnv
      }
    }
  })
})
