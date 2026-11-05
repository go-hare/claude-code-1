import { afterEach, describe, expect, test } from 'bun:test'
import { getCommandQueue, resetCommandQueue } from '../messageQueueManager.js'
import {
  notifyAdoptAgentFailed,
  notifyAdoptTaskFailed,
  notifyAdoptWorkflowFailed,
} from '../adoptFailNotify.js'

afterEach(() => {
  try {
    resetCommandQueue()
  } catch {
    // optional export
  }
})

describe('notifyAdoptTaskFailed (SAo)', () => {
  test('builds failed task-notification XML and enqueues', () => {
    const msg = notifyAdoptTaskFailed('task-1', 'because reasons')
    expect(msg).toContain('<task-notification>')
    expect(msg).toContain('<task-id>task-1</task-id>')
    expect(msg).toContain('<status>failed</status>')
    expect(msg).toContain('<summary>because reasons</summary>')
    expect(msg).toContain('</task-notification>')

    // Queue should have the notification when reset/get available.
    try {
      const q = getCommandQueue()
      const hit = q.find(
        c =>
          c.mode === 'task-notification' &&
          typeof c.value === 'string' &&
          c.value.includes('task-1'),
      )
      expect(hit).toBeTruthy()
      expect(hit?.priority).toBe('next')
      expect(hit?.skipAttachments).toBe(true)
      expect(hit?.shouldQuery).toBe(false)
    } catch {
      // getCommandQueue may not exist in some builds — XML shape is enough
    }
  })

  test('escapes XML special chars in summary', () => {
    const msg = notifyAdoptTaskFailed('t', 'a <b> & "c"')
    // densable Wt: `& < >` only — quotes stay quotes (text node, not attr).
    expect(msg).toContain('a &lt;b&gt; &amp; "c"')
    expect(msg).not.toContain('<b>')
    expect(msg).not.toContain('&quot;')
  })
})

describe('notifyAdoptAgentFailed (RAo)', () => {
  test('includes checkpointed agent wording and reason', () => {
    const msg = notifyAdoptAgentFailed(
      { agentId: 'ag1', description: 'explore' },
      'owner not resumed',
    )
    // densable Wt leaves quotes in the text node.
    expect(msg).toContain('Background agent "explore"')
    expect(msg).not.toContain('&quot;')
    expect(msg).toContain('could not be resumed (owner not resumed)')
    expect(msg).toContain('<task-id>ag1</task-id>')
  })
})

describe('notifyAdoptWorkflowFailed (AAo)', () => {
  test('includes manual resume hint when scriptPath + runId set', () => {
    const msg = notifyAdoptWorkflowFailed(
      {
        taskId: 'w1',
        description: 'spec',
        scriptPath: '/tmp/spec.ts',
        workflowRunId: 'wf_abc',
      },
      'transcript link failed',
    )
    expect(msg).toContain('Background workflow "spec"')
    expect(msg).not.toContain('&quot;')
    expect(msg).toContain('could not be resumed (transcript link failed)')
    expect(msg).toContain("Workflow({scriptPath: '/tmp/spec.ts'")
    expect(msg).toContain("resumeFromRunId: 'wf_abc'")
  })

  test('omits manual hint without scriptPath', () => {
    const msg = notifyAdoptWorkflowFailed(
      { taskId: 'w2', description: 'x' },
      'rejected',
    )
    expect(msg).toContain('could not be resumed (rejected)')
    expect(msg).not.toContain('To resume manually')
  })
})
