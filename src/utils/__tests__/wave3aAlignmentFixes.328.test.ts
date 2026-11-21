import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { pathToFileURL } from 'url'
import {
  addSessionCronTask,
  clearRefusalFallbackModelLatch,
  getMainLoopModelOverride,
  getRefusalFallbackModelLatch,
  removeSessionCronTasks,
  setMainLoopModelOverride,
  setRefusalFallbackModelLatch,
  takeCarriedEffortEnd,
} from '../../bootstrap/state.js'
import { clearSessionCaches } from '../../commands/clear/caches.js'
import {
  getGhStandinTag,
  getSystemContext,
  setGhStandinTag,
} from '../../context.js'
import {
  _registerLiveMcpClientForTests,
  buildMcpRootsList,
  notifyMcpRootsListChanged,
} from '../../services/mcp/client.js'
import {
  _resetPolicyLimitsForTesting,
  _setArtifactCreateNoticeForTesting,
  getArtifactCreateNotice,
} from '../../services/policyLimits/index.js'
import {
  DEFAULT_ARTIFACT_CREATE_NOTICE_TEXT,
  PolicyLimitsResponseSchema,
} from '../../services/policyLimits/types.js'
import { asAgentId } from '../../types/ids.js'
import type { Message } from '../../types/message.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import { formatGhStandinNote } from '../agentProxy/ghStandin.js'
import { writeExitHandoffAdopt } from '../bgCheckpoint.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import {
  _resetSessionOrgEffortCapsForTesting,
  getSessionOrgEffortCap,
  stepDownOrgEffortCap,
} from '../effort.js'
import { drainBackgroundShutdownWork } from '../gracefulShutdown.js'
import { clearPendingWakeupOnFire } from '../loopDynamic.js'
import {
  applyThirdPartyUpgradeChoice,
  filterUndecidedUpgradeCandidates,
  type ThirdPartyDeclinedUpgradesConfig,
  type ThirdPartyUpgradeCandidate,
} from '../model/thirdPartyModelUpgrade.js'
import { readPendingWakeup, writePendingWakeup } from '../orphanCronResume.js'
import {
  formatOlderCompatibleInstallNote,
  formatOlderCompatibleUpdateMessage,
  verifyOlderCandidateManifestVersion,
} from '../plugins/pluginEngineRange.js'
import {
  isOlderVersionFallbackEligible,
  listOlderCompatibleVersionCandidates,
} from '../plugins/pluginInstallationHelpers.js'
import {
  processResumedConversation,
  restoreSessionStateFromLog,
} from '../sessionRestore.js'
import {
  buildTranscriptGcKeepLineSet,
  compactTranscriptJsonl,
  getCurrentSessionPermissionMode,
  getResumeHeadPath,
  getToolResultCopiesOnDisk,
  getTranscriptWriterDegraded,
  isLowYieldCompactSkipEnabled,
  loadTranscriptFile,
  loadTranscriptFromFile,
  noteTranscriptWriterDegraded,
  planResumeHeadForTranscript,
  resetProjectForTesting,
  savePermissionMode,
  saveSessionModel,
  setLowYieldCompactSkipEnabled,
  setToolResultCopiesOnDisk,
  slimEntriesForResumeHydration,
  tryLoadResumeHeadRows,
  writeResumeHeadFile,
} from '../sessionStorage.js'
import {
  getTranscriptWriterDegraded as getLiveTranscriptWriterDegraded,
  resetTranscriptWriterHealthForTest,
} from '../transcriptWriterHealth.js'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

beforeEach(() => {
  resetProjectForTesting()
  resetTranscriptWriterHealthForTest()
  _resetPolicyLimitsForTesting()
  _resetSessionOrgEffortCapsForTesting()
  setGhStandinTag(undefined)
  clearRefusalFallbackModelLatch()
  takeCarriedEffortEnd()
  setMainLoopModelOverride(undefined)
  setToolResultCopiesOnDisk('whole')
})

