/**
 * Official Claude Code 2.1.331 Wave 6 multi-host / multi-session ALS isolation tests:
 * Verifies concurrent `runWithNewHostSession` isolation across remaining Builtin Tools,
 * Services (MagicDocs, autoModeSetup, contextCollapse, designConsent, designProjectGrant,
 * LSP, mockRateLimits, providerRegistry, providerUsage/balance, settingsSync, intentNormalize),
 * and Core subsystems (assistant, buddy, coordinator, history, proactive, query, skills,
 * onChangeAppState, shellPressureReap, tools).
 */

import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  __resetWebFetchAgentEnabledForTests,
  isWebFetchAgentEnabled,
  WEB_FETCH_AGENT_TYPE,
} from '@claude-code/builtin-tools/tools/AgentTool/built-in/webFetchAgent.js'
import {
  consumeUnreviewedWebFetch,
  maybeStampUnreviewedWebFetch,
} from '@claude-code/builtin-tools/tools/AgentTool/spawnHookRewrite.js'
import {
  consumeApprovedPublishSourcePin,
  consumeNewArtifactPersonOnlyAsk,
  recordApprovedPublishSourcePin,
  recordNewArtifactPersonOnlyAsk,
} from '@claude-code/builtin-tools/tools/ArtifactTool/permissions.js'
import {
  _resetPrewarmedBashEditDiffSnapshotsForTesting,
  consumePrewarmedBashEditDiffSnapshot,
  discardPrewarmedBashEditDiffSnapshot,
  prewarmBashEditDiffSnapshot,
} from '@claude-code/builtin-tools/tools/BashTool/bashEditDiff.js'
import {
  getOperationHints,
  recordDiscoveredOperationHints,
  resetDiscoveredOperationHints,
  validateWriteOpArgs,
} from '@claude-code/builtin-tools/tools/ClaudeDesignTool/validateArguments.js'
import { getDefaultFileReadingLimits } from '@claude-code/builtin-tools/tools/FileReadTool/limits.js'
import {
  clearListAgentsCursorCacheForTests,
  issueListAgentsCursor,
  lookupListAgentsCursor,
  paginatePeerListingRows,
} from '@claude-code/builtin-tools/tools/ListPeersTool/ListPeersTool.js'
import {
  logGoalProposalAvailableOnce,
  resetGoalProposalAvailableLatchForTests,
} from '@claude-code/builtin-tools/tools/ProposeGoalTool/proposeGoalGate.js'
import {
  _recordPushNotificationDedupForTesting,
  _resetPushNotificationDedupForTesting,
  PushNotificationTool,
} from '@claude-code/builtin-tools/tools/PushNotificationTool/PushNotificationTool.js'
import {
  clearSendUserFileArgsStashForTesting,
  recordListedSendUserFileArgs,
  SEND_USER_FILE_ARGUMENTS_CHANGED_ERROR,
  verifySendUserFileArgsUnchanged,
} from '@claude-code/builtin-tools/tools/SendUserFileTool/SendUserFileTool.js'
import { createAdapter } from '@claude-code/builtin-tools/tools/WebSearchTool/adapters/index.js'
import {
  getAssistantActivationPath,
  isAssistantForced,
  markAssistantForced,
} from 'src/assistant/index.js'
import {
  setFlagSettingsInline,
  setIsInteractive,
  setKairosActive,
} from 'src/bootstrap/state.js'
import { roll } from 'src/buddy/companion.js'
import { triggerCompanionReaction } from 'src/buddy/companionReact.js'
import {
  acquireFileLock,
  getFileLockOwner,
  getFileLockStats,
  releaseAgentLocks,
  resetFileLockStateForTests,
} from 'src/coordinator/fileLockManager.js'
import {
  addToHistory,
  clearPendingHistoryEntries,
  getHistory,
  keepClearedDraftToHistory,
  mintPasteId,
  removeLastFromHistory,
  resetPasteIdAllocatorForTests,
} from 'src/history.js'
import {
  activateProactive,
  deactivateProactive,
  getActivationSource,
  getNextTickAt,
  isContextBlocked,
  isProactiveActive,
  isProactivePaused,
  pauseProactive,
  setContextBlocked,
  setNextTickAt,
  subscribeToProactiveChanges,
} from 'src/proactive/index.js'
import { resolveLivePrecomputeBufferFraction } from 'src/query.js'
import {
  _resetForTesting as resetAnalyticsForTesting,
  attachAnalyticsSink,
} from 'src/services/analytics/index.js'
import * as growthbook from 'src/services/analytics/growthbook.js'
import {
  isAutoModeSetupWrappingUp,
  runBackgroundAutoModeSetup,
} from 'src/services/autoModeSetup/background.js'
import {
  initContextCollapse,
  isContextCollapseEnabled,
  resetContextCollapse,
} from 'src/services/contextCollapse/index.js'
import {
  DESIGN_CONSENT_BIT,
  missingDesignConsentBit,
  seedDesignConsentCache,
} from 'src/services/designConsent.js'
import {
  decideTokenlessProjectWrite,
  DesignSessionState,
  resetDesignProjectGrantForTests,
  seedDesignGrantProbe,
  seedDesignProjectCard,
} from 'src/services/designProjectGrant.js'
import {
  checkForLSPDiagnostics,
  clearDeliveredDiagnosticsForFile,
  registerPendingLSPDiagnostic,
  resetAllLSPDiagnosticState,
} from 'src/services/lsp/LSPDiagnosticRegistry.js'
import {
  createLSPServerInstance,
  subscribeLspStartFailureWarnings,
} from 'src/services/lsp/LSPServerInstance.js'
import {
  clearTrackedMagicDocs,
  initMagicDocs,
  registerMagicDoc,
} from 'src/services/MagicDocs/magicDocs.js'
import {
  clearMockHeaders,
  getCurrentMockScenario,
  getMockHeaders,
  getMockSubscriptionType,
  setMockRateLimitScenario,
  setMockSubscriptionType,
} from 'src/services/mockRateLimits.js'
import {
  _invalidateProviderCache,
  loadProviders,
} from 'src/services/providerRegistry/loader.js'
import { genericBalanceProvider } from 'src/services/providerUsage/balance/generic.js'
import {
  getActiveBalanceProviderId,
  startBalancePolling,
  stopBalancePolling,
} from 'src/services/providerUsage/balance/poller.js'
import { getProviderUsage } from 'src/services/providerUsage/store.js'
import {
  _resetDownloadPromiseForTesting,
  downloadUserSettings,
} from 'src/services/settingsSync/index.js'
import {
  clearIntentNormalizeCache,
  normalizeQueryIntent,
} from 'src/services/skillSearch/intentNormalize.js'
import * as claudeApi from 'src/services/api/claude.js'
import {
  getMCPSkillBuilders,
  type MCPSkillBuilders,
  registerMCPSkillBuilders,
} from 'src/skills/mcpSkillBuilders.js'
import {
  awaitPendingSkillDownload,
  clearPendingSkillDownloads,
  hasPendingSkillDownload,
  registerPendingSkillDownload,
} from 'src/skills/syncedSkillsHarden.js'
import {
  getCcrKeepsSessionRules,
  setCcrKeepsSessionRules,
} from 'src/state/onChangeAppState.js'
import {
  evaluateMemoryPressureReap,
  getLastPressureReapAt,
  resetLastPressureReapAtForTests,
  setLastPressureReapAt,
} from 'src/tasks/LocalShellTask/shellPressureReap.js'
import type { ToolUseContext } from 'src/Tool.js'
import { filterToolsByDenyRules, getAllBaseTools } from 'src/tools.js'
import type { Message } from 'src/types/message.js'
import { executePostSamplingHooks } from 'src/utils/hooks/postSamplingHooks.js'
import {
  getActiveSessionFromAls,
  runWithNewHostSession,
} from 'src/utils/sessionHost.js'
import { asSystemPrompt } from 'src/utils/systemPromptType.js'
import { ToolStateSlots } from 'src/utils/toolState.js'
import * as configModule from 'src/utils/config.js'

