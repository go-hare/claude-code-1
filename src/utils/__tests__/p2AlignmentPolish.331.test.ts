import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentTool } from '@claude-code/builtin-tools/tools/AgentTool/AgentTool.js'
import {
  hasMonitorStderrOutput,
  MonitorTool,
} from '@claude-code/builtin-tools/tools/MonitorTool/MonitorTool.js'
import { ScheduleWakeupTool } from '@claude-code/builtin-tools/tools/ScheduleWakeupTool/ScheduleWakeupTool.js'
import { isDeferredTool } from '@claude-code/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
import { SendMessageTool } from '@claude-code/builtin-tools/tools/SendMessageTool/SendMessageTool.js'
import { generateUniqueTeammateName } from '@claude-code/builtin-tools/tools/shared/spawnMultiAgent.js'
import { TaskStopTool } from '@claude-code/builtin-tools/tools/TaskStopTool/TaskStopTool.js'
import type { TaskState } from '../../tasks/types.js'
import { asSessionId } from '../../types/ids.js'
import {
  getSessionId,
  setOriginalCwd,
  switchSession,
} from '../../bootstrap/state.js'
import {
  buildConfigExitSummaryLines,
  cycleEnumOptionIndex,
  formatConfigExitSummaryLine,
  runFastModePreModelSwitchCheck,
  type Setting,
  sanitizeConfigErrorMessage,
} from '../../components/Settings/Config.js'
import type { ToolUseContext } from '../../Tool.js'
import {
  StopTaskError,
  stopTask,
  truncateStopSummary,
} from '../../tasks/stopTask.js'
import {
  classifyIdeWorkspaceMatch,
  deduplicateIdeLockfileDirs,
} from '../ide.js'
import {
  getScratchpadDir,
  resetScratchpadDirCache,
} from '../permissions/filesystem.js'
import { isReservedSpawnAgentName } from '../swarm/constants.js'
import {
  decodeTaggedSessionUuid,
  isValidSessionTaskListId,
  sessionTeamName,
} from '../swarm/sessionTeam.js'
import {
  assertNoControlChars,
  getTeamDir,
  getTeamFilePath,
  hasControlChars,
  isShutdownFrameStale,
  parsedTeamFile,
  readTeamFile,
  readTeamFileAsync,
  sanitizeTeamFile,
  writeTeamFileAsync,
} from '../swarm/teamHelpers.js'
import { resolveTeammateModelWith } from '../swarm/teammateModel.js'
import {
  escapeTaskNotificationTrailing,
  formatTaskNotificationXml,
} from '../task/framework.js'
import { TaskOutput } from '../task/TaskOutput.js'
import {
  clearShownPlanDigests,
  computePlanDigest,
  getShownPlanDigest,
  invalidateAllShownPlanDigests,
  PlanApprovalResponseMessageSchema,
  readMailbox,
  recordPendingShutdownRequest,
  recordShownPlanDigest,
  resetPendingShutdownRequestsForTesting,
  verifyPlanApprovalBinding,
} from '../teammateMailbox.js'
import { runWithTeammateContext } from '../teammateContext.js'
import {
  startUdsMessaging,
  stopUdsMessaging,
  unlinkUdsKeyFilesOnExit,
} from '../udsMessaging.js'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')

