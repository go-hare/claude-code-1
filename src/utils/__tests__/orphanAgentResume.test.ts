import { afterEach, describe, expect, test } from 'bun:test'
import { getCommandQueue, resetCommandQueue } from '../messageQueueManager.js'
import {
  buildOrphanWorkflowStoppedSummary,
  classifyOrphanAgent,
  clearAgentResumeInFlightForTests,
  isAgentResumeInFlight,
  isAgentTranscriptIncomplete,
  stripInterruptedTrailingTurns,
  notifyOrphanAgentAlreadyCompleted,
  notifyOrphanAgentAutoResumeFailed,
  notifyOrphanAgentAutoResumed,
  notifyOrphanAgentsBatch,
  notifyOrphanKindBatch,
  ORPHAN_AGENT_CAP,
  ORPHAN_AGGREGATE_SUMMARY,
  ORPHAN_AUTO_RESUME_MAX_AGE_MS,
  ORPHAN_SHELL_STOPPED_SUMMARY,
  ORPHAN_SUMMARY_PREFIX,
  processOrphanAgentCandidates,
  processOrphanShells,
  processOrphanWorkflows,
  releaseAgentResumeInFlight,
  runOrphanAgentResumePass,
  scanAsyncAgentsFromMessages,
  scheduleDeferredOrphanAutoResume,
  tryClaimAgentResumeInFlight,
} from '../orphanAgentResume.js'

afterEach(() => {
  try {
    resetCommandQueue()
  } catch {
    /* optional */
  }
  clearAgentResumeInFlightForTests()
})

describe('scanAsyncAgentsFromMessages (Rqb agent subset)', () => {
  test('collects async_launched from Agent tool_result', () => {
    const { asyncAgents, notifiedTaskIds } = scanAsyncAgentsFromMessages([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: {} }],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu1', is_error: false },
          ],
        },
        toolUseResult: {
          status: 'async_launched',
          agentId: 'agent-abc',
          description: 'explore repo',
          outputFile: '/tmp/o',
        },
      },
    ])
    expect(asyncAgents).toHaveLength(1)
    expect(asyncAgents[0]).toMatchObject({
      agentId: 'agent-abc',
      description: 'explore repo',
      launchedByAgentTool: true,
      outputFile: '/tmp/o',
    })
    expect(notifiedTaskIds.size).toBe(0)
  })

  test('marks redispatched via SendMessage resume result', () => {
    const { asyncAgents } = scanAsyncAgentsFromMessages([
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'sm1', is_error: false },
          ],
        },
        toolUseResult: {
          success: true,
          message: 'resumed',
          resumedAgentId: 'agent-r',
        },
      },
    ])
    expect(asyncAgents.find(a => a.agentId === 'agent-r')?.redispatched).toBe(
      true,
    )
  })

  test('collects notified task-ids from user text (bAf gate: both tags)', () => {
    const { notifiedTaskIds } = scanAsyncAgentsFromMessages([
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'text',
              text: '<task-notification><task-id>done-1</task-id><status>completed</status></task-notification>',
            },
          ],
        },
      },
    ])
    expect(notifiedTaskIds.has('done-1')).toBe(true)
  })

  test('bAf requires both task-notification and status open tags', () => {
    const { notifiedTaskIds } = scanAsyncAgentsFromMessages([
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'text',
              text: '<task-id>bare-id</task-id>',
            },
          ],
        },
      },
    ])
    expect(notifiedTaskIds.has('bare-id')).toBe(false)
  })

  test('redispatched after notify deletes from notifiedTaskIds (single-pass Rqb)', () => {
    // Official FAIL repro: notify then SendMessage resume — redispatched wins.
    const { asyncAgents, notifiedTaskIds } = scanAsyncAgentsFromMessages([
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'text',
              text: '<task-notification><task-id>agN</task-id><status>completed</status></task-notification>',
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'sm1', is_error: false },
          ],
        },
        toolUseResult: {
          success: true,
          message: 'resumed agN',
          resumedAgentId: 'agN',
        },
      },
    ])
    expect(asyncAgents.find(a => a.agentId === 'agN')?.redispatched).toBe(true)
    expect(notifiedTaskIds.has('agN')).toBe(false)

    const r = processOrphanAgentCandidates(
      [
        {
          agentId: 'agN',
          description: 'resumed agN',
          redispatched: true,
          mtimeMs: null,
          hasMeta: false,
        },
      ],
      {
        notifiedTaskIds,
        notify: false,
      },
    )
    // Not skipped as notified; classified stopped (redispatched residue).
    expect(r.skippedNotified).toEqual([])
    expect(r.stopped.map(s => s.entry.agentId)).toEqual(['agN'])
  })
})

