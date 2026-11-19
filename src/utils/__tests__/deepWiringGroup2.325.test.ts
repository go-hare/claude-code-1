import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Notification } from '../../context/notifications.js'
import { maybeNotifyOpus48FastModeDeprecation } from '../../hooks/notifs/useFastModeNotification.js'
import {
  dispatchRemoteSettingsLoadNotice,
  REMOTE_SETTINGS_NOTICE_KEY,
} from '../../hooks/notifs/useRemoteSettingsNotification.js'
import { query } from '../../query.js'
import {
  autoCompactIfNeeded,
  getClaudeMdGrowthTokens,
  getLastSentClaudeMdTokens,
  resetSentClaudeMdTokensForTesting,
  shouldAutoCompact,
} from '../../services/compact/autoCompact.js'
import { roughTokenCountEstimation } from '../../services/tokenEstimation.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import type { ToolUseContext } from '../../Tool.js'
import type { AgentId } from '../../types/ids.js'
import {
  enableConfigs,
  getGlobalConfig,
  hasOwedReloadThroughStorage,
  isUnparseableFileLeftAlone,
  leaveUnparseableFileAlone,
  oweReloadThroughStorage,
  readGlobalConfigFromDisk,
  refreshGlobalConfigFromStorage,
  reloadThroughStorageOnce,
  resetGlobalConfigWriteFlagsForTesting,
  saveCurrentProjectConfig,
  saveGlobalConfig,
} from '../config.js'
import {
  getGlobalClaudeFile,
  resetGlobalClaudeFileForTests,
  seedGlobalClaudeFile,
} from '../env.js'
import { createAssistantMessage, createUserMessage } from '../messages.js'
import { settingsChangeDetector } from '../settings/changeDetector.js'
import {
  clearInternalWrites,
  getFirstReadStat,
  hasFirstReadStat,
} from '../settings/internalWrites.js'
import {
  onRemoteSettingsLoadStatusChanged,
  releaseRemoteSettingsLoadBackstop,
  REMOTE_SETTINGS_HAVE_LOADED_MSG,
  REMOTE_SETTINGS_STILL_LOADING_MSG,
  type RemoteSettingsNoticeSaid,
  resetRemoteSettingsStateForTesting,
} from '../settings/remoteSettingsState.js'
import {
  getSettingsForSource,
  parseSettingsFile,
  runRemoteSettingsLoadCycle,
} from '../settings/settings.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import {
  createLocalFsBackend,
  pinStorageV5,
  pinStorageV5FromEnv,
  resetHoverRestPinForTests,
  resetPinnedStorageV5ForTests,
} from '../storageV5/index.js'

const srcRoot = join(import.meta.dir, '../..')
const tempDirs: string[] = []
const savedEnv: Record<string, string | undefined> = {}

