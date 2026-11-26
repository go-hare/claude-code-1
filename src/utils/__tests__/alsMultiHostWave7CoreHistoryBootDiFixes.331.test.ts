/**
 * Official Claude Code 2.1.331 Wave 7 Core Disk Locks, History, Boot DI,
 * Wave 5 Agent 6 ALS Fixes, Balance Poller, ProviderRegistry & ToolResultStorage tests.
 *
 * Verifies every fix from Strict Adversarial Review D (P0-8, P0-9, P1-13, P1-14,
 * P1-15, P1-16, P2-14a, P2-14b) plus Reviewer A P0-2 (`Ns()` in functionHooksModules).
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Ns } from '@anthropic/ink'
import {
  resetStateForTests,
  setSessionPersistenceDisabled,
} from '../../bootstrap/state.js'
import { addToHistory, clearPendingHistoryEntries } from '../../history.js'
import {
  _invalidateProviderCache,
  DEFAULT_PROVIDERS,
  loadProviders,
  saveProviders,
} from '../../services/providerRegistry/loader.js'
import { genericBalanceProvider } from '../../services/providerUsage/balance/generic.js'
import {
  getActiveBalanceProviderId,
  startBalancePolling,
  stopBalancePolling,
} from '../../services/providerUsage/balance/poller.js'
import {
  getMCPSkillBuilders,
  type MCPSkillBuilders,
  registerMCPSkillBuilders,
} from '../../skills/mcpSkillBuilders.js'
import {
  isAccountOnHoldGateEnabled,
  registerAccountOnHoldGateReader,
} from '../accountOnHold.js'
import {
  getAutonomyPersistenceLockCountForTests,
  withAutonomyPersistenceLock,
} from '../autonomyPersistence.js'
import * as cleanupRegistry from '../cleanupRegistry.js'
import { runCleanupFunctions } from '../cleanupRegistry.js'
import {
  leftoverD2SetClientData,
  leftoverQrr,
  leftoverQrrInstallClientData,
  leftoverQrrSetCacheKey,
  leftoverQrrSetOverride,
  leftoverQrrSetReadGate,
  leftoverQrrSetSlots,
  leftoverQrrSetStaleMatchGetter,
  leftoverQrrSetStrictReadGate,
  leftoverQrrSetWindowSeed,
  leftoverQrrStrict,
} from '../collapseReadSearch.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import {
  executeInBackground,
  resetBrokenAsyncRewakeForTests,
} from '../hooks/hookAsyncRewake.js'
import {
  clearHookEventState,
  registerHookEventHandler,
  setAllHookEventsEnabled,
} from '../hooks/hookEvents.js'
import {
  acquirePluginClient,
  type ClientPressBridge,
  disposePluginClients,
  forgetPluginSurfaceModules,
  setClientFaultReporter,
  setClientMessageCancelHandler,
  setClientMessagePostHandler,
  setClientPressBridge,
  setPluginSurfaceModules,
} from '../plugins/functionHooksClient.js'
import { enqueueClientMessage } from '../plugins/functionHooksModules.js'
import {
  resetInMemoryState,
  scheduleManagedExternalPluginBackgroundFetch,
} from '../plugins/installedPluginsManager.js'
import {
  clearPluginToolRegistrarForTests,
  createBunPluginToolRegistrar,
  createNodePluginToolRegistrar,
} from '../plugins/pluginToolLoopbackRegistrar.js'
import * as pluginToolRegistry from '../plugins/pluginToolRegistry.js'
import {
  exitSessionContext,
  getActiveSessionFromAls,
  getBootstrapSession,
  hasActiveSessionAls,
  registerSessionContextReader,
  runWithNewHostSession,
  runWithSession,
  runWithSubconversationContext,
} from '../sessionHost.js'
import { getSessionAlsStore } from '../sessionRoot.js'
import type { ShellCommand } from '../ShellCommand.js'
import {
  readMailbox,
  withInProcessMailboxLock,
  writeToMailbox,
} from '../teammateMailbox.js'
import {
  _resetEphemeralToolResultsForTests,
  cleanupEphemeralToolResultsDirs,
  ensureToolResultsDir,
  getToolResultsDir,
} from '../toolResultStorage.js'
import {
  getWorktreeGitIsolationContext,
  registerWorktreeSessionProvider,
} from '../worktreeGitIsolation.js'

const tick = (ms = 10): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

function makeFakeShellCommand(opts: {
  stdout?: string
  stderr?: string
  exitCode?: number
}): {
  shell: ShellCommand
  resolveExit: (code?: number) => void
} {
  let resolveResult!: (value: { code: number; interrupted: boolean }) => void
  const resultPromise = new Promise<{ code: number; interrupted: boolean }>(
    resolve => {
      resolveResult = resolve
    },
  )
  const stdout = opts.stdout ?? ''
  const stderr = opts.stderr ?? ''
  let status: 'running' | 'completed' | 'killed' = 'running'

  const shell = {
    get status() {
      return status
    },
    set status(next: 'running' | 'completed' | 'killed') {
      status = next
    },
    result: resultPromise,
    taskOutput: {
      getStdout: async () => stdout,
      getStderr: async () => stderr,
    },
    kill: () => {
      status = 'killed'
    },
    cleanup: () => {},
  } as unknown as ShellCommand

  return {
    shell,
    resolveExit: (code = opts.exitCode ?? 0) => {
      status = 'completed'
      resolveResult({ code, interrupted: false })
    },
  }
}

describe('2.1.331 Wave 7 Core Disk Locks, History, Boot DI, Wave 5 Agent 6 ALS Fixes, Poller, ProviderRegistry & ToolResultStorage', () => {
  const tempDirs: string[] = []
  const restores: Array<() => void> = []
  const savedEnv: Record<string, string | undefined> = {}

  function setEnv(key: string, value: string | undefined): void {
    if (!(key in savedEnv)) {
      savedEnv[key] = process.env[key]
    }
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  function makeTempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
    tempDirs.push(dir)
    return dir
  }

  beforeEach(() => {
    registerSessionContextReader(getSessionAlsStore)
    resetStateForTests()
  })

  afterEach(async () => {
    for (const restore of restores.splice(0).reverse()) {
      try {
        restore()
      } catch {
        // ignore restore errors
      }
    }
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k]
      } else {
        process.env[k] = v
      }
      delete savedEnv[k]
    }
    getClaudeConfigHomeDir.cache?.clear?.()
    resetStateForTests()
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore temp cleanup errors
      }
    }
  })

  test('P0-8: autonomyPersistence serializes concurrent hosts on same rootDir with maxOverlap === 1, zero ELOCKED, and intact caller ALS', async () => {
    const sharedRoot = makeTempDir('w7-auto-lock-')
    let active = 0
    let maxOverlap = 0
    const observedIds: string[] = []

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        runWithNewHostSession(
          { id: `auto-host-${i}`, cwd: sharedRoot },
          async () => {
            await withAutonomyPersistenceLock(sharedRoot, async () => {
              active += 1
              if (active > maxOverlap) maxOverlap = active
              const beforeId = getActiveSessionFromAls()?.id
              await tick(5)
              const afterId = getActiveSessionFromAls()?.id
              expect(beforeId).toBe(`auto-host-${i}`)
              expect(afterId).toBe(`auto-host-${i}`)
              observedIds.push(afterId ?? 'none')
              active -= 1
            })
          },
        ),
      ),
    )

    expect(maxOverlap).toBe(1)
    expect(observedIds).toHaveLength(8)
    expect(new Set(observedIds).size).toBe(8)
    expect(getAutonomyPersistenceLockCountForTests()).toBe(0)
  })

  test('P0-8: teammateMailbox serializes concurrent hosts targeting same inbox path (including unnormalized variants) with maxOverlap === 1', async () => {
    const sharedConfigDir = makeTempDir('w7-mb-cfg-')
    setEnv('CLAUDE_CONFIG_DIR', sharedConfigDir)
    getClaudeConfigHomeDir.cache?.clear?.()

    const inboxPath = join(sharedConfigDir, 'shared-inbox.json')
    const unnormalizedInboxPath = join(
      sharedConfigDir,
      'nested',
      '..',
      'shared-inbox.json',
    )

    let active = 0
    let maxOverlap = 0
    const observedIds: string[] = []

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        runWithNewHostSession({ id: `mb-host-${i}` }, async () => {
          const pathToUse = i % 2 === 0 ? inboxPath : unnormalizedInboxPath
          await withInProcessMailboxLock(pathToUse, async () => {
            active += 1
            if (active > maxOverlap) maxOverlap = active
            const beforeId = getActiveSessionFromAls()?.id
            await tick(4)
            const afterId = getActiveSessionFromAls()?.id
            expect(beforeId).toBe(`mb-host-${i}`)
            expect(afterId).toBe(`mb-host-${i}`)
            observedIds.push(afterId ?? 'none')
            active -= 1
          })
        }),
      ),
    )

    expect(maxOverlap).toBe(1)
    expect(observedIds).toHaveLength(8)
    expect(new Set(observedIds).size).toBe(8)

    // Also verify real concurrent writeToMailbox across 8 hosts drops 0 messages (zero ELOCKED)
    const teamName = 'w7-shared-team'
    const msgIds = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        runWithNewHostSession({ id: `mb-writer-${i}` }, () =>
          writeToMailbox(
            'shared-agent',
            {
              from: `sender-${i}`,
              text: `payload-${i}`,
              timestamp: new Date(1_700_000_000_000 + i).toISOString(),
            },
            teamName,
          ),
        ),
      ),
    )

    expect(msgIds.every(id => typeof id === 'string' && id.length > 0)).toBe(
      true,
    )
    const messages = await readMailbox('shared-agent', teamName)
    expect(messages).toHaveLength(8)
    expect(new Set(messages.map(m => m.text)).size).toBe(8)
  })

  test('P0-9: history.ts persists 40 / 40 entries across 40 concurrent hosts via runCleanupFunctions() and re-registers cleanly after drain', async () => {
    const sharedConfigDir = makeTempDir('w7-hist-40-')
    setEnv('CLAUDE_CONFIG_DIR', sharedConfigDir)
    setEnv('CLAUDECODE', undefined)
    setEnv('CLAUDE_CODE_CHILD_SESSION', undefined)
    setEnv('CLAUDE_CODE_SKIP_PROMPT_HISTORY', undefined)
    getClaudeConfigHomeDir.cache?.clear?.()

    const count = 40
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        runWithNewHostSession(
          { id: `hist-s-${i}`, cwd: sharedConfigDir },
          async () => {
            clearPendingHistoryEntries()
            addToHistory(`wave7-entry-${i}`)
            await runCleanupFunctions()
          },
        ),
      ),
    )

    const historyFile = join(sharedConfigDir, 'history.jsonl')
    const lines = readFileSync(historyFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l) as { display: string })
    const displays = new Set(lines.map(l => l.display))
    expect(lines).toHaveLength(count)
    for (let i = 0; i < count; i++) {
      expect(displays.has(`wave7-entry-${i}`)).toBe(true)
    }

    // Reusing a session AFTER runCleanupFunctions() drain must re-register cleanup cleanly
    await runWithNewHostSession(
      { id: 'hist-reuse-session', cwd: sharedConfigDir },
      async () => {
        clearPendingHistoryEntries()
        addToHistory('reuse-first-entry')
        await runCleanupFunctions()
        addToHistory('reuse-second-entry')
        await runCleanupFunctions()
      },
    )

    const afterReuseLines = readFileSync(historyFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => (JSON.parse(l) as { display: string }).display)
    expect(afterReuseLines).toContain('reuse-first-entry')
    expect(afterReuseLines).toContain('reuse-second-entry')
  })

  test('P1-13: collapseReadSearch boot leftoverQrrInstallClientData() is inherited by fresh isolated hosts while allowing explicit per-host overrides (including null)', async () => {
    const cfgDir = makeTempDir('w7-qrr-cfg-')
    setEnv('CLAUDE_CONFIG_DIR', cfgDir)
    setEnv('CLAUDE_CODE_USE_BEDROCK', undefined)
    setEnv('CLAUDE_CODE_USE_VERTEX', undefined)
    setEnv('CLAUDE_CODE_USE_FOUNDRY', undefined)
    setEnv('CLAUDE_CODE_USE_OPENAI', undefined)
    setEnv('CLAUDE_CODE_USE_GEMINI', undefined)
    setEnv('CLAUDE_CODE_USE_GROK', undefined)
    getClaudeConfigHomeDir.cache?.clear?.()

    // Reset defaults outside ALS, install boot client-data gates, restore in afterEach
    leftoverQrrSetSlots(null)
    leftoverQrrSetWindowSeed(null)
    leftoverQrrSetReadGate(null)
    leftoverQrrSetStrictReadGate(null)
    leftoverQrrSetCacheKey(null)
    leftoverQrrSetOverride(null)
    leftoverQrrSetStaleMatchGetter(null)
    restores.push(() => {
      leftoverD2SetClientData(null)
      leftoverQrrSetSlots(null)
      leftoverQrrSetWindowSeed(null)
      leftoverQrrSetReadGate(null)
      leftoverQrrSetStrictReadGate(null)
      leftoverQrrSetCacheKey(null)
      leftoverQrrSetOverride(null)
      leftoverQrrSetStaleMatchGetter(null)
    })

    // Boot installation outside ALS (mirrors init.ts:366)
    expect(hasActiveSessionAls()).toBe(false)
    leftoverQrrInstallClientData()

    // Fresh isolated host inherits boot strictReadGate & readGate
    const firstPartyRes = runWithNewHostSession({ id: 'qrr-1p' }, () => {
      leftoverD2SetClientData({ meadow_lantern: true })
      return {
        strict: leftoverQrrStrict(),
        regular: leftoverQrr()?.data ?? null,
      }
    })
    expect(firstPartyRes.strict).toEqual({ meadow_lantern: true })
    expect(firstPartyRes.regular).toEqual({ meadow_lantern: true })

    // On 3P provider (Bedrock), boot-installed readGate and strictReadGate block reads in fresh hosts
    setEnv('CLAUDE_CODE_USE_BEDROCK', '1')
    const [thirdPartyDefault, thirdPartyNullOverride] = await Promise.all([
      runWithNewHostSession({ id: 'qrr-3p-default' }, async () => {
        leftoverD2SetClientData({ meadow_lantern: true })
        await tick(5)
        return {
          regular: leftoverQrr(),
          strict: leftoverQrrStrict(),
        }
      }),
      runWithNewHostSession({ id: 'qrr-3p-null-override' }, async () => {
        leftoverD2SetClientData({ meadow_lantern: true })
        // Explicit per-host null read gate disables the 3P gate ONLY for this host
        leftoverQrrSetReadGate(null)
        await tick(5)
        return {
          regular: leftoverQrr()?.data ?? null,
          strict: leftoverQrrStrict(),
        }
      }),
    ])

    expect(thirdPartyDefault.regular).toBeNull()
    expect(thirdPartyDefault.strict).toBeNull()
    expect(thirdPartyNullOverride.regular).toEqual({ meadow_lantern: true })
    expect(thirdPartyNullOverride.strict).toBeNull()

    // Back on 1P: explicit per-host strictReadGate=null overrides boot strict gate ONLY for that host
    setEnv('CLAUDE_CODE_USE_BEDROCK', undefined)
    const [strictNullHost, strictInheritedHost] = await Promise.all([
      runWithNewHostSession({ id: 'qrr-strict-null' }, async () => {
        leftoverD2SetClientData({ meadow_lantern: true })
        leftoverQrrSetStrictReadGate(null)
        await tick(5)
        return leftoverQrrStrict()
      }),
      runWithNewHostSession({ id: 'qrr-strict-inherited' }, async () => {
        leftoverD2SetClientData({ meadow_lantern: true })
        await tick(5)
        return leftoverQrrStrict()
      }),
    ])
    expect(strictNullHost).toBeNull()
    expect(strictInheritedHost).toEqual({ meadow_lantern: true })
  })

  test('P1-14: lazy boot DI registrars use exitSessionContext and subconversation-safe getActiveSessionFromAls() checks without shadowing', async () => {
    // 1. Source-level guarantee that all 4 top-level default registrations use exitSessionContext
    const repoRoot = join(import.meta.dir, '..', '..', '..')
    expect(
      readFileSync(join(repoRoot, 'src/skills/loadSkillsDir.ts'), 'utf8'),
    ).toContain('exitSessionContext(() => {\n  registerMCPSkillBuilders(')
    expect(
      readFileSync(join(repoRoot, 'src/utils/worktree.ts'), 'utf8'),
    ).toContain(
      'exitSessionContext(() => {\n  registerWorktreeSessionProvider(',
    )
    expect(
      readFileSync(
        join(repoRoot, 'src/services/analytics/growthbook.ts'),
        'utf8',
      ),
    ).toContain(
      'exitSessionContext(() => {\n  registerAccountOnHoldGateReader(',
    )
    expect(
      readFileSync(
        join(repoRoot, 'src/utils/plugins/functionHooksModules.ts'),
        'utf8',
      ),
    ).toContain('exitSessionContext(() => {\n  setClientPressBridge(')

    // 2. mcpSkillBuilders: subconversation on default host updates default AND clears stale default-host override
    let prevBuilders: MCPSkillBuilders | null = null
    try {
      prevBuilders = getMCPSkillBuilders()
    } catch {
      prevBuilders = null
    }
    const staleBuilders: MCPSkillBuilders = {
      createSkillCommand:
        (() => {}) as unknown as MCPSkillBuilders['createSkillCommand'],
      parseSkillFrontmatterFields:
        (() => ({})) as unknown as MCPSkillBuilders['parseSkillFrontmatterFields'],
    }
    const subconvDefaultBuilders: MCPSkillBuilders = {
      createSkillCommand:
        (() => {}) as unknown as MCPSkillBuilders['createSkillCommand'],
      parseSkillFrontmatterFields:
        (() => ({})) as unknown as MCPSkillBuilders['parseSkillFrontmatterFields'],
    }
    restores.push(() => {
      if (prevBuilders) {
        exitSessionContext(() => registerMCPSkillBuilders(prevBuilders!))
      }
    })

    // Seed a stale per-host override on the default bootstrap session
    runWithSession(getBootstrapSession(), () => {
      registerMCPSkillBuilders(staleBuilders)
    })
    expect(getMCPSkillBuilders()).toBe(staleBuilders)

    // Now register inside runWithSubconversationContext on default host (hasActiveSessionAls()===true, getActiveSessionFromAls()===undefined)
    runWithSubconversationContext({ sessionId: 'subconv-default' }, () => {
      expect(hasActiveSessionAls()).toBe(true)
      expect(getActiveSessionFromAls()).toBeUndefined()
      registerMCPSkillBuilders(subconvDefaultBuilders)
    })

    // Default host must NOT be shadowed by staleBuilders, AND fresh isolated host inherits subconvDefaultBuilders
    expect(getMCPSkillBuilders()).toBe(subconvDefaultBuilders)
    const inheritedBuilders = runWithNewHostSession(
      { id: 'di-msb-fresh' },
      () => getMCPSkillBuilders(),
    )
    expect(inheritedBuilders).toBe(subconvDefaultBuilders)

    // 3. worktreeGitIsolation: subconversation on default host updates default AND clears stale default-host override
    const staleWt = () => ({
      worktreePath: '/wt-stale',
      originalCwd: '/orig-stale',
    })
    const freshDefaultWt = () => ({
      worktreePath: '/wt-default-fresh',
      originalCwd: '/orig-default-fresh',
    })
    restores.push(() => {
      exitSessionContext(() => registerWorktreeSessionProvider(() => null))
    })

    runWithSession(getBootstrapSession(), () => {
      registerWorktreeSessionProvider(staleWt)
    })
    expect(getWorktreeGitIsolationContext('/tmp')?.worktreePath).toBe(
      '/wt-stale',
    )

    runWithSubconversationContext({ sessionId: 'subconv-wt' }, () => {
      registerWorktreeSessionProvider(freshDefaultWt)
    })
    expect(getWorktreeGitIsolationContext('/tmp')?.worktreePath).toBe(
      '/wt-default-fresh',
    )
    const inheritedWt = runWithNewHostSession(
      { id: 'di-wt-fresh' },
      () => getWorktreeGitIsolationContext('/tmp')?.worktreePath,
    )
    expect(inheritedWt).toBe('/wt-default-fresh')

    // 4. accountOnHold: subconversation on default host updates default AND clears stale default-host override
    const prevGate = registerAccountOnHoldGateReader(() => false)
    restores.push(() => {
      exitSessionContext(() => registerAccountOnHoldGateReader(prevGate))
    })

    runWithSession(getBootstrapSession(), () => {
      registerAccountOnHoldGateReader(() => false)
    })
    expect(isAccountOnHoldGateEnabled()).toBe(false)

    runWithSubconversationContext({ sessionId: 'subconv-aoh' }, () => {
      registerAccountOnHoldGateReader(() => true)
    })
    expect(isAccountOnHoldGateEnabled()).toBe(true)
    const inheritedGate = runWithNewHostSession({ id: 'di-aoh-fresh' }, () =>
      isAccountOnHoldGateEnabled(),
    )
    expect(inheritedGate).toBe(true)

    // 5. functionHooksClient setClientPressBridge: subconversation on default host updates default AND clears stale default-host override
    const holds: string[] = []
    const defaultBridge: ClientPressBridge = {
      hold: plugin => {
        holds.push(`default:${plugin}`)
        return 777
      },
      release: () => {},
      forget: () => {},
    }
    const staleBridge: ClientPressBridge = {
      hold: plugin => {
        holds.push(`stale:${plugin}`)
        return 666
      },
      release: () => {},
      forget: () => {},
    }
    restores.push(() => {
      disposePluginClients()
      forgetPluginSurfaceModules('plug-di-bridge')
      exitSessionContext(() => setClientPressBridge(undefined))
    })

    runWithSession(getBootstrapSession(), () => {
      setClientPressBridge(staleBridge)
    })
    runWithSubconversationContext({ sessionId: 'subconv-bridge' }, () => {
      setClientPressBridge(defaultBridge)
    })

    const surfaceDir = makeTempDir('w7-bridge-')
    const modPath = join(surfaceDir, 'btn.js')
    const btnSource = `export function Btn() { return h('Button', { onPress: () => {} }, 'Go') }`
    writeFileSync(modPath, btnSource, 'utf8')

    // Mount in a fresh isolated host — must inherit defaultBridge (NOT staleBridge or undefined)
    await runWithNewHostSession({ id: 'di-bridge-fresh' }, async () => {
      setPluginSurfaceModules('plug-di-bridge', surfaceDir, [
        {
          module: './btn',
          modulePath: modPath,
          component: 'Btn',
          source: btnSource,
        },
      ])
      const client = acquirePluginClient({
        plugin: 'plug-di-bridge',
        key: 'k-di',
        module: './btn',
      })
      await tick(25)
      client.release()
      disposePluginClients()
      forgetPluginSurfaceModules('plug-di-bridge')
    })
    expect(holds).toContain('default:plug-di-bridge')
    expect(holds).not.toContain('stale:plug-di-bridge')
  })

  test('P1-15 & Reviewer A P0-2: Wave 5 Agent 6 5 files keep hasActiveSessionAls() === false outside ALS and functionHooksModules uses dynamic Ns()', async () => {
    expect(hasActiveSessionAls()).toBe(false)

    // Reviewer A P0-2: functionHooksModules uses Ns() instead of boot-pinned instances
    const repoRoot = join(import.meta.dir, '..', '..', '..')
    const fhmSource = readFileSync(
      join(repoRoot, 'src/utils/plugins/functionHooksModules.ts'),
      'utf8',
    )
    expect(fhmSource).toContain(
      "import { getClipboardPath, Ns, stringWidth } from '@anthropic/ink'",
    )
    expect(fhmSource).toContain('const ink = Ns().get(process.stdout)')
    expect(fhmSource).not.toContain('const ink = instances.get(process.stdout)')

    const [nsA, nsB] = await Promise.all([
      runWithNewHostSession({ id: 'ns-host-a' }, async () => {
        const reg = Ns()
        await tick(5)
        return reg
      }),
      runWithNewHostSession({ id: 'ns-host-b' }, async () => {
        const reg = Ns()
        await tick(5)
        return reg
      }),
    ])
    expect(nsA).not.toBe(nsB)

    // 1. hookAsyncRewake.ts outside ALS
    resetBrokenAsyncRewakeForTests()
    clearHookEventState()
    setAllHookEventsEnabled(true)
    const hookAlsStates: boolean[] = []
    registerHookEventHandler(() => {
      hookAlsStates.push(hasActiveSessionAls())
    })
    restores.push(() => {
      clearHookEventState()
      resetBrokenAsyncRewakeForTests()
    })
    const fakeShell = makeFakeShellCommand({ stdout: 'ok', exitCode: 0 })
    executeInBackground({
      processId: 'w7-rewake-non-als',
      hookId: 'hk-w7-1',
      shellCommand: fakeShell.shell,
      asyncResponse: { async: true },
      hookEvent: 'Stop',
      hookName: 'test-rewake',
      command: 'echo ok',
      asyncRewake: true,
    })
    fakeShell.resolveExit(0)
    await tick(25)
    expect(hookAlsStates).toEqual([false])

    // 2. installedPluginsManager.ts outside ALS
    resetInMemoryState()
    const fetcherAlsStates: boolean[] = []
    const fetchPromise = scheduleManagedExternalPluginBackgroundFetch(
      [
        {
          pluginId: 'w7-non-als-ext@mkt',
          entry: { name: 'w7-non-als-ext' },
          marketplaceInstallLocation: makeTempDir('w7-ipm-'),
        },
      ],
      {
        fetcher: async () => {
          fetcherAlsStates.push(hasActiveSessionAls())
          return false
        },
      },
    )
    expect(fetchPromise).toBeDefined()
    await fetchPromise
    expect(fetcherAlsStates).toEqual([false])

    // 3. pluginToolLoopbackRegistrar.ts outside ALS (both Bun and Node servers)
    const loopbackAlsStates: boolean[] = []
    const listSpy = spyOn(
      pluginToolRegistry,
      'listPluginRegisteredTools',
    ).mockImplementation(() => {
      loopbackAlsStates.push(hasActiveSessionAls())
      return [
        {
          name: 'ping',
          description: 'Ping',
          inputSchema: { type: 'object' },
        },
      ]
    })
    restores.push(() => {
      listSpy.mockRestore()
      clearPluginToolRegistrarForTests()
    })

    for (const makeReg of [
      createBunPluginToolRegistrar,
      createNodePluginToolRegistrar,
    ]) {
      clearPluginToolRegistrarForTests()
      const reg = makeReg()
      const res = reg('plug-loop-non-als', [
        {
          name: 'ping',
          description: 'Ping',
          inputSchema: { type: 'object' },
        },
      ])
      expect(res.config.type).toBe('http')
      if (res.config.type === 'http') {
        const resp = await fetch(res.config.url, {
          method: 'POST',
          headers: {
            ...res.config.headers,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {},
          }),
        })
        expect(resp.status).toBe(200)
      }
    }
    expect(loopbackAlsStates.length).toBeGreaterThanOrEqual(2)
    expect(loopbackAlsStates.every(v => v === false)).toBe(true)

    // 4. functionHooksClient.ts outside ALS
    const clientAlsStates: Record<string, boolean[]> = {
      fault: [],
      cancel: [],
      hold: [],
      release: [],
      post: [],
    }
    const clientSurfaceDir = makeTempDir('w7-fhc-non-als-')
    const panelPath = join(clientSurfaceDir, 'panel.js')
    const panelSrc = `
      export function Panel(props, surface) {
        if (props?.triggerPost && surface?.post) {
          surface.post({ ping: true })
        }
        return h('Button', { onPress: () => {} }, 'ok')
      }
    `
    writeFileSync(panelPath, panelSrc, 'utf8')
    const brokenPath = join(clientSurfaceDir, 'broken.js')
    writeFileSync(
      brokenPath,
      `export function Broken() { throw new Error('boom') }`,
      'utf8',
    )

    setClientFaultReporter(() => {
      clientAlsStates.fault!.push(hasActiveSessionAls())
    })
    setClientMessagePostHandler(() => {
      clientAlsStates.post!.push(hasActiveSessionAls())
    })
    setClientMessageCancelHandler(() => {
      clientAlsStates.cancel!.push(hasActiveSessionAls())
    })
    setClientPressBridge({
      hold: () => {
        clientAlsStates.hold!.push(hasActiveSessionAls())
        return 1
      },
      release: () => {
        clientAlsStates.release!.push(hasActiveSessionAls())
      },
      forget: () => {},
    })
    restores.push(() => {
      disposePluginClients()
      forgetPluginSurfaceModules('plug-fhc-non-als')
      setClientFaultReporter(undefined)
      setClientMessagePostHandler(undefined)
      setClientMessageCancelHandler(undefined)
      setClientPressBridge(undefined)
    })

    setPluginSurfaceModules('plug-fhc-non-als', clientSurfaceDir, [
      {
        module: './panel',
        modulePath: panelPath,
        component: 'Panel',
        source: panelSrc,
      },
      {
        module: './broken',
        modulePath: brokenPath,
        component: 'Broken',
        source: `export function Broken() { throw new Error('boom') }`,
      },
    ])

    const okClient = acquirePluginClient({
      plugin: 'plug-fhc-non-als',
      key: 'ok-k',
      module: './panel',
      props: { triggerPost: true },
    })
    const failClient = acquirePluginClient({
      plugin: 'plug-fhc-non-als',
      key: 'bad-k',
      module: './broken',
    })
    await tick(35)
    okClient.release()
    failClient.release()
    disposePluginClients()

    expect(clientAlsStates.hold!.length).toBeGreaterThanOrEqual(1)
    expect(clientAlsStates.hold!.every(v => v === false)).toBe(true)
    expect(clientAlsStates.release!.length).toBeGreaterThanOrEqual(1)
    expect(clientAlsStates.release!.every(v => v === false)).toBe(true)
    expect(clientAlsStates.post!.length).toBeGreaterThanOrEqual(1)
    expect(clientAlsStates.post!.every(v => v === false)).toBe(true)
    expect(clientAlsStates.fault!.length).toBeGreaterThanOrEqual(1)
    expect(clientAlsStates.fault!.every(v => v === false)).toBe(true)
    expect(clientAlsStates.cancel!.length).toBeGreaterThanOrEqual(1)
    expect(clientAlsStates.cancel!.every(v => v === false)).toBe(true)

    // 5. functionHooksModules.ts enqueueClientMessage outside ALS
    let replyAls: boolean | undefined
    enqueueClientMessage(
      {
        id: 'w7-msg-non-als',
        plugin: 'plug-none',
        surface: 'terminal',
        component: 'Client',
        requestId: 'req-1',
        element: 'el-1',
        module: './m',
        data: { hello: 1 },
      },
      () => {
        replyAls = hasActiveSessionAls()
      },
    )
    await tick(45)
    expect(replyAls).toBe(false)
  })

  test('P1-16: balance/poller.ts registers cleanup so runCleanupFunctions() stops the host interval cleanly', async () => {
    setEnv('CLAUDE_CODE_BALANCE_PROVIDER', undefined)
    setEnv('CLAUDE_CODE_BALANCE_POLL_INTERVAL_MINUTES', '0.0005') // ~30ms

    const isEnabledSpy = spyOn(
      genericBalanceProvider,
      'isEnabled',
    ).mockReturnValue(true)
    let fetchCalls = 0
    const seenSessionIds: Array<string | undefined> = []
    const fetchSpy = spyOn(
      genericBalanceProvider,
      'fetchBalance',
    ).mockImplementation(async () => {
      fetchCalls += 1
      seenSessionIds.push(getActiveSessionFromAls()?.id)
      return {
        remaining: 100,
        currency: 'USD',
        fetchedAt: Date.now(),
      }
    })
    restores.push(() => {
      stopBalancePolling()
      isEnabledSpy.mockRestore()
      fetchSpy.mockRestore()
    })

    await runWithNewHostSession({ id: 'poller-cleanup-host' }, async () => {
      startBalancePolling()
      expect(getActiveBalanceProviderId()).toBe('generic')
      await tick(75)
      expect(fetchCalls).toBeGreaterThanOrEqual(2)
      expect(seenSessionIds.every(id => id === 'poller-cleanup-host')).toBe(
        true,
      )

      // Draining host cleanup MUST stop the interval and clear active provider!
      await runCleanupFunctions()
      expect(getActiveBalanceProviderId()).toBeNull()
    })

    const countRightAfterCleanup = fetchCalls
    await tick(90)
    expect(fetchCalls).toBe(countRightAfterCleanup)
  })

  test('P2-14a: providerRegistry/loader.ts saveProviders() in Host A immediately invalidates Host B cached providers', async () => {
    const cfgDir = makeTempDir('w7-prov-gen-')
    setEnv('CLAUDE_CONFIG_DIR', cfgDir)
    getClaudeConfigHomeDir.cache?.clear?.()
    _invalidateProviderCache()

    const customProvider = {
      id: 'wave7-custom',
      kind: 'openai-compat' as const,
      baseUrl: 'https://wave7-custom.example.com/v1',
      apiKeyEnv: 'WAVE7_CUSTOM_KEY',
      defaultModel: 'wave7-model',
      compatRule: 'strict-openai' as const,
    }

    let bLoadedRelease!: () => void
    const bLoaded = new Promise<void>(resolve => {
      bLoadedRelease = resolve
    })
    let aSavedRelease!: () => void
    const aSaved = new Promise<void>(resolve => {
      aSavedRelease = resolve
    })

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'prov-save-a' }, async () => {
        await bLoaded
        saveProviders([...DEFAULT_PROVIDERS, customProvider])
        aSavedRelease()
        return loadProviders().some(p => p.id === 'wave7-custom')
      }),
      runWithNewHostSession({ id: 'prov-save-b' }, async () => {
        const before = loadProviders()
        const hadCustomBefore = before.some(p => p.id === 'wave7-custom')
        bLoadedRelease()
        await aSaved
        // Host B does NOT call _invalidateProviderCache() itself; generation bump forces reload
        const after = loadProviders()
        const hadCustomAfter = after.some(p => p.id === 'wave7-custom')
        return {
          hadCustomBefore,
          hadCustomAfter,
          reloadedRef: before !== after,
        }
      }),
    ])

    expect(resA).toBe(true)
    expect(resB).toEqual({
      hadCustomBefore: false,
      hadCustomAfter: true,
      reloadedRef: true,
    })
  })

  test('P2-14b: toolResultStorage dead/isolated host cleanup does NOT delete default host ephemeral dir, and cleanupRegistered resets after drain', async () => {
    const baseCfg = makeTempDir('w7-trs-cfg-')
    const projDir = makeTempDir('w7-trs-proj-')
    setEnv('CLAUDE_CONFIG_DIR', baseCfg)
    setEnv('CLAUDE_CODE_SKIP_PROMPT_HISTORY', '1')
    getClaudeConfigHomeDir.cache?.clear?.()

    // 1. Default bootstrap host creates a live ephemeral dir with a marker file
    _resetEphemeralToolResultsForTests()
    await ensureToolResultsDir()
    const defaultResultsDir = getToolResultsDir()
    const defaultMarker = join(defaultResultsDir, 'default-live.txt')
    writeFileSync(defaultMarker, 'alive', 'utf8')
    expect(existsSync(defaultMarker)).toBe(true)
    restores.push(() => {
      void cleanupEphemeralToolResultsDirs()
    })

    // 2. Ephemeral Host X registers its cleanup callback; invoking it OUTSIDE ALS
    // (simulating dead/GC'd session teardown on default host) MUST NOT touch default host's dir!
    let capturedHostXCleanup: (() => void | Promise<void>) | undefined
    const origRegisterCleanup = cleanupRegistry.registerCleanup
    const regSpy = spyOn(cleanupRegistry, 'registerCleanup').mockImplementation(
      fn => {
        if (typeof fn === 'function') {
          capturedHostXCleanup = fn
        }
        return origRegisterCleanup(fn)
      },
    )
    restores.push(() => regSpy.mockRestore())

    let hostXDir = ''
    await runWithNewHostSession(
      { id: 'trs-host-x', cwd: projDir },
      async () => {
        setSessionPersistenceDisabled(true)
        await ensureToolResultsDir()
        hostXDir = getToolResultsDir()
        writeFileSync(join(hostXDir, 'x.txt'), 'ephemeral-x', 'utf8')
        expect(existsSync(hostXDir)).toBe(true)
      },
    )
    regSpy.mockRestore()

    expect(capturedHostXCleanup).toBeDefined()
    expect(hasActiveSessionAls()).toBe(false)
    // Run Host X's cleanup callback OUTSIDE ALS (when getBootstrapSessionHost() === default host)
    await capturedHostXCleanup!()
    expect(existsSync(hostXDir)).toBe(false)

    // Default host's live ephemeral dir MUST still exist untouched!
    expect(hostXDir).not.toBe(defaultResultsDir)
    expect(existsSync(defaultMarker)).toBe(true)

    // 3. Reusing a host after drain resets cleanupRegistered so a second ephemeral dir is ALSO cleaned on drain
    await runWithNewHostSession(
      { id: 'trs-host-reuse', cwd: projDir },
      async () => {
        setSessionPersistenceDisabled(true)
        await ensureToolResultsDir()
        const firstDir = getToolResultsDir()
        writeFileSync(join(firstDir, '1.txt'), 'one', 'utf8')
        expect(existsSync(firstDir)).toBe(true)

        await runCleanupFunctions()
        expect(existsSync(firstDir)).toBe(false)

        // Second ephemeral dir on the SAME host after drain must re-register cleanup
        await ensureToolResultsDir()
        const secondDir = getToolResultsDir()
        expect(secondDir).not.toBe(firstDir)
        writeFileSync(join(secondDir, '2.txt'), 'two', 'utf8')
        expect(existsSync(secondDir)).toBe(true)

        await runCleanupFunctions()
        expect(existsSync(secondDir)).toBe(false)

        // Also verify _resetEphemeralToolResultsForTests resets cleanupRegistered
        await ensureToolResultsDir()
        const thirdDir = getToolResultsDir()
        writeFileSync(join(thirdDir, '3.txt'), 'three', 'utf8')
        _resetEphemeralToolResultsForTests()
        await ensureToolResultsDir()
        const fourthDir = getToolResultsDir()
        writeFileSync(join(fourthDir, '4.txt'), 'four', 'utf8')
        await runCleanupFunctions()
        expect(existsSync(fourthDir)).toBe(false)
      },
    )

    // Default host dir STILL untouched until default host explicitly cleans up!
    expect(existsSync(defaultMarker)).toBe(true)
    await cleanupEphemeralToolResultsDirs()
    expect(existsSync(defaultResultsDir)).toBe(false)
  })
})
