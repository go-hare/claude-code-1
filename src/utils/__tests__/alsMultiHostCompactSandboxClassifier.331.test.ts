import { afterEach, describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  _setSpeculativeClassifierCheckForTesting,
  clearSpeculativeChecks,
  consumeSpeculativeClassifierCheck,
  peekSpeculativeClassifierCheck,
} from '@claude-code/builtin-tools/tools/BashTool/bashPermissions.js'
import {
  _resetSandboxCheckRecordsForTesting,
  _resetUnsandboxedCommandsDisabledForTesting,
  disableUnsandboxedCommandsForMcpServe,
  isUnsandboxedCommandsDisabled,
  recordSandboxStateAtCheck,
  shouldKeepRewrittenCommandInSandbox,
} from '@claude-code/builtin-tools/tools/BashTool/shouldUseSandbox.js'
import { SandboxManager as BaseSandboxManager } from '@anthropic-ai/sandbox-runtime'
import {
  createAutoDreamRunner,
  executeAutoDream,
  getAutoDreamStateForTesting,
  initAutoDream,
} from '../../services/autoDream/autoDream.js'
import {
  clearRefusedClearToolUsesModelsForTesting,
  hasModelRefusedClearToolUses,
  recordClearToolUsesRefusal,
} from '../../services/compact/apiMicrocompact.js'
import {
  getClaudeMdGrowthTokens,
  getLastSentClaudeMdTokens,
  recordSentClaudeMdTokens,
  resetSentClaudeMdTokensForTesting,
} from '../../services/compact/autoCompact.js'
import {
  clearCompactCleanupCallbacksForTesting,
  registerCompactCleanup,
  runPostCompactCleanup,
} from '../../services/compact/postCompactCleanup.js'
import {
  getSessionMemoryCompactConfig,
  resetSessionMemoryCompactConfig,
  setSessionMemoryCompactConfig,
} from '../../services/compact/sessionMemoryCompact.js'
import {
  createMemoryExtractor,
  drainPendingExtraction,
  executeExtractMemories,
  getMemoryExtractorStateForTesting,
  initExtractMemories,
} from '../../services/extractMemories/extractMemories.js'
import {
  abortPromptSuggestion,
  executePromptSuggestion,
  getPromptSuggestionAbortControllerForTests,
  markPersonActivityForPromptSuggestion,
  resetUnattendedPromptSuggestionStateForTests,
  shouldBackOffUnattendedPromptSuggestion,
} from '../../services/PromptSuggestion/promptSuggestion.js'
import {
  getLastSummarizedMessageId,
  getSessionMemoryConfig,
  hasMetUpdateThreshold,
  isSessionMemoryInitialized,
  markExtractionCompleted,
  markExtractionStarted,
  markSessionMemoryInitialized,
  recordExtractionTokenCount,
  resetSessionMemoryState,
  setLastSummarizedMessageId,
  setSessionMemoryConfig,
} from '../../services/SessionMemory/sessionMemoryUtils.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import type { ToolUseContext } from '../../Tool.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '../../types/message.js'
import {
  _getClassifierApprovalsStateForTesting,
  clearClassifierApprovals,
  deleteClassifierApproval,
  isClassifierChecking,
} from '../classifierApprovals.js'
import { getCwd, runWithCwd } from '../cwd.js'
import type { REPLHookContext } from '../hooks/postSamplingHooks.js'
import type { ClassifierResult } from '../permissions/bashClassifier.js'
import {
  _resetSandboxHeldStateForTesting,
  _setSandboxInitFailureForTesting,
  addSessionAllowedHost,
  captureSandboxRootMoveHold,
  clearFsReadConfigMemoForTests,
  clearSandboxRootMoveHold,
  clearSessionAllowedHostsForTests,
  convertToSandboxRuntimeConfig,
  ensureInitializedForWrap,
  getLastSandboxAskCallbackForTests,
  getSandboxInitFailureReason,
  getSandboxRootMoveHold,
  getSessionAllowedHosts,
  isSandboxDisabledThisSession,
  SandboxInitFailedError,
  SandboxManager,
} from '../sandbox/sandbox-adapter.js'
import { getBootstrapSession, runWithNewHostSession } from '../sessionHost.js'
import { resetSettingsCache } from '../settings/settingsCache.js'