afterEach(() => {
  resetProjectForTesting()
  resetTranscriptWriterHealthForTest()
  _resetPolicyLimitsForTesting()
  _resetSessionOrgEffortCapsForTesting()
  setGhStandinTag(undefined)
  clearRefusalFallbackModelLatch()
  takeCarriedEffortEnd()
  setMainLoopModelOverride(undefined)
  setToolResultCopiesOnDisk('whole')
  setLowYieldCompactSkipEnabled(true)
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 3A Item 1: session metadata & unified resume hydration', () => {
  test('permission-mode and session-model survive loadTranscriptFile and loadTranscriptFromFile across compact_boundary', async () => {
    const dir = makeTempDir('wave3a-meta-')
    const sid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as UUID
    const file = join(dir, `${sid}.jsonl`)
    const u1 = '11111111-1111-4111-8111-111111111111'
    const a1 = '22222222-2222-4222-8222-222222222222'
    const b1 = '33333333-3333-4333-8333-333333333333'
    const u2 = '44444444-4444-4444-8444-444444444444'

    const rows = [
      {
        type: 'user',
        uuid: u1,
        parentUuid: null,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'user', content: 'before compact' },
      },
      {
        type: 'assistant',
        uuid: a1,
        parentUuid: u1,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      },
      {
        type: 'permission-mode',
        permissionMode: 'plan',
        sessionId: sid,
      },
      {
        type: 'session-model',
        model: 'claude-opus-4-6',
        sessionId: sid,
      },
      {
        type: 'system',
        subtype: 'compact_boundary',
        uuid: b1,
        parentUuid: a1,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:02.000Z',
        content: 'Conversation compacted',
      },
      {
        type: 'user',
        uuid: u2,
        parentUuid: b1,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:03.000Z',
        message: { role: 'user', content: 'after compact' },
      },
    ]
    writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n')

    const parsed = await loadTranscriptFile(file)
    expect(parsed.permissionModes.get(sid)).toBe('plan')
    expect(parsed.sessionModels.get(sid)).toBe('claude-opus-4-6')

    const log = await loadTranscriptFromFile(file)
    expect(log).not.toBeNull()
    expect(log?.permissionMode).toBe('plan')
    expect(log?.sessionModel).toBe('claude-opus-4-6')
  })

  test('savePermissionMode updates in-memory permission mode and saveSessionModel accepts model string', () => {
    savePermissionMode('acceptEdits')
    expect(getCurrentSessionPermissionMode()).toBe('acceptEdits')
    saveSessionModel('claude-sonnet-4-6')
    saveSessionModel(null)
  })

  test('processResumedConversation unifies model, goal, and agentNameRegistry hydration with restoreSessionStateFromLog', async () => {
    const baseState = getDefaultAppState()
    const resumedMessages = [
      {
        type: 'user',
        uuid: '11111111-1111-4111-8111-111111111111' as UUID,
        message: { role: 'user', content: 'hello' },
      },
      {
        type: 'assistant',
        uuid: '22222222-2222-4222-8222-222222222222' as UUID,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu_agent_1',
              name: 'Agent',
              input: {
                name: 'scout',
                description: 'check repo',
                prompt: 'inspect files',
              },
            },
          ],
        },
      },
      {
        type: 'user',
        uuid: '33333333-3333-4333-8333-333333333333' as UUID,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_agent_1',
              content: 'done',
            },
          ],
        },
        toolUseResult: {
          status: 'completed',
          agentId: 'a0123456789abcdef',
          prompt: 'inspect files',
          content: [{ type: 'text', text: 'done' }],
          totalDurationMs: 10,
          totalTokens: 10,
          totalToolUseCount: 1,
          usage: {
            input_tokens: 5,
            output_tokens: 5,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            server_tool_use: null,
            service_tier: null,
            cache_creation: null,
          },
        },
      },
    ] as unknown as Message[]

    const resumeContext = {
      modeApi: null,
      mainThreadAgentDefinition: undefined,
      agentDefinitions: { activeAgents: [], allAgents: [] },
      currentCwd: process.cwd(),
      cliAgents: [],
      initialState: baseState,
    }

    // 1. CLI startup resume hydrates sessionModel & agentNameRegistry
    const cliResumed = await processResumedConversation(
      {
        messages: resumedMessages,
        fileHistorySnapshots: [],
        sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as UUID,
        sessionModel: 'claude-opus-4-6',
        permissionMode: 'plan',
      },
      { forkSession: false },
      resumeContext,
    )
    expect(cliResumed.initialState.mainLoopModel).toBe('claude-opus-4-6')
    expect(cliResumed.initialState.agentNameRegistry?.get('scout')).toBe(
      asAgentId('a0123456789abcdef'),
    )

    // 2. Explicit CLI --model override is respected (not clobbered by sessionModel)
    setMainLoopModelOverride('claude-sonnet-4-6')
    const cliWithOverride = await processResumedConversation(
      {
        messages: resumedMessages,
        fileHistorySnapshots: [],
        sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' as UUID,
        sessionModel: 'claude-opus-4-6',
      },
      { forkSession: false },
      resumeContext,
    )
    expect(getMainLoopModelOverride()).toBe('claude-sonnet-4-6')
    expect(cliWithOverride.initialState.mainLoopModel).toBe(
      baseState.mainLoopModel,
    )

    // 3. Fork skips agentNameRegistry inheritance just like restoreSessionStateFromLog
    setMainLoopModelOverride(undefined)
    const cliForked = await processResumedConversation(
      {
        messages: resumedMessages,
        fileHistorySnapshots: [],
        sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' as UUID,
        sessionModel: 'claude-opus-4-6',
      },
      { forkSession: true },
      resumeContext,
    )
    expect(cliForked.initialState.agentNameRegistry?.size ?? 0).toBe(0)
  })
})

