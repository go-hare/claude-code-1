import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import {
  clearHandbackFollowUpDropped,
  clearHandbackLaterReportRefused,
  getHandbackFollowUpDropped,
  markHandbackFollowUpDropped,
  markHandbackLaterReportRefused,
  wasHandbackLaterReportRefused,
} from '@claude-code/builtin-tools/tools/AgentTool/agentToolUtils.js'
import {
  isForkSubagentForceAsyncEnabled,
  resetForkSubagentProductSource,
  resolveForkSubagentProductSource,
} from '@claude-code/builtin-tools/tools/AgentTool/forkSubagent.js'
import {
  getSessionId,
  regenerateSessionId,
  switchSession,
} from 'src/bootstrap/state.js'
import {
  clearSystemPromptSections,
  resolveStaticSystemPromptSection,
  resolveSystemPromptSections,
  setPromptSectionInvalidator,
  setPromptSectionResolver,
  systemPromptSection,
} from 'src/constants/systemPromptSections.js'
import {
  getLastAnnouncedDeferredTools,
  maybeAppendDeferredToolsAnnouncement,
  resetLastAnnouncedDeferredTools,
} from 'src/services/api/claude.js'
import { getDefaultAppState } from 'src/state/AppStateStore.js'
import type { Tool, Tools, ToolUseContext } from 'src/Tool.js'
import { asSessionId } from 'src/types/ids.js'
import {
  forgetSentSkillNames,
  getSentSkillAttachmentState,
  resetSentSkillNames,
  suppressNextSkillDiscovery,
  suppressNextSkillListing,
} from 'src/utils/attachments.js'
import { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache.js'
import {
  type CacheSafeParams,
  createCacheSafeParams,
  getLastCacheSafeParams,
  runForkedAgent,
  saveCacheSafeParams,
} from 'src/utils/forkedAgent.js'
import { createUserMessage } from 'src/utils/messages.js'
import {
  exitSessionContext,
  getActiveSessionFromAls,
  runWithNewHostSession,
  runWithSession,
  runWithSubconversationContext,
} from 'src/utils/sessionRoot.js'
import {
  assertCanSpawnSubagent,
  getConcurrentSubagents,
  getTotalAgentSpawns,
  getWebSearchCalls,
  incrementWebSearchCalls,
  resetSessionSpawnCaps,
  takeConcurrencySlot,
} from 'src/utils/sessionSpawnCaps.js'
import {
  checkUnchangedImageRereadLimit,
  noteImageMediaStripped,
  resetImageRereadState,
  UNCHANGED_IMAGE_REREAD_LIMIT_MESSAGE,
} from 'src/utils/subagentCacheEvict.js'
import {
  clearHandbackDeliveriesForTests,
  flagHandbackSession,
  getHandbackDelivery,
  getHandbackSessionContract,
  recordHandbackDelivery,
  setHandbackSessionContract,
} from 'src/utils/subagentHandback.js'
import {
  recordSubagentSpawn,
  recordSubagentSpawnRefused,
  snapshotSubagentSpawnLedger,
  subagentSpawnLedgerOf,
} from 'src/utils/subagentSpawnLedger.js'
import { asSystemPrompt } from 'src/utils/systemPromptType.js'
import {
  setPendingThinkingStripped,
  takePendingThinkingStripped,
  thinkingStrippedAttachment,
} from 'src/utils/thinking.js'

function makeMinimalToolUseContext(
  abortController: AbortController,
  onGetAppState?: () => void,
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
      ideInstallationStatus: null,
      isNonInteractiveSession: true,
      customSystemPrompt: undefined,
      appendSystemPrompt: undefined,
      agentDefinitions: { activeAgents: [], allAgents: [] },
      theme: 'dark',
    },
    abortController,
    readFileState: createFileStateCacheWithSizeLimit(10),
    getAppState: () => {
      onGetAppState?.()
      return appState
    },
    setAppState: () => {},
    setToolPermissionContext: () => {},
    setSessionToolPermissionContext: () => {},
    nestedMemoryAttachmentTriggers: new Set(),
    loadedNestedMemoryPaths: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
    messages: [],
    setMessages: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    pushApiMetricsEntry: () => {},
  } as unknown as ToolUseContext
}