afterEach(() => {
  clearSpeculativeChecks()
  clearClassifierApprovals()
  _resetUnsandboxedCommandsDisabledForTesting()
  _resetSandboxCheckRecordsForTesting()
  clearSessionAllowedHostsForTests()
  clearFsReadConfigMemoForTests()
  clearSandboxRootMoveHold()
  _resetSandboxHeldStateForTesting()
  clearRefusedClearToolUsesModelsForTesting()
  resetSentClaudeMdTokensForTesting()
  clearCompactCleanupCallbacksForTesting()
  resetSessionMemoryState()
  resetSessionMemoryCompactConfig()
  resetUnattendedPromptSuggestionStateForTests()
})

function createDeferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (err?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeUserMsg(
  content: string,
  uuid: string,
  originKind?: string,
): UserMessage {
  return {
    type: 'user',
    uuid: uuid as UUID,
    message: { role: 'user', content },
    ...(originKind ? { origin: { kind: originKind } } : {}),
  } as UserMessage
}

function makeAssistantMsg(text: string, uuid: string): AssistantMessage {
  return {
    type: 'assistant',
    uuid: uuid as UUID,
    requestId: `req-${uuid}`,
    message: {
      id: `msg-${uuid}`,
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      stop_sequence: null,
      type: 'message',
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 500,
      },
    },
  } as unknown as AssistantMessage
}

function makeHookContext(messages: Message[]): REPLHookContext {
  let state = {
    ...getDefaultAppState(),
    promptSuggestionEnabled: true,
  }
  const setAppState = (
    updater: (
      prev: ReturnType<typeof getDefaultAppState>,
    ) => ReturnType<typeof getDefaultAppState>,
  ) => {
    state = updater(state)
  }
  const toolUseContext = {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-6',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () => state,
    setAppState,
    setToolJSX: () => {},
    addNotification: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  } as unknown as ToolUseContext

  return {
    messages,
    systemPrompt: [] as unknown as REPLHookContext['systemPrompt'],
    userContext: {},
    systemContext: {},
    toolUseContext,
    querySource: 'repl_main_thread',
  }
}