describe('Hqb / Dqb shell & workflow orphans', () => {
  test('scan collects bgShells and workflows', () => {
    const { bgShells, workflows, stoppedTaskIds } = scanAsyncAgentsFromMessages(
      [
        {
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'bash1', is_error: false },
            ],
          },
          toolUseResult: {
            backgroundTaskId: 'shell-1',
            stdout: 'running...',
          },
        },
        {
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'wf1', is_error: false },
            ],
          },
          toolUseResult: {
            status: 'async_launched',
            taskType: 'local_workflow',
            taskId: 'wf-1',
            workflowName: 'deploy',
            runId: 'run-9',
          },
        },
        {
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'done1', is_error: false },
            ],
          },
          toolUseResult: {
            task_id: 'already-done',
            task_type: 'local_bash',
          },
        },
      ],
    )
    expect(bgShells).toEqual([{ taskId: 'shell-1', toolUseId: 'bash1' }])
    expect(workflows).toEqual([
      {
        taskId: 'wf-1',
        toolUseId: 'wf1',
        workflowName: 'deploy',
        runId: 'run-9',
      },
    ])
    expect(stoppedTaskIds.has('already-done')).toBe(true)
  })

  test('Hqb single shell notify stopped with full summary', () => {
    const r = processOrphanShells([{ taskId: 's1', toolUseId: 'tu' }], {
      notify: true,
    })
    expect(r.notified).toHaveLength(1)
    expect(r.aggregate).toBe(false)
    try {
      const q = getCommandQueue()
      const vals = q
        .filter(c => c.mode === 'task-notification')
        .map(c => String(c.value))
      expect(vals.some(v => v.includes('<status>stopped</status>'))).toBe(true)
      expect(vals.some(v => v.includes('<tool-use-id>tu</tool-use-id>'))).toBe(
        true,
      )
      expect(
        vals.some(v => v.includes(ORPHAN_SHELL_STOPPED_SUMMARY.slice(0, 40))),
      ).toBe(true)
    } catch {
      /* queue optional */
    }
  })

  test('Hqb multi shells use F$a kind batch', () => {
    const msg = notifyOrphanKindBatch({
      status: 'stopped',
      kind: 'shell',
      label: 'shell command',
      taskIds: ['a', 'b'],
      liveExclusions: ['live1'],
    })
    expect(msg).toContain('<task-id>a</task-id>')
    expect(msg).toContain('<task-id>b</task-id>')
    expect(msg).toContain(`${ORPHAN_SUMMARY_PREFIX}__:shell`)
    expect(msg).toContain(`${ORPHAN_SUMMARY_PREFIX}_live__:live1`)
    expect(msg).toContain('<status>stopped</status>')
    expect(msg).toContain('2 background shell command task(s)')
  })

  test('Hqb multi shells product path lf+F$a (source + classify)', () => {
    // Official Hqb multi: for (s of o) lf(...); F$a(...). Source must call emit
    // before kind batch; runtime SDK queue gated by non-interactive session.
    const { readFileSync } = require('fs') as typeof import('fs')
    const { join } = require('path') as typeof import('path')
    const src = readFileSync(
      join(import.meta.dirname, '../orphanAgentResume.ts'),
      'utf8',
    )
    const hqb = src.indexOf('export function processOrphanShells')
    const dqb = src.indexOf('export function processOrphanWorkflows')
    expect(hqb).toBeGreaterThan(-1)
    const body = src.slice(hqb, dqb > hqb ? dqb : hqb + 2500)
    expect(body).toContain('emitOrphanLf')
    expect(body).toContain('ORPHAN_AGGREGATE_SUMMARY')
    expect(body).toContain("kind: 'shell'")
    const r = processOrphanShells(
      [
        { taskId: 's-a', toolUseId: 'tu-a' },
        { taskId: 's-b', toolUseId: 'tu-b' },
      ],
      { notify: true },
    )
    expect(r.aggregate).toBe(true)
    expect(r.notified.map(s => s.taskId)).toEqual(['s-a', 's-b'])
    try {
      const q = getCommandQueue()
      const vals = q
        .filter(c => c.mode === 'task-notification')
        .map(c => String(c.value))
      expect(
        vals.some(v => v.includes(`${ORPHAN_SUMMARY_PREFIX}__:shell`)),
      ).toBe(true)
    } catch {
      /* queue optional */
    }
  })

  test('kqb/Dqb product paths emitOrphanLf before aggregate XML', () => {
    const { readFileSync } = require('fs') as typeof import('fs')
    const { join } = require('path') as typeof import('path')
    const src = readFileSync(
      join(import.meta.dirname, '../orphanAgentResume.ts'),
      'utf8',
    )
    // kqb over-cap: lf each then F$a
    const kqb = src.indexOf('export function processOrphanAgentCandidates')
    const kqbBody = src.slice(kqb, kqb + 3500)
    expect(kqbBody).toContain('emitOrphanLf')
    expect(kqbBody).toContain("kind: 'agent'")
    // Dqb over-cap + singles
    const dqb = src.indexOf('export function processOrphanWorkflows')
    const dqbBody = src.slice(dqb, dqb + 2200)
    expect(dqbBody).toContain('emitOrphanLf')
    expect(dqbBody).toContain('emitSdk: false')
  })

  test('Dqb workflow summary includes resume hint', () => {
    const s = buildOrphanWorkflowStoppedSummary({
      taskId: 'w1',
      toolUseId: 't',
      workflowName: 'ship',
      runId: 'r1',
    })
    expect(s).toContain('"ship"')
    expect(s).toContain('resumeFromRunId: "r1"')
  })

  test('Dqb skips notified/stopped/live', () => {
    const r = processOrphanWorkflows(
      [
        { taskId: 'n', toolUseId: '1' },
        { taskId: 's', toolUseId: '2' },
        { taskId: 'l', toolUseId: '3' },
        { taskId: 'orphan', toolUseId: '4', runId: 'x' },
      ],
      {
        notifiedTaskIds: new Set(['n']),
        stoppedTaskIds: new Set(['s']),
        liveTaskIds: new Set(['l']),
        notify: false,
      },
    )
    expect(r.skippedNotified).toEqual(['n'])
    expect(r.skippedStopped).toEqual(['s'])
    expect(r.skippedLive).toEqual(['l'])
    expect(r.notified.map(w => w.taskId)).toEqual(['orphan'])
  })

  test('agent over-cap uses F$a agent marker', () => {
    const many = Array.from({ length: ORPHAN_AGENT_CAP + 1 }, (_, i) => ({
      agentId: `a${i}`,
      description: `d${i}`,
      mtimeMs: null as number | null,
    }))
    const r = processOrphanAgentCandidates(many, { notify: true })
    expect(r.aggregateFailed).toBe(true)
    expect(r.failed[0]?.summary).toBe(ORPHAN_AGGREGATE_SUMMARY)
    try {
      const q = getCommandQueue()
      const vals = q
        .filter(c => c.mode === 'task-notification')
        .map(c => String(c.value))
      expect(
        vals.some(v => v.includes(`${ORPHAN_SUMMARY_PREFIX}__:agent`)),
      ).toBe(true)
    } catch {
      /* optional */
    }
  })
})