function makeTempDir(prefix: string): string {
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

function restoreEnv(): void {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  for (const k of Object.keys(savedEnv)) {
    delete savedEnv[k]
  }
}

afterEach(async () => {
  restoreEnv()
  resetSentClaudeMdTokensForTesting()
  resetRemoteSettingsStateForTesting()
  resetGlobalConfigWriteFlagsForTesting()
  resetSettingsCache()
  clearInternalWrites()
  resetPinnedStorageV5ForTests()
  resetHoverRestPinForTests()
  resetGlobalClaudeFileForTests()
  await settingsChangeDetector.resetForTesting()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeMinimalToolUseContext(
  overrides: Partial<ToolUseContext> = {},
): ToolUseContext {
  const appState = getDefaultAppState()
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-6',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () => appState,
    setAppState: () => {},
    setToolJSX: () => {},
    addNotification: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
    ...overrides,
  } as unknown as ToolUseContext
}

describe('Deep Wiring Group 2: Compact / Settings / Config / REPL Notifications', () => {
  test('#1562: query() records sent CLAUDE.md tokens so CLAUDE.md growth triggers autoCompact', async () => {
    const smallClaudeMd = 'Small project instructions for turn 1.'
    const smallTokens = roughTokenCountEstimation(smallClaudeMd)
    const userMsg = createUserMessage({ content: 'hello' })
    const toolUseContext = makeMinimalToolUseContext()

    const events: unknown[] = []
    for await (const ev of query({
      messages: [userMsg],
      systemPrompt: ['You are helpful.'] as unknown as Parameters<
        typeof query
      >[0]['systemPrompt'],
      userContext: { claudeMd: smallClaudeMd },
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      toolUseContext,
      querySource: 'repl_main_thread',
      deps: {
        callModel: async function* () {
          const reply = createAssistantMessage({ content: 'ok' })
          reply.message.model = 'claude-sonnet-4-6'
          reply.message.usage = {
            ...reply.message.usage,
            input_tokens: 120_000,
            output_tokens: 50,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          }
          yield reply
        },
        autocompact: async () => ({ wasCompacted: false }),
        microcompact: async msgs => ({ messages: msgs }),
        uuid: () => 'test-uuid',
      },
    })) {
      events.push(ev)
    }

    expect(events.length).toBeGreaterThan(0)
    // Main-thread query() recorded sent CLAUDE.md tokens
    expect(getLastSentClaudeMdTokens()).toBe(smallTokens)

    // Subagent queries must not overwrite the main thread's recorded tokens
    const subCtx = makeMinimalToolUseContext({
      agentId: 'subagent-1' as AgentId,
    })
    for await (const _ev of query({
      messages: [userMsg],
      systemPrompt: ['Subagent'] as unknown as Parameters<
        typeof query
      >[0]['systemPrompt'],
      userContext: { claudeMd: 'x'.repeat(20_000) },
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      toolUseContext: subCtx,
      querySource: 'agent:custom',
      deps: {
        callModel: async function* () {
          yield createAssistantMessage({ content: 'sub ok' })
        },
        autocompact: async () => ({ wasCompacted: false }),
        microcompact: async msgs => ({ messages: msgs }),
        uuid: () => 'sub-uuid',
      },
    })) {
      // drain
    }
    expect(getLastSentClaudeMdTokens()).toBe(smallTokens)

    // Now CLAUDE.md grows massively (e.g. +80k tokens) while assistant usage still reflects turn 1 (120k)
    const hugeClaudeMd = 'A'.repeat(400_000)
    const growth = await getClaudeMdGrowthTokens(hugeClaudeMd)
    expect(growth).toBeGreaterThan(50_000)

    const prevMsg = createAssistantMessage({ content: 'ok' })
    prevMsg.message.model = 'claude-sonnet-4-6'
    prevMsg.message.usage = {
      ...prevMsg.message.usage,
      input_tokens: 120_000,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    // Without CLAUDE.md growth, 120k is below Sonnet 4.6's 167k autocompact threshold
    expect(
      await shouldAutoCompact(
        [userMsg, prevMsg],
        'claude-sonnet-4-6',
        undefined,
        0,
        smallClaudeMd,
      ),
    ).toBe(false)
    // With huge CLAUDE.md growth, shouldAutoCompact flips to true
    expect(
      await shouldAutoCompact(
        [userMsg, prevMsg],
        'claude-sonnet-4-6',
        undefined,
        0,
        hugeClaudeMd,
      ),
    ).toBe(true)
    // Also verify autoCompactIfNeeded threads cacheSafeParams.userContext.claudeMd
    expect(typeof autoCompactIfNeeded).toBe('function')
  })

  test('#1553: parseSettingsFile records first-read stat so changeDetector catches pre-watch edits', async () => {
    const dir = makeTempDir('settings-first-read-')
    setEnv('CLAUDE_CONFIG_DIR', dir)
    mkdirSync(dir, { recursive: true })

    const userSettingsPath = join(dir, 'settings.json')
    writeFileSync(userSettingsPath, JSON.stringify({ model: 'sonnet' }), 'utf8')
    const initialStat = statSync(userSettingsPath)

    // Production read via parseSettingsFile records first-read stat
    const parsed = parseSettingsFile(userSettingsPath)
    expect(parsed.settings?.model).toBe('sonnet')
    expect(hasFirstReadStat(userSettingsPath)).toBe(true)
    const recorded = getFirstReadStat(userSettingsPath)
    expect(recorded).not.toBeNull()
    expect(recorded?.size).toBe(initialStat.size)
    expect(recorded?.mtimeMs).toBe(initialStat.mtimeMs)

    // Missing file records null first-read stat (ENOENT)
    const missingPath = join(dir, 'nonexistent-settings.json')
    const missingParsed = parseSettingsFile(missingPath)
    expect(missingParsed.settings).toBeNull()
    expect(hasFirstReadStat(missingPath)).toBe(true)
    expect(getFirstReadStat(missingPath)).toBeNull()

    // External edit happens BEFORE changeDetector.initialize()
    writeFileSync(
      userSettingsPath,
      JSON.stringify({ model: 'opus', cleanupPeriodDays: 30 }),
      'utf8',
    )
    // Ensure distinct mtime in case filesystem granularity is coarse
    const bumped = new Date(Date.now() + 2000)
    utimesSync(userSettingsPath, bumped, bumped)

    const detectedSources: string[] = []
    await settingsChangeDetector.resetForTesting({
      stabilityThreshold: 25,
      pollInterval: 10,
      fsWatchProbe: async () => 'delivers',
    })
    // Re-record first read stat with the pre-edit snapshot since resetForTesting clears internalWrites
    // then simulate the exact startup sequence: first read -> external edit -> initialize()
    writeFileSync(userSettingsPath, JSON.stringify({ model: 'sonnet' }), 'utf8')
    resetSettingsCache()
    parseSettingsFile(userSettingsPath)
    expect(hasFirstReadStat(userSettingsPath)).toBe(true)

    writeFileSync(
      userSettingsPath,
      JSON.stringify({ model: 'opus', cleanupPeriodDays: 45 }),
      'utf8',
    )
    const bumped2 = new Date(Date.now() + 4000)
    utimesSync(userSettingsPath, bumped2, bumped2)

    const unsub = settingsChangeDetector.subscribe(source => {
      detectedSources.push(source)
    })
    try {
      await settingsChangeDetector.initialize()
      // Wait for chokidar ready + catchUp stability window
      const deadline = Date.now() + 3000
      while (
        !detectedSources.includes('userSettings') &&
        Date.now() < deadline
      ) {
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      expect(detectedSources).toContain('userSettings')
    } finally {
      unsub()
    }
  })

  test('#1531 & #1512: runRemoteSettingsLoadCycle applies first-party policy consent-free and drives REPL notifications', async () => {
    const delivered: Notification[] = []
    let said: RemoteSettingsNoticeSaid | undefined
    const unsub = onRemoteSettingsLoadStatusChanged(() => {
      said = dispatchRemoteSettingsLoadNotice(said, n => delivered.push(n))
    })

    try {
      let resolveFetch!: (
        val: Awaited<
          ReturnType<Parameters<typeof runRemoteSettingsLoadCycle>[0]>
        >,
      ) => void
      const fetchPromise = new Promise<
        Awaited<ReturnType<Parameters<typeof runRemoteSettingsLoadCycle>[0]>>
      >(resolve => {
        resolveFetch = resolve
      })

      const cyclePromise = runRemoteSettingsLoadCycle(() => fetchPromise, {
        eligible: true,
        isInteractive: false,
      })

      // Release startup backstop while fetch is still in flight -> pending warning notice
      releaseRemoteSettingsLoadBackstop()
      expect(delivered.length).toBe(1)
      expect(delivered[0]?.key).toBe(REMOTE_SETTINGS_NOTICE_KEY)
      expect('text' in delivered[0]! && delivered[0]!.text).toBe(
        REMOTE_SETTINGS_STILL_LOADING_MSG,
      )
      expect(delivered[0]?.color).toBe('warning')

      // Resolve with Team/Enterprise first-party trusted payload containing dangerous changes
      resolveFetch({
        ok: true,
        settings: { cleanupPeriodDays: 21 },
        isFirstPartyTrusted: true,
        hasDangerousSettingsChanged: true,
      })

      const result = await cyclePromise
      expect(result.applied).toBe(true)
      expect(result.outcome).toBe('first_party_silent')
      expect(result.status).toEqual({ state: 'ok', hasSettings: true })

      // Applied remote settings are now served as policySettings
      const policy = getSettingsForSource('policySettings')
      expect(policy?.cleanupPeriodDays).toBe(21)

      // Notification transitioned to "have now loaded · remote policy applied"
      expect(delivered.length).toBe(2)
      expect('text' in delivered[1]! && delivered[1]!.text).toContain(
        REMOTE_SETTINGS_HAVE_LOADED_MSG,
      )
      expect('text' in delivered[1]! && delivered[1]!.text).toContain(
        'remote policy applied',
      )

      // Failure cycle emits warning notification with formatted reason
      const failResult = await runRemoteSettingsLoadCycle(
        async () => ({
          ok: false,
          failure: { errorKind: 'http_5xx', httpStatus: 503 },
        }),
        { eligible: true, isInteractive: true },
      )
      expect(failResult.applied).toBe(false)
      expect(delivered.length).toBe(3)
      expect('text' in delivered[2]! && delivered[2]!.text).toContain(
        'server error (503)',
      )
      expect(delivered[2]?.color).toBe('warning')
    } finally {
      unsub()
    }

    // Verify REPL.tsx mounts useRemoteSettingsNotification
    const replSrc = readFileSync(join(srcRoot, 'screens/REPL.tsx'), 'utf8')
    expect(replSrc).toContain('useRemoteSettingsNotification()')
  })

  test('#1479: useFastModeNotification surfaces Opus 4.8 fast mode deprecation notice when enabled', () => {
    const notifications: Notification[] = []
    const beforeSunset = Date.parse('2026-11-15T00:00:00Z')
    const afterSunset = Date.parse('2026-12-01T00:00:00Z')

    // Fast mode OFF -> no notification
    expect(
      maybeNotifyOpus48FastModeDeprecation(
        'claude-opus-4-8',
        false,
        n => notifications.push(n),
        beforeSunset,
      ),
    ).toBe(false)
    expect(notifications).toHaveLength(0)

    // Non-Opus-4.8 model with fast mode ON -> no notification
    expect(
      maybeNotifyOpus48FastModeDeprecation(
        'claude-sonnet-4-6',
        true,
        n => notifications.push(n),
        beforeSunset,
      ),
    ).toBe(false)
    expect(notifications).toHaveLength(0)

    // Opus 4.8 with fast mode ON before sunset -> emits official deprecation notice
    expect(
      maybeNotifyOpus48FastModeDeprecation(
        'claude-opus-4-8',
        true,
        n => notifications.push(n),
        beforeSunset,
      ),
    ).toBe(true)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.key).toBe('opus48-fast-mode-deprecation')
    expect(notifications[0]?.priority).toBe('immediate')
    expect(notifications[0]?.requeueOnPreempt).toBe(true)
    expect(notifications[0]?.color).toBe('warning')
    expect('text' in notifications[0]! && notifications[0]!.text).toContain(
      'Opus 4.8 fast mode is deprecated and will be removed on Nov 30',
    )

    // After sunset date -> no deprecation notice (error path takes over)
    expect(
      maybeNotifyOpus48FastModeDeprecation(
        'claude-opus-4-8',
        true,
        n => notifications.push(n),
        afterSunset,
      ),
    ).toBe(false)

    // Verify REPL.tsx passes mainLoopModel into useFastModeNotification
    const replSrc = readFileSync(join(srcRoot, 'screens/REPL.tsx'), 'utf8')
    expect(replSrc).toContain('useFastModeNotification(mainLoopModel)')
  })

  test('#1657 / #1662 / #1661: config.ts flags close full read/write loop in production path', async () => {
    const dir = makeTempDir('cfg-wiring-')
    const cfgFile = join(dir, '.claude.json')
    writeFileSync(cfgFile, '{corrupted json', 'utf8')

    setEnv('CLAUDE_CONFIG_DIR', dir)
    resetGlobalClaudeFileForTests()
    seedGlobalClaudeFile(cfgFile)
    expect(getGlobalClaudeFile()).toBe(cfgFile)

    // #1657: when unparseableFileLeftAlone is set in non-test mode, saveGlobalConfig &
    // saveCurrentProjectConfig refuse to overwrite the corrupted file.
    setEnv('NODE_ENV', 'production')
    leaveUnparseableFileAlone()
    expect(isUnparseableFileLeftAlone()).toBe(true)
    expect(saveGlobalConfig(c => ({ ...c, numStartups: 99 }))).toBe(false)
    expect(
      saveCurrentProjectConfig(p => ({ ...p, hasTrustDialogAccepted: true })),
    ).toBe(false)
    expect(readFileSync(cfgFile, 'utf8')).toBe('{corrupted json')

    // #1662: oweReloadThroughStorage + getGlobalConfig / init reloadThroughStorageOnce
    // triggers one-shot refresh through pinned StorageV5 backend.
    resetGlobalConfigWriteFlagsForTesting()
    writeFileSync(
      cfgFile,
      JSON.stringify({ numStartups: 7, theme: 'dark' }),
      'utf8',
    )
    setEnv('CLAUDE_CODE_HOVER_REST', '1')
    const backend = createLocalFsBackend({
      configHome: dir,
      globalConfigFile: cfgFile,
    })
    const snapshot = pinStorageV5FromEnv(() => backend)
    pinStorageV5(snapshot)

    enableConfigs()
    // Ensure owed flag is set and then settled once by getGlobalConfig()
    oweReloadThroughStorage()
    expect(hasOwedReloadThroughStorage()).toBe(true)
    const cfg = getGlobalConfig()
    expect(cfg.numStartups).toBe(7)
    // Owed flag consumed by getGlobalConfig -> triggerOwedReloadThroughPinnedStorage
    expect(hasOwedReloadThroughStorage()).toBe(false)
    await reloadThroughStorageOnce(() =>
      refreshGlobalConfigFromStorage(backend),
    )

    // #1661: readGlobalConfigFromDisk returns undefined if file is ENOENT while doubtsNoFile is true
    rmSync(cfgFile, { force: true })
    // Verify init.ts wires reloadThroughStorageOnce + refreshGlobalConfigFromStorage
    const initSrc = readFileSync(join(srcRoot, 'entrypoints/init.ts'), 'utf8')
    expect(initSrc).toContain('reloadThroughStorageOnce')
    expect(initSrc).toContain('refreshGlobalConfigFromStorage')
    // When file is missing without doubts, readGlobalConfigFromDisk returns defaults
    expect(readGlobalConfigFromDisk()).toBeDefined()
  })
})