describe('Official 2.1.331 P2 Alignment Polish (all 18 items)', () => {
  // =========================================================================
  // Group 1: Session Team / Agent / SendMessage (8 items)
  // =========================================================================

  describe('1.1 teamHelpers readTeamFile / sanitizeTeamFile corrupt JSON scrubbing', () => {
    let tempConfigDir: string
    let prevConfigDir: string | undefined

    beforeEach(() => {
      tempConfigDir = mkdtempSync(join(tmpdir(), 'p2-team-scrub-'))
      prevConfigDir = process.env.CLAUDE_CONFIG_DIR
      process.env.CLAUDE_CONFIG_DIR = tempConfigDir
    })

    afterEach(() => {
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
      rmSync(tempConfigDir, { recursive: true, force: true })
    })

    test('readTeamFile and readTeamFileAsync return null on truncated/corrupt JSON', async () => {
      const teamName = 'corrupt-team'
      mkdirSync(getTeamDir(teamName), { recursive: true })
      writeFileSync(
        getTeamFilePath(teamName),
        '{"name": "corrupt-team", "members": [',
        'utf-8',
      )

      expect(readTeamFile(teamName)).toBeNull()
      expect(await readTeamFileAsync(teamName)).toBeNull()
    })

    test('sanitizeTeamFile / parsedTeamFile scrubs malformed members and invalid fields', async () => {
      expect(parsedTeamFile).toBe(sanitizeTeamFile)
      expect(sanitizeTeamFile(null)).toBeNull()
      expect(sanitizeTeamFile(['not-an-object'])).toBeNull()
      expect(sanitizeTeamFile({ name: 123 })).toBeNull()

      const teamName = 'partial-team'
      mkdirSync(getTeamDir(teamName), { recursive: true })
      writeFileSync(
        getTeamFilePath(teamName),
        JSON.stringify({
          name: teamName,
          description: 999,
          createdAt: 'bad-timestamp',
          leadAgentId: 42,
          leadProcess: { pid: 'not-a-number', procStart: 123 },
          members: [
            null,
            'bad-member',
            { agentId: 'missing-name@partial-team' },
            {
              agentId: 'worker@partial-team',
              name: 'worker',
              agentType: 'general-purpose',
              joinedAt: 1700000000000,
              tmuxPaneId: 'in-process',
              cwd: '/tmp',
              subscriptions: [],
            },
          ],
        }),
        'utf-8',
      )

      const syncResult = readTeamFile(teamName)
      const asyncResult = await readTeamFileAsync(teamName)
      expect(syncResult).not.toBeNull()
      expect(asyncResult).not.toBeNull()
      expect(syncResult!.name).toBe(teamName)
      expect(syncResult!.description).toBeUndefined()
      expect(syncResult!.leadProcess).toBeUndefined()
      expect(syncResult!.members).toHaveLength(1)
      expect(syncResult!.members[0]!.name).toBe('worker')
      expect(asyncResult!.members).toHaveLength(1)
    })
  })

  describe('1.2 Reserved teammate names and control character rejection', () => {
    test('isReservedSpawnAgentName rejects main, team-lead, user, system, agent IDs, and session IDs', () => {
      expect(isReservedSpawnAgentName('main')).toBe(true)
      expect(isReservedSpawnAgentName('team-lead')).toBe(true)
      expect(isReservedSpawnAgentName('TEAM-LEAD')).toBe(true)
      expect(isReservedSpawnAgentName('user')).toBe(true)
      expect(isReservedSpawnAgentName('system')).toBe(true)
      // NFKC fullwidth variant
      expect(isReservedSpawnAgentName('\uff35\uff33\uff25\uff32')).toBe(true)
      // Agent ID shape (`a` + optional label + 16 hex)
      expect(isReservedSpawnAgentName('a0123456789abcdef')).toBe(true)
      expect(isReservedSpawnAgentName('ahelper-0123456789abcdef')).toBe(true)
      // Tagged session ID shapes (session_01... / cse_01...)
      expect(isReservedSpawnAgentName('session_01ABCDEFGHJKLMNPQRSTUVWX')).toBe(
        true,
      )
      expect(
        isReservedSpawnAgentName('cse_vrtx_01ABCDEFGHJKLMNPQRSTUVWX'),
      ).toBe(true)
      expect(
        isReservedSpawnAgentName(
          'session_bdrk_staging_01abcdefghjklmnpqrstuvwx',
        ),
      ).toBe(true)
      // Local session ID shape
      expect(
        isReservedSpawnAgentName('local_12345678-1234-1234-1234-123456789abc'),
      ).toBe(true)

      // Allowed normal names
      expect(isReservedSpawnAgentName('researcher')).toBe(false)
      expect(isReservedSpawnAgentName('code-reviewer')).toBe(false)
    })

    test('hasControlChars and assertNoControlChars reject C0, DEL, and C1 control characters', async () => {
      expect(hasControlChars('clean-worker')).toBe(false)
      expect(hasControlChars('研究员-1')).toBe(false)
      expect(hasControlChars('bad\x07bell')).toBe(true)
      expect(hasControlChars('bad\nnewline')).toBe(true)
      expect(hasControlChars('bad\x1b[31m')).toBe(true)
      expect(hasControlChars('bad\x7fdel')).toBe(true)
      // C1 control character (CSI U+009B)
      expect(hasControlChars('bad\u009b31m')).toBe(true)

      expect(() => assertNoControlChars('ok-name')).not.toThrow()
      expect(() => assertNoControlChars('bad\u009bname')).toThrow(
        /control character U\+009B/i,
      )
      await expect(
        generateUniqueTeammateName('bad\x1bname', undefined),
      ).rejects.toThrow(/control characters/i)
      await expect(
        generateUniqueTeammateName('team-lead', undefined),
      ).rejects.toThrow(/reserved name/i)
      await expect(
        generateUniqueTeammateName('user', undefined),
      ).rejects.toThrow(/reserved name/i)
      await expect(
        generateUniqueTeammateName('system', undefined),
      ).rejects.toThrow(/reserved name/i)
    })
  })

  describe('1.3 sessionTeam non-UUID sessionId truncation/sanitization and base58 decoding', () => {
    test('sessionTeamName handles UUIDs, tagged base58 session IDs, and arbitrary non-UUIDs', () => {
      // Standard UUID → session-<8hex>
      expect(sessionTeamName('12345678-abcd-ef01-2345-6789abcdef01')).toBe(
        'session-12345678',
      )

      // Custom non-UUID → sanitized and capped at 120 chars after "session-"
      expect(sessionTeamName('custom_session.id/123')).toBe(
        'session-custom-session-id-123',
      )
      const veryLongId = 'x'.repeat(200)
      const longTeam = sessionTeamName(veryLongId)
      expect(longTeam.startsWith('session-')).toBe(true)
      expect(longTeam.length).toBeLessThanOrEqual('session-'.length + 120)

      // Empty/punctuation-only falls back cleanly
      expect(sessionTeamName('!!!')).toBe('session-default')

      // Tagged base58 session ID decodes to a canonical UUID
      const tagged = 'session_011111111111111111111111'
      const decoded = decodeTaggedSessionUuid(tagged)
      expect(decoded).toBe('00000000-0000-0000-0000-000000000000')
      expect(sessionTeamName(tagged)).toBe(
        'session-00000000-0000-0000-0000-000000000000',
      )
    })

    test('isValidSessionTaskListId rejects control chars and path traversal', () => {
      expect(isValidSessionTaskListId('session-tasks-123')).toBe(true)
      expect(isValidSessionTaskListId('')).toBe(false)
      expect(isValidSessionTaskListId('bad\x00id')).toBe(false)
      expect(isValidSessionTaskListId('bad\u009bid')).toBe(false)
      expect(isValidSessionTaskListId('../escape')).toBe(false)
      expect(isValidSessionTaskListId('a/b')).toBe(false)
      expect(isValidSessionTaskListId('a\\b')).toBe(false)
    })
  })

  describe('1.4 Stale shutdown frame guard on teammate respawn', () => {
    let tempConfigDir: string
    let prevConfigDir: string | undefined

    beforeEach(() => {
      tempConfigDir = mkdtempSync(join(tmpdir(), 'p2-stale-shutdown-'))
      prevConfigDir = process.env.CLAUDE_CONFIG_DIR
      process.env.CLAUDE_CONFIG_DIR = tempConfigDir
    })

    afterEach(() => {
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
      rmSync(tempConfigDir, { recursive: true, force: true })
    })

    test('isShutdownFrameStale marks frames at or before respawn joinedAt as stale', async () => {
      const teamName = 'respawn-team'
      const respawnJoinedAt = 1_700_000_050_000
      await writeTeamFileAsync(teamName, {
        name: teamName,
        createdAt: 1_700_000_000_000,
        leadAgentId: `team-lead@${teamName}`,
        leadSessionId: 'lead-session-1',
        members: [
          {
            agentId: `worker@${teamName}`,
            name: 'worker',
            agentType: 'general-purpose',
            joinedAt: respawnJoinedAt,
            tmuxPaneId: 'in-process',
            cwd: '/tmp',
            subscriptions: [],
          },
        ],
      })

      // Old shutdown frame before respawn → stale
      expect(
        await isShutdownFrameStale(
          teamName,
          `worker@${teamName}`,
          new Date(respawnJoinedAt - 10_000).toISOString(),
        ),
      ).toBe(true)

      // Exact boundary (joinedAt >= frameTs) → stale
      expect(
        await isShutdownFrameStale(
          teamName,
          `worker@${teamName}`,
          new Date(respawnJoinedAt).toISOString(),
        ),
      ).toBe(true)

      // Newer shutdown frame after respawn → fresh (not stale)
      expect(
        await isShutdownFrameStale(
          teamName,
          `worker@${teamName}`,
          new Date(respawnJoinedAt + 5_000).toISOString(),
        ),
      ).toBe(false)
    })

    test('SendMessageTool refuses stale shutdown_response after teammate respawn', async () => {
      const teamName = 'respawn-send-team'
      const respawnJoinedAt = 1_700_000_050_000
      await writeTeamFileAsync(teamName, {
        name: teamName,
        createdAt: 1_700_000_000_000,
        leadAgentId: `team-lead@${teamName}`,
        leadSessionId: 'lead-session-1',
        members: [
          {
            agentId: `worker@${teamName}`,
            name: 'worker',
            agentType: 'general-purpose',
            joinedAt: respawnJoinedAt,
            tmuxPaneId: 'in-process',
            cwd: '/tmp',
            subscriptions: [],
          },
        ],
      })

      const staleRequestId = `shutdown-${respawnJoinedAt - 5_000}@worker`
      recordPendingShutdownRequest(staleRequestId, 'worker', true)
      try {
        const res = await runWithTeammateContext(
          {
            agentId: `worker@${teamName}`,
            agentName: 'worker',
            teamName,
            parentSessionId: 'lead-session-1',
            planModeRequired: false,
            isInProcess: true,
            abortController: new AbortController(),
          },
          () =>
            SendMessageTool.call(
              {
                to: 'team-lead',
                message: {
                  type: 'shutdown_response',
                  request_id: staleRequestId,
                  approve: true,
                },
              },
              {
                getAppState: () =>
                  ({
                    teamContext: {
                      teamName,
                      leadAgentId: `team-lead@${teamName}`,
                      teammates: {},
                    },
                    agentNameRegistry: new Map(),
                    tasks: {},
                  }) as unknown as ReturnType<ToolUseContext['getAppState']>,
                setAppState: () => {},
              } as unknown as ToolUseContext,
              async () => ({ behavior: 'allow', updatedInput: {} }),
              {} as never,
            ),
        )
        expect(res.data.success).toBe(false)
        expect(res.data.message).toMatch(
          /stale shutdown request sent before this teammate joined/i,
        )
      } finally {
        resetPendingShutdownRequestsForTesting()
      }
    })
  })

  describe('1.5 SendMessageTool non-UDS "to" schema description copy', () => {
    test('matches official 2.1.331 copy', () => {
      const desc = SendMessageTool.inputSchema.shape.to.description
      expect(desc).toBe(
        'Recipient: a background agent\'s name or agentId, a teammate name, or "main"',
      )
    })
  })

  describe('1.6 planDigest verification and handlePlanApproval binding', () => {
    let tempConfigDir: string
    let prevConfigDir: string | undefined

    beforeEach(() => {
      clearShownPlanDigests()
      tempConfigDir = mkdtempSync(join(tmpdir(), 'p2-plan-digest-'))
      prevConfigDir = process.env.CLAUDE_CONFIG_DIR
      process.env.CLAUDE_CONFIG_DIR = tempConfigDir
    })

    afterEach(() => {
      clearShownPlanDigests()
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
      rmSync(tempConfigDir, { recursive: true, force: true })
    })

    test('recordShownPlanDigest, conflicting digest invalidation, and verifyPlanApprovalBinding', () => {
      const planA = 'Step 1: refactor\nStep 2: test'
      const planB = 'Step 1: rm -rf /'
      const digestA = computePlanDigest(planA)
      expect(digestA).toHaveLength(64)

      recordShownPlanDigest('req-1', planA)
      expect(getShownPlanDigest('req-1')).toBe(digestA)

      // Same content keeps digest valid
      recordShownPlanDigest('req-1', planA)
      expect(getShownPlanDigest('req-1')).toBe(digestA)

      // Conflicting plan content for same requestId invalidates (fail-closed)
      recordShownPlanDigest('req-1', planB)
      expect(getShownPlanDigest('req-1')).toBeUndefined()

      // Schema accepts optional planDigest
      const parsed = PlanApprovalResponseMessageSchema().parse({
        type: 'plan_approval_response',
        requestId: 'req-2',
        approved: true,
        timestamp: new Date().toISOString(),
        planDigest: digestA,
      })
      expect(parsed.planDigest).toBe(digestA)

      // Binding verification
      expect(
        verifyPlanApprovalBinding(
          { requestId: 'req-2', answered: false, planDigest: digestA },
          { requestId: 'req-2', approved: true, planDigest: digestA },
          true,
        ),
      ).toBe('bound')

      expect(
        verifyPlanApprovalBinding(
          { requestId: 'req-2', answered: false, planDigest: digestA },
          {
            requestId: 'req-2',
            approved: true,
            planDigest: computePlanDigest(planB),
          },
          true,
        ),
      ).toBe('plan_digest_mismatch')

      expect(
        verifyPlanApprovalBinding(
          { requestId: 'req-2', answered: false, planDigest: digestA },
          { requestId: 'req-2', approved: true, planDigest: undefined },
          true,
        ),
      ).toBe('plan_digest_mismatch')

      // invalidateAllShownPlanDigests clears lookup cleanly
      recordShownPlanDigest('req-3', planA)
      expect(getShownPlanDigest('req-3')).toBe(digestA)
      invalidateAllShownPlanDigests()
      expect(getShownPlanDigest('req-3')).toBeUndefined()
    })

    test('SendMessageTool handlePlanApproval embeds planDigest and warns pane teammates when missing', async () => {
      const teamName = 'plan-team'
      await writeTeamFileAsync(teamName, {
        name: teamName,
        createdAt: Date.now(),
        leadAgentId: `team-lead@${teamName}`,
        leadSessionId: 'lead-1',
        members: [
          {
            agentId: `planner@${teamName}`,
            name: 'planner',
            agentType: 'general-purpose',
            joinedAt: Date.now(),
            tmuxPaneId: '%42', // pane teammate (not 'in-process')
            cwd: '/tmp',
            subscriptions: [],
          },
        ],
      })

      const ctx = {
        getAppState: () =>
          ({
            teamContext: {
              teamName,
              leadAgentId: `team-lead@${teamName}`,
              teammates: {},
            },
            toolPermissionContext: { mode: 'default' },
            agentNameRegistry: new Map(),
            tasks: {},
          }) as unknown as ReturnType<ToolUseContext['getAppState']>,
        setAppState: () => {},
      } as unknown as ToolUseContext

      // 1) With recorded shown plan digest → mailbox payload includes planDigest
      const planText = '1. Edit config\n2. Run tests'
      recordShownPlanDigest('plan-req-ok', planText)
      const okRes = await SendMessageTool.call(
        {
          to: 'planner',
          message: {
            type: 'plan_approval_response',
            request_id: 'plan-req-ok',
            approve: true,
          },
        },
        ctx,
        async () => ({ behavior: 'allow', updatedInput: {} }),
        {} as never,
      )
      expect(okRes.data.success).toBe(true)
      expect(okRes.data.message).not.toContain(
        'No single plan is on record for this request',
      )
      const mailbox = await readMailbox('planner', teamName)
      expect(mailbox).toHaveLength(1)
      const payload = JSON.parse(mailbox[0]!.text) as {
        planDigest?: string
        approved: boolean
      }
      expect(payload.approved).toBe(true)
      expect(payload.planDigest).toBe(computePlanDigest(planText))

      // 2) Without shown plan digest for pane teammate → includes official warning note
      const missingRes = await SendMessageTool.call(
        {
          to: 'planner',
          message: {
            type: 'plan_approval_response',
            request_id: 'plan-req-unknown',
            approve: true,
          },
        },
        ctx,
        async () => ({ behavior: 'allow', updatedInput: {} }),
        {} as never,
      )
      expect(missingRes.data.success).toBe(true)
      expect(missingRes.data.message).toContain(
        'No single plan is on record for this request',
      )
    })
  })

  describe('1.7 teammateModel CLAUDE_CODE_SUBAGENT_MODEL fallback and availableModels clamping', () => {
    test('applies CLAUDE_CODE_SUBAGENT_MODEL, FORCE override, availableModels clamping, and parent tier match', () => {
      // CLAUDE_CODE_SUBAGENT_MODEL applies when inputModel is omitted
      expect(
        resolveTeammateModelWith(undefined, 'claude-opus-4-6', {
          mainLoopModel: 'claude-sonnet-4-6',
          hardcodedFallback: 'claude-sonnet-4-6',
          defaultSubagentModel: 'claude-sonnet-4-6',
          isAllowed: () => true,
        }),
      ).toBe('claude-sonnet-4-6')

      // Explicit model beats soft CLAUDE_CODE_SUBAGENT_MODEL, while FORCE overrides explicit model
      expect(
        resolveTeammateModelWith('haiku', 'claude-opus-4-6', {
          mainLoopModel: 'claude-sonnet-4-6',
          hardcodedFallback: 'claude-sonnet-4-6',
          defaultSubagentModel: 'claude-sonnet-4-6',
          isAllowed: () => true,
        }),
      ).toBe('haiku')

      expect(
        resolveTeammateModelWith('haiku', 'claude-opus-4-6', {
          mainLoopModel: 'claude-sonnet-4-6',
          hardcodedFallback: 'claude-sonnet-4-6',
          defaultSubagentModel: 'claude-opus-4-6',
          forceSubagentModel: true,
          isAllowed: () => true,
        }),
      ).toBe('claude-opus-4-6')

      // availableModels clamping: stepDownFamily when candidate is disallowed
      expect(
        resolveTeammateModelWith('opus', 'claude-sonnet-4-6', {
          mainLoopModel: 'claude-sonnet-4-6',
          hardcodedFallback: 'claude-sonnet-4-6',
          isAllowed: m => m === 'claude-opus-4-5' || m === 'claude-sonnet-4-6',
          stepDownFamily: m => (m === 'opus' ? 'claude-opus-4-5' : null),
        }),
      ).toBe('claude-opus-4-5')

      // availableModels clamping: falls back to allowed leader when candidate disallowed and no step-down
      expect(
        resolveTeammateModelWith('opus', 'claude-sonnet-4-6', {
          mainLoopModel: 'claude-sonnet-4-6',
          hardcodedFallback: 'claude-haiku-4-5',
          isAllowed: m => m === 'claude-sonnet-4-6',
          stepDownFamily: () => null,
        }),
      ).toBe('claude-sonnet-4-6')

      // Bare family alias matching parent tier inherits leader exact string
      expect(
        resolveTeammateModelWith('opus', 'claude-opus-4-6[1m]', {
          mainLoopModel: 'claude-sonnet-4-6',
          hardcodedFallback: 'claude-sonnet-4-6',
          isAllowed: () => true,
          matchesParentTier: (alias, leader) =>
            alias === 'opus' && leader.includes('opus'),
        }),
      ).toBe('claude-opus-4-6[1m]')
    })
  })

  describe('1.8 teammate_spawned payload fields (started_away_from_shell, resolvedModel, outputFile)', () => {
    test('AgentTool.mapToolResultToToolResultBlockParam emits started_away_from_shell notice', () => {
      const withAway = AgentTool.mapToolResultToToolResultBlockParam(
        {
          status: 'teammate_spawned',
          prompt: 'do work',
          teammate_id: 'worker@team-1',
          agent_id: 'worker@team-1',
          agentId: 'worker@team-1',
          name: 'worker',
          team_name: 'team-1',
          tmux_session_name: 'claude-swarm',
          tmux_window_name: 'swarm-view',
          tmux_pane_id: '%12',
          resolvedModel: 'claude-sonnet-4-6',
          outputFile: '/tmp/worker.output',
          started_away_from_shell: true,
        } as unknown as Parameters<
          typeof AgentTool.mapToolResultToToolResultBlockParam
        >[0],
        'toolu_1',
      )
      const textWithAway = Array.isArray(withAway.content)
        ? withAway.content.map(c => ('text' in c ? c.text : '')).join('\n')
        : String(withAway.content)
      expect(textWithAway).toContain("started in the session's own folder")
      expect(textWithAway).toContain('worker@team-1')

      const withoutAway = AgentTool.mapToolResultToToolResultBlockParam(
        {
          status: 'teammate_spawned',
          prompt: 'do work',
          teammate_id: 'worker@team-1',
          agent_id: 'worker@team-1',
          name: 'worker',
          team_name: 'team-1',
          tmux_session_name: 'in-process',
          tmux_window_name: 'in-process',
          tmux_pane_id: 'in-process',
          resolvedModel: 'claude-sonnet-4-6',
          outputFile: '/tmp/worker.output',
          started_away_from_shell: false,
        } as unknown as Parameters<
          typeof AgentTool.mapToolResultToToolResultBlockParam
        >[0],
        'toolu_2',
      )
      const textWithoutAway = Array.isArray(withoutAway.content)
        ? withoutAway.content.map(c => ('text' in c ? c.text : '')).join('\n')
        : String(withoutAway.content)
      expect(textWithoutAway).not.toContain(
        "started in the session's own folder",
      )
    })
  })

  // =========================================================================
  // Group 2: Monitor / TaskStop / XML / ToolSearch (4 items)
  // =========================================================================

  describe('2.1 MonitorTool UTF-16 pipedStdoutBytes, keepalive dedupe, and whenToUse copy', () => {
    test('TaskOutput.pipedStdoutBytes and hasMonitorStderrOutput avoid UTF-8/CJK false positives', () => {
      const output = new TaskOutput('monitor-utf8-test', null, false)
      try {
        // CJK + astral emoji: UTF-8 byteLength (19) !== UTF-16 .length (7)
        const cjkLine = '你好世界🎉\n'
        expect(Buffer.byteLength(cjkLine, 'utf8')).toBeGreaterThan(
          cjkLine.length,
        )

        output.writeStdout(cjkLine)
        expect(output.totalBytes).toBe(cjkLine.length)
        expect(output.pipedStdoutBytes).toBe(cjkLine.length)
        expect(hasMonitorStderrOutput(output, cjkLine.length)).toBe(false)

        // Writing 1 char to stderr immediately triggers stderr detection
        output.writeStderr('!')
        expect(output.totalBytes).toBe(cjkLine.length + 1)
        expect(output.pipedStdoutBytes).toBe(cjkLine.length)
        expect(hasMonitorStderrOutput(output, cjkLine.length)).toBe(true)
      } finally {
        output.clear()
      }
    })

    test('MonitorTool has official 2.1.331 whenToUse copy and no duplicate :stream keepalive key', () => {
      expect(MonitorTool.whenToUse).toBe(
        'When you are about to check a log, process or job again and again to catch each new event, use it and not repeated Bash calls or sleeps.',
      )
      const monitorSrc = readFileSync(
        join(
          REPO_ROOT,
          'packages/builtin-tools/src/tools/MonitorTool/MonitorTool.tsx',
        ),
        'utf-8',
      )
      expect(monitorSrc).not.toContain('`monitor:${handle.taskId}:stream`')
      expect(monitorSrc).toContain('monitorKeepaliveReason(handle.taskId)')
    })
  })

  describe('2.2 stopTask self-stop ownership check and Wre truncation before XML escaping', () => {
    test('local_agent can stop itself while another non-main agent gets official 2.1.331 not_owner message', async () => {
      const makeTasks = () => ({
        a1: {
          id: 'a1',
          type: 'local_agent' as const,
          status: 'running' as const,
          description: 'self-stop test agent',
          agentId: 'a1',
          ownerAgentId: 'parent-agent',
          startTime: Date.now(),
          outputFile: '',
          outputOffset: 0,
          notified: false,
          prompt: 'work',
          selectedAgent: { agentType: 'general-purpose' },
          agentType: 'general-purpose',
          abortController: new AbortController(),
          messages: [],
          progress: { toolUseCount: 0, tokenCount: 0 },
          isBackgrounded: true,
        },
      })

      // Different non-main agent is rejected with official message
      let tasks1: Record<string, TaskState> = makeTasks() as unknown as Record<
        string,
        TaskState
      >
      await expect(
        stopTask('a1', {
          getAppState: () =>
            ({ tasks: tasks1 }) as unknown as ReturnType<
              ToolUseContext['getAppState']
            >,
          setAppState: fn => {
            const next = fn({ tasks: tasks1 } as unknown as ReturnType<
              ToolUseContext['getAppState']
            >)
            tasks1 = next.tasks
          },
          callerAgentId: 'other-agent',
        }),
      ).rejects.toThrow(
        new StopTaskError(
          'The main session, the user or the agent itself can stop task a1; agent other-agent cannot stop it.',
          'not_owner',
        ),
      )

      // The agent itself (`callerAgentId === agentTask.agentId`) is allowed to stop itself!
      let tasks2: Record<string, TaskState> = makeTasks() as unknown as Record<
        string,
        TaskState
      >
      const selfStopRes = await stopTask('a1', {
        getAppState: () =>
          ({ tasks: tasks2 }) as unknown as ReturnType<
            ToolUseContext['getAppState']
          >,
        setAppState: fn => {
          const next = fn({ tasks: tasks2 } as unknown as ReturnType<
            ToolUseContext['getAppState']
          >)
          tasks2 = next.tasks
        },
        callerAgentId: 'a1',
      })
      expect(selfStopRes.taskId).toBe('a1')
      expect(tasks2.a1?.status).toBe('killed')
    })

    test('truncateStopSummary (Wre) preserves <=1000 chars, protects UTF-16 surrogates, and TaskStopTool applies Wre in mapToolResultToToolResultBlockParam', () => {
      const exact1000 = 'a'.repeat(1000)
      expect(truncateStopSummary(exact1000)).toBe(exact1000)

      // Place surrogate pair right across the 500-char head cut and 300-char tail cut
      const withSurrogates = `${'a'.repeat(499)}🚀${'b'.repeat(500)}🚀${'c'.repeat(299)}`
      const truncated = truncateStopSummary(withSurrogates)
      expect(truncated).toContain('chars omitted')
      // Must not leave lone high/low surrogate code units
      for (let i = 0; i < truncated.length; i++) {
        const code = truncated.charCodeAt(i)
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = truncated.charCodeAt(i + 1)
          expect(next >= 0xdc00 && next <= 0xdfff).toBe(true)
        }
      }

      // TaskStopTool.mapToolResultToToolResultBlockParam truncates long command via Wre
      const longCmd = `${'x'.repeat(600)}&<>${'y'.repeat(600)}`
      const block = TaskStopTool.mapToolResultToToolResultBlockParam(
        {
          message: 'Successfully stopped task: t1',
          task_id: 't1',
          task_type: 'local_bash',
          command: longCmd,
        },
        'toolu_stop_1',
      )
      const parsed = JSON.parse(String(block.content)) as { command?: string }
      expect(parsed.command).toBe(truncateStopSummary(longCmd))
      expect(parsed.command).toContain('chars omitted')
    })
  })

  describe('2.3 Escape literal </task-notification> inside trailing XML content', () => {
    test('escapeTaskNotificationTrailing and formatTaskNotificationXml neutralize closing tags', () => {
      const untrusted =
        'before </task-notification> middle </TASK-NOTIFICATION> spaced < / task-notification > <ok>keep</ok>'
      const escaped = escapeTaskNotificationTrailing(untrusted)
      expect(escaped).not.toMatch(/<\s*\/\s*task-notification\b/i)
      expect(escaped).toContain('&lt;/task-notification>')
      expect(escaped).toContain('&lt;/TASK-NOTIFICATION>')
      expect(escaped).toContain('&lt; / task-notification >')
      expect(escaped).toContain('<ok>keep</ok>')

      const xml = formatTaskNotificationXml({
        taskId: 'task-1',
        status: 'completed',
        summary: 'done',
        trailing: untrusted,
      })
      const closingMatches = xml.match(/<\s*\/\s*task-notification\s*>/gi) ?? []
      expect(closingMatches).toHaveLength(1)
      expect(xml).toContain('\n</task-notification>')
      expect(xml).toContain('&lt;/task-notification>')
    })
  })

  describe('2.4 SearchExtraToolsTool ScheduleWakeup exemption removed', () => {
    test('ScheduleWakeupTool sets shouldDefer: false directly and isDeferredTool has no hardcoded exemption', () => {
      expect(ScheduleWakeupTool.shouldDefer).toBe(false)
      expect(isDeferredTool(ScheduleWakeupTool)).toBe(false)
      // Synthetic tool named ScheduleWakeup with shouldDefer: true is NOT exempted
      expect(
        isDeferredTool({
          name: 'ScheduleWakeup',
          shouldDefer: true,
        } as unknown as typeof ScheduleWakeupTool),
      ).toBe(true)
    })
  })

  // =========================================================================
  // Group 3: /config & IDE / UDS / Scratchpad / Policy Copy (6 items)
  // =========================================================================

  describe('3.1 Config.tsx exit summary, ANSI sanitization, previousValue wrap, precomputeCompactionEnabled default, and fast PreModelSwitch', () => {
    test('buildConfigExitSummaryLines covers arbitrary changed core settings and plugin options', () => {
      const coreSetting: Setting = {
        id: 'emojiCompletionEnabled',
        label: 'Emoji shortcode completion',
        value: false,
        type: 'boolean',
        onChange: () => {},
      }
      const pluginBool: Setting = {
        id: 'my-plugin.enableLint',
        label: 'Enable lint',
        value: true,
        type: 'boolean',
        provided: {
          plugin: 'my-plugin',
          pluginId: 'my-plugin@local',
          description: 'Run linter',
          kind: 'boolean',
        },
        onChange: () => {},
      }
      const pluginText: Setting = {
        id: 'my-plugin.endpoint',
        label: 'Endpoint URL',
        value: 'https://secret.example.com',
        type: 'managedEnum',
        provided: {
          plugin: 'my-plugin',
          pluginId: 'my-plugin@local',
          description: 'Server URL',
          kind: 'text',
        },
        onChange: () => {},
      }

      const lines = buildConfigExitSummaryLines(
        [
          { id: 'emojiCompletionEnabled', before: 'true', asked: 'false' },
          { id: 'my-plugin.enableLint', before: 'false', asked: 'true' },
          {
            id: 'my-plugin.endpoint',
            before: 'old',
            asked: 'https://secret.example.com',
          },
          // Already covered ID should not duplicate
          { id: 'theme', before: 'dark', asked: 'light' },
        ],
        [coreSetting, pluginBool, pluginText],
        ['Set theme to light'],
        new Set(['apiKey', 'theme']),
        false,
      )

      expect(lines).toHaveLength(4)
      expect(lines[0]).toBe('Set theme to light')
      expect(lines[1]).toContain('Emoji shortcode completion')
      expect(lines[1]).toContain('false')
      expect(lines[2]).toContain('Enable lint (my-plugin)')
      expect(lines[2]).toContain('true')
      // Free-text plugin option emits "Changed <label> (<plugin>)" without leaking raw text
      expect(lines[3]).toBe('Changed Endpoint URL (my-plugin)')
      expect(formatConfigExitSummaryLine(pluginText)).toBe(
        'Changed Endpoint URL (my-plugin)',
      )
    })

    test('sanitizeConfigErrorMessage strips ANSI CSI, OSC 8 hyperlinks, and C0/C1 control chars', () => {
      const dirty =
        '\x1b[31mDenied\x1b[0m: \x1b]8;;https://evil.test\x07click\x1b]8;;\x07 \u009b32mgreen\x07'
      const clean = sanitizeConfigErrorMessage(dirty)
      expect(clean).not.toContain('\x1b')
      expect(clean).not.toContain('\u009b')
      expect(clean).not.toContain('\x07')
      expect(clean).toContain('Denied')
      expect(clean).toContain('click')
    })

    test('cycleEnumOptionIndex wraps backward on select:previousValue (-1) and forward on +1', () => {
      // Backward wrap from 0 → last index (3)
      expect(cycleEnumOptionIndex(0, 4, -1)).toBe(3)
      expect(cycleEnumOptionIndex(2, 4, -1)).toBe(1)
      // Forward wrap from last index (3) → 0
      expect(cycleEnumOptionIndex(3, 4, 1)).toBe(0)
      expect(cycleEnumOptionIndex(1, 4, 1)).toBe(2)
      // Missing value (-1)
      expect(cycleEnumOptionIndex(-1, 4, -1)).toBe(3)
      expect(cycleEnumOptionIndex(-1, 4, 1)).toBe(0)

      // Source check: select:previousValue calls toggleSetting(-1), precomputeCompactionEnabled defaults true
      const configSrc = readFileSync(
        join(REPO_ROOT, 'src/components/Settings/Config.tsx'),
        'utf-8',
      )
      expect(configSrc).toContain('toggleSetting(-1)')
      expect(configSrc).toContain(
        'settingsData?.precomputeCompactionEnabled ?? true',
      )
    })

    test('runFastModePreModelSwitchCheck handles proceed, block, ask, stale model change, and no-promotion skip', async () => {
      // 1) Already on fast-capable model → skips hooks
      let hooksCalled = 0
      const noPromote = await runFastModePreModelSwitchCheck({
        readCurrentModel: () => 'opus',
        messages: [],
        getPromotionTarget: () => undefined,
        runHooks: async () => {
          hooksCalled++
          return { decision: 'proceed', skipConfirm: false, messages: [] }
        },
      })
      expect(noPromote).toEqual({
        allowed: true,
        targetModel: undefined,
        messageSuffix: '',
      })
      expect(hooksCalled).toBe(0)

      // 2) Hook proceeds with ANSI-tainted message → allowed with sanitized suffix
      const proceeded = await runFastModePreModelSwitchCheck({
        readCurrentModel: () => 'sonnet',
        messages: [],
        getPromotionTarget: () => 'opus',
        runHooks: async () => ({
          decision: 'proceed',
          skipConfirm: false,
          messages: ['\x1b[32mapproved by policy\x1b[0m'],
        }),
      })
      expect(proceeded).toEqual({
        allowed: true,
        targetModel: 'opus',
        messageSuffix: ' · approved by policy',
      })

      // 3) Hook blocks → refused with sanitized error
      const blocked = await runFastModePreModelSwitchCheck({
        readCurrentModel: () => 'sonnet',
        messages: [],
        getPromotionTarget: () => 'opus',
        runHooks: async () => ({
          decision: 'block',
          reason: '\x1b[31mopus disabled\x1b[0m',
          messages: [],
        }),
      })
      expect(blocked.allowed).toBe(false)
      if (!blocked.allowed) {
        expect(blocked.error?.message).toContain('opus disabled')
        expect(blocked.error?.message).not.toContain('\x1b')
      }

      // 4) Hook asks → refused with official "(run /model to switch, then enable fast mode)" hint
      const asked = await runFastModePreModelSwitchCheck({
        readCurrentModel: () => 'sonnet',
        messages: [],
        getPromotionTarget: () => 'opus',
        runHooks: async () => ({
          decision: 'ask',
          reason: 'budget check',
          messages: [],
        }),
      })
      expect(asked.allowed).toBe(false)
      if (!asked.allowed) {
        expect(asked.error?.message).toContain(
          'budget check (run /model to switch, then enable fast mode)',
        )
      }

      // 5) Model changed while hooks ran → rejected with stale promotion error
      let currentModel = 'sonnet'
      const staleModel = await runFastModePreModelSwitchCheck({
        readCurrentModel: () => currentModel,
        messages: [],
        getPromotionTarget: () => 'opus',
        runHooks: async () => {
          currentModel = 'haiku'
          return { decision: 'proceed', skipConfirm: false, messages: [] }
        },
      })
      expect(staleModel.allowed).toBe(false)
      if (!staleModel.allowed) {
        expect(staleModel.error?.message).toContain(
          'the model changed while PreModelSwitch hooks ran',
        )
      }

      // 6) Superseded pick (`isStale() === true`) → silent stale abort
      const superseded = await runFastModePreModelSwitchCheck({
        readCurrentModel: () => 'sonnet',
        messages: [],
        getPromotionTarget: () => 'opus',
        isStale: () => true,
        runHooks: async () => ({
          decision: 'proceed',
          skipConfirm: false,
          messages: [],
        }),
      })
      expect(superseded).toEqual({ allowed: false, stale: true })
    })
  })

  describe('3.2 ide.ts inside-cwd matching and realpath lockfile directory deduplication', () => {
    test('classifyIdeWorkspaceMatch handles contains-cwd, inside-cwd, unrelated, and trailing slashes', () => {
      expect(classifyIdeWorkspaceMatch('/repo/packages/app', '/repo')).toBe(
        'contains-cwd',
      )
      expect(classifyIdeWorkspaceMatch('/repo', '/repo/')).toBe('contains-cwd')
      expect(classifyIdeWorkspaceMatch('/repo/', '/repo')).toBe('contains-cwd')
      expect(classifyIdeWorkspaceMatch('/repo', '/repo/packages/app')).toBe(
        'inside-cwd',
      )
      expect(classifyIdeWorkspaceMatch('/repo-a', '/repo-b')).toBe('unrelated')
      expect(classifyIdeWorkspaceMatch('/repo-a', '/repo-ab')).toBe('unrelated')
    })

    test('deduplicateIdeLockfileDirs deduplicates symlinks via realpath', async () => {
      const root = mkdtempSync(join(tmpdir(), 'p2-ide-dedupe-'))
      try {
        const realDir = join(root, 'real-ide')
        const linkDir = join(root, 'link-ide')
        mkdirSync(realDir, { recursive: true })
        symlinkSync(realDir, linkDir)

        const deduped = await deduplicateIdeLockfileDirs([realDir, linkDir])
        expect(deduped).toEqual([realDir])
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  })

  describe('3.3 udsMessaging.ts synchronous exit listener keyfile cleanup', () => {
    test('registers unlinkUdsKeyFilesOnExit on process exit and cleans up keyfile synchronously', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'p2-uds-exit-'))
      const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
      process.env.CLAUDE_CONFIG_DIR = tempDir
      const sockPath = join(tempDir, 'test.sock')
      try {
        await startUdsMessaging(sockPath)
        expect(process.listeners('exit')).toContain(unlinkUdsKeyFilesOnExit)
        // Calling unlinkUdsKeyFilesOnExit must cleanly unlink without throwing
        expect(() => unlinkUdsKeyFilesOnExit()).not.toThrow()
      } finally {
        await stopUdsMessaging()
        if (prevConfigDir === undefined) {
          delete process.env.CLAUDE_CONFIG_DIR
        } else {
          process.env.CLAUDE_CONFIG_DIR = prevConfigDir
        }
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })

  describe('3.4 Scratchpad onSessionSwitch cache reset and startup try/catch', () => {
    test('getScratchpadDir resets cached paths on switchSession and init.ts wraps startup ensureScratchpadDir', () => {
      const origSession = getSessionId()
      try {
        resetScratchpadDirCache()
        switchSession(asSessionId('p2-scratch-session-a'))
        const dirA = getScratchpadDir()
        expect(dirA).toContain('p2-scratch-session-a')

        switchSession(asSessionId('p2-scratch-session-b'))
        const dirB = getScratchpadDir()
        expect(dirB).toContain('p2-scratch-session-b')
        expect(dirB).not.toBe(dirA)

        // Changing originalCwd also computes fresh path cleanly
        const prevCwd = process.cwd()
        try {
          setOriginalCwd(join(tmpdir(), 'p2-scratch-cwd-check'))
          const dirC = getScratchpadDir()
          expect(dirC).toContain('p2-scratch-session-b')
          expect(dirC).not.toBe(dirB)
        } finally {
          setOriginalCwd(prevCwd)
          resetScratchpadDirCache()
        }
      } finally {
        switchSession(origSession)
      }

      const initSrc = readFileSync(
        join(REPO_ROOT, 'src/entrypoints/init.ts'),
        'utf-8',
      )
      expect(initSrc).toContain('init: ensureScratchpadDir failed:')
      expect(initSrc).toContain('onSessionSwitch(')
    })
  })

  describe('3.5 Policy display label uses "enterprise managed settings"', () => {
    test('permissionRuleEdit.ts uses "enterprise managed settings" and never "host managed settings"', () => {
      const src = readFileSync(
        join(REPO_ROOT, 'src/cli/handlers/permissionRuleEdit.ts'),
        'utf-8',
      )
      expect(src).not.toContain('host managed settings')
      expect(src).toContain(
        'enterprise managed settings allow only managed permission rules; rules cannot be added or removed',
      )
      expect(src).toContain(
        'enterprise managed settings could not be read, so permission rules cannot be edited',
      )
    })
  })
})