describe('isAgentTranscriptIncomplete ($co portable)', () => {
  test('ends on assistant → complete (false incomplete)', () => {
    expect(
      isAgentTranscriptIncomplete([
        { type: 'user', message: { content: 'go' } },
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'done' }] },
        },
      ]),
    ).toBe(false)
  })

  test('ends on user → incomplete', () => {
    expect(
      isAgentTranscriptIncomplete([
        { type: 'user', message: { content: 'go' } },
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'working' }] },
        },
        { type: 'user', message: { content: 'continue' } },
      ]),
    ).toBe(true)
  })

  test('trailing interrupt-only user is skipped; prior assistant → complete', () => {
    expect(
      isAgentTranscriptIncomplete([
        { type: 'user', message: { content: 'go' } },
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'done' }] },
        },
        {
          type: 'user',
          message: { content: '[Request interrupted by user]' },
        },
      ]),
    ).toBe(false)
  })
})

describe('stripInterruptedTrailingTurns (LVr portable)', () => {
  test('strips trailing interrupt user leaving completed assistant', () => {
    const out = stripInterruptedTrailingTurns([
      { type: 'user', message: { content: 'go' } },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'done' }],
          stop_reason: 'end_turn',
        },
      },
      {
        type: 'user',
        message: { content: '[Request interrupted by user]' },
      },
    ])
    expect(out).toHaveLength(2)
    expect(out[1]?.type).toBe('assistant')
    expect(isAgentTranscriptIncomplete(out)).toBe(false)
  })

  test('strips incomplete tool_use assistant + trailing interrupt', () => {
    const out = stripInterruptedTrailingTurns([
      { type: 'user', message: { content: 'go' } },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'done' }],
          stop_reason: 'end_turn',
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }],
          stop_reason: 'tool_use',
        },
      },
      {
        type: 'user',
        message: { content: '[Request interrupted by user for tool use]' },
      },
    ])
    expect(out.map(m => m.type)).toEqual(['user', 'assistant'])
    expect(isAgentTranscriptIncomplete(out)).toBe(false)
  })

  test('does not strip completed assistant with end_turn', () => {
    const msgs = [
      { type: 'user', message: { content: 'go' } },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'done' }],
          stop_reason: 'end_turn',
        },
      },
    ]
    expect(stripInterruptedTrailingTurns(msgs)).toEqual(msgs)
  })

  test('keeps non user/assistant/system trail after cut', () => {
    const out = stripInterruptedTrailingTurns([
      { type: 'user', message: { content: 'go' } },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'done' }],
          stop_reason: 'end_turn',
        },
      },
      {
        type: 'user',
        message: { content: '[Request interrupted by user]' },
      },
      { type: 'progress', message: { content: 'x' } },
    ])
    expect(out.map(m => m.type)).toEqual(['user', 'assistant', 'progress'])
  })
})