describe('Wave 3A Item 2: transcript storage alignment', () => {
  test('tengu_pebble_leaf_prune gate is removed and leaf pruning runs unconditionally', async () => {
    const src = readFileSync(
      join(REPO_ROOT, 'src/utils/sessionStorage.ts'),
      'utf8',
    )
    expect(src).not.toContain('tengu_pebble_leaf_prune')

    const dir = makeTempDir('wave3a-leaf-')
    const file = join(dir, 'transcript.jsonl')
    const sid = '11111111-1111-4111-8111-111111111111'
    const u1 = '22222222-2222-4222-8222-222222222222'
    const a1 = '33333333-3333-4333-8333-333333333333'
    const u2 = '44444444-4444-4444-8444-444444444444'
    const rows = [
      {
        type: 'user',
        uuid: u1,
        parentUuid: null,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'user', content: 'first' },
      },
      {
        type: 'assistant',
        uuid: a1,
        parentUuid: u1,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'r1' }] },
      },
      {
        type: 'user',
        uuid: u2,
        parentUuid: a1,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'user', content: 'second' },
      },
    ]
    writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
    const loaded = await loadTranscriptFile(file)
    expect([...loaded.leafUuids]).toEqual([u2])
  })

  test('transcript writer health is unified with transcriptWriterHealth.ts', () => {
    noteTranscriptWriterDegraded('ENOSPC', 'drain', '/tmp/s.jsonl')
    expect(getTranscriptWriterDegraded()).toEqual({
      code: 'ENOSPC',
      source: 'drain',
      filePath: '/tmp/s.jsonl',
    })
    expect(getLiveTranscriptWriterDegraded()).toEqual(
      getTranscriptWriterDegraded(),
    )
    resetTranscriptWriterHealthForTest()
    expect(getTranscriptWriterDegraded()).toBeNull()
  })

  test('lowYieldCompactSkipEnabled defaults to true', () => {
    expect(isLowYieldCompactSkipEnabled()).toBe(true)
  })

  test('buildTranscriptGcKeepLineSet matches official WZe retention rules across compact_boundary', () => {
    const sid = '11111111-1111-4111-8111-111111111111'
    const lines = [
      // 0: pre-compact user (drop)
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        sessionId: sid,
      }),
      // 1: pre-compact file-history-snapshot for u1 (drop)
      JSON.stringify({ type: 'file-history-snapshot', messageId: 'u1' }),
      // 2: pre-compact preserved message (keep via preservedMessages)
      JSON.stringify({
        type: 'user',
        uuid: 'u_keep',
        parentUuid: 'u1',
        sessionId: sid,
      }),
      // 3: file-history-snapshot for u_keep (keep via preservedMessages)
      JSON.stringify({ type: 'file-history-snapshot', messageId: 'u_keep' }),
      // 4: old custom-title (drop — superseded by #5)
      JSON.stringify({
        type: 'custom-title',
        sessionId: sid,
        customTitle: 'old',
      }),
      // 5: latest pre-boundary custom-title (keep — last-wins)
      JSON.stringify({
        type: 'custom-title',
        sessionId: sid,
        customTitle: 'new',
      }),
      // 6: accumulate metadata (keep)
      JSON.stringify({
        type: 'content-replacement',
        sessionId: sid,
        replacements: [],
      }),
      // 7: pre-boundary attribution-snapshot (drop — superseded by #11)
      JSON.stringify({ type: 'attribution-snapshot', sessionId: sid, v: 1 }),
      // 8: compact_boundary preserving u_keep (keep)
      JSON.stringify({
        type: 'system',
        subtype: 'compact_boundary',
        uuid: 'cb1',
        parentUuid: 'u_keep',
        sessionId: sid,
        compactMetadata: { preservedMessages: { uuids: ['u_keep'] } },
      }),
      // 9: tombstone (drop)
      JSON.stringify({ type: 'tombstone', uuid: 't1' }),
      // 10: post-boundary user (keep)
      JSON.stringify({
        type: 'user',
        uuid: 'u2',
        parentUuid: 'cb1',
        sessionId: sid,
      }),
      // 11: latest attribution-snapshot (keep)
      JSON.stringify({ type: 'attribution-snapshot', sessionId: sid, v: 2 }),
    ]

    const keep = buildTranscriptGcKeepLineSet(lines)
    expect(keep.has(0)).toBe(false)
    expect(keep.has(1)).toBe(false)
    expect(keep.has(2)).toBe(true)
    expect(keep.has(3)).toBe(true)
    expect(keep.has(4)).toBe(false)
    expect(keep.has(5)).toBe(true)
    expect(keep.has(6)).toBe(true)
    expect(keep.has(7)).toBe(false)
    expect(keep.has(8)).toBe(true)
    expect(keep.has(9)).toBe(false)
    expect(keep.has(10)).toBe(true)
    expect(keep.has(11)).toBe(true)

    const { compacted, skippedLowYield } = compactTranscriptJsonl(
      lines.join('\n') + '\n',
    )
    expect(skippedLowYield).toBe(false)
    expect(compacted).toContain('"uuid":"u_keep"')
    expect(compacted).toContain('"customTitle":"new"')
    expect(compacted).not.toContain('"customTitle":"old"')
    expect(compacted).not.toContain('"type":"tombstone"')
    expect(compacted).not.toContain('"uuid":"u1"')
  })

  test('planResumeHeadForTranscript + writeResumeHeadFile round-trips via tryLoadResumeHeadRows', async () => {
    const rootDir = makeTempDir('wave3a-resume-head-')
    const projectDir = join(rootDir, 'project-a')
    mkdirSync(projectDir, { recursive: true })
    const sid = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const file = join(projectDir, `${sid}.jsonl`)

    const metaLine = JSON.stringify({
      type: 'custom-title',
      sessionId: sid,
      customTitle: 'My Session',
    })
    const oldUser = JSON.stringify({
      type: 'user',
      uuid: 'u0',
      parentUuid: null,
      sessionId: sid,
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { role: 'user', content: 'x'.repeat(2048) },
    })
    const boundaryLine = JSON.stringify({
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'cb1',
      parentUuid: 'u0',
      sessionId: sid,
      timestamp: '2026-01-01T00:00:01.000Z',
      content: 'Conversation compacted',
    })
    const postUser = JSON.stringify({
      type: 'user',
      uuid: 'u1',
      parentUuid: 'cb1',
      sessionId: sid,
      timestamp: '2026-01-01T00:00:02.000Z',
      message: { role: 'user', content: 'after boundary' },
    })

    const prefix = `${metaLine}\n${oldUser}\n`
    const boundaryOffset = Buffer.byteLength(prefix, 'utf8')
    const full = `${prefix}${boundaryLine}\n${postUser}\n`
    writeFileSync(file, full, 'utf8')
    const fileSize = statSync(file).size

    const planned = await planResumeHeadForTranscript(
      file,
      fileSize,
      boundaryOffset,
      { ignoreMinGain: true },
    )
    expect(planned).not.toBeNull()

    const headPath = getResumeHeadPath(file, dirname(dirname(file)))
    expect(headPath).not.toBeNull()
    await writeResumeHeadFile(headPath!, planned!)
    expect(existsSync(headPath!)).toBe(true)

    const loaded = await tryLoadResumeHeadRows(file, fileSize)
    expect(loaded).not.toBeNull()
    expect(loaded?.boundaryOffset).toBe(boundaryOffset)
  })

  test('setToolResultCopiesOnDisk("slim") and slimEntriesForResumeHydration slim large toolUseResult fields', () => {
    setToolResultCopiesOnDisk('slim')
    expect(getToolResultCopiesOnDisk()).toBe('slim')

    const entries = [
      {
        type: 'assistant',
        uuid: 'a0' as UUID,
        parentUuid: null,
        sessionId: 'sid',
        timestamp: '2026-01-01T00:00:00.000Z',
        isSidechain: false,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu-read-1',
              name: 'Read',
              input: { file_path: '/tmp/foo.ts' },
            },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'u1' as UUID,
        parentUuid: 'a0' as UUID,
        sessionId: 'sid',
        timestamp: '2026-01-01T00:00:01.000Z',
        isSidechain: false,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu-read-1',
              content: 'ok',
            },
          ],
        },
        toolUseResult: {
          type: 'text',
          file: {
            filePath: '/tmp/foo.ts',
            content: 'A'.repeat(20_000),
            numLines: 500,
            startLine: 1,
            totalLines: 500,
          },
        },
      },
    ] as unknown as Parameters<typeof slimEntriesForResumeHydration>[0]

    const slimmed = slimEntriesForResumeHydration(entries)
    const result = (
      slimmed[1] as unknown as {
        toolUseResult?: { file?: { content?: string; filePath?: string } }
      }
    ).toolUseResult
    expect(result?.file?.filePath).toBe('/tmp/foo.ts')
    expect(result?.file?.content).toBe('')
  })
})

