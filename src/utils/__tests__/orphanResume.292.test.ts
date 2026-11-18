import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  buildOrphanWorkflowStoppedSummary,
  leftoverOrphanStoppedNote,
  notifyOrphanKindBatch,
  ORPHAN_WORKFLOW_STOPPED_PHRASE,
} from '../orphanAgentResume.js'
import {
  readPendingWakeup,
  resurrectPendingWakeupFromScan,
  writePendingWakeup,
} from '../orphanCronResume.js'

describe('v2.1.292-295 orphan resume alignment (#213, #389, #402)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orphan-resume-292-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('#213: readPendingWakeup/writePendingWakeup and resurrectPendingWakeupFromScan rearm future wakeup and notify past-due wakeup', async () => {
    const now = 1_700_000_000_000
    await writePendingWakeup(tempDir, {
      toolUseId: 'tu_wake_1',
      scheduledFor: now + 60_000,
      chainStartedAt: now - 10_000,
    })
    const loaded = await readPendingWakeup(tempDir)
    expect(loaded).toEqual({
      toolUseId: 'tu_wake_1',
      scheduledFor: now + 60_000,
      chainStartedAt: now - 10_000,
    })

    const rearmedCalls: Array<{ scheduledFor: number; prompt: string }> = []
    const resFuture = await resurrectPendingWakeupFromScan({
      sessionDir: tempDir,
      wakeupCalls: [
        {
          toolUseId: 'tu_wake_1',
          createdAt: now - 5_000,
          input: { prompt: 'tick loop', reason: 'poll' },
        },
      ],
      results: new Map([['tu_wake_1', { scheduledFor: now + 60_000 }]]),
      notifiedTaskIds: new Set(),
      nowMs: now,
      rearmWakeup: args => rearmedCalls.push(args),
    })
    expect(resFuture.kind).toBe('rearmed')
    expect(rearmedCalls).toHaveLength(1)
    expect(rearmedCalls[0]!.prompt).toBe('tick loop')

    // Past-due wakeup notifies instead of re-arming
    const pastDueNotifications: string[] = []
    const resPast = await resurrectPendingWakeupFromScan({
      sessionDir: tempDir,
      wakeupCalls: [
        {
          toolUseId: 'tu_wake_1',
          createdAt: now - 5_000,
          input: { prompt: 'tick loop' },
        },
      ],
      results: new Map([['tu_wake_1', { scheduledFor: now + 60_000 }]]),
      notifiedTaskIds: new Set(),
      nowMs: now + 120_000,
      rearmWakeup: () => {},
      onPastDueNotification: n => pastDueNotifications.push(n.summary),
    })
    expect(resPast.kind).toBe('past_due_notified')
    expect(pastDueNotifications[0]).toContain('/loop wakeup was due')
  })

  test('#389: workflow stopped summary does not mention TaskStop', () => {
    const summary = buildOrphanWorkflowStoppedSummary({
      taskId: 'wf-1',
      toolUseId: 'tu-1',
      workflowName: 'deploy',
    })
    expect(summary).not.toContain('TaskStop')
    expect(summary).toContain(ORPHAN_WORKFLOW_STOPPED_PHRASE)

    const batchMsg = notifyOrphanKindBatch({
      status: 'stopped',
      kind: 'workflow',
      label: 'workflow',
      taskIds: ['wf-1', 'wf-2'],
    })
    expect(batchMsg).toContain(ORPHAN_WORKFLOW_STOPPED_PHRASE)
    expect(batchMsg).not.toContain('TaskStop')
  })

  test('#402: leftoverOrphanStoppedNote preserves SendMessage resume hint for redispatched agents with output files', () => {
    const note = leftoverOrphanStoppedNote(
      {
        agentId: 'agent-1',
        description: 'worker',
        canReadOutputFile: true,
        redispatched: true,
      },
      'redispatched',
    )
    expect(note).toContain(
      'Send it another message with SendMessage to resume it',
    )
    expect(note).toContain('check its worktree/output for partial work')
  })
})
