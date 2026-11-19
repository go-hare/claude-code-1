import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getFlagSettingsPath, setFlagSettingsPath } from '../bootstrap/state.js'
import {
  BRIDGE_SETTINGS_BINDING_ENV,
  computeBridgeSettingsBinding,
  verifyBridgeSettingsBinding,
} from '../bridge/sessionRunner.js'
import { type AppState, getDefaultAppState } from '../state/AppState.js'
import { evaluateCcrKeepsSessionRules } from '../state/onChangeAppState.js'
import {
  completeMcpTask,
  failMcpTask,
  getSep2663TaskSidecarPath,
  killMcpTask,
  readPersistedSep2663TaskMetas,
  registerMcpTask,
} from '../tasks/McpTask/McpTask.js'
import { handleSep2663ServerTask } from '../utils/mcpAutoBackground.js'
import { listSetAsidePluginData } from '../utils/plugins/marketplaceHelpers.js'
import * as settingsMod from '../utils/settings/settings.js'
import { resetSettingsCache } from '../utils/settings/settingsCache.js'
import type { TaskRegistry } from '../utils/taskRegistry.js'

const SRC_ROOT = join(import.meta.dir, '..')

describe('Wave 319-322 Review Fix Batch 3 (9 items)', () => {
  const tempDirs: string[] = []
  const savedEnv: Record<string, string | undefined> = {}
  const origFlagSettingsPath = getFlagSettingsPath()

  function makeTmp(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  function setEnv(key: string, val: string | undefined): void {
    if (!(key in savedEnv)) {
      savedEnv[key] = process.env[key]
    }
    if (val === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = val
    }
  }

  afterEach(() => {
    setFlagSettingsPath(origFlagSettingsPath)
    resetSettingsCache()
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    for (const k of Object.keys(savedEnv)) delete savedEnv[k]
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true })
    }
  })

  test('1. [P0] #1752: REPL.tsx runs copyFileHistoryForResume strictly after switchSession', () => {
    const replSrc = readFileSync(join(SRC_ROOT, 'screens/REPL.tsx'), 'utf8')
    const switchIdx = replSrc.indexOf(
      'switchSession(\n          asSessionId(sessionId),',
    )
    const copyIdx = replSrc.indexOf('copyFileHistoryForResume(log)')
    expect(switchIdx).toBeGreaterThan(-1)
    expect(copyIdx).toBeGreaterThan(switchIdx)
  })

  test('2. [P0] #1717: SEP-2663 sidecar write, unified reader, terminal cleanup, live setAppState & abortable poll sleep', async () => {
    const { restorePersistedSep2663TasksOnResume } = await import('../main.js')
    const { readPersistedSep2663TaskMetas: readPersistedFromPrint } =
      await import('../cli/print.js')
    // Unified reader re-exported by print.ts matches McpTask.ts
    expect(readPersistedFromPrint).toBe(readPersistedSep2663TaskMetas)

    // Verify main.tsx passes resumeSep2663Tasks to launchRepl rather than updating dead resumeData.initialState
    const mainSrc = readFileSync(join(SRC_ROOT, 'main.tsx'), 'utf8')
    expect(mainSrc).toContain('resumeSep2663Tasks,')
    expect(mainSrc).not.toContain('resumeData.initialState = next')

    const projectDir = makeTmp('sep2663-proj-')
    const sessionId = 'sess-batch3-1717'
    let state = getDefaultAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }

    // 2a. registerMcpTask atomically writes sidecar for protocol === 'sep2663'
    const taskId1 = registerMcpTask(setAppState, {
      serverName: 'claude.ai Linear',
      toolName: 'sync_issues',
      mcpTaskId: 'srv-linear-1',
      protocol: 'sep2663',
      pollIntervalMs: 100,
      sidecarSessionId: sessionId,
      sidecarProjectDir: projectDir,
    })
    const task1 = state.tasks[taskId1] as { sidecarWrite?: Promise<unknown> }
    await task1.sidecarWrite

    const sidecarPath1 = getSep2663TaskSidecarPath(
      taskId1,
      sessionId,
      projectDir,
    )
    expect(existsSync(sidecarPath1)).toBe(true)

    // Ignore non-mcp-task files in the same directory
    writeFileSync(
      join(projectDir, sessionId, 'mcp-tasks', 'other.meta.json'),
      JSON.stringify({
        taskId: 'x',
        serverName: 's',
        toolName: 't',
        mcpTaskId: 'm',
        protocol: 'sep2663',
      }),
    )

    const metas = await readPersistedSep2663TaskMetas(sessionId, projectDir)
    expect(metas).toHaveLength(1)
    expect(metas[0]).toMatchObject({
      taskId: taskId1,
      serverName: 'claude.ai Linear',
      toolName: 'sync_issues',
      mcpTaskId: 'srv-linear-1',
      protocol: 'sep2663',
    })

    // 2b. completeMcpTask cleans up the sidecar
    expect(completeMcpTask(taskId1, setAppState, 'all done')).toBe(true)
    await new Promise(r => setTimeout(r, 20))
    expect(existsSync(sidecarPath1)).toBe(false)

    // 2c. failMcpTask cleans up the sidecar
    const taskId2 = registerMcpTask(setAppState, {
      serverName: 'claude.ai Linear',
      toolName: 'export',
      mcpTaskId: 'srv-linear-2',
      protocol: 'sep2663',
      sidecarSessionId: sessionId,
      sidecarProjectDir: projectDir,
    })
    await (state.tasks[taskId2] as { sidecarWrite?: Promise<unknown> })
      .sidecarWrite
    const sidecarPath2 = getSep2663TaskSidecarPath(
      taskId2,
      sessionId,
      projectDir,
    )
    expect(existsSync(sidecarPath2)).toBe(true)
    expect(failMcpTask(taskId2, setAppState, 'boom')).toBe(true)
    await new Promise(r => setTimeout(r, 20))
    expect(existsSync(sidecarPath2)).toBe(false)

    // 2d. killMcpTask cleans up the sidecar
    const taskId3 = registerMcpTask(setAppState, {
      serverName: 'claude.ai Linear',
      toolName: 'cancel_me',
      mcpTaskId: 'srv-linear-3',
      protocol: 'sep2663',
      sidecarSessionId: sessionId,
      sidecarProjectDir: projectDir,
    })
    await (state.tasks[taskId3] as { sidecarWrite?: Promise<unknown> })
      .sidecarWrite
    const sidecarPath3 = getSep2663TaskSidecarPath(
      taskId3,
      sessionId,
      projectDir,
    )
    expect(existsSync(sidecarPath3)).toBe(true)
    const fakeRegistry = {
      get: (id: string) => state.tasks[id],
      update: (
        id: string,
        updater: (cur: AppState['tasks'][string]) => AppState['tasks'][string],
      ) => {
        setAppState(prev => {
          const cur = prev.tasks[id]
          if (!cur) return prev
          return { ...prev, tasks: { ...prev.tasks, [id]: updater(cur) } }
        })
      },
    } as unknown as TaskRegistry
    await killMcpTask(taskId3, fakeRegistry)
    await new Promise(r => setTimeout(r, 20))
    expect(existsSync(sidecarPath3)).toBe(false)

    // 2e. handleSep2663ServerTask writes sidecar & restorePersistedSep2663TasksOnResume uses live setAppState and aborts sleep promptly
    let resolvePoll!: () => void
    const bgRes = await handleSep2663ServerTask({
      serverName: 'claude.ai Slack',
      toolName: 'search',
      toolLabel: 'mcp__claude_ai_Slack__search',
      taskRef: {
        mcpTaskId: 'srv-slack-42',
        status: 'working',
        pollIntervalMs: 30_000,
      },
      env: {},
      isNonInteractiveSession: false,
      setAppState,
      sidecarSessionId: sessionId,
      sidecarProjectDir: projectDir,
      pollToCompletion: () =>
        new Promise<{ content: Array<{ type: 'text'; text: string }> }>(res => {
          resolvePoll = () => res({ content: [{ type: 'text', text: 'done' }] })
        }),
    })
    const bgTaskId = (bgRes as { taskId: string }).taskId
    await (state.tasks[bgTaskId] as { sidecarWrite?: Promise<unknown> })
      .sidecarWrite
    expect(
      existsSync(getSep2663TaskSidecarPath(bgTaskId, sessionId, projectDir)),
    ).toBe(true)

    // Simulate --resume in a fresh live AppState with long pollIntervalMs (30s) and abort quickly
    let resumedState = getDefaultAppState()
    const resumedSetAppState = (updater: (prev: AppState) => AppState) => {
      resumedState = updater(resumedState)
    }
    let getCalls = 0
    const fakeClient = {
      type: 'connected' as const,
      name: 'claude.ai Slack',
      capabilities: {},
      config: { type: 'http' as const, url: 'https://example.test/mcp' },
      client: {
        request: async () => {
          getCalls++
          return { status: 'working' }
        },
      },
      cleanup: async () => {},
    }
    const restored = await restorePersistedSep2663TasksOnResume({
      sessionId,
      projectDir,
      setAppState: resumedSetAppState,
      getMcpClients: () => [fakeClient as never],
    })
    expect(restored.restoredTaskIds).toEqual([bgTaskId])
    expect(resumedState.tasks[bgTaskId]?.type).toBe('mcp_task')
    await new Promise(r => setTimeout(r, 15))
    expect(getCalls).toBeGreaterThanOrEqual(1)

    // Abort the restored poller — should settle immediately (well under 30s!)
    const t0 = Date.now()
    const restoredTask = resumedState.tasks[bgTaskId] as {
      driveAbortController?: AbortController
    }
    restoredTask.driveAbortController?.abort()
    await new Promise(r => setTimeout(r, 25))
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(resumedState.tasks[bgTaskId]?.status).toBe('failed')

    // Clean up original in-memory poll promise
    resolvePoll()
  })

  test('3. [P1] #1771/#1816: evaluateCcrKeepsSessionRules passes deny.whole && ask.whole to sanitizeAllowSessionRules', () => {
    // When deny & ask are whole, missing an allow rule in ctx MUST return false
    const missingAllow = evaluateCcrKeepsSessionRules(
      {
        internal: {
          session_deny_rules: ['Bash(rm -rf *)'],
          session_ask_rules: ['Bash(git push *)'],
          session_allow_rules: ['Bash(bun test)'],
        },
      },
      {
        alwaysDenyRules: { session: ['Bash(rm -rf *)'] },
        alwaysAskRules: { session: ['Bash(git push *)'] },
        alwaysAllowRules: { session: [] },
      },
    )
    expect(missingAllow).toBe(false)

    // When all deny, ask, and allow rules are present, returns true
    const allPresent = evaluateCcrKeepsSessionRules(
      {
        internal: {
          session_deny_rules: ['Bash(rm -rf *)'],
          session_ask_rules: ['Bash(git push *)'],
          session_allow_rules: ['Bash(bun test)'],
        },
      },
      {
        alwaysDenyRules: { session: ['Bash(rm -rf *)'] },
        alwaysAskRules: { session: ['Bash(git push *)'] },
        alwaysAllowRules: { session: ['Bash(bun test)'] },
      },
    )
    expect(allPresent).toBe(true)

    // When deny list is NOT whole (corrupted non-array), allow rules are dropped (deny.whole && ask.whole === false)
    const denyNotWhole = evaluateCcrKeepsSessionRules(
      {
        internal: {
          session_deny_rules: 'corrupted' as unknown as string[],
          session_ask_rules: ['Bash(git push *)'],
          session_allow_rules: ['Bash(bun test)'],
        },
      },
      {
        alwaysDenyRules: { session: [] },
        alwaysAskRules: { session: ['Bash(git push *)'] },
        alwaysAllowRules: { session: [] },
      },
    )
    expect(denyNotWhole).toBe(true)
  })

  test('4. [P1] #1846: verifyBridgeSettingsBinding allows symlinks with unchanged content and child parseSettingsFile closes TOCTOU', () => {
    const dir = makeTmp('bridge-settings-1846-')
    const realFile = join(dir, 'real-settings.json')
    const linkFile = join(dir, 'link-settings.json')
    const initialContent = JSON.stringify({ model: 'sonnet' })
    writeFileSync(realFile, initialContent, 'utf8')
    symlinkSync(realFile, linkFile)

    const binding = computeBridgeSettingsBinding(linkFile, initialContent)

    // Symlink arg + realpath resolvedPath with identical content must PASS
    expect(
      verifyBridgeSettingsBinding(
        linkFile,
        realFile,
        initialContent,
        binding,
        {},
      ),
    ).toEqual({ ok: true })

    // Modified content through symlink must FAIL
    const changed = verifyBridgeSettingsBinding(
      linkFile,
      realFile,
      JSON.stringify({ model: 'opus' }),
      binding,
      {},
    )
    expect(changed.ok).toBe(false)

    // Child process parseSettingsFile verifies CLAUDE_CODE_BRIDGE_SETTINGS_BINDING on flagSettings
    setFlagSettingsPath(linkFile)
    setEnv(BRIDGE_SETTINGS_BINDING_ENV, binding)
    resetSettingsCache()
    const okParsed = settingsMod.parseSettingsFile(linkFile)
    expect(okParsed.settings?.model).toBe('sonnet')

    // Tamper with the target file after binding -> child parseSettingsFile MUST throw BridgeSettingsBindingError
    writeFileSync(realFile, JSON.stringify({ model: 'haiku' }), 'utf8')
    resetSettingsCache()
    expect(() => settingsMod.parseSettingsFile(linkFile)).toThrow(
      settingsMod.BridgeSettingsBindingError,
    )
  })

  test('5. [P1] #1745: finalizeLoginDone awaits validateForceLoginOrg before shouldQuery/pinned dismissal and login.tsx guards background rejections', async () => {
    const { finalizeLoginDone } = await import('../commands/login/login.js')
    // 5a. willAutoQuery=true + invalid org: rolls back and NEVER passes shouldQuery: true
    const events: string[] = []
    let doneOpts: unknown
    await finalizeLoginDone({
      success: true,
      willAutoQuery: true,
      hasForceLoginPin: false,
      doneMessage: 'Login successful',
      onDone: (_msg, opts) => {
        events.push('onDone')
        doneOpts = opts
      },
      validateOrg: async () => {
        await new Promise(r => setTimeout(r, 10))
        events.push('validateOrg')
        return { valid: false, message: 'Org not allowed' }
      },
      rollbackSignIn: async () => {
        events.push('rollback')
      },
      onOrgRefusedBeforeDismiss: () => {
        events.push('refusedBeforeDismiss')
      },
      onOrgRefusedAfterDismiss: () => {
        events.push('refusedAfterDismiss')
      },
      runBackgroundRefresh: () => {
        events.push('refresh')
      },
    })
    expect(events).toEqual([
      'validateOrg',
      'rollback',
      'refusedBeforeDismiss',
      'onDone',
    ])
    expect(
      (doneOpts as { shouldQuery?: boolean } | undefined)?.shouldQuery,
    ).toBeUndefined()

    // 5b. willAutoQuery=true + valid org: validateOrg completes BEFORE onDone({ shouldQuery: true })
    const validEvents: string[] = []
    let validDoneOpts: unknown
    await finalizeLoginDone({
      success: true,
      willAutoQuery: true,
      hasForceLoginPin: true,
      doneMessage: 'Login successful',
      onDone: (_msg, opts) => {
        validEvents.push('onDone')
        validDoneOpts = opts
      },
      validateOrg: async () => {
        await new Promise(r => setTimeout(r, 5))
        validEvents.push('validateOrg')
        return { valid: true }
      },
      rollbackSignIn: async () => {
        validEvents.push('rollback')
      },
      onOrgRefusedBeforeDismiss: () => {},
      onOrgRefusedAfterDismiss: () => {},
      runBackgroundRefresh: () => {
        validEvents.push('refresh')
      },
    })
    expect(validEvents).toEqual(['validateOrg', 'onDone', 'refresh'])
    expect(validDoneOpts).toEqual({ display: 'system', shouldQuery: true })

    // 5c. Unpinned & no auto-query: dismisses immediately before validateOrg resolves
    const fastEvents: string[] = []
    let resolveOrg!: () => void
    const pending = finalizeLoginDone({
      success: true,
      willAutoQuery: false,
      hasForceLoginPin: false,
      doneMessage: 'Login successful',
      onDone: () => {
        fastEvents.push('onDone')
      },
      validateOrg: () =>
        new Promise(res => {
          resolveOrg = () => {
            fastEvents.push('validateOrg')
            res({ valid: true })
          }
        }),
      rollbackSignIn: async () => {},
      onOrgRefusedBeforeDismiss: () => {},
      onOrgRefusedAfterDismiss: () => {},
      runBackgroundRefresh: () => {
        fastEvents.push('refresh')
      },
    })
    expect(fastEvents).toEqual(['onDone'])
    resolveOrg()
    await pending
    expect(fastEvents).toEqual(['onDone', 'validateOrg', 'refresh'])

    // 5d. Source check: no bare unguarded `void enrollTrustedDevice()` or `void checkAndDisableAutoModeIfNeeded(`
    const loginSrc = readFileSync(
      join(SRC_ROOT, 'commands/login/login.tsx'),
      'utf8',
    )
    expect(loginSrc).not.toContain('void enrollTrustedDevice()')
    expect(loginSrc).not.toContain('void checkAndDisableAutoModeIfNeeded(')
    expect(loginSrc).toContain('enrollTrustedDevice()).catch(')
    expect(loginSrc).toContain('checkAndDisableAutoModeIfNeeded(')
  })

  test('6. [P1] #1826: sessionHandler.ts runs removeSessionState cleanup last and includes gitconfigPath', () => {
    const src = readFileSync(
      join(SRC_ROOT, 'self-hosted-runner/sessionHandler.ts'),
      'utf8',
    )
    const worktreesIdx = src.indexOf('await cleanupSessionWorktrees(')
    const credHelperIdx = src.indexOf('await unsetGitProxyRepoLocalCredHelper(')
    const fenceIdx = src.indexOf('fenceBg.markFinalized()')
    const ingressIdx = src.indexOf('await cleanupSessionIngressToken(')
    const removeStateIdx = src.indexOf('if (opts.removeSessionState === true)')

    expect(worktreesIdx).toBeGreaterThan(-1)
    expect(credHelperIdx).toBeGreaterThan(worktreesIdx)
    expect(fenceIdx).toBeGreaterThan(credHelperIdx)
    expect(ingressIdx).toBeGreaterThan(fenceIdx)
    expect(removeStateIdx).toBeGreaterThan(ingressIdx)

    const removeBlock = src.slice(removeStateIdx, removeStateIdx + 500)
    expect(removeBlock).toContain('configDir')
    expect(removeBlock).toContain('stageFileRoot')
    expect(removeBlock).toContain('sessionDir')
    expect(removeBlock).toContain('gitconfigPath')
  })

  test('7. [P1] #1749/#1789: screenPluginDirectorySymlinks allows ..foo inside root and rejects .. / ../outside / absolute rel', async () => {
    const { screenPluginDirectorySymlinks } = await import(
      '../services/plugins/pluginOperations.js'
    )
    const parent = makeTmp('plugin-symlink-1749-')
    const root = join(parent, 'my-plugin')
    mkdirSync(root, { recursive: true })

    // Legal sibling file named "..foo" inside root
    const dotDotFoo = join(root, '..foo')
    writeFileSync(dotDotFoo, 'safe', 'utf8')
    symlinkSync(dotDotFoo, join(root, 'safe-link'))
    await expect(screenPluginDirectorySymlinks(root)).resolves.toBeUndefined()

    // Symlink pointing directly to parent directory ("..") MUST be rejected
    symlinkSync(parent, join(root, 'escape-parent'))
    await expect(screenPluginDirectorySymlinks(root)).rejects.toThrow(
      'points outside plugin root',
    )
    rmSync(join(root, 'escape-parent'))

    // Symlink pointing outside root ("../outside.txt") MUST be rejected
    const outsideFile = join(parent, 'outside.txt')
    writeFileSync(outsideFile, 'secret', 'utf8')
    symlinkSync(outsideFile, join(root, 'escape-file'))
    await expect(screenPluginDirectorySymlinks(root)).rejects.toThrow(
      'points outside plugin root',
    )

    // Source verifies isAbsolute(rel) for Windows cross-drive protection
    const opsSrc = readFileSync(
      join(SRC_ROOT, 'services/plugins/pluginOperations.ts'),
      'utf8',
    )
    expect(opsSrc).toContain(
      "rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)",
    )
  })

  test('8. [0-caller] #1960: cleanup.ts wires pruneExpiredSetAsideData(cleanupPeriodDays) with try/catch degradation', () => {
    const cleanupSrc = readFileSync(join(SRC_ROOT, 'utils/cleanup.ts'), 'utf8')
    const fnStart = cleanupSrc.indexOf(
      'export async function cleanupOldMessageFilesInBackground',
    )
    expect(fnStart).toBeGreaterThan(-1)
    const body = cleanupSrc.slice(fnStart)
    expect(body).toContain('pruneExpiredSetAsideData(cleanupPeriodDays)')
    expect(body).toContain('Failed to prune expired plugin set-aside data')
  })

  test('9. [0-caller] #1960: marketplaceManager.ts reconciles managed extraKnownMarketplaces takeover once and is idempotent', async () => {
    const { addMarketplaceSource } = await import(
      '../utils/plugins/marketplaceManager.js'
    )
    const configDir = makeTmp('mkt-takeover-cfg-')
    setEnv('CLAUDE_CONFIG_DIR', configDir)
    const pluginsDir = join(configDir, 'plugins')
    mkdirSync(pluginsDir, { recursive: true })

    // Create two local marketplaces with the same name "acme" from different directories
    const userMktDir = makeTmp('mkt-user-acme-')
    const managedMktDir = makeTmp('mkt-managed-acme-')
    for (const dir of [userMktDir, managedMktDir]) {
      mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
      writeFileSync(
        join(dir, '.claude-plugin', 'marketplace.json'),
        JSON.stringify({
          name: 'acme',
          owner: { name: 'Acme' },
          plugins: [
            {
              name: 'helper',
              source: './plugins/helper',
            },
          ],
        }),
        'utf8',
      )
    }

    // Seed pre-existing user marketplace in known_marketplaces.json + installed plugin + data dir
    writeFileSync(
      join(pluginsDir, 'known_marketplaces.json'),
      JSON.stringify({
        acme: {
          source: { source: 'directory', path: userMktDir },
          installLocation: userMktDir,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      }),
      'utf8',
    )
    writeFileSync(
      join(pluginsDir, 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'helper@acme': [
            {
              scope: 'user',
              installPath: join(pluginsDir, 'cache', 'acme', 'helper', '1.0.0'),
              version: '1.0.0',
              installedAt: '2026-01-01T00:00:00.000Z',
              lastUpdated: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      }),
      'utf8',
    )
    const dataDir = join(pluginsDir, 'data', 'helper-acme')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'user-state.json'), '{"hello":"world"}', 'utf8')

    // Managed policy declares "acme" from managedMktDir
    const managedSource = { source: 'directory' as const, path: managedMktDir }
    const settingsSpy = spyOn(
      settingsMod,
      'getSettingsForSource',
    ).mockImplementation(source => {
      if (source === 'policySettings') {
        return {
          extraKnownMarketplaces: {
            acme: { source: managedSource },
          },
        }
      }
      return null
    })

    try {
      const first = await addMarketplaceSource(managedSource)
      expect(first.name).toBe('acme')
      expect(first.alreadyMaterialized).toBe(false)

      // Old plugin data dir should have been set aside
      expect(existsSync(dataDir)).toBe(false)
      const setAside = await listSetAsidePluginData({ pluginsDir })
      expect(setAside.holders).toHaveLength(1)
      expect(readdirSync(setAside.holders[0]!)).toContain('helper-acme')

      // Second call with the same managed source is idempotent — no second set-aside holder
      const second = await addMarketplaceSource(managedSource)
      expect(second.alreadyMaterialized).toBe(true)
      const setAsideAfter = await listSetAsidePluginData({ pluginsDir })
      expect(setAsideAfter.holders).toHaveLength(1)
      expect(readdirSync(join(pluginsDir, 'data', '.set-aside'))).toHaveLength(
        1,
      )
    } finally {
      settingsSpy.mockRestore()
    }
  })
})