describe('Wave 3A Item 3: 3P model upgrade GlobalConfig persistence & main.tsx startup wiring', () => {
  test('declined Bedrock upgrade persists to GlobalConfig (~/.claude.json) and filters candidates', () => {
    const prevGlobal = getGlobalConfig() as unknown as Record<string, unknown>
    const prevDeclined = prevGlobal.bedrockDeclinedUpgrades
    const candidate: ThirdPartyUpgradeCandidate = {
      tier: 'sonnet',
      envVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
      fromKey: 'claude-sonnet-4-5',
      fromMarketingName: 'Sonnet 4.5',
      toKey: 'claude-sonnet-4-6',
      toMarketingName: 'Sonnet 4.6',
      toModelId: 'us.anthropic.claude-sonnet-4-6-v1:0',
    }

    try {
      const applied = applyThirdPartyUpgradeChoice('bedrock', candidate, false)
      expect(applied).toBe(false)

      const updated =
        getGlobalConfig() as unknown as ThirdPartyDeclinedUpgradesConfig
      expect(updated.bedrockDeclinedUpgrades?.sonnet).toBe(
        'claude-sonnet-4-5-to-claude-sonnet-4-6',
      )

      const remaining = filterUndecidedUpgradeCandidates('bedrock', [candidate])
      expect(remaining).toEqual([])
    } finally {
      saveGlobalConfig(current => {
        const copy = { ...(current as unknown as Record<string, unknown>) }
        if (prevDeclined === undefined) {
          delete copy.bedrockDeclinedUpgrades
        } else {
          copy.bedrockDeclinedUpgrades = prevDeclined
        }
        return copy as unknown as ReturnType<typeof getGlobalConfig>
      })
    }
  })

  test('main.tsx wires 3P catalog startup await, gateway warnings, 2-phase Code Mode opt-in, headless warning, and unknown --agent exit', () => {
    const src = readFileSync(join(REPO_ROOT, 'src/main.tsx'), 'utf8')
    expect(src).toContain('await thirdPartyModelCatalogStartupPromise')
    const catalogDecidedIdx = src.indexOf(
      "profileCheckpoint('action_model_catalog_decided')",
    )
    const modelResolvedIdx = src.indexOf(
      "profileCheckpoint('action_model_resolved')",
    )
    expect(catalogDecidedIdx).toBeGreaterThan(-1)
    expect(modelResolvedIdx).toBeGreaterThan(catalogDecidedIdx)
    expect(src).toContain('emitClaudeAppsGatewayStartupWarnings')
    expect(src).toContain('recordCodeModeSignedInAccount')
    expect(src).toContain('reviewCodeModeOptInAfterInit')
    expect(src).toContain(
      'Warning: ${codeModeWarningNotice(codeModeDecision.why)}',
    )
    expect(src).toContain("--agent '${agentCli}' not found. Available agents:")
  })
})