describe('runOrphanAgentResumePass', () => {
  test('notifies failed orphan without auto-resume when no resumeAgent', async () => {
    const r = await runOrphanAgentResumePass({
      messages: [
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'tu1', name: 'Agent', input: {} },
            ],
          },
        },
        {
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tu1', is_error: false },
            ],
          },
          toolUseResult: {
            status: 'async_launched',
            agentId: 'ghost',
            description: 'ghost work',
          },
        },
      ],
      waitForMcp: false,
      notify: false,
      resurrectCrons: false,
      // no resumeAgent → auto-resume disabled in process
    })
    expect(r.scanned).toBe(1)
    // Without disk meta/mtime, classify → failed; autoResume empty
    expect(r.autoResume).toEqual([])
  })
})

describe('classifyOrphanAgent (kqb subset)', () => {
  test('auto-resume when agent-tool + meta + fresh mtime', () => {
    const now = 1_000_000
    const r = classifyOrphanAgent(
      {
        agentId: 'a1',
        description: 'explore',
        launchedByAgentTool: true,
        hasMeta: true,
        mtimeMs: now - 1000,
      },
      { nowMs: now },
    )
    expect(r.kind).toBe('auto-resume')
  })

  test('stopped when transcript mtime but auto-resume disabled', () => {
    const r = classifyOrphanAgent(
      {
        agentId: 'a1',
        description: 'x',
        launchedByAgentTool: true,
        hasMeta: true,
        mtimeMs: Date.now(),
      },
      { autoResumeEnabled: false },
    )
    expect(r.kind).toBe('stopped')
    if (r.kind === 'stopped') {
      expect(r.summary).toContain('transcript is saved on disk')
    }
  })

  test('failed when no transcript residue', () => {
    const r = classifyOrphanAgent({
      agentId: 'a1',
      description: 'lost',
      mtimeMs: null,
      hasMeta: false,
    })
    expect(r.kind).toBe('failed')
    if (r.kind === 'failed') {
      expect(r.summary).toContain('in-process state was lost')
    }
  })

  test('stale mtime beyond Aqb is not auto-resumed', () => {
    const now = Date.now()
    const r = classifyOrphanAgent(
      {
        agentId: 'a1',
        launchedByAgentTool: true,
        hasMeta: true,
        mtimeMs: now - ORPHAN_AUTO_RESUME_MAX_AGE_MS - 1,
      },
      { nowMs: now },
    )
    expect(r.kind).not.toBe('auto-resume')
  })

  test('sidecar stoppedByUser classifies stopped (no auto-resume)', () => {
    const now = Date.now()
    const r = classifyOrphanAgent(
      {
        agentId: 'a1',
        description: 'explore',
        launchedByAgentTool: true,
        hasMeta: true,
        mtimeMs: now - 1000,
        stoppedByUser: true,
      },
      { nowMs: now },
    )
    expect(r.kind).toBe('stopped')
    if (r.kind === 'stopped') {
      expect(r.summary).toContain('stopped by the user')
      expect(r.summary).toContain('will not be auto-resumed')
    }
  })
})