describe('2.1.331 Multi-Host ALS Isolation: Classifier, Sandbox, Compact & Stop-Hook Services', () => {
  test('speculativeChecks & classifierApprovals isolate concurrent sessions and reject stale CWD after cd', async () => {
    const approvedResult: ClassifierResult = {
      matches: true,
      matchedDescription: 'allow safe build scripts',
      confidence: 'high',
      reason: 'matches build rule in /repo-a',
    }

    await Promise.all([
      runWithNewHostSession(
        { id: 'sess-cls-a', cwd: '/repo-a', originalCwd: '/repo-a' },
        async sessionA => {
          expect(getCwd()).toBe('/repo-a')
          _setSpeculativeClassifierCheckForTesting(
            './scripts/deploy.sh',
            Promise.resolve(approvedResult),
          )
          const clsStateA = _getClassifierApprovalsStateForTesting()
          clsStateA.approvals.set('tu-shared-1', {
            classifier: 'bash',
            matchedRule: 'rule-from-a',
          })
          clsStateA.checking.add('tu-checking-1')

          // Yield across microtasks while Session B attempts to steal approval
          await Promise.resolve()

          expect(clsStateA.approvals.get('tu-shared-1')?.matchedRule).toBe(
            'rule-from-a',
          )
          expect(isClassifierChecking('tu-checking-1')).toBe(true)
          expect(
            peekSpeculativeClassifierCheck('./scripts/deploy.sh'),
          ).toBeDefined()

          // Changing CWD inside Session A invalidates speculative approval stamped for /repo-a
          sessionA.setCwd('/repo-a/untrusted-subdir')
          expect(getCwd()).toBe('/repo-a/untrusted-subdir')
          expect(
            peekSpeculativeClassifierCheck('./scripts/deploy.sh'),
          ).toBeUndefined()
          expect(
            consumeSpeculativeClassifierCheck('./scripts/deploy.sh'),
          ).toBeUndefined()

          // Re-seed in /repo-a/untrusted-subdir and verify runWithCwd mismatch also rejects
          _setSpeculativeClassifierCheckForTesting(
            'npm test',
            Promise.resolve(approvedResult),
          )
          runWithCwd('/repo-a/other', () => {
            expect(peekSpeculativeClassifierCheck('npm test')).toBeUndefined()
          })
          // Entry was only peeked, so switching back to matching CWD consumes it cleanly
          const consumed = await consumeSpeculativeClassifierCheck('npm test')
          expect(consumed).toEqual(approvedResult)

          deleteClassifierApproval('tu-shared-1')
          expect(clsStateA.approvals.has('tu-shared-1')).toBe(false)
        },
      ),
      runWithNewHostSession(
        { id: 'sess-cls-b', cwd: '/repo-b', originalCwd: '/repo-b' },
        async () => {
          expect(getCwd()).toBe('/repo-b')
          // Session B must NEVER see or consume Session A's speculative check or approvals
          expect(
            peekSpeculativeClassifierCheck('./scripts/deploy.sh'),
          ).toBeUndefined()
          expect(
            consumeSpeculativeClassifierCheck('./scripts/deploy.sh'),
          ).toBeUndefined()
          const clsStateB = _getClassifierApprovalsStateForTesting()
          expect(clsStateB.approvals.get('tu-shared-1')).toBeUndefined()
          expect(isClassifierChecking('tu-checking-1')).toBe(false)

          // Session B records its own independent approval for the same toolUseID
          clsStateB.approvals.set('tu-shared-1', {
            classifier: 'bash',
            matchedRule: 'rule-from-b',
          })
          await Promise.resolve()
          expect(clsStateB.approvals.get('tu-shared-1')?.matchedRule).toBe(
            'rule-from-b',
          )
        },
      ),
    ])

    // Also verify public feature-gated APIs under compile-time --feature=BASH_CLASSIFIER & TRANSCRIPT_CLASSIFIER
    const repoRoot = join(import.meta.dir, '../../..')
    const sub = Bun.spawnSync(
      [
        process.execPath,
        '--feature=BASH_CLASSIFIER',
        '--feature=TRANSCRIPT_CLASSIFIER',
        '-e',
        `
        import { runWithNewHostSession } from './src/utils/sessionHost.js'
        import {
          setClassifierApproval,
          getClassifierApproval,
          setYoloClassifierApproval,
          getYoloClassifierApproval,
          setClassifierChecking,
          clearClassifierChecking,
          isClassifierChecking,
        } from './src/utils/classifierApprovals.js'

        await Promise.all([
          runWithNewHostSession({ id: 'sub-a', cwd: '/repo-a' }, async () => {
            setClassifierApproval('tu-1', 'bash-rule-a')
            setYoloClassifierApproval('tu-2', 'yolo-reason-a')
            setClassifierChecking('tu-check')
            await Promise.resolve()
            if (getClassifierApproval('tu-1') !== 'bash-rule-a') throw new Error('mismatch a1')
            if (getYoloClassifierApproval('tu-2') !== 'yolo-reason-a') throw new Error('mismatch a2')
            if (!isClassifierChecking('tu-check')) throw new Error('mismatch a3')
            clearClassifierChecking('tu-check')
            if (isClassifierChecking('tu-check')) throw new Error('mismatch a4')
          }),
          runWithNewHostSession({ id: 'sub-b', cwd: '/repo-b' }, async () => {
            if (getClassifierApproval('tu-1') !== undefined) throw new Error('leaked bash approval to b')
            if (getYoloClassifierApproval('tu-2') !== undefined) throw new Error('leaked yolo approval to b')
            if (isClassifierChecking('tu-check')) throw new Error('leaked checking to b')
            setClassifierApproval('tu-1', 'bash-rule-b')
            await Promise.resolve()
            if (getClassifierApproval('tu-1') !== 'bash-rule-b') throw new Error('mismatch b1')
          }),
        ])
        `,
      ],
      { cwd: repoRoot, stderr: 'pipe', stdout: 'pipe' },
    )
    expect(sub.exitCode).toBe(0)
  })

  test('sandbox-adapter & shouldUseSandbox isolate sessionAllowedHosts, sandboxDisabledThisSession, fsReadConfigMemo, askCallback, and unsandboxedCommandsDisabled across hosts', async () => {
    const tempConfigDir = mkdtempSync(join(tmpdir(), 'als-sbx-331-'))
    mkdirSync(tempConfigDir, { recursive: true })
    writeFileSync(
      join(tempConfigDir, 'settings.json'),
      JSON.stringify({ sandbox: { enabled: true } }),
    )
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tempConfigDir
    resetSettingsCache()

    const origGetFsReadConfig = BaseSandboxManager.getFsReadConfig
    const origCheckDeps = BaseSandboxManager.checkDependencies
    let hostReadCounter = 0
    BaseSandboxManager.getFsReadConfig = () => {
      hostReadCounter += 1
      return {
        denyOnly: [`/secret-host-${hostReadCounter}`],
        allowWithinDeny: [],
      }
    }
    BaseSandboxManager.checkDependencies = () => ({
      errors: [],
      warnings: [],
    })

    try {
      const askA = async () => true
      const askB = async () => false

      await Promise.all([
        runWithNewHostSession(
          {
            id: 'sess-sbx-a',
            cwd: '/workspace-a',
            originalCwd: '/workspace-a',
          },
          async () => {
            addSessionAllowedHost('api.host-a.internal')
            disableUnsandboxedCommandsForMcpServe()
            recordSandboxStateAtCheck(
              'tu-sbx-1',
              { command: 'echo a', dangerouslyDisableSandbox: false },
              true,
            )
            captureSandboxRootMoveHold()
            expect(getSandboxRootMoveHold()).toBeDefined()

            // Simulate sandbox init failure disabling sandbox on Host A only
            _setSandboxInitFailureForTesting('host-a bwrap unavailable')
            await SandboxManager.initialize(askA)
            expect(getSandboxInitFailureReason()).toBe(
              'host-a bwrap unavailable',
            )

            // Populate Host A's fsReadConfigMemo
            const readCfgA1 = SandboxManager.getFsReadConfig()
            const readCfgA2 = SandboxManager.getFsReadConfig()
            expect(readCfgA1).toBe(readCfgA2)
            expect(readCfgA1.denyOnly).toEqual(['/secret-host-1'])

            if (SandboxManager.isSupportedPlatform()) {
              let caught: unknown
              try {
                await ensureInitializedForWrap({ keepsSandboxOn: false })
              } catch (err) {
                caught = err
              }
              expect(caught).toBeInstanceOf(SandboxInitFailedError)
              expect(isSandboxDisabledThisSession()).toBe(true)
              expect(SandboxManager.isSandboxingEnabled()).toBe(false)
            }

            await Promise.resolve()

            expect([...getSessionAllowedHosts()]).toEqual([
              'api.host-a.internal',
            ])
            const runtimeCfgA = convertToSandboxRuntimeConfig({})
            expect(runtimeCfgA.network.allowedDomains).toContain(
              'api.host-a.internal',
            )
            expect(runtimeCfgA.network.allowedDomains).not.toContain(
              'api.host-b.internal',
            )
            expect(isUnsandboxedCommandsDisabled()).toBe(true)
            expect(getLastSandboxAskCallbackForTests()).toBe(askA)
            expect(
              shouldKeepRewrittenCommandInSandbox('tu-sbx-1', {
                command: 'echo rewritten',
              }),
            ).toBe(true)
          },
        ),
        runWithNewHostSession(
          {
            id: 'sess-sbx-b',
            cwd: '/workspace-b',
            originalCwd: '/workspace-b',
          },
          async () => {
            await Promise.resolve()

            // Host B never sees Host A's allowed hosts, MCP-serve unsandboxed lock, rootMoveHold, or init failure
            expect([...getSessionAllowedHosts()]).toEqual([])
            expect(isUnsandboxedCommandsDisabled()).toBe(false)
            expect(isSandboxDisabledThisSession()).toBe(false)
            expect(getSandboxInitFailureReason()).toBeUndefined()
            expect(getSandboxRootMoveHold()).toBeUndefined()
            if (SandboxManager.isSupportedPlatform()) {
              expect(SandboxManager.isSandboxingEnabled()).toBe(true)
            }
            expect(
              shouldKeepRewrittenCommandInSandbox('tu-sbx-1', {
                command: 'echo rewritten',
              }),
            ).toBe(false)

            addSessionAllowedHost('api.host-b.internal')
            _setSandboxInitFailureForTesting('noop-prevent-os-proxy')
            await SandboxManager.initialize(askB)
            _setSandboxInitFailureForTesting(undefined)
            expect(getLastSandboxAskCallbackForTests()).toBe(askB)

            const runtimeCfgB = convertToSandboxRuntimeConfig({})
            expect(runtimeCfgB.network.allowedDomains).toContain(
              'api.host-b.internal',
            )
            expect(runtimeCfgB.network.allowedDomains).not.toContain(
              'api.host-a.internal',
            )

            // Host B computes its own fsReadConfigMemo instead of reusing Host A's memo
            const readCfgB = SandboxManager.getFsReadConfig()
            expect(readCfgB.denyOnly).toEqual(['/secret-host-2'])
          },
        ),
      ])
    } finally {
      BaseSandboxManager.getFsReadConfig = origGetFsReadConfig
      BaseSandboxManager.checkDependencies = origCheckDeps
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
      resetSettingsCache()
      rmSync(tempConfigDir, { recursive: true, force: true })
    }
  })

  test('apiMicrocompact, autoCompact, postCompactCleanup, sessionMemoryUtils & sessionMemoryCompact isolate state across sessions', async () => {
    let cleanupAFired = 0
    let cleanupBFired = 0

    await Promise.all([
      runWithNewHostSession(
        { id: 'sess-compact-a', cwd: '/proj-a', originalCwd: '/proj-a' },
        async () => {
          recordClearToolUsesRefusal('claude-sonnet-4-6[1m]')
          recordSentClaudeMdTokens(100)
          registerCompactCleanup(() => {
            cleanupAFired += 1
          })
          _getClassifierApprovalsStateForTesting().approvals.set(
            'tu-compact-a',
            { classifier: 'bash', matchedRule: 'rule-a' },
          )
          _setSpeculativeClassifierCheckForTesting(
            'ls -la',
            Promise.resolve({
              matches: true,
              confidence: 'high',
              reason: 'ok',
            }),
          )

          setLastSummarizedMessageId('msg-a-42')
          markExtractionStarted()
          recordExtractionTokenCount(12_000)
          markSessionMemoryInitialized()
          setSessionMemoryConfig({ minimumTokensBetweenUpdate: 4_000 })
          setSessionMemoryCompactConfig({ minTokens: 15_000 })

          await Promise.resolve()

          expect(hasModelRefusedClearToolUses('claude-sonnet-4-6')).toBe(true)
          expect(getLastSentClaudeMdTokens()).toBe(100)
          const growthA = await getClaudeMdGrowthTokens('x'.repeat(2_000))
          expect(growthA).toBeGreaterThan(0)
          expect(getLastSummarizedMessageId()).toBe('msg-a-42')
          expect(isSessionMemoryInitialized()).toBe(true)
          expect(hasMetUpdateThreshold(16_500)).toBe(true)
          expect(getSessionMemoryConfig().minimumTokensBetweenUpdate).toBe(
            4_000,
          )
          expect(getSessionMemoryCompactConfig().minTokens).toBe(15_000)

          // Compacting Session A must fire ONLY Session A's cleanup callbacks
          runPostCompactCleanup('sdk')
          expect(cleanupAFired).toBe(1)
          expect(cleanupBFired).toBe(0)
          expect(
            _getClassifierApprovalsStateForTesting().approvals.has(
              'tu-compact-a',
            ),
          ).toBe(false)
          expect(peekSpeculativeClassifierCheck('ls -la')).toBeUndefined()

          markExtractionCompleted()
        },
      ),
      runWithNewHostSession(
        { id: 'sess-compact-b', cwd: '/proj-b', originalCwd: '/proj-b' },
        async () => {
          registerCompactCleanup(() => {
            cleanupBFired += 1
          })
          _getClassifierApprovalsStateForTesting().approvals.set(
            'tu-compact-b',
            { classifier: 'bash', matchedRule: 'rule-b' },
          )
          _setSpeculativeClassifierCheckForTesting(
            'git status',
            Promise.resolve({
              matches: true,
              confidence: 'high',
              reason: 'ok',
            }),
          )

          await Promise.resolve()

          // Session B sees clean defaults — zero bleed from Session A
          expect(hasModelRefusedClearToolUses('claude-sonnet-4-6')).toBe(false)
          expect(getLastSentClaudeMdTokens()).toBeUndefined()
          expect(await getClaudeMdGrowthTokens('x'.repeat(2_000))).toBe(0)
          expect(getLastSummarizedMessageId()).toBeUndefined()
          expect(isSessionMemoryInitialized()).toBe(false)
          expect(getSessionMemoryConfig().minimumTokensBetweenUpdate).toBe(
            5_000,
          )
          expect(getSessionMemoryCompactConfig().minTokens).toBe(10_000)

          // Yield again so Session A runs postCompactCleanup while Session B stays live
          await Promise.resolve()
          expect(cleanupBFired).toBe(0)
          expect(
            _getClassifierApprovalsStateForTesting().approvals.get(
              'tu-compact-b',
            )?.matchedRule,
          ).toBe('rule-b')
          expect(peekSpeculativeClassifierCheck('git status')).toBeDefined()
        },
      ),
    ])
  })

  test('promptSuggestion, extractMemories & autoDream isolate abort controllers, cursors, trailing ALS context, and scan throttles across concurrent sessions', async () => {
    const prevUserType = process.env.USER_TYPE
    process.env.USER_TYPE = 'ant'

    try {
      const suggestionDeferredA = createDeferred<{
        suggestion: string | null
        generationRequestId: string | null
      }>()
      const suggestionDeferredB = createDeferred<{
        suggestion: string | null
        generationRequestId: string | null
      }>()

      let suggestionTextA = null as string | null
      let controllerA: AbortController | null = null
      let controllerB: AbortController | null = null

      const baseTurnsA: Message[] = [
        makeUserMsg('fix bug in parser', 'a-u1'),
        makeAssistantMsg('fixed parser bug', 'a-a1'),
        makeUserMsg('update snapshots', 'a-u2'),
        makeAssistantMsg('updated snapshots', 'a-a2'),
      ]
      const baseTurnsB: Message[] = [
        makeUserMsg('refactor router', 'b-u1'),
        makeAssistantMsg('refactored router', 'b-a1'),
        makeUserMsg('add docs', 'b-u2'),
        makeAssistantMsg('added docs', 'b-a2'),
      ]

      const mockUsage = (inputTokens: number, outputTokens: number) => ({
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
        service_tier: 'standard' as const,
        cache_creation: {
          ephemeral_1h_input_tokens: 0,
          ephemeral_5m_input_tokens: 0,
        },
        inference_geo: '',
        iterations: [],
        speed: 'standard' as const,
      })

      // Verify standalone factories work independently
      const standaloneExtractor = createMemoryExtractor({
        isGateEnabledFn: () => true,
        isAutoMemoryEnabledFn: () => true,
        isRemoteModeFn: () => false,
        scanMemoryFilesFn: async () => [],
        runForkedAgentFn: async () => ({
          messages: [],
          totalUsage: mockUsage(10, 5),
        }),
      })
      expect(standaloneExtractor.getStateForTesting().inProgress).toBe(false)
      const standaloneDream = createAutoDreamRunner({
        isGateOpenFn: () => false,
      })
      expect(standaloneDream.getStateForTesting().lastSessionScanAt).toBe(0)

      // Concurrent multi-host session execution for PromptSuggestion, ExtractMemories & AutoDream
      const extractFirstRunA = createDeferred<void>()
      const observedSessionIdsInExtractA: string[] = []
      const observedSessionIdsInExtractB: string[] = []

      await Promise.all([
        runWithNewHostSession(
          { id: 'sess-bg-a', cwd: '/bg-a', originalCwd: '/bg-a' },
          async sessionA => {
            const ctxA = makeHookContext(baseTurnsA)
            const promptPromiseA = executePromptSuggestion(ctxA, {
              generateSuggestionFn: async abortController => {
                controllerA = abortController
                return suggestionDeferredA.promise
              },
            })

            expect(getPromptSuggestionAbortControllerForTests()).not.toBeNull()

            // Unattended turn backoff state in Session A
            const unattendedMsgs = [
              makeUserMsg('scheduled tick', 'a-sched', 'scheduled'),
            ]
            for (let i = 0; i < 9; i++) {
              shouldBackOffUnattendedPromptSuggestion(unattendedMsgs)
            }
            // 10th unattended turn backs off in Session A (>8 and not power of 2)
            expect(
              shouldBackOffUnattendedPromptSuggestion(unattendedMsgs),
            ).toBe(true)

            // Initialize extractMemories & autoDream in Session A
            let callCountA = 0
            initExtractMemories({
              isGateEnabledFn: () => true,
              isAutoMemoryEnabledFn: () => true,
              isRemoteModeFn: () => false,
              scanMemoryFilesFn: async () => [],
              runForkedAgentFn: async () => {
                callCountA += 1
                observedSessionIdsInExtractA.push(getBootstrapSession().id)
                if (callCountA === 1) {
                  await extractFirstRunA.promise
                }
                return {
                  messages: [],
                  totalUsage: mockUsage(10, 5),
                }
              },
            })

            initAutoDream({
              isGateOpenFn: () => true,
              getConfigFn: () => ({ minHours: 1, minSessions: 5 }),
              readLastConsolidatedAtFn: async () => Date.now() - 10 * 3_600_000,
              listSessionsTouchedSinceFn: async () => ['s1'],
            })

            // Start extract run 1 in Session A (suspends inside runForkedAgentFn)
            const extractRun1 = executeExtractMemories(ctxA)
            await Promise.resolve()
            await Promise.resolve()
            expect(getMemoryExtractorStateForTesting().inProgress).toBe(true)

            // Coalesce a second call in Session A while run 1 is in progress
            const trailingTurnsA: Message[] = [
              ...baseTurnsA,
              makeUserMsg('remember we use bun test', 'a-u3'),
              makeAssistantMsg('noted', 'a-a3'),
            ]
            await executeExtractMemories(makeHookContext(trailingTurnsA))
            expect(getMemoryExtractorStateForTesting().hasPendingContext).toBe(
              true,
            )

            // Trigger autoDream scan throttle in Session A
            await executeAutoDream(ctxA)
            expect(
              getAutoDreamStateForTesting().lastSessionScanAt,
            ).toBeGreaterThan(0)

            // Wait until Session B has started & aborted its own prompt suggestion
            await new Promise(r => setTimeout(r, 15))

            // Session A's prompt suggestion controller MUST still be alive!
            expect(controllerA).not.toBeNull()
            expect(controllerA!.signal.aborted).toBe(false)

            suggestionDeferredA.resolve({
              suggestion: 'run the tests',
              generationRequestId: 'gen-a',
            })
            await promptPromiseA
            suggestionTextA =
              ctxA.toolUseContext.getAppState().promptSuggestion.text

            // Release extract run 1 -> trailing extraction runs in .finally under Session A's ALS!
            extractFirstRunA.resolve()
            await drainPendingExtraction(5_000)
            await extractRun1

            expect(observedSessionIdsInExtractA).toEqual([
              sessionA.id,
              sessionA.id,
            ])
            expect(
              getMemoryExtractorStateForTesting().lastMemoryMessageUuid,
            ).toBe('a-a3')
          },
        ),
        runWithNewHostSession(
          { id: 'sess-bg-b', cwd: '/bg-b', originalCwd: '/bg-b' },
          async sessionB => {
            await Promise.resolve()

            // Session B starts with clean unattended state, clean autoDream scan timestamp, and no abort controller
            expect(getPromptSuggestionAbortControllerForTests()).toBeNull()
            const unattendedMsgsB = [
              makeUserMsg('scheduled tick b', 'b-sched', 'scheduled'),
            ]
            expect(
              shouldBackOffUnattendedPromptSuggestion(unattendedMsgsB),
            ).toBe(false)
            markPersonActivityForPromptSuggestion(123_456)

            const ctxB = makeHookContext(baseTurnsB)
            const promptPromiseB = executePromptSuggestion(ctxB, {
              generateSuggestionFn: async abortController => {
                controllerB = abortController
                return suggestionDeferredB.promise
              },
            })

            await Promise.resolve()
            expect(controllerB).not.toBeNull()

            // Session B aborts its prompt suggestion — MUST NOT abort Session A!
            abortPromptSuggestion()
            expect(controllerB!.signal.aborted).toBe(true)
            expect(getPromptSuggestionAbortControllerForTests()).toBeNull()
            suggestionDeferredB.resolve({
              suggestion: 'push changes',
              generationRequestId: 'gen-b',
            })
            await promptPromiseB

            // Session B's autoDream & extractMemories state are untouched by Session A
            expect(getAutoDreamStateForTesting().lastSessionScanAt).toBe(0)
            expect(getMemoryExtractorStateForTesting().inProgress).toBe(false)
            expect(
              getMemoryExtractorStateForTesting().lastMemoryMessageUuid,
            ).toBeUndefined()

            initExtractMemories({
              isGateEnabledFn: () => true,
              isAutoMemoryEnabledFn: () => true,
              isRemoteModeFn: () => false,
              scanMemoryFilesFn: async () => [],
              runForkedAgentFn: async () => {
                observedSessionIdsInExtractB.push(getBootstrapSession().id)
                return {
                  messages: [],
                  totalUsage: mockUsage(8, 4),
                }
              },
            })

            await executeExtractMemories(ctxB)
            expect(observedSessionIdsInExtractB).toEqual([sessionB.id])
            expect(
              getMemoryExtractorStateForTesting().lastMemoryMessageUuid,
            ).toBe('b-a2')
          },
        ),
      ])

      expect(suggestionTextA).toBe('run the tests')
    } finally {
      if (prevUserType === undefined) {
        delete process.env.USER_TYPE
      } else {
        process.env.USER_TYPE = prevUserType
      }
    }
  })
})
