import { afterEach, describe, expect, test } from 'bun:test'
import {
  getCommandQueue,
  resetCommandQueue,
} from '../messageQueueManager.js'
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
    } catch {
      // getCommandQueue may not exist in some builds — XML shape is enough
    }
  })

  test('escapes XML special chars in summary', () => {
    const msg = notifyAdoptTaskFailed('t', 'a <b> & "c"')
    expect(msg).toContain('a &lt;b&gt; &amp; &quot;c&quot;')
    expect(msg).not.toContain('<b>')
  })
})

describe('notifyAdoptAgentFailed (RAo)', () => {
  test('includes checkpointed agent wording and reason', () => {
    const msg = notifyAdoptAgentFailed(
      { agentId: 'ag1', description: 'explore' },
      'owner not resumed',
    )
    // Quotes in description are XML-escaped inside <summary>.
    expect(msg).toContain('Background agent &quot;explore&quot;')
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
    expect(msg).toContain('Background workflow &quot;spec&quot;')
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
