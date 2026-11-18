import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildWorkflowHarnessMessages,
  isWorkflowPromptProvenanceOn,
} from '../../utils/workflowHarness.js'
import {
  adoptCarriedWorkflowNeedsConsent,
  CARRIED_WORKFLOW_DONT_ASK_NOTE,
} from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { createTaskRegistry } from '../../utils/taskRegistry.js'

describe('#815 & #853 Workflow harness & carried workflow resume', () => {
  const prevProv = process.env.CLAUDE_CODE_WORKFLOW_PROMPT_PROVENANCE

  afterEach(() => {
    if (prevProv === undefined) {
      delete process.env.CLAUDE_CODE_WORKFLOW_PROMPT_PROVENANCE
    } else {
      process.env.CLAUDE_CODE_WORKFLOW_PROMPT_PROVENANCE = prevProv
    }
  })

  test('#853 isWorkflowPromptProvenanceOn defaults to true and buildWorkflowHarnessMessages splits relay', () => {
    delete process.env.CLAUDE_CODE_WORKFLOW_PROMPT_PROVENANCE
    expect(isWorkflowPromptProvenanceOn()).toBe(true)

    const msgs = [
      {
        type: 'user' as const,
        origin: { kind: 'human' as const },
        message: { role: 'user' as const, content: 'Run the report workflow' },
      },
    ]
    const built = buildWorkflowHarnessMessages(msgs, 'step 1: gather data')
    expect(built.promptMessages.length).toBe(2)
    expect(built.promptMessages[0]).toContain(
      '[Workflow harness — user request]',
    )
    expect(built.promptMessages[0]).toContain('Run the report workflow')
    expect(built.promptMessages[1]).toContain(
      '[Workflow harness — computed task]',
    )
    expect(built.promptMessages[1]).toContain('step 1: gather data')
  })

  test('#815 adoptCarriedWorkflowNeedsConsent hands carried workflow back to Workflow tool', () => {
    let tasks: Record<string, any> = {
      wf_1: {
        id: 'wf_1',
        type: 'local_workflow',
        status: 'paused',
        description: 'carried',
        startTime: Date.now(),
        workflowName: 'demo',
        workflowFile: '/tmp/demo.ts',
        workflowProgress: [],
        progressVersion: 0,
        agentCount: 0,
        totalTokens: 0,
        totalToolCalls: 0,
        workflowRunId: 'run-1',
      },
    }
    const registry = createTaskRegistry(
      () => ({ tasks }) as any,
      updater => {
        const next = updater({ tasks } as any)
        tasks = next.tasks
      },
    )
    const calls: Array<{ reason: string; note: string }> = []
    const ok = adoptCarriedWorkflowNeedsConsent(
      { taskId: 'wf_1', workflowRunId: 'run-1' },
      {
        taskRegistry: registry,
        permissionMode: 'dontAsk',
        onNeedsConsent: (_h, reason, note) => calls.push({ reason, note }),
      },
    )
    expect(ok).toBe(true)
    expect(tasks.wf_1).toBeUndefined()
    expect(calls).toEqual([
      {
        reason: 'a carried workflow runs again only through the Workflow tool',
        note: CARRIED_WORKFLOW_DONT_ASK_NOTE,
      },
    ])
  })
})
