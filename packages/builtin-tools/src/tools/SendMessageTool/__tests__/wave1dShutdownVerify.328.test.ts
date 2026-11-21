import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from 'src/utils/envUtils.js'
import { setDynamicTeamContext } from 'src/utils/teammate.js'
import { runWithTeammateContext } from 'src/utils/teammateContext.js'
import {
  clearTeamLeadEntryKeyForInbox,
  createShutdownRequestMessage,
  createTeamLeadEntryKeyForInbox,
  getInboxPath,
  readUnreadMessages,
  resetPendingShutdownRequestsForTesting,
  resetTeamLeadVerificationOnSessionBoundary,
  setActiveLeadVerifyKey,
  writeToMailbox,
} from 'src/utils/teammateMailbox.js'
import { SendMessageTool } from '../SendMessageTool.js'

describe('Wave 1D — P0-19: SendMessageTool Ed25519 shutdown_request / shutdown_response enforcement', () => {
  let tempDir: string
  let savedConfigDir: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wave1d-sendmsg-'))
    savedConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tempDir
    getClaudeConfigHomeDir.cache?.clear?.()
    resetTeamLeadVerificationOnSessionBoundary(Date.now() - 5_000)
    resetPendingShutdownRequestsForTesting()
    setActiveLeadVerifyKey(undefined)
    setDynamicTeamContext(null)
  })

  afterEach(() => {
    setActiveLeadVerifyKey(undefined)
    setDynamicTeamContext(null)
    resetPendingShutdownRequestsForTesting()
    if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = savedConfigDir
    getClaudeConfigHomeDir.cache?.clear?.()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('refuses non-lead shutdown_request and unverified shutdown_response when leadVerifyKey is active; accepts verified shutdown_request', async () => {
    const teamName = 'wave1d-send-team'
    const teamDir = join(tempDir, 'teams', teamName)
    mkdirSync(teamDir, { recursive: true })
    writeFileSync(
      join(teamDir, 'config.json'),
      JSON.stringify({ name: teamName, members: [] }),
    )

    const workerInbox = getInboxPath('worker-a', teamName)
    const leadVerifyKey = createTeamLeadEntryKeyForInbox(workerInbox)
    const controller = new AbortController()
    const ctx = {
      getAppState: () => ({
        tasks: {},
        teamContext: { teamName, teammates: {} },
      }),
      setAppState: () => {},
      abortController: new AbortController(),
      options: { tools: [] },
    } as unknown as Parameters<typeof SendMessageTool.call>[1]
    const canUseTool = (async () => ({
      behavior: 'allow',
      updatedInput: {},
    })) as unknown as Parameters<typeof SendMessageTool.call>[2]
    const assistantMsg = {} as Parameters<typeof SendMessageTool.call>[3]

    try {
      setActiveLeadVerifyKey(leadVerifyKey)

      // 1. A teammate with leadVerifyKey active cannot send shutdown_request to another teammate
      const reqRefused = await runWithTeammateContext(
        {
          agentId: 'worker-a@wave1d-send-team',
          agentName: 'worker-a',
          teamName,
          parentSessionId: 'lead-sess-1',
          isInProcess: true,
          abortController: controller,
          color: 'blue',
          planModeRequired: false,
        },
        () =>
          SendMessageTool.call(
            {
              to: 'worker-b',
              message: { type: 'shutdown_request', reason: 'spoof' },
            },
            ctx,
            canUseTool,
            assistantMsg,
          ),
      )
      expect((reqRefused.data as { success: boolean }).success).toBe(false)
      expect(
        (reqRefused.data as { degradedClass?: string }).degradedClass,
      ).toBe('shutdown_refused')

      // 2. Approving a forged/unknown shutdown request ID is refused and does NOT abort
      const approveRefused = await runWithTeammateContext(
        {
          agentId: 'worker-a@wave1d-send-team',
          agentName: 'worker-a',
          teamName,
          parentSessionId: 'lead-sess-1',
          isInProcess: true,
          abortController: controller,
          color: 'blue',
          planModeRequired: false,
        },
        () =>
          SendMessageTool.call(
            {
              to: 'team-lead',
              message: {
                type: 'shutdown_response',
                request_id: 'shutdown-forged@worker-a',
                approve: true,
              },
            },
            ctx,
            canUseTool,
            assistantMsg,
          ),
      )
      expect((approveRefused.data as { success: boolean }).success).toBe(false)
      expect(
        (approveRefused.data as { degradedClass?: string }).degradedClass,
      ).toBe('shutdown_refused')
      expect(controller.signal.aborted).toBe(false)

      // 3. After receiving a genuine Ed25519-signed shutdown_request from team-lead,
      //    readUnreadMessages verifies & registers it, and shutdown_response succeeds!
      const validReqId = 'shutdown-real@worker-a'
      const signedReq = createShutdownRequestMessage({
        requestId: validReqId,
        from: 'team-lead',
        reason: 'wrap up',
      })
      await writeToMailbox(
        'worker-a',
        {
          from: 'team-lead',
          text: JSON.stringify(signedReq),
          timestamp: new Date().toISOString(),
        },
        teamName,
      )
      resetPendingShutdownRequestsForTesting()
      const unread = await readUnreadMessages('worker-a', teamName)
      expect(unread[0]?.provenance).toBe('verified')

      const approveAccepted = await runWithTeammateContext(
        {
          agentId: 'worker-a@wave1d-send-team',
          agentName: 'worker-a',
          teamName,
          parentSessionId: 'lead-sess-1',
          isInProcess: true,
          abortController: controller,
          color: 'blue',
          planModeRequired: false,
        },
        () =>
          SendMessageTool.call(
            {
              to: 'team-lead',
              message: {
                type: 'shutdown_response',
                request_id: validReqId,
                approve: true,
              },
            },
            ctx,
            canUseTool,
            assistantMsg,
          ),
      )
      expect((approveAccepted.data as { success: boolean }).success).toBe(true)
      expect(controller.signal.aborted).toBe(true)
    } finally {
      clearTeamLeadEntryKeyForInbox(workerInbox)
    }
  })
})