function makeDummyCacheSafeParams(label: string): CacheSafeParams {
  const ac = new AbortController()
  ac.abort()
  return {
    systemPrompt: asSystemPrompt([`system-${label}`]),
    userContext: { label },
    systemContext: {},
    toolUseContext: makeMinimalToolUseContext(ac),
    forkContextMessages: [createUserMessage({ content: `hello-${label}` })],
  }
}

describe('2.1.331 ALS multi-host isolation: ForkedAgent, Query, Thinking & Subagent Slots', () => {
  describe('forkedAgent: saveCacheSafeParams / getLastCacheSafeParams & detached runForkedAgent ALS', () => {
    test('isolates lastCacheSafeParams across concurrent host sessions and shares across withProject forks', async () => {
      const paramsA = makeDummyCacheSafeParams('session-A')
      const paramsB = makeDummyCacheSafeParams('session-B')

      const [seenA, seenB] = await Promise.all([
        runWithNewHostSession({ id: randomUUID() }, async sessionA => {
          expect(getLastCacheSafeParams()).toBeNull()
          saveCacheSafeParams(paramsA)
          await Bun.sleep(10)

          const forkA = sessionA.withProject({ cwd: '/tmp' })
          const seenInFork = runWithSession(forkA, () =>
            getLastCacheSafeParams(),
          )
          expect(seenInFork).toBe(paramsA)

          return getLastCacheSafeParams()
        }),
        runWithNewHostSession({ id: randomUUID() }, async () => {
          await Bun.sleep(5)
          // Session A's params must not leak into Session B
          expect(getLastCacheSafeParams()).toBeNull()
          saveCacheSafeParams(paramsB)
          expect(getLastCacheSafeParams()).toBe(paramsB)
          saveCacheSafeParams(null)
          expect(getLastCacheSafeParams()).toBeNull()
          return paramsB
        }),
      ])

      expect(seenA).toBe(paramsA)
      expect(seenB).toBe(paramsB)
    })

    test('invalidates getLastCacheSafeParams when sessionId changes via regenerateSessionId, switchSession, or subconversation overlay', () => {
      runWithNewHostSession({ id: randomUUID() }, () => {
        const params1 = makeDummyCacheSafeParams('before-regenerate')
        saveCacheSafeParams(params1)
        expect(getLastCacheSafeParams()).toBe(params1)

        // Subconversation with a distinct sessionId must not read parent's params
        const subSeen = runWithSubconversationContext(
          { sessionId: randomUUID() },
          () => getLastCacheSafeParams(),
        )
        expect(subSeen).toBeNull()
        // Outer session still sees its own params
        expect(getLastCacheSafeParams()).toBe(params1)

        // regenerateSessionId invalidates cached params for the prior sessionId
        regenerateSessionId()
        expect(getLastCacheSafeParams()).toBeNull()

        // Re-save under the new sessionId, then switchSession to another id
        const params2 = makeDummyCacheSafeParams('before-switch')
        saveCacheSafeParams(params2)
        expect(getLastCacheSafeParams()).toBe(params2)

        switchSession(asSessionId(randomUUID()))
        expect(getLastCacheSafeParams()).toBeNull()
      })
    })

    test('runForkedAgent restores originating ALS session when invoked from a detached callback', async () => {
      let capturedSessionAId = ''
      let capturedSessionBId = ''

      const savedParamsA = runWithNewHostSession(
        { id: randomUUID() },
        sessionA => {
          capturedSessionAId = sessionA.id
          const ac = new AbortController()
          ac.abort()
          const ctx = makeMinimalToolUseContext(ac)
          const params = createCacheSafeParams({
            systemPrompt: asSystemPrompt(['test-A']),
            userContext: {},
            systemContext: {},
            toolUseContext: ctx,
            messages: [],
          })
          saveCacheSafeParams(params)
          return params
        },
      )

      const spreadParamsB = runWithNewHostSession(
        { id: randomUUID() },
        sessionB => {
          capturedSessionBId = sessionB.id
          const ac = new AbortController()
          ac.abort()
          const ctx = makeMinimalToolUseContext(ac)
          const base = createCacheSafeParams({
            systemPrompt: asSystemPrompt(['test-B']),
            userContext: {},
            systemContext: {},
            toolUseContext: ctx,
            messages: [],
          })
          // Spread copy (common pattern in post-sampling hooks) still preserves session via toolUseContext WeakMap
          return { ...base, userContext: { cloned: '1' } }
        },
      )

      // Execute both runForkedAgent calls completely outside any ALS session (simulating detached timers/callbacks)
      await exitSessionContext(async () => {
        expect(getActiveSessionFromAls()).toBeUndefined()

        let activeSessionIdDuringForkA: string | undefined
        let getSessionIdDuringForkA: string | undefined
        let activeSessionIdDuringForkB: string | undefined
        let getSessionIdDuringForkB: string | undefined

        const acA = new AbortController()
        acA.abort()
        const acB = new AbortController()
        acB.abort()

        await Promise.all([
          runForkedAgent({
            promptMessages: [createUserMessage({ content: 'fork task A' })],
            cacheSafeParams: savedParamsA,
            canUseTool: async () => ({
              behavior: 'allow',
              updatedInput: {},
            }),
            querySource: 'session_memory',
            forkLabel: 'detached_als_test_a',
            skipTranscript: true,
            overrides: {
              abortController: acA,
              getAppState: () => {
                activeSessionIdDuringForkA = getActiveSessionFromAls()?.id
                getSessionIdDuringForkA = getSessionId()
                return getDefaultAppState()
              },
            },
          }),
          runForkedAgent({
            promptMessages: [createUserMessage({ content: 'fork task B' })],
            cacheSafeParams: spreadParamsB,
            canUseTool: async () => ({
              behavior: 'allow',
              updatedInput: {},
            }),
            querySource: 'session_memory',
            forkLabel: 'detached_als_test_b',
            skipTranscript: true,
            overrides: {
              abortController: acB,
              getAppState: () => {
                activeSessionIdDuringForkB = getActiveSessionFromAls()?.id
                getSessionIdDuringForkB = getSessionId()
                return getDefaultAppState()
              },
            },
          }),
        ])

        expect(activeSessionIdDuringForkA).toBe(capturedSessionAId)
        expect(getSessionIdDuringForkA).toBe(capturedSessionAId)
        expect(activeSessionIdDuringForkB).toBe(capturedSessionBId)
        expect(getSessionIdDuringForkB).toBe(capturedSessionBId)
      })
    })
  })

  describe('claude.ts: lastAnnouncedDeferredTools isolation across sessions', () => {
    test('Session A announcing deferred tools on Turn 1 does not suppress <available-deferred-tools> on Session B Turn 1', async () => {
      const fakeTools = [
        {
          name: 'mcp__alpha__query_docs',
          description: 'Query alpha docs',
        },
        {
          name: 'mcp__beta__create_issue',
          description: 'Create beta issue',
        },
      ] as unknown as Tools
      const deferredNames = new Set([
        'mcp__alpha__query_docs',
        'mcp__beta__create_issue',
      ])

      const [resA, resB] = await Promise.all([
        runWithNewHostSession({ id: randomUUID() }, async () => {
          resetLastAnnouncedDeferredTools()
          const baseMsgs = [createUserMessage({ content: 'turn 1 A' })]
          const turn1 = maybeAppendDeferredToolsAnnouncement(
            baseMsgs,
            fakeTools,
            deferredNames,
          )
          // Turn 1 in Session A injects <available-deferred-tools>
          expect(turn1.length).toBe(2)
          expect(String(turn1[1]?.message.content)).toContain(
            '<available-deferred-tools>',
          )
          expect(getLastAnnouncedDeferredTools().size).toBe(2)

          await Bun.sleep(10)

          // Turn 2 in Session A with same tools does NOT re-inject
          const turn2 = maybeAppendDeferredToolsAnnouncement(
            baseMsgs,
            fakeTools,
            deferredNames,
          )
          expect(turn2.length).toBe(1)
          return turn1.length
        }),
        runWithNewHostSession({ id: randomUUID() }, async () => {
          await Bun.sleep(5)
          // Session B starts after Session A already announced on Turn 1!
          expect(getLastAnnouncedDeferredTools().size).toBe(0)
          const baseMsgs = [createUserMessage({ content: 'turn 1 B' })]
          const turn1B = maybeAppendDeferredToolsAnnouncement(
            baseMsgs,
            fakeTools,
            deferredNames,
          )
          // Session B MUST still receive <available-deferred-tools> on its Turn 1
          expect(turn1B.length).toBe(2)
          expect(String(turn1B[1]?.message.content)).toContain(
            '<available-deferred-tools>',
          )

          // Adding a 3rd deferred tool in Session B triggers re-announcement only in Session B
          const expandedTools = [
            ...fakeTools,
            {
              name: 'mcp__gamma__deploy',
              description: 'Deploy gamma',
            } as unknown as Tool,
          ]
          const expandedDeferred = new Set([
            ...deferredNames,
            'mcp__gamma__deploy',
          ])
          const turn2B = maybeAppendDeferredToolsAnnouncement(
            baseMsgs,
            expandedTools,
            expandedDeferred,
          )
          expect(turn2B.length).toBe(2)
          expect(getLastAnnouncedDeferredTools().size).toBe(3)
          return turn1B.length
        }),
      ])

      expect(resA).toBe(2)
      expect(resB).toBe(2)
    })
  })

  describe('thinking.ts: pendingThinkingStripped isolation across concurrent sessions', () => {
    test('Session B calling takePendingThinkingStripped never steals Session A thinking_stripped attachment', async () => {
      const attA = thinkingStrippedAttachment('partial', {
        messageId: 'msg_session_a',
        thinkingIndex: 2,
      })

      await Promise.all([
        runWithNewHostSession({ id: randomUUID() }, async () => {
          setPendingThinkingStripped(attA)
          await Bun.sleep(15)
          // Session A must still receive its own pending attachment after Session B drained
          expect(takePendingThinkingStripped()).toEqual(attA)
          expect(takePendingThinkingStripped()).toBeUndefined()
        }),
        runWithNewHostSession({ id: randomUUID() }, async () => {
          await Bun.sleep(5)
          // Session B sees nothing from Session A
          expect(takePendingThinkingStripped()).toBeUndefined()
          const attB = thinkingStrippedAttachment('all')
          setPendingThinkingStripped(attB)
          expect(takePendingThinkingStripped()).toEqual(attB)
        }),
      ])
    })
  })

  describe('attachments.ts: sentSkillNames, suppressNext, and suppressNextDiscovery isolation', () => {
    test('isolates sentSkillNames, suppressNextSkillListing, suppressNextSkillDiscovery, and resetSentSkillNames per root session', async () => {
      await Promise.all([
        runWithNewHostSession({ id: randomUUID() }, async sessionA => {
          const stateA = getSentSkillAttachmentState()
          stateA.sentSkillNames.set('', new Set(['commit', 'review-pr']))
          suppressNextSkillListing()
          suppressNextSkillDiscovery()

          await Bun.sleep(15)

          // Session B calling resetSentSkillNames must not wipe Session A
          expect(stateA.suppressNext).toBe(true)
          expect(stateA.suppressNextDiscovery).toBe(true)
          expect([...(stateA.sentSkillNames.get('') ?? [])]).toEqual([
            'commit',
            'review-pr',
          ])

          // withProject fork shares the root session's skill attachment state
          const forkA = sessionA.withProject({ cwd: '/tmp' })
          runWithSession(forkA, () => {
            forgetSentSkillNames(['commit'])
          })
          expect([...(stateA.sentSkillNames.get('') ?? [])]).toEqual([
            'review-pr',
          ])
        }),
        runWithNewHostSession({ id: randomUUID() }, async () => {
          await Bun.sleep(5)
          const stateB = getSentSkillAttachmentState()
          expect(stateB.suppressNext).toBe(false)
          expect(stateB.suppressNextDiscovery).toBe(false)
          expect(stateB.sentSkillNames.size).toBe(0)

          stateB.sentSkillNames.set('', new Set(['other-skill']))
          suppressNextSkillListing()
          resetSentSkillNames()

          expect(stateB.suppressNext).toBe(false)
          expect(stateB.sentSkillNames.size).toBe(0)
        }),
      ])
    })
  })

  describe('systemPromptSections.ts: resolver, invalidator, and generation isolation', () => {
    test('clearSystemPromptSections and setPromptSectionResolver in Session A never clobber or invalidate in-flight sections in Session B', async () => {
      let invalidatorACalls = 0
      let invalidatorBCalls = 0
      let computeBCalls = 0

      await Promise.all([
        runWithNewHostSession({ id: randomUUID() }, async () => {
          setPromptSectionResolver(async (name, text) => `[A:${name}]${text}`)
          setPromptSectionInvalidator(() => {
            invalidatorACalls += 1
          })

          await Bun.sleep(10)
          // Clear sections in Session A while Session B's section compute is in-flight!
          clearSystemPromptSections()

          const resA = await resolveStaticSystemPromptSection('intro', 'hello')
          expect(resA).toBe('[A:intro]hello')
        }),
        runWithNewHostSession({ id: randomUUID() }, async () => {
          setPromptSectionResolver(async (name, text) => `[B:${name}]${text}`)
          setPromptSectionInvalidator(() => {
            invalidatorBCalls += 1
          })

          const slowSection = systemPromptSection('slow_section', async () => {
            computeBCalls += 1
            await Bun.sleep(25)
            return 'computed-body'
          })

          const first = await resolveSystemPromptSections([slowSection])
          expect(first).toEqual(['[B:slow_section]computed-body'])

          // Because Session A's clearSystemPromptSections did NOT bump Session B's generation,
          // Session B cached slow_section on the first pass and will NOT recompute on the second!
          const second = await resolveSystemPromptSections([slowSection])
          expect(second).toEqual(['[B:slow_section]computed-body'])
          expect(computeBCalls).toBe(1)
        }),
      ])

      expect(invalidatorACalls).toBe(1)
      expect(invalidatorBCalls).toBe(0)
    })
  })

  describe('sessionSpawnCaps, forkSubagent, subagentSpawnLedger, subagentHandback, agentToolUtils, and subagentCacheEvict', () => {
    test('sessionSpawnCaps isolates spawn counters, concurrency slots, and resetSessionSpawnCaps across sessions', async () => {
      const capEnv = {
        ...process.env,
        CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION: '2',
      }

      await Promise.all([
        runWithNewHostSession({ id: randomUUID() }, async () => {
          resetSessionSpawnCaps()
          assertCanSpawnSubagent({ env: capEnv })
          assertCanSpawnSubagent({ env: capEnv })
          expect(getTotalAgentSpawns()).toBe(2)
          expect(() => assertCanSpawnSubagent({ env: capEnv })).toThrow(
            /Subagent spawn limit reached \(2 of 2 agents spawned\)/,
          )

          const releaseA = takeConcurrencySlot()
          incrementWebSearchCalls()
          expect(getConcurrentSubagents()).toBe(1)
          expect(getWebSearchCalls()).toBe(1)

          await Bun.sleep(15)
          // Session B's reset must not reset Session A
          expect(getTotalAgentSpawns()).toBe(2)
          expect(getConcurrentSubagents()).toBe(1)
          expect(getWebSearchCalls()).toBe(1)

          // Releasing slot outside Session A still decrements Session A's captured state
          exitSessionContext(() => releaseA())
          expect(getConcurrentSubagents()).toBe(0)
        }),
        runWithNewHostSession({ id: randomUUID() }, async () => {
          await Bun.sleep(5)
          // Session B has a clean slate despite Session A hitting the cap
          expect(getTotalAgentSpawns()).toBe(0)
          expect(getConcurrentSubagents()).toBe(0)
          expect(getWebSearchCalls()).toBe(0)
          assertCanSpawnSubagent({ env: capEnv })
          expect(getTotalAgentSpawns()).toBe(1)
          resetSessionSpawnCaps()
          expect(getTotalAgentSpawns()).toBe(0)
        }),
      ])
    })

    test('forkSubagent isolates sticky forkProductSource and interactive vs non-interactive host behavior', () => {
      const prevForkEnv = process.env.CLAUDE_CODE_FORK_SUBAGENT
      const prevEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
      try {
        delete process.env.CLAUDE_CODE_ENTRYPOINT
        // Session A runs with CLAUDE_CODE_FORK_SUBAGENT=1, latching 'env' on Session A
        process.env.CLAUDE_CODE_FORK_SUBAGENT = '1'
        runWithNewHostSession(
          { id: randomUUID(), isInteractive: true },
          sessionA => {
            resetForkSubagentProductSource()
            expect(resolveForkSubagentProductSource()).toBe('env')

            // Clear env: Session A retains sticky 'env', including force-async
            delete process.env.CLAUDE_CODE_FORK_SUBAGENT
            expect(resolveForkSubagentProductSource()).toBe('env')
            expect(isForkSubagentForceAsyncEnabled()).toBe(true)

            // Meanwhile, headless Session B starts fresh without Session A's 'env' sticky!
            runWithNewHostSession(
              { id: randomUUID(), isInteractive: false },
              () => {
                expect(resolveForkSubagentProductSource()).toBe('default')
                // Non-interactive CLI with source='default' does NOT force async
                expect(isForkSubagentForceAsyncEnabled()).toBe(false)
              },
            )

            // Session A's sticky is untouched
            expect(
              runWithSession(sessionA, () =>
                resolveForkSubagentProductSource(),
              ),
            ).toBe('env')
          },
        )
      } finally {
        if (prevForkEnv === undefined) {
          delete process.env.CLAUDE_CODE_FORK_SUBAGENT
        } else {
          process.env.CLAUDE_CODE_FORK_SUBAGENT = prevForkEnv
        }
        if (prevEntrypoint === undefined) {
          delete process.env.CLAUDE_CODE_ENTRYPOINT
        } else {
          process.env.CLAUDE_CODE_ENTRYPOINT = prevEntrypoint
        }
      }
    })

    test('subagentSpawnLedger shares ledger across session.withProject(...) forks while isolating separate root sessions', () => {
      runWithNewHostSession({ id: randomUUID() }, sessionA => {
        const forkA = sessionA.withProject({ cwd: '/tmp/worktree-a' })
        expect(subagentSpawnLedgerOf(forkA)).toBe(
          subagentSpawnLedgerOf(sessionA),
        )

        const handle = recordSubagentSpawn(
          { agentType: 'Explore', runInBackground: true, depth: 1 },
          forkA,
        )
        handle.completed()
        recordSubagentSpawnRefused('depth_limit', forkA)

        const snapA = snapshotSubagentSpawnLedger(sessionA)
        expect(snapA.spawned).toBe(1)
        expect(snapA.completed).toBe(1)
        expect(snapA.refused).toEqual({ depth_limit: 1 })

        runWithNewHostSession({ id: randomUUID() }, sessionB => {
          const snapB = snapshotSubagentSpawnLedger(sessionB)
          expect(snapB.spawned).toBe(0)
          expect(snapB.refused).toEqual({})
        })
      })
    })

    test('subagentHandback, agentToolUtils handback maps, and subagentCacheEvict imageRereadStates are isolated per root session', () => {
      runWithNewHostSession({ id: randomUUID() }, sessionA => {
        clearHandbackDeliveriesForTests()
        recordHandbackDelivery('task-1', 'main', { flagged: true })
        setHandbackSessionContract('agent-1', true)
        flagHandbackSession('agent-1')

        markHandbackLaterReportRefused('agent-1')
        markHandbackFollowUpDropped('agent-1', 'message')

        resetImageRereadState()
        noteImageMediaStripped('agent-img', 2)
        for (let i = 0; i < 60; i++) {
          checkUnchangedImageRereadLimit(
            'agent-img',
            '/tmp/same.png',
            'aGVsbG8=',
          )
        }
        expect(
          checkUnchangedImageRereadLimit(
            'agent-img',
            '/tmp/same.png',
            'aGVsbG8=',
          ),
        ).toBe(UNCHANGED_IMAGE_REREAD_LIMIT_MESSAGE)

        // Session B sees completely isolated maps/sets
        runWithNewHostSession({ id: randomUUID() }, () => {
          expect(getHandbackDelivery('task-1', 'main')).toBeUndefined()
          expect(getHandbackSessionContract('agent-1')).toBeUndefined()
          expect(wasHandbackLaterReportRefused('agent-1')).toBe(false)
          expect(getHandbackFollowUpDropped('agent-1')).toEqual({
            dropped: false,
          })
          expect(
            checkUnchangedImageRereadLimit(
              'agent-img',
              '/tmp/same.png',
              'aGVsbG8=',
            ),
          ).toBeUndefined()

          // Clearing inside Session B does not clear Session A
          clearHandbackDeliveriesForTests()
          clearHandbackLaterReportRefused('agent-1')
          clearHandbackFollowUpDropped('agent-1')
          resetImageRereadState()
        })

        // Session A (and its withProject fork) retains all state
        const forkA = sessionA.withProject({ cwd: '/tmp' })
        runWithSession(forkA, () => {
          expect(getHandbackDelivery('task-1', 'main')).toEqual({
            recipient: 'main',
            flagged: true,
          })
          expect(getHandbackSessionContract('agent-1')).toEqual({
            contract: true,
            flagged: true,
          })
          expect(wasHandbackLaterReportRefused('agent-1')).toBe(true)
          expect(getHandbackFollowUpDropped('agent-1')).toEqual({
            dropped: true,
            hint: 'message',
          })
          expect(
            checkUnchangedImageRereadLimit(
              'agent-img',
              '/tmp/same.png',
              'aGVsbG8=',
            ),
          ).toBe(UNCHANGED_IMAGE_REREAD_LIMIT_MESSAGE)
        })
      })
    })
  })
})