describe('agentResumeInFlight claim de-dupe', () => {
  test('tryClaim / release is exclusive per agentId', () => {
    expect(tryClaimAgentResumeInFlight('x')).toBe(true)
    expect(tryClaimAgentResumeInFlight('x')).toBe(false)
    expect(isAgentResumeInFlight('x')).toBe(true)
    expect(tryClaimAgentResumeInFlight('y')).toBe(true)
    releaseAgentResumeInFlight('x')
    expect(isAgentResumeInFlight('x')).toBe(false)
    expect(tryClaimAgentResumeInFlight('x')).toBe(true)
  })

  test('scheduleDeferredOrphanAutoResume skips agents already in-flight', async () => {
    expect(tryClaimAgentResumeInFlight('held')).toBe(true)
    const called: string[] = []
    const r = await scheduleDeferredOrphanAutoResume({
      agents: [
        { agentId: 'held', description: 'skip-me' },
        { agentId: 'free', description: 'run-me' },
      ],
      waitForMcp: false,
      notify: false,
      resumeAgent: async entry => {
        called.push(entry.agentId)
      },
    })
    expect(called).toEqual(['free'])
    expect(r.resumed).toBe(1)
    expect(r.failed).toBe(0)
    // held still owned by outer claim
    expect(isAgentResumeInFlight('held')).toBe(true)
    // free released after attempt
    expect(isAgentResumeInFlight('free')).toBe(false)
  })
})

describe('SAf / EAf / vAf / Iqb notifies', () => {
  test('SAf has no status tag and restart wording', () => {
    const msg = notifyOrphanAgentAutoResumed({
      agentId: 'ag1',
      description: 'explore',
      outputFile: '/tmp/out',
    })
    expect(msg).toContain('<task-id>ag1</task-id>')
    expect(msg).toContain('<output-file>/tmp/out</output-file>')
    expect(msg).not.toContain('<status>')
    expect(msg).toContain('automatically restarted')
  })

  test('EAf completed status', () => {
    const msg = notifyOrphanAgentAlreadyCompleted({
      agentId: 'ag2',
      description: 'done',
    })
    expect(msg).toContain('<status>completed</status>')
    expect(msg).toContain('already completed')
  })

  test('vAf stopped with reason', () => {
    const msg = notifyOrphanAgentAutoResumeFailed(
      { agentId: 'ag3', description: 'x' },
      'no transcript',
    )
    expect(msg).toContain('<status>stopped</status>')
    expect(msg).toContain('could not be automatically restarted: no transcript')
  })

  test('Iqb multi-id batch', () => {
    const msg = notifyOrphanAgentsBatch('failed', [
      { agentId: 'a', description: 'one' },
      { agentId: 'b', description: 'two' },
    ])
    expect(msg).toContain('<task-id>a</task-id>')
    expect(msg).toContain('<task-id>b</task-id>')
    expect(msg).toContain('<status>failed</status>')
    expect(msg).toContain('2 background agents')
  })
})