describe('Wave 3A Item 4: cli.tsx fast-path, cloudSession surface, bootstrap/state', () => {
  test('cli.tsx uses backgroundSessionVerbIndex and removes CLAUDE_CODE_NO_SHELL_SNAPSHOT', () => {
    const src = readFileSync(join(REPO_ROOT, 'src/entrypoints/cli.tsx'), 'utf8')
    expect(src).toContain('backgroundSessionVerbIndex(args,')
    expect(src).not.toContain('CLAUDE_CODE_NO_SHELL_SNAPSHOT')
    expect(src).toContain('CLAUDE_CODE_DISABLE_SHELL_HEAD_START')
  })

  test('cloudSession.ts wires setAutoCompactWindowSurface(readAutoCompactWindowSurface(sessionHost))', () => {
    const src = readFileSync(join(REPO_ROOT, 'src/cli/cloudSession.ts'), 'utf8')
    const matches = src.match(
      /setAutoCompactWindowSurface\(readAutoCompactWindowSurface\(sessionHost\)\)/g,
    )
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  test('bootstrap/state: model override clears carriedEffort with model_change, latch clear defaults to model_pick, loop removal clears .pending-wakeup unless handOff', async () => {
    // 1. Model change clears carriedEffort from refusal fallback latch
    setRefusalFallbackModelLatch({
      fallbackModel: 'claude-sonnet-4-6',
      previousOverride: 'claude-opus-4-6',
      carriedEffort: 'high',
    })
    setMainLoopModelOverride('claude-haiku-4-5')
    expect(getRefusalFallbackModelLatch()?.carriedEffort).toBeUndefined()
    expect(takeCarriedEffortEnd()).toBe('model_change')

    // 2. clearRefusalFallbackModelLatch defaults to 'model_pick'
    setRefusalFallbackModelLatch({
      fallbackModel: 'claude-sonnet-4-6',
      previousOverride: 'claude-opus-4-6',
      carriedEffort: 'high',
    })
    clearRefusalFallbackModelLatch()
    expect(getRefusalFallbackModelLatch()).toBeUndefined()
    expect(takeCarriedEffortEnd()).toBe('model_pick')

    // 3. removeSessionCronTasks honors { handOff: true } vs normal deletion
    const dir = makeTempDir('wave3a-cron-wakeup-')
    const prevBgDir = process.env.CLAUDE_JOB_DIR
    process.env.CLAUDE_JOB_DIR = dir
    try {
      await writePendingWakeup(dir, {
        toolUseId: 'tu-1',
        scheduledFor: Date.now() + 60_000,
        chainStartedAt: Date.now(),
      })
      expect(await readPendingWakeup(dir)).not.toBeNull()

      addSessionCronTask({
        id: 'loop-handoff',
        cron: '* * * * *',
        prompt: 'tick',
        createdAt: Date.now(),
        recurring: false,
        kind: 'loop',
      })
      removeSessionCronTasks(['loop-handoff'], { handOff: true })
      await new Promise(r => setTimeout(r, 20))
      expect(await readPendingWakeup(dir)).not.toBeNull()

      addSessionCronTask({
        id: 'loop-cancel',
        cron: '* * * * *',
        prompt: 'tick',
        createdAt: Date.now(),
        recurring: false,
        kind: 'loop',
      })
      removeSessionCronTasks(['loop-cancel'])
      await new Promise(r => setTimeout(r, 20))
      expect(await readPendingWakeup(dir)).toBeNull()
    } finally {
      if (prevBgDir === undefined) delete process.env.CLAUDE_JOB_DIR
      else process.env.CLAUDE_JOB_DIR = prevBgDir
    }
  })
})

describe('Wave 3A Item 5: policyLimits, clear/login effort caps, MCP roots, plugin fallback, bgCheckpoint, loopDynamic, context', () => {
  test('policyLimits parses, sanitizes, and caches artifact_create_notice', async () => {
    const parsed = PolicyLimitsResponseSchema().parse({
      restrictions: {},
      artifact_create_notice: {
        text: '  Hello\u200B   Artifact\nNotice  ',
      },
    })
    expect(parsed.artifact_create_notice?.text).toBe('Hello Artifact Notice')

    const fallbackParsed = PolicyLimitsResponseSchema().parse({
      restrictions: {},
      artifact_create_notice: { text: '' },
    })
    expect(fallbackParsed.artifact_create_notice?.text).toBe(
      DEFAULT_ARTIFACT_CREATE_NOTICE_TEXT,
    )

    expect(getArtifactCreateNotice()).toBeNull()
    _setArtifactCreateNoticeForTesting({ text: 'Custom org notice' })
    expect(getArtifactCreateNotice()).toBe('Custom org notice')
    _resetPolicyLimitsForTesting()
    expect(getArtifactCreateNotice()).toBeNull()
  })

  test('clearSessionCaches clears session org effort caps and login.tsx wires clearSessionOrgEffortCaps', () => {
    stepDownOrgEffortCap('claude-opus-4-6', 'high')
    expect(getSessionOrgEffortCap('claude-opus-4-6')).toBe('medium')
    clearSessionCaches()
    expect(getSessionOrgEffortCap('claude-opus-4-6')).toBeUndefined()

    const loginSrc = readFileSync(
      join(REPO_ROOT, 'src/commands/login/login.tsx'),
      'utf8',
    )
    expect(loginSrc).toContain('clearSessionOrgEffortCaps()')
  })

  test('MCP buildMcpRootsList includes additional working directories and notifyMcpRootsListChanged notifies live clients', () => {
    const result = buildMcpRootsList('/workspace/main', [
      '/workspace/extra-a',
      '/workspace/extra-b',
      '/workspace/main',
    ])
    expect(result.roots.map(r => r.uri)).toEqual([
      pathToFileURL('/workspace/main').href,
      pathToFileURL('/workspace/extra-a').href,
      pathToFileURL('/workspace/extra-b').href,
    ])

    let notified = 0
    const fakeClient = {
      sendRootsListChanged: async () => {
        notified++
      },
    } as unknown as Parameters<typeof _registerLiveMcpClientForTests>[0]
    const unregister = _registerLiveMcpClientForTests(fakeClient)
    try {
      notifyMcpRootsListChanged()
      expect(notified).toBe(1)
    } finally {
      unregister()
    }
  })

  test('plugin older compatible version fallback helpers match official 2.1.328 behavior', async () => {
    const floatingEntry = {
      name: 'demo-plugin',
      version: '2.0.0',
      strict: true,
      source: {
        source: 'npm' as const,
        package: '@acme/demo-plugin',
      },
    }
    expect(
      isOlderVersionFallbackEligible('demo-plugin@mkt', floatingEntry, {
        source: 'directory',
        path: '/tmp/mkt',
      }),
    ).toBe(true)

    const candidates = await listOlderCompatibleVersionCandidates({
      entry: floatingEntry,
      below: '2.0.0',
      listAvailableVersions: async () => [
        '1.0.0',
        '2.0.0',
        '1.9.0',
        '2.1.0',
        '1.5.0',
      ],
    })
    expect(candidates.map(c => c.version)).toEqual(['1.9.0', '1.5.0', '1.0.0'])

    // Exact pinned npm version must not downgrade outside its pinned range (official B2o)
    const pinnedCandidates = await listOlderCompatibleVersionCandidates({
      entry: {
        ...floatingEntry,
        source: {
          source: 'npm' as const,
          package: '@acme/demo-plugin',
          version: '2.0.0',
        },
      },
      below: '2.0.0',
      listAvailableVersions: async () => ['1.9.0', '2.0.0'],
    })
    expect(pinnedCandidates).toEqual([])

    expect(
      verifyOlderCandidateManifestVersion(candidates[0]!, { version: '1.9.0' }),
    ).toBeUndefined()
    expect(
      verifyOlderCandidateManifestVersion(candidates[0]!, { version: '1.8.0' }),
    ).toContain('1.8.0')

    const miss = {
      range: '>=99.0.0',
      claudeCodeVersion: '2.1.328',
      newerClaudeCodeMayFit: true,
    }
    const note = formatOlderCompatibleInstallNote({
      version: '1.9.0',
      rejectedVersion: '2.0.0',
      miss,
    })
    expect(note).toContain('Installed 1.9.0')
    expect(note).toContain('2.0.0 needs Claude Code >=99.0.0')

    const updateMsg = formatOlderCompatibleUpdateMessage({
      baseMessage: 'Plugin "demo-plugin" updated from 1.5.0 to 1.9.0.',
      rejectedVersion: '2.0.0',
      miss,
    })
    expect(updateMsg).toContain('1.5.0')
    expect(updateMsg).toContain('1.9.0')
    expect(updateMsg).toContain('2.0.0')
    expect(updateMsg).toContain('>=99.0.0')
  })

  test('bgCheckpoint writeExitHandoffAdopt registers write promise with gracefulShutdown', async () => {
    const dir = makeTempDir('wave3a-adopt-')
    const res = await writeExitHandoffAdopt(dir, {
      payload: {
        writtenAtMs: Date.now(),
        origin: 'exit',
        cron: [],
        shells: [
          {
            id: 'sh1',
            pid: process.pid,
            command: 'sleep 1',
            description: 'test shell',
            cwd: dir,
            outputFile: join(dir, 'sh1.out'),
            startedAtMs: Date.now(),
          },
        ],
      },
    })
    expect(res).not.toBeNull()
    await drainBackgroundShutdownWork()
    const src = readFileSync(
      join(REPO_ROOT, 'src/utils/bgCheckpoint.ts'),
      'utf8',
    )
    expect(src).toContain('trackBackgroundShutdownWork(writePromise)')
  })

  test('loopDynamic clearPendingWakeupOnFire removes .pending-wakeup sidecar', async () => {
    const dir = makeTempDir('wave3a-loop-wakeup-')
    await writePendingWakeup(dir, {
      toolUseId: 'tu-loop',
      scheduledFor: Date.now() + 30_000,
      chainStartedAt: Date.now(),
    })
    expect(await readPendingWakeup(dir)).not.toBeNull()
    await clearPendingWakeupOnFire(dir)
    expect(await readPendingWakeup(dir)).toBeNull()
  })

  test('context.ts getSystemContext includes ghStandin note when agent-proxy stand-in tag is active', async () => {
    const tag = 'builtin-api+runner+gh-only'
    setGhStandinTag(tag)
    expect(getGhStandinTag()).toBe(tag)

    const ctxWithTag = await getSystemContext()
    const expectedNote = formatGhStandinNote(tag)
    expect(expectedNote).toBeDefined()
    expect(ctxWithTag.ghStandin).toBe(expectedNote!)

    setGhStandinTag(undefined)
    const ctxWithoutTag = await getSystemContext()
    expect(ctxWithoutTag.ghStandin).toBeUndefined()
  })
})