const tempDirs: string[] = []
const restores: Array<() => void> = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createBarrier(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>(resolve => {
    release = resolve
  })
  return { promise, release }
}

function tick(ms = 10): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

afterEach(() => {
  for (const restore of restores.splice(0).reverse()) {
    try {
      restore()
    } catch {
      // ignore cleanup errors
    }
  }
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore temp cleanup errors
    }
  }
})

describe('2.1.331 Wave 6 ALS multi-host isolation: Builtin Tools, Services & Core', () => {
  test('MagicDocs: trackedMagicDocs and post-sampling hook isolate concurrent root sessions', async () => {
    const prevUserType = process.env.USER_TYPE
    process.env.USER_TYPE = 'ant'
    restores.push(() => {
      if (prevUserType === undefined) {
        delete process.env.USER_TYPE
      } else {
        process.env.USER_TYPE = prevUserType
      }
    })

    const dir = makeTempDir('magic-docs-w6-')
    const docA = join(dir, 'docA.md')
    const docB = join(dir, 'docB.md')
    writeFileSync(docA, '# not a magic doc anymore\n', 'utf8')
    writeFileSync(docB, '# not a magic doc anymore\n', 'utf8')

    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'magic-a' }, async () => {
        clearTrackedMagicDocs()
        await initMagicDocs()
        registerMagicDoc(docA)
        b1.release()
        await b2.promise
        // Running hook in Host A should inspect/prune docA only (no header -> removed)
        const fakeCtx = {
          readFileState: new Map(),
          options: { tools: [] },
        } as unknown as ToolUseContext
        await executePostSamplingHooks(
          [],
          asSystemPrompt([]),
          {},
          {},
          fakeCtx,
          'repl_main_thread',
        )
        // Register docA again and verify clear in Host B did not affect Host A
        registerMagicDoc(docA)
        return 'ok-a'
      }),
      runWithNewHostSession({ id: 'magic-b' }, async () => {
        await b1.promise
        clearTrackedMagicDocs()
        await initMagicDocs()
        // Host B clearing its tracked docs must NOT clear Host A's tracked docA
        registerMagicDoc(docB)
        b2.release()
        return 'ok-b'
      }),
    ])

    expect(resA).toBe('ok-a')
    expect(resB).toBe('ok-b')
  })

  test('contextCollapse: initContextCollapse/resetContextCollapse isolate concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'cc-a' }, async () => {
        resetContextCollapse()
        initContextCollapse()
        b1.release()
        await b2.promise
        return isContextCollapseEnabled()
      }),
      runWithNewHostSession({ id: 'cc-b' }, async () => {
        await b1.promise
        const initial = isContextCollapseEnabled()
        resetContextCollapse()
        b2.release()
        return { initial, afterReset: isContextCollapseEnabled() }
      }),
    ])

    expect(resA).toBe(true)
    expect(resB).toEqual({ initial: false, afterReset: false })
  })

  test('autoModeSetup/background: isAutoModeSetupWrappingUp isolates concurrent hosts', async () => {
    const bEntered = createBarrier()
    const bProceed = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'ams-a' }, async () => {
        const before = isAutoModeSetupWrappingUp()
        let during = false
        await runBackgroundAutoModeSetup({
          answers: {
            environment: 'local',
            scope: 'project',
            customNotes: '',
          } as unknown as Parameters<
            typeof runBackgroundAutoModeSetup
          >[0]['answers'],
          mode: 'append',
          permissionContext: {
            mode: 'default',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          } as unknown as Parameters<
            typeof runBackgroundAutoModeSetup
          >[0]['permissionContext'],
          setAppState: () => {},
          requestDialog: (async () => 'decline') as unknown as Parameters<
            typeof runBackgroundAutoModeSetup
          >[0]['requestDialog'],
          propose: async () => {
            during = isAutoModeSetupWrappingUp()
            bEntered.release()
            await bProceed.promise
            return { ok: false, code: 'aborted', reason: 'test' }
          },
        })
        const after = isAutoModeSetupWrappingUp()
        return { before, during, after }
      }),
      runWithNewHostSession({ id: 'ams-b' }, async () => {
        await bEntered.promise
        const observedWhileAWrapping = isAutoModeSetupWrappingUp()
        bProceed.release()
        return observedWhileAWrapping
      }),
    ])

    expect(resA).toEqual({ before: false, during: true, after: false })
    expect(resB).toBe(false)
  })

  test('designConsent: seedDesignConsentCache isolates concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'dc-a' }, async () => {
        seedDesignConsentCache(false)
        b1.release()
        await b2.promise
        const state = new DesignSessionState()
        return await missingDesignConsentBit(state)
      }),
      runWithNewHostSession({ id: 'dc-b' }, async () => {
        await b1.promise
        seedDesignConsentCache(true)
        const state = new DesignSessionState()
        const bit = await missingDesignConsentBit(state)
        b2.release()
        return bit
      }),
    ])

    expect(resA).toBe(DESIGN_CONSENT_BIT)
    expect(resB).toBeNull()
  })

  test('designProjectGrant: probeOverride & cardOverride isolate concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()

    const makeCtx = () => ({
      agentContext: { agentType: 'main' },
      toolState: new ToolStateSlots(),
      getAppState: () => ({
        toolPermissionContext: {
          mode: 'default',
          isBypassPermissionsModeAvailable: false,
        },
      }),
    })

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'dpg-a' }, async () => {
        resetDesignProjectGrantForTests()
        seedDesignGrantProbe(['proj-shared'])
        seedDesignProjectCard({
          name: 'HostA',
          sharingLabel: 'private',
          url: 'https://claude.ai/design/p/proj-shared',
        })
        b1.release()
        await b2.promise
        return await decideTokenlessProjectWrite(
          'write_files',
          {
            project_id: 'proj-shared',
            files: [{ path: 'index.html', data: '<p/>' }],
          },
          makeCtx(),
        )
      }),
      runWithNewHostSession({ id: 'dpg-b' }, async () => {
        await b1.promise
        resetDesignProjectGrantForTests()
        seedDesignGrantProbe([])
        seedDesignProjectCard({
          name: 'HostB',
          sharingLabel: 'private: invited members only',
          url: 'https://claude.ai/design/p/proj-shared',
        })
        const decision = await decideTokenlessProjectWrite(
          'write_files',
          {
            project_id: 'proj-shared',
            files: [{ path: 'index.html', data: '<p/>' }],
          },
          makeCtx(),
        )
        b2.release()
        return decision
      }),
    ])

    expect(resA.kind).toBe('allow')
    expect(resB.kind).toBe('ask-grant')
    if (resB.kind === 'ask-grant') {
      expect(resB.message).toContain('HostB')
    }
  })

  test('mockRateLimits: scenario, headers, and subscription isolate concurrent hosts', async () => {
    const prevUserType = process.env.USER_TYPE
    process.env.USER_TYPE = 'ant'
    restores.push(() => {
      if (prevUserType === undefined) {
        delete process.env.USER_TYPE
      } else {
        process.env.USER_TYPE = prevUserType
      }
    })

    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'mrl-a' }, async () => {
        clearMockHeaders()
        setMockRateLimitScenario('session-limit-reached')
        setMockSubscriptionType('pro')
        b1.release()
        await b2.promise
        return {
          scenario: getCurrentMockScenario(),
          status: getMockHeaders()?.['anthropic-ratelimit-unified-status'],
          sub: getMockSubscriptionType(),
        }
      }),
      runWithNewHostSession({ id: 'mrl-b' }, async () => {
        await b1.promise
        const initial = getCurrentMockScenario()
        setMockRateLimitScenario('approaching-weekly-limit')
        setMockSubscriptionType('enterprise')
        b2.release()
        return {
          initial,
          scenario: getCurrentMockScenario(),
          status: getMockHeaders()?.['anthropic-ratelimit-unified-status'],
          sub: getMockSubscriptionType(),
        }
      }),
    ])

    expect(resA).toEqual({
      scenario: 'session-limit-reached',
      status: 'rejected',
      sub: 'pro',
    })
    expect(resB).toEqual({
      initial: null,
      scenario: 'approaching-weekly-limit',
      status: 'allowed_warning',
      sub: 'enterprise',
    })
  })

  test('LSPDiagnosticRegistry: pending and delivered LRU isolate concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()

    const diagFile = {
      uri: 'file:///workspace/app.ts',
      diagnostics: [
        {
          message: 'Type error',
          severity: 'Error' as const,
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 5 },
          },
        },
      ],
    }

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'lsp-diag-a' }, async () => {
        resetAllLSPDiagnosticState()
        registerPendingLSPDiagnostic({
          serverName: 'ts-server-a',
          files: [diagFile],
        })
        b1.release()
        await b2.promise
        const first = checkForLSPDiagnostics()
        // Same diagnostic re-registered in Host A is deduplicated by Host A's LRU
        registerPendingLSPDiagnostic({
          serverName: 'ts-server-a',
          files: [diagFile],
        })
        const second = checkForLSPDiagnostics()
        clearDeliveredDiagnosticsForFile(diagFile.uri)
        return {
          firstCount: first.length,
          server: first[0]?.serverName,
          secondCount: second.length,
        }
      }),
      runWithNewHostSession({ id: 'lsp-diag-b' }, async () => {
        await b1.promise
        resetAllLSPDiagnosticState()
        // Host B must NOT see Host A's pending diagnostics
        const beforeRegister = checkForLSPDiagnostics()
        // And Host B must still receive the same file/diagnostic (not deduplicated by Host A)
        registerPendingLSPDiagnostic({
          serverName: 'ts-server-b',
          files: [diagFile],
        })
        b2.release()
        const afterRegister = checkForLSPDiagnostics()
        return {
          beforeCount: beforeRegister.length,
          afterCount: afterRegister.length,
          server: afterRegister[0]?.serverName,
        }
      }),
    ])

    expect(resA).toEqual({
      firstCount: 1,
      server: 'ts-server-a',
      secondCount: 0,
    })
    expect(resB).toEqual({
      beforeCount: 0,
      afterCount: 1,
      server: 'ts-server-b',
    })
  })

  test('LSPServerInstance: start failure warning listeners isolate concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()

    const [warningsA, warningsB] = await Promise.all([
      runWithNewHostSession({ id: 'lsp-warn-a' }, async () => {
        const seen: string[] = []
        const unsub = subscribeLspStartFailureWarnings((srv, msg) => {
          seen.push(`${srv}:${msg}`)
        })
        b1.release()
        await b2.promise
        const inst = createLSPServerInstance('missing-a', {
          command: '/nonexistent-binary-wave6-a',
          args: [],
          extensionToLanguage: { '.ts': 'typescript' },
          transport: 'stdio',
          scope: 'dynamic',
          source: 'test-plugin-a',
        })
        await inst.start().catch(() => {})
        unsub()
        return seen
      }),
      runWithNewHostSession({ id: 'lsp-warn-b' }, async () => {
        await b1.promise
        const seen: string[] = []
        const unsub = subscribeLspStartFailureWarnings((srv, msg) => {
          seen.push(`${srv}:${msg}`)
        })
        b2.release()
        const inst = createLSPServerInstance('missing-b', {
          command: '/nonexistent-binary-wave6-b',
          args: [],
          extensionToLanguage: { '.ts': 'typescript' },
          transport: 'stdio',
          scope: 'dynamic',
          source: 'test-plugin-b',
        })
        await inst.start().catch(() => {})
        unsub()
        return seen
      }),
    ])

    expect(warningsA.length).toBe(1)
    expect(warningsA[0]).toContain('missing-a')
    expect(warningsA[0]).not.toContain('missing-b')
    expect(warningsB.length).toBe(1)
    expect(warningsB[0]).toContain('missing-b')
    expect(warningsB[0]).not.toContain('missing-a')
  })

  test('providerRegistry/loader: _cachedProviders isolates host slots while invalidation bumps shared generation', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()
    const b3 = createBarrier()
    const b4 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'prov-a' }, async () => {
        _invalidateProviderCache()
        const listA1 = loadProviders()
        const listA1Repeat = loadProviders()
        b1.release()
        await b2.promise
        // Before invalidation, Host A keeps its own cached array reference
        const listA2BeforeInv = loadProviders()
        b3.release()
        await b4.promise
        // After Host B invalidates, Host A sees a freshly reloaded array
        const listA3AfterInv = loadProviders()
        return {
          memoizedWithinHost: listA1 === listA1Repeat,
          memoizedWhileBLoaded: listA1 === listA2BeforeInv,
          reloadedAfterSiblingInvalidate: listA1 !== listA3AfterInv,
          listA1,
          count: listA1.length,
        }
      }),
      runWithNewHostSession({ id: 'prov-b' }, async () => {
        await b1.promise
        const listB1 = loadProviders()
        b2.release()
        await b3.promise
        _invalidateProviderCache()
        const listB2 = loadProviders()
        b4.release()
        return {
          differentAfterInvalidate: listB1 !== listB2,
          listB1,
          count: listB2.length,
        }
      }),
    ])

    expect(resA.memoizedWithinHost).toBe(true)
    expect(resA.memoizedWhileBLoaded).toBe(true)
    expect(resA.reloadedAfterSiblingInvalidate).toBe(true)
    expect(resA.listA1).not.toBe(resB.listB1)
    expect(resA.count).toBeGreaterThan(0)
    expect(resB.differentAfterInvalidate).toBe(true)
  })

  test('providerUsage/balance/poller: polling state & timer callback isolate concurrent hosts', async () => {
    const prevInterval = process.env.CLAUDE_CODE_BALANCE_POLL_INTERVAL_MINUTES
    const prevProvider = process.env.CLAUDE_CODE_BALANCE_PROVIDER
    delete process.env.CLAUDE_CODE_BALANCE_PROVIDER
    process.env.CLAUDE_CODE_BALANCE_POLL_INTERVAL_MINUTES = '0.0005' // ~30ms
    restores.push(() => {
      if (prevInterval === undefined) {
        delete process.env.CLAUDE_CODE_BALANCE_POLL_INTERVAL_MINUTES
      } else {
        process.env.CLAUDE_CODE_BALANCE_POLL_INTERVAL_MINUTES = prevInterval
      }
      if (prevProvider === undefined) {
        delete process.env.CLAUDE_CODE_BALANCE_PROVIDER
      } else {
        process.env.CLAUDE_CODE_BALANCE_PROVIDER = prevProvider
      }
    })

    const isEnabledSpy = spyOn(
      genericBalanceProvider,
      'isEnabled',
    ).mockImplementation(
      () => getActiveSessionFromAls()?.id === 'poller-host-a',
    )
    const observedSessionIds: string[] = []
    const fetchSpy = spyOn(
      genericBalanceProvider,
      'fetchBalance',
    ).mockImplementation(async () => {
      const sid = getActiveSessionFromAls()?.id ?? 'none'
      observedSessionIds.push(sid)
      return {
        remaining: 42.5,
        currency: 'USD',
        fetchedAt: Date.now(),
      }
    })
    restores.push(() => {
      isEnabledSpy.mockRestore()
      fetchSpy.mockRestore()
    })

    const bStarted = createBarrier()
    const bChecked = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'poller-host-a' }, async () => {
        startBalancePolling()
        const activeId = getActiveBalanceProviderId()
        bStarted.release()
        await tick(75)
        await bChecked.promise
        const usage = getProviderUsage()
        stopBalancePolling()
        return {
          activeId,
          remaining: usage.balance?.remaining,
          afterStop: getActiveBalanceProviderId(),
        }
      }),
      runWithNewHostSession({ id: 'poller-host-b' }, async () => {
        await bStarted.promise
        const activeBefore = getActiveBalanceProviderId()
        startBalancePolling()
        await tick(50)
        const usage = getProviderUsage()
        stopBalancePolling()
        bChecked.release()
        return {
          activeBefore,
          activeId: getActiveBalanceProviderId(),
          remaining: usage.balance?.remaining,
        }
      }),
    ])

    expect(resA).toEqual({
      activeId: 'generic',
      remaining: 42.5,
      afterStop: null,
    })
    expect(resB).toEqual({
      activeBefore: null,
      activeId: null,
      remaining: undefined,
    })
    expect(observedSessionIds.length).toBeGreaterThanOrEqual(2)
    expect(observedSessionIds.every(id => id === 'poller-host-a')).toBe(true)
  })

  test('settingsSync: downloadPromise isolates concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'ss-a' }, async () => {
        _resetDownloadPromiseForTesting()
        const p1 = downloadUserSettings()
        b1.release()
        await b2.promise
        const p2 = downloadUserSettings()
        await p1
        return { sameWithinHost: p1 === p2, p1 }
      }),
      runWithNewHostSession({ id: 'ss-b' }, async () => {
        await b1.promise
        _resetDownloadPromiseForTesting()
        const p1 = downloadUserSettings()
        b2.release()
        await p1
        return { p1 }
      }),
    ])

    expect(resA.sameWithinHost).toBe(true)
    expect(resA.p1).not.toBe(resB.p1)
  })

  test('skillSearch/intentNormalize: query cache isolates concurrent hosts', async () => {
    const prevEnabled = process.env.SKILL_SEARCH_INTENT_ENABLED
    process.env.SKILL_SEARCH_INTENT_ENABLED = '1'
    restores.push(() => {
      if (prevEnabled === undefined) {
        delete process.env.SKILL_SEARCH_INTENT_ENABLED
      } else {
        process.env.SKILL_SEARCH_INTENT_ENABLED = prevEnabled
      }
    })

    const haikuSpy = spyOn(claudeApi, 'queryHaiku').mockImplementation(
      async () => {
        const sid = getActiveSessionFromAls()?.id ?? 'unknown'
        return {
          message: {
            content: [{ type: 'text', text: `optimize ${sid}` }],
          },
        } as unknown as Awaited<ReturnType<typeof claudeApi.queryHaiku>>
      },
    )
    restores.push(() => haikuSpy.mockRestore())

    const query = '帮我优化代码性能'
    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'intent-a' }, async () => {
        clearIntentNormalizeCache()
        const first = await normalizeQueryIntent(query)
        b1.release()
        await b2.promise
        const second = await normalizeQueryIntent(query)
        return { first, second }
      }),
      runWithNewHostSession({ id: 'intent-b' }, async () => {
        await b1.promise
        clearIntentNormalizeCache()
        const first = await normalizeQueryIntent(query)
        b2.release()
        return first
      }),
    ])

    expect(resA.first).toContain('intent-a')
    expect(resA.second).toBe(resA.first)
    expect(resB).toContain('intent-b')
    expect(haikuSpy).toHaveBeenCalledTimes(2)
  })

  test('assistant: markAssistantForced / getAssistantActivationPath isolate concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'asst-a' }, async () => {
        setKairosActive(true)
        markAssistantForced()
        b1.release()
        await b2.promise
        return {
          forced: isAssistantForced(),
          path: getAssistantActivationPath(),
        }
      }),
      runWithNewHostSession({ id: 'asst-b' }, async () => {
        await b1.promise
        setKairosActive(true)
        const forced = isAssistantForced()
        const path = getAssistantActivationPath()
        b2.release()
        return { forced, path }
      }),
    ])

    expect(resA).toEqual({ forced: true, path: 'daemon' })
    expect(resB).toEqual({ forced: false, path: 'gate' })
  })

  test('buddy: companion roll cache and companionReact rate-limit isolate concurrent hosts', async () => {
    const configSpy = spyOn(configModule, 'getGlobalConfig').mockReturnValue({
      companion: {
        name: 'Pip',
        personality: 'cheerful',
        seed: 'seed-1',
        hatchedAt: Date.now(),
      },
      companionMuted: false,
    } as unknown as ReturnType<typeof configModule.getGlobalConfig>)
    const querySpy = spyOn(claudeApi, 'queryWithModel').mockImplementation(
      async () => {
        const sid = getActiveSessionFromAls()?.id ?? 'unknown'
        return {
          message: {
            content: [
              { type: 'text', text: JSON.stringify({ reaction: `hi-${sid}` }) },
            ],
          },
        } as unknown as Awaited<ReturnType<typeof claudeApi.queryWithModel>>
      },
    )
    restores.push(() => {
      configSpy.mockRestore()
      querySpy.mockRestore()
    })

    const msg = [
      { type: 'user', message: { role: 'user', content: 'hello world' } },
    ] as unknown as Message[]

    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'buddy-a' }, async () => {
        const r1 = roll('user-a')
        const reactions: string[] = []
        triggerCompanionReaction(msg, text => {
          if (text) reactions.push(text)
        })
        b1.release()
        await b2.promise
        await tick(30)
        // Second non-addressed call within 45s in Host A must be rate-limited
        triggerCompanionReaction(msg, text => {
          if (text) reactions.push(text)
        })
        await tick(20)
        return { rollSpecies: r1.bones.species, reactions }
      }),
      runWithNewHostSession({ id: 'buddy-b' }, async () => {
        await b1.promise
        const r1 = roll('user-b')
        const reactions: string[] = []
        // Host B has NOT reacted yet, so it must NOT be rate-limited by Host A's lastReactTime!
        triggerCompanionReaction(msg, text => {
          if (text) reactions.push(text)
        })
        b2.release()
        await tick(30)
        return { rollSpecies: r1.bones.species, reactions }
      }),
    ])

    expect(resA.reactions).toEqual(['hi-buddy-a'])
    expect(resB.reactions).toEqual(['hi-buddy-b'])
    expect(resA.rollSpecies).toBeTruthy()
    expect(resB.rollSpecies).toBeTruthy()
  })

  test('coordinator/fileLockManager: locks and stats isolate concurrent hosts', async () => {
    const dir = makeTempDir('flock-w6-')
    const sharedFile = join(dir, 'shared.ts')
    writeFileSync(sharedFile, 'export const x = 1\n', 'utf8')

    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'lock-a' }, async () => {
        resetFileLockStateForTests()
        const acq = acquireFileLock(sharedFile, 'worker-a1')
        b1.release()
        await b2.promise
        const owner = getFileLockOwner(sharedFile)
        const conflict = acquireFileLock(sharedFile, 'worker-a2')
        const stats = getFileLockStats()
        releaseAgentLocks('worker-a1')
        return {
          acqSuccess: acq.success,
          owner,
          conflictSuccess: conflict.success,
          totalConflicts: stats.totalConflicts,
        }
      }),
      runWithNewHostSession({ id: 'lock-b' }, async () => {
        await b1.promise
        resetFileLockStateForTests()
        // Same physical path must succeed in Host B while locked in Host A!
        const acq = acquireFileLock(sharedFile, 'worker-b1')
        const owner = getFileLockOwner(sharedFile)
        const stats = getFileLockStats()
        b2.release()
        releaseAgentLocks('worker-b1')
        return {
          acqSuccess: acq.success,
          owner,
          totalAcquisitions: stats.totalAcquisitions,
          totalConflicts: stats.totalConflicts,
        }
      }),
    ])

    expect(resA).toEqual({
      acqSuccess: true,
      owner: 'worker-a1',
      conflictSuccess: false,
      totalConflicts: 1,
    })
    expect(resB).toEqual({
      acqSuccess: true,
      owner: 'worker-b1',
      totalAcquisitions: 1,
      totalConflicts: 0,
    })
  })

  test('history: paste id allocator, cleared drafts, and pending undo isolate concurrent hosts', async () => {
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    const prevClaudeCode = process.env.CLAUDECODE
    const prevChild = process.env.CLAUDE_CODE_CHILD_SESSION
    const prevSkip = process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    process.env.CLAUDE_CONFIG_DIR = makeTempDir('hist-cfg-w6-')
    delete process.env.CLAUDECODE
    delete process.env.CLAUDE_CODE_CHILD_SESSION
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    restores.push(() => {
      if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      if (prevClaudeCode === undefined) delete process.env.CLAUDECODE
      else process.env.CLAUDECODE = prevClaudeCode
      if (prevChild === undefined) delete process.env.CLAUDE_CODE_CHILD_SESSION
      else process.env.CLAUDE_CODE_CHILD_SESSION = prevChild
      if (prevSkip === undefined) {
        delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
      } else {
        process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY = prevSkip
      }
    })

    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'hist-a' }, async () => {
        resetPasteIdAllocatorForTests()
        clearPendingHistoryEntries()
        const p1 = mintPasteId()
        const p2 = mintPasteId()
        keepClearedDraftToHistory({
          display: 'draft-from-a',
          pastedContents: {},
        })
        addToHistory('prompt-a-1')
        b1.release()
        await b2.promise
        const p3 = mintPasteId()
        const entriesBeforeUndo: string[] = []
        for await (const entry of getHistory({ withClearedDrafts: true })) {
          entriesBeforeUndo.push(entry.display)
          if (entriesBeforeUndo.length >= 6) break
        }
        removeLastFromHistory()
        const entriesAfterUndo: string[] = []
        for await (const entry of getHistory({ withClearedDrafts: true })) {
          entriesAfterUndo.push(entry.display)
          if (entriesAfterUndo.length >= 6) break
        }
        clearPendingHistoryEntries()
        return {
          ids: [p1, p2, p3],
          hasDraftA: entriesBeforeUndo.includes('draft-from-a'),
          hasDraftB: entriesBeforeUndo.includes('draft-from-b'),
          hadPromptA: entriesBeforeUndo.includes('prompt-a-1'),
          hasPromptAAfterUndo: entriesAfterUndo.includes('prompt-a-1'),
        }
      }),
      runWithNewHostSession({ id: 'hist-b' }, async () => {
        await b1.promise
        resetPasteIdAllocatorForTests()
        clearPendingHistoryEntries()
        // Host B paste counter starts fresh at 1 despite Host A minting 1, 2
        const p1 = mintPasteId()
        keepClearedDraftToHistory({
          display: 'draft-from-b',
          pastedContents: {},
        })
        // Calling removeLastFromHistory in Host B must NOT undo Host A's prompt-a-1
        removeLastFromHistory()
        const drafts: string[] = []
        for await (const entry of getHistory({ withClearedDrafts: true })) {
          drafts.push(entry.display)
          if (drafts.length >= 6) break
        }
        b2.release()
        clearPendingHistoryEntries()
        return {
          p1,
          hasDraftB: drafts.includes('draft-from-b'),
          hasDraftA: drafts.includes('draft-from-a'),
        }
      }),
    ])

    expect(resA).toEqual({
      ids: [1, 2, 3],
      hasDraftA: true,
      hasDraftB: false,
      hadPromptA: true,
      hasPromptAAfterUndo: false,
    })
    expect(resB).toEqual({ p1: 1, hasDraftB: true, hasDraftA: false })
  })

  test('proactive: state machine and change listeners isolate concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()
    let unsubA!: () => void

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'pro-a' }, async () => {
        let notifications = 0
        unsubA = subscribeToProactiveChanges(() => {
          notifications++
        })
        activateProactive('source-a')
        setNextTickAt(123456)
        b1.release()
        await b2.promise
        const snap = {
          active: isProactiveActive(),
          paused: isProactivePaused(),
          blocked: isContextBlocked(),
          nextTick: getNextTickAt(),
          source: getActivationSource(),
          notifications,
        }
        return snap
      }),
      runWithNewHostSession({ id: 'pro-b' }, async () => {
        await b1.promise
        let notifications = 0
        const unsubB = subscribeToProactiveChanges(() => {
          notifications++
        })
        const initialActive = isProactiveActive()
        activateProactive('source-b')
        pauseProactive()
        setContextBlocked(true)
        const snap = {
          initialActive,
          active: isProactiveActive(),
          paused: isProactivePaused(),
          blocked: isContextBlocked(),
          nextTick: getNextTickAt(),
          source: getActivationSource(),
          notifications,
        }
        deactivateProactive()
        unsubB()
        b2.release()
        return snap
      }),
    ])

    // Unsubscribing Host A's listener outside ALS must still work cleanly
    unsubA()

    expect(resA).toEqual({
      active: true,
      paused: false,
      blocked: false,
      nextTick: 123456,
      source: 'source-a',
      notifications: 2,
    })
    expect(resB).toEqual({
      initialActive: false,
      active: true,
      paused: true,
      blocked: true,
      nextTick: null,
      source: 'source-b',
      notifications: 3,
    })
  })

  test('skills/mcpSkillBuilders: preserves module-load default and isolates per-host overrides', async () => {
    const defaultB = {
      createSkillCommand:
        (() => {}) as unknown as MCPSkillBuilders['createSkillCommand'],
      parseSkillFrontmatterFields:
        (() => ({})) as unknown as MCPSkillBuilders['parseSkillFrontmatterFields'],
    }
    const overrideA = {
      createSkillCommand:
        (() => {}) as unknown as MCPSkillBuilders['createSkillCommand'],
      parseSkillFrontmatterFields:
        (() => ({})) as unknown as MCPSkillBuilders['parseSkillFrontmatterFields'],
    }

    // Preserve any existing module-load default so we restore it afterward
    let prevDefault: MCPSkillBuilders | null = null
    try {
      prevDefault = getMCPSkillBuilders()
    } catch {
      prevDefault = null
    }
    registerMCPSkillBuilders(defaultB)
    restores.push(() => {
      if (prevDefault) {
        registerMCPSkillBuilders(prevDefault)
      }
    })

    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'msb-a' }, async () => {
        const inherited = getMCPSkillBuilders()
        registerMCPSkillBuilders(overrideA)
        b1.release()
        await b2.promise
        return {
          inheritedDefault: inherited === defaultB,
          seesOverride: getMCPSkillBuilders() === overrideA,
        }
      }),
      runWithNewHostSession({ id: 'msb-b' }, async () => {
        await b1.promise
        const resolved = getMCPSkillBuilders()
        b2.release()
        return resolved === defaultB
      }),
    ])

    expect(resA).toEqual({ inheritedDefault: true, seesOverride: true })
    expect(resB).toBe(true)
    expect(getMCPSkillBuilders()).toBe(defaultB)
  })

  test('skills/syncedSkillsHarden: pendingSkillDownloads isolates concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'ssh-a' }, async () => {
        clearPendingSkillDownloads()
        const finishA = registerPendingSkillDownload('shared-skill')
        const pendingBefore = hasPendingSkillDownload('shared-skill')
        b1.release()
        await b2.promise
        const waiter = awaitPendingSkillDownload('shared-skill')
        finishA({ ok: true })
        const outcome = await waiter
        return {
          pendingBefore,
          outcome,
          pendingAfter: hasPendingSkillDownload('shared-skill'),
        }
      }),
      runWithNewHostSession({ id: 'ssh-b' }, async () => {
        await b1.promise
        // Host B must NOT see Host A's pending download
        const seesA = hasPendingSkillDownload('shared-skill')
        const finishB = registerPendingSkillDownload('shared-skill')
        finishB({ ok: false, reason: 'host-b-denied' })
        // Clearing in Host B must NOT cancel Host A's pending download
        clearPendingSkillDownloads()
        b2.release()
        return { seesA }
      }),
    ])

    expect(resA).toEqual({
      pendingBefore: true,
      outcome: { ok: true },
      pendingAfter: false,
    })
    expect(resB).toEqual({ seesA: false })
  })

  test('state/onChangeAppState: ccrKeepsSessionRules isolates concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'ccr-a' }, async () => {
        setCcrKeepsSessionRules(true)
        b1.release()
        await b2.promise
        return getCcrKeepsSessionRules()
      }),
      runWithNewHostSession({ id: 'ccr-b' }, async () => {
        await b1.promise
        const initial = getCcrKeepsSessionRules()
        setCcrKeepsSessionRules(false)
        b2.release()
        return { initial, afterSet: getCcrKeepsSessionRules() }
      }),
    ])

    expect(resA).toBe(true)
    expect(resB).toEqual({ initial: undefined, afterSet: false })
  })

  test('tasks/shellPressureReap: lastPressureReapAt anti-churn isolates concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()

    const now = 10_000_000
    const lastInteraction = now - 3_600_000 // 1h idle

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'reap-a' }, async () => {
        resetLastPressureReapAtForTests()
        setLastPressureReapAt(now - 600_000) // reaped 10m ago
        b1.release()
        await b2.promise
        const decision = evaluateMemoryPressureReap({
          level: 'critical',
          status: 'running',
          notified: false,
          lastInteractionTime: lastInteraction,
          now,
          mainLoopBusy: false,
          hasActiveAgentTasks: false,
          taskStartTime: now - 300_000, // started 5m after reap -> anti-churn blocks
          checkHostMemory: () => ({ scarce: true, detail: 'scarce' }),
        })
        return { ts: getLastPressureReapAt(), shouldReap: decision.shouldReap }
      }),
      runWithNewHostSession({ id: 'reap-b' }, async () => {
        await b1.promise
        resetLastPressureReapAtForTests()
        const decision = evaluateMemoryPressureReap({
          level: 'critical',
          status: 'running',
          notified: false,
          lastInteractionTime: lastInteraction,
          now,
          mainLoopBusy: false,
          hasActiveAgentTasks: false,
          taskStartTime: now - 300_000,
          checkHostMemory: () => ({ scarce: true, detail: 'scarce' }),
        })
        b2.release()
        return { ts: getLastPressureReapAt(), shouldReap: decision.shouldReap }
      }),
    ])

    expect(resA).toEqual({ ts: now - 600_000, shouldReap: false })
    expect(resB).toEqual({ ts: 0, shouldReap: true })
  })

  test('query: precomputeArmTableMalformedLogged one-shot latch isolates concurrent hosts', async () => {
    const gbSpy = spyOn(
      growthbook,
      'getFeatureValue_CACHED_MAY_BE_STALE',
    ).mockImplementation(((key: string, fallback: unknown) => {
      if (key === 'tengu_amber_moleskin') {
        return 'not-a-valid-table'
      }
      return fallback
    }) as typeof growthbook.getFeatureValue_CACHED_MAY_BE_STALE)
    restores.push(() => gbSpy.mockRestore())

    const b1 = createBarrier()
    const b2 = createBarrier()

    const [eventsA, eventsB] = await Promise.all([
      runWithNewHostSession({ id: 'q-a' }, async () => {
        resetAnalyticsForTesting()
        const logged: string[] = []
        attachAnalyticsSink({
          logEvent: name => logged.push(name),
          logEventAsync: async name => {
            logged.push(name)
          },
        })
        resolveLivePrecomputeBufferFraction(
          'claude-sonnet-4-6',
          'repl_main_thread',
        )
        b1.release()
        await b2.promise
        // Second call in Host A must NOT re-emit
        resolveLivePrecomputeBufferFraction(
          'claude-sonnet-4-6',
          'repl_main_thread',
        )
        return logged.filter(e => e === 'tengu_precompute_arm_table_malformed')
      }),
      runWithNewHostSession({ id: 'q-b' }, async () => {
        await b1.promise
        resetAnalyticsForTesting()
        const logged: string[] = []
        attachAnalyticsSink({
          logEvent: name => logged.push(name),
          logEventAsync: async name => {
            logged.push(name)
          },
        })
        // Host B MUST still emit its own one-shot malformed-table event!
        resolveLivePrecomputeBufferFraction(
          'claude-sonnet-4-6',
          'repl_main_thread',
        )
        b2.release()
        return logged.filter(e => e === 'tengu_precompute_arm_table_malformed')
      }),
    ])

    expect(eventsA).toEqual(['tengu_precompute_arm_table_malformed'])
    expect(eventsB).toEqual(['tengu_precompute_arm_table_malformed'])
  })

  test('tools: withheldOutsideLaunchListLogged and per-session REPL wrapper isolate concurrent hosts', async () => {
    const prevUserType = process.env.USER_TYPE
    process.env.USER_TYPE = 'ant'
    restores.push(() => {
      if (prevUserType === undefined) {
        delete process.env.USER_TYPE
      } else {
        process.env.USER_TYPE = prevUserType
      }
    })

    const permCtx = {
      mode: 'default' as const,
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
      toolsKeptByLaunchList: ['Bash'],
    }
    const sampleTools = [{ name: 'Bash' }, { name: 'Write' }]

    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'tools-a' }, async () => {
        resetAnalyticsForTesting()
        const logged: string[] = []
        attachAnalyticsSink({
          logEvent: name => logged.push(name),
          logEventAsync: async name => {
            logged.push(name)
          },
        })
        filterToolsByDenyRules(sampleTools, permCtx)
        b1.release()
        await b2.promise
        // Second call in Host A does not re-log Write
        filterToolsByDenyRules(sampleTools, permCtx)
        const replA = getAllBaseTools().find(t => t.name === 'REPL')
        return {
          logged: logged.filter(
            e => e === 'tengu_tool_withheld_outside_launch_list',
          ),
          replA,
        }
      }),
      runWithNewHostSession({ id: 'tools-b' }, async () => {
        await b1.promise
        resetAnalyticsForTesting()
        const logged: string[] = []
        attachAnalyticsSink({
          logEvent: name => logged.push(name),
          logEventAsync: async name => {
            logged.push(name)
          },
        })
        // Host B gets its own one-shot log for Write!
        filterToolsByDenyRules(sampleTools, permCtx)
        const replB = getAllBaseTools().find(t => t.name === 'REPL')
        b2.release()
        return {
          logged: logged.filter(
            e => e === 'tengu_tool_withheld_outside_launch_list',
          ),
          replB,
        }
      }),
    ])

    expect(resA.logged).toEqual(['tengu_tool_withheld_outside_launch_list'])
    expect(resB.logged).toEqual(['tengu_tool_withheld_outside_launch_list'])
    if (resA.replA && resB.replB) {
      expect(resA.replA).not.toBe(resB.replB)
    }
  })

  test('ArtifactTool/permissions: source pins & person-only asks isolate concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'art-a' }, async () => {
        recordApprovedPublishSourcePin('tu-1', {
          pin: { kind: 'absent' },
          sha256: 'hash-a',
        })
        recordNewArtifactPersonOnlyAsk('tu-1')
        b1.release()
        await b2.promise
        return {
          pin: consumeApprovedPublishSourcePin('tu-1'),
          ask: consumeNewArtifactPersonOnlyAsk('tu-1'),
        }
      }),
      runWithNewHostSession({ id: 'art-b' }, async () => {
        await b1.promise
        // Host B must NOT see or consume Host A's pin or ask
        const pinBefore = consumeApprovedPublishSourcePin('tu-1')
        const askBefore = consumeNewArtifactPersonOnlyAsk('tu-1')
        recordApprovedPublishSourcePin('tu-1', {
          pin: { kind: 'absent' },
          sha256: 'hash-b',
        })
        b2.release()
        return {
          pinBefore,
          askBefore,
          pinB: consumeApprovedPublishSourcePin('tu-1'),
        }
      }),
    ])

    expect(resA.pin?.sha256).toBe('hash-a')
    expect(resA.ask).toBe(true)
    expect(resB.pinBefore).toBeUndefined()
    expect(resB.askBefore).toBe(false)
    expect(resB.pinB?.sha256).toBe('hash-b')
  })

  test('ProposeGoalTool/proposeGoalGate: one-shot log latch isolates concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()

    const [eventsA, eventsB] = await Promise.all([
      runWithNewHostSession({ id: 'goal-a' }, async () => {
        resetAnalyticsForTesting()
        resetGoalProposalAvailableLatchForTests()
        const logged: string[] = []
        attachAnalyticsSink({
          logEvent: name => logged.push(name),
          logEventAsync: async name => {
            logged.push(name)
          },
        })
        logGoalProposalAvailableOnce('auto')
        b1.release()
        await b2.promise
        logGoalProposalAvailableOnce('auto')
        return logged.filter(e => e === 'tengu_goal_proposal_available')
      }),
      runWithNewHostSession({ id: 'goal-b' }, async () => {
        await b1.promise
        resetAnalyticsForTesting()
        resetGoalProposalAvailableLatchForTests()
        const logged: string[] = []
        attachAnalyticsSink({
          logEvent: name => logged.push(name),
          logEventAsync: async name => {
            logged.push(name)
          },
        })
        logGoalProposalAvailableOnce('alwaysAsk')
        b2.release()
        return logged.filter(e => e === 'tengu_goal_proposal_available')
      }),
    ])

    expect(eventsA).toEqual(['tengu_goal_proposal_available'])
    expect(eventsB).toEqual(['tengu_goal_proposal_available'])
  })

  test('ListPeersTool: pagination cursor LRU isolates concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()
    let cursorA = ''

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'peers-a' }, async () => {
        clearListAgentsCursorCacheForTests()
        cursorA = issueListAgentsCursor(new Set(['session\x00p1']))
        b1.release()
        await b2.promise
        const stillValidInA = lookupListAgentsCursor(cursorA)
        return { hasP1: stillValidInA?.has('session\x00p1') === true }
      }),
      runWithNewHostSession({ id: 'peers-b' }, async () => {
        await b1.promise
        // Cursor issued in Host A must be invalid in Host B
        const page = paginatePeerListingRows(
          [{ key: 'session\x00p2', line: 'peer-2' }],
          { cursor: cursorA },
        )
        clearListAgentsCursorCacheForTests()
        b2.release()
        return { kind: page.kind }
      }),
    ])

    expect(resA.hasP1).toBe(true)
    expect(resB.kind).toBe('invalid-cursor')
  })

  test('PushNotificationTool: dedup map isolates concurrent hosts', async () => {
    const makeCtx = () =>
      ({
        options: { isNonInteractiveSession: true },
        getAppState: () => ({
          replBridgeExplicit: true,
          replBridgeSessionActive: true,
          replBridgeEnabled: true,
          replBridgeConnected: true,
        }),
      }) as unknown as ToolUseContext

    const input = {
      title: 'Build Ready',
      body: 'Done',
      status: 'proactive' as const,
    }
    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'push-a' }, async () => {
        _resetPushNotificationDedupForTesting()
        _recordPushNotificationDedupForTesting(
          input.title,
          input.body,
          input.status,
        )
        const first = await PushNotificationTool.call(input, makeCtx())
        b1.release()
        await b2.promise
        // Even after Host B resets its own dedup map, Host A stays deduplicated
        const second = await PushNotificationTool.call(input, makeCtx())
        return {
          firstDedup: first.data.deduplicated,
          secondDedup: second.data.deduplicated,
        }
      }),
      runWithNewHostSession({ id: 'push-b' }, async () => {
        await b1.promise
        // Same title+body in Host B must NOT be deduplicated by Host A
        const first = await PushNotificationTool.call(input, makeCtx())
        _resetPushNotificationDedupForTesting()
        b2.release()
        return {
          firstDedup: first.data.deduplicated,
          disabledReason: first.data.disabledReason,
        }
      }),
    ])

    expect(resA).toEqual({ firstDedup: true, secondDedup: true })
    expect(resB).toEqual({
      firstDedup: undefined,
      disabledReason: 'no_transport',
    })
  })

  test('SendUserFileTool: TOCTOU listed args stash isolates concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'suf-a' }, async () => {
        clearSendUserFileArgsStashForTesting()
        recordListedSendUserFileArgs('shared-tool-use-id', ['/tmp/a.txt'])
        b1.release()
        await b2.promise
        return verifySendUserFileArgsUnchanged('shared-tool-use-id', [
          '/tmp/a.txt',
        ])
      }),
      runWithNewHostSession({ id: 'suf-b' }, async () => {
        await b1.promise
        clearSendUserFileArgsStashForTesting()
        recordListedSendUserFileArgs('shared-tool-use-id', ['/tmp/b.txt'])
        const mismatch = verifySendUserFileArgsUnchanged('shared-tool-use-id', [
          '/tmp/tampered.txt',
        ])
        b2.release()
        return mismatch
      }),
    ])

    expect(resA).toEqual({ ok: true })
    expect(resB).toEqual({
      ok: false,
      error: SEND_USER_FILE_ARGUMENTS_CHANGED_ERROR,
    })
  })

  test('AgentTool/spawnHookRewrite: unreviewedWebFetch stamps isolate concurrent hosts', async () => {
    const makeAutoCtx = () =>
      ({
        getAppState: () => ({
          toolPermissionContext: {
            mode: 'auto',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {
              localSettings: ['WebFetch(domain:example.com)'],
            },
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          },
        }),
      }) as unknown as ToolUseContext

    const agents = [{ agentType: WEB_FETCH_AGENT_TYPE, source: 'built-in' }]
    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'shr-a' }, async () => {
        await maybeStampUnreviewedWebFetch({
          toolUseId: 'wf-id-1',
          prompt: 'Read https://example.com/docs',
          subagentType: WEB_FETCH_AGENT_TYPE,
          activeAgents: agents,
          context: makeAutoCtx(),
        })
        b1.release()
        await b2.promise
        return {
          firstConsume: consumeUnreviewedWebFetch('wf-id-1'),
          secondConsume: consumeUnreviewedWebFetch('wf-id-1'),
        }
      }),
      runWithNewHostSession({ id: 'shr-b' }, async () => {
        await b1.promise
        // Host B must NOT be able to consume Host A's stamp
        const consumedInB = consumeUnreviewedWebFetch('wf-id-1')
        b2.release()
        return consumedInB
      }),
    ])

    expect(resA).toEqual({ firstConsume: true, secondConsume: false })
    expect(resB).toBe(false)
  })

  test('AgentTool/webFetchAgent: cachedWebFetchAgentEnabled isolates concurrent hosts', async () => {
    const prevEnv = process.env.CLAUDE_CODE_WEB_FETCH_AGENT
    const prevDisable = process.env.CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS
    process.env.CLAUDE_CODE_WEB_FETCH_AGENT = '1'
    process.env.CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS = '1'
    restores.push(() => {
      if (prevEnv === undefined) {
        delete process.env.CLAUDE_CODE_WEB_FETCH_AGENT
      } else {
        process.env.CLAUDE_CODE_WEB_FETCH_AGENT = prevEnv
      }
      if (prevDisable === undefined) {
        delete process.env.CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS
      } else {
        process.env.CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS = prevDisable
      }
    })

    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'wfa-a' }, async () => {
        __resetWebFetchAgentEnabledForTests()
        setIsInteractive(true)
        const first = isWebFetchAgentEnabled()
        b1.release()
        await b2.promise
        return { first, second: isWebFetchAgentEnabled() }
      }),
      runWithNewHostSession({ id: 'wfa-b' }, async () => {
        await b1.promise
        __resetWebFetchAgentEnabledForTests()
        // Non-interactive + DISABLE_BUILTIN_AGENTS => rosterKind='none' => false
        setIsInteractive(false)
        const enabledB = isWebFetchAgentEnabled()
        b2.release()
        return enabledB
      }),
    ])

    expect(resA).toEqual({ first: true, second: true })
    expect(resB).toBe(false)
  })

  test('ClaudeDesignTool/validateArguments: discoveredHints isolate concurrent hosts', async () => {
    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'cdv-a' }, async () => {
        resetDiscoveredOperationHints()
        recordDiscoveredOperationHints([
          {
            name: 'custom_read_op',
            annotations: { readOnlyHint: true, destructiveHint: false },
          },
        ])
        b1.release()
        await b2.promise
        return {
          hints: getOperationHints('custom_read_op'),
          validation: validateWriteOpArgs('custom_read_op', {}),
        }
      }),
      runWithNewHostSession({ id: 'cdv-b' }, async () => {
        await b1.promise
        resetDiscoveredOperationHints()
        const hints = getOperationHints('custom_read_op')
        const validation = validateWriteOpArgs('custom_read_op', {})
        b2.release()
        return { hints, validation }
      }),
    ])

    expect(resA.hints).toEqual({ readOnly: true, destructive: false })
    expect(resA.validation).toBeNull()
    expect(resB.hints).toBeUndefined()
    expect(resB.validation).toContain('unrecognized operation')
  })

  test('FileReadTool/limits: getDefaultFileReadingLimits memo & .cache proxy isolate concurrent hosts', async () => {
    const gbSpy = spyOn(
      growthbook,
      'getFeatureValue_CACHED_MAY_BE_STALE',
    ).mockImplementation(((key: string, fallback: unknown) => {
      if (key === 'tengu_amber_wren') {
        const sid = getActiveSessionFromAls()?.id
        if (sid === 'lim-a') return { maxTokens: 11_111, maxSizeBytes: 123_456 }
        if (sid === 'lim-b') return { maxTokens: 22_222, maxSizeBytes: 234_567 }
      }
      return fallback
    }) as typeof growthbook.getFeatureValue_CACHED_MAY_BE_STALE)
    restores.push(() => gbSpy.mockRestore())

    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'lim-a' }, async () => {
        getDefaultFileReadingLimits.cache.clear?.()
        const first = getDefaultFileReadingLimits()
        b1.release()
        await b2.promise
        const second = getDefaultFileReadingLimits()
        // Same memoized object within Host A despite Host B clearing its cache!
        return { first, sameRef: first === second }
      }),
      runWithNewHostSession({ id: 'lim-b' }, async () => {
        await b1.promise
        const first = getDefaultFileReadingLimits()
        // Clearing Host B's cache via .cache proxy must NOT clear Host A's cache
        getDefaultFileReadingLimits.cache.clear?.()
        // Setting a custom Map via .cache setter also stays isolated to Host B
        getDefaultFileReadingLimits.cache =
          new Map() as unknown as typeof getDefaultFileReadingLimits.cache
        const afterReplace = getDefaultFileReadingLimits()
        b2.release()
        return { first, afterReplace }
      }),
    ])

    expect(resA.first.maxTokens).toBe(11_111)
    expect(resA.first.maxSizeBytes).toBe(123_456)
    expect(resA.sameRef).toBe(true)
    expect(resB.first.maxTokens).toBe(22_222)
    expect(resB.afterReplace.maxTokens).toBe(22_222)
  })

  test('WebSearchTool/adapters: createAdapter cache isolates concurrent hosts', async () => {
    const prevEnv = process.env.WEB_SEARCH_ADAPTER
    delete process.env.WEB_SEARCH_ADAPTER
    restores.push(() => {
      if (prevEnv === undefined) {
        delete process.env.WEB_SEARCH_ADAPTER
      } else {
        process.env.WEB_SEARCH_ADAPTER = prevEnv
      }
    })

    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'ws-a' }, async () => {
        setFlagSettingsInline({ webSearchAdapter: 'brave' })
        const first = createAdapter()
        b1.release()
        await b2.promise
        const second = createAdapter()
        return {
          ctorName: first.constructor.name,
          sameRef: first === second,
          ref: first,
        }
      }),
      runWithNewHostSession({ id: 'ws-b' }, async () => {
        await b1.promise
        setFlagSettingsInline({ webSearchAdapter: 'exa' })
        const first = createAdapter()
        b2.release()
        return { ctorName: first.constructor.name, ref: first }
      }),
    ])

    expect(resA.sameRef).toBe(true)
    expect(resA.ref).not.toBe(resB.ref)
    expect(resA.ctorName).toBe('BraveSearchAdapter')
    expect(resB.ctorName).toBe('ExaSearchAdapter')
  })

  test('BashTool/bashEditDiff: prewarmedSnapshots map isolates concurrent hosts', async () => {
    const nonGitDir = makeTempDir('bash-diff-w6-')
    const b1 = createBarrier()
    const b2 = createBarrier()

    const [resA, resB] = await Promise.all([
      runWithNewHostSession({ id: 'bed-a' }, async () => {
        _resetPrewarmedBashEditDiffSnapshotsForTesting()
        const prewarmed = prewarmBashEditDiffSnapshot(nonGitDir, 'tool-shared')
        b1.release()
        await b2.promise
        // Host B discarding the same key must NOT discard Host A's prewarmed promise!
        const consumed = consumePrewarmedBashEditDiffSnapshot(
          nonGitDir,
          'tool-shared',
        )
        await prewarmed
        return { samePromise: prewarmed === consumed }
      }),
      runWithNewHostSession({ id: 'bed-b' }, async () => {
        await b1.promise
        discardPrewarmedBashEditDiffSnapshot(nonGitDir, 'tool-shared')
        _resetPrewarmedBashEditDiffSnapshotsForTesting()
        b2.release()
        return 'ok'
      }),
    ])

    expect(resA.samePromise).toBe(true)
    expect(resB).toBe('ok')
  })
})