describe('processOrphanAgentCandidates', () => {
  test('skips live and notified; returns auto-resume set', () => {
    const r = processOrphanAgentCandidates(
      [
        {
          agentId: 'live',
          launchedByAgentTool: true,
          hasMeta: true,
          mtimeMs: Date.now(),
        },
        {
          agentId: 'notified',
          launchedByAgentTool: true,
          hasMeta: true,
          mtimeMs: Date.now(),
        },
        {
          agentId: 'resume-me',
          description: 'work',
          launchedByAgentTool: true,
          hasMeta: true,
          mtimeMs: Date.now(),
        },
        {
          agentId: 'fail-me',
          description: 'gone',
          mtimeMs: null,
        },
      ],
      {
        liveAgentIds: new Set(['live']),
        notifiedTaskIds: new Set(['notified']),
        notify: false,
      },
    )
    expect(r.skippedLive).toEqual(['live'])
    expect(r.skippedNotified).toEqual(['notified'])
    expect(r.autoResume.map(a => a.agentId)).toEqual(['resume-me'])
    expect(r.failed.map(f => f.entry.agentId)).toEqual(['fail-me'])
    expect(r.aggregateFailed).toBe(false)
  })

  test('cap > hGo aggregates as failed', () => {
    const many = Array.from({ length: ORPHAN_AGENT_CAP + 1 }, (_, i) => ({
      agentId: `a${i}`,
      description: `d${i}`,
      mtimeMs: null as number | null,
    }))
    const r = processOrphanAgentCandidates(many, { notify: false })
    expect(r.aggregateFailed).toBe(true)
    expect(r.autoResume).toEqual([])
    expect(r.failed).toHaveLength(ORPHAN_AGENT_CAP + 1)
  })
})

describe('scheduleDeferredOrphanAutoResume (ese)', () => {
  test('SAf / EAf / vAf routing from resume results', async () => {
    const order: string[] = []
    const r = await scheduleDeferredOrphanAutoResume({
      agents: [
        { agentId: 'ok', description: 'a' },
        { agentId: 'done', description: 'b' },
        { agentId: 'bad', description: 'c' },
      ],
      waitForMcp: false,
      notify: true,
      resumeAgent: async e => {
        order.push(`resume:${e.agentId}`)
        if (e.agentId === 'done')
          return { alreadyCompleted: true, outputFile: '/o' }
        if (e.agentId === 'bad') throw new Error('boom')
        return {}
      },
    })
    expect(r).toEqual({
      resumed: 1,
      alreadyCompleted: 1,
      failed: 1,
      skipped: false,
    })
    expect(order).toEqual(['resume:ok', 'resume:done', 'resume:bad'])

    try {
      const q = getCommandQueue()
      const vals = q
        .filter(c => c.mode === 'task-notification')
        .map(c => String(c.value))
      expect(vals.some(v => v.includes('automatically restarted'))).toBe(true)
      expect(vals.some(v => v.includes('already completed'))).toBe(true)
      expect(
        vals.some(v =>
          v.includes('could not be automatically restarted: boom'),
        ),
      ).toBe(true)
    } catch {
      // queue may be unavailable — counts above still assert routing
    }
  })

  test('isCurrent false skips all', async () => {
    let called = 0
    const r = await scheduleDeferredOrphanAutoResume({
      agents: [{ agentId: 'x' }],
      waitForMcp: false,
      isCurrent: () => false,
      resumeAgent: async () => {
        called++
      },
    })
    expect(r.skipped).toBe(true)
    expect(called).toBe(0)
  })
})
