/**
 * Official 2.1 Host stream/control schema smoke — task_updated / task_summary /
 * thinking_tokens / model_fallback / command_lifecycle / background_tasks.
 */
import { describe, expect, test } from 'bun:test'
import {
  SDKBackgroundTasksChangedMessageSchema,
  SDKCommandLifecycleMessageSchema,
  SDKMessageSchema,
  SDKModelFallbackMessageSchema,
  SDKTaskNotificationMessageSchema,
  SDKTaskProgressMessageSchema,
  SDKTaskStartedMessageSchema,
  SDKTaskSummaryMessageSchema,
  SDKTaskUpdatedMessageSchema,
  SDKThinkingTokensMessageSchema,
} from '../coreSchemas.js'
import {
  SDKControlBackgroundTasksRequestSchema,
  SDKControlRequestInnerSchema,
} from '../controlSchemas.js'

describe('Official 2.1 Host stream schemas', () => {
  test('task_updated wire-safe patch', () => {
    const msg = SDKTaskUpdatedMessageSchema().parse({
      type: 'system',
      subtype: 'task_updated',
      task_id: 't1',
      patch: {
        status: 'running',
        is_backgrounded: true,
        end_time: 123,
        total_paused_ms: 0,
        error: 'x',
        description: 'd',
      },
      uuid: '00000000-0000-4000-8000-000000000001',
      session_id: 's1',
    })
    expect(msg.subtype).toBe('task_updated')
    expect(msg.patch.is_backgrounded).toBe(true)
  })

  test('task_summary detail null clear', () => {
    const msg = SDKTaskSummaryMessageSchema().parse({
      type: 'system',
      subtype: 'task_summary',
      detail: null,
      uuid: '00000000-0000-4000-8000-000000000002',
      session_id: 's1',
    })
    expect(msg.detail).toBeNull()
  })

  test('thinking_tokens cumulative + delta', () => {
    const msg = SDKThinkingTokensMessageSchema().parse({
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 100,
      estimated_tokens_delta: 20,
      uuid: '00000000-0000-4000-8000-000000000003',
      session_id: 's1',
    })
    expect(msg.estimated_tokens).toBe(100)
  })

  test('model_fallback trigger enum', () => {
    const msg = SDKModelFallbackMessageSchema().parse({
      type: 'system',
      subtype: 'model_fallback',
      trigger: 'model_not_found',
      original_model: 'a',
      fallback_model: 'b',
      content: 'switched',
      uuid: '00000000-0000-4000-8000-000000000004',
      session_id: 's1',
    })
    expect(msg.trigger).toBe('model_not_found')
  })

  test('command_lifecycle preserves command uuid', () => {
    const msg = SDKCommandLifecycleMessageSchema().parse({
      type: 'command_lifecycle',
      uuid: 'cmd-user-uuid',
      state: 'started',
      session_id: 's1',
    })
    expect(msg.uuid).toBe('cmd-user-uuid')
    expect(msg.state).toBe('started')
  })

  test('SDKMessage union accepts task_updated and command_lifecycle', () => {
    const a = SDKMessageSchema().parse({
      type: 'system',
      subtype: 'task_updated',
      task_id: 't1',
      patch: { status: 'failed' },
      uuid: '00000000-0000-4000-8000-000000000005',
      session_id: 's1',
    })
    expect(a.type).toBe('system')

    const b = SDKMessageSchema().parse({
      type: 'command_lifecycle',
      uuid: 'cmd-2',
      state: 'completed',
    })
    expect(b.type).toBe('command_lifecycle')
  })

  test('background_tasks_changed REPLACE live set', () => {
    const msg = SDKBackgroundTasksChangedMessageSchema().parse({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [
        {
          task_id: 'a1',
          task_type: 'local_agent',
          description: 'Agent "x"',
          ambient: true,
        },
      ],
      uuid: '00000000-0000-4000-8000-000000000006',
      session_id: 's1',
    })
    expect(msg.subtype).toBe('background_tasks_changed')
    expect(msg.tasks).toHaveLength(1)
    expect(msg.tasks[0]?.ambient).toBe(true)

    const empty = SDKMessageSchema().parse({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [],
      uuid: '00000000-0000-4000-8000-000000000007',
      session_id: 's1',
    })
    expect(empty).toMatchObject({
      subtype: 'background_tasks_changed',
      tasks: [],
    })
  })

  test('task_started / task_notification / task_progress densable 2.1.289 fields', () => {
    const started = SDKTaskStartedMessageSchema().parse({
      type: 'system',
      subtype: 'task_started',
      task_id: 't1',
      description: 'd',
      subagent_type: 'Explore',
      is_backgrounded: true,
      spawn_depth: 1,
      skip_transcript: true,
      ambient: true,
      uuid: '00000000-0000-4000-8000-000000000008',
      session_id: 's1',
    })
    expect(started.subagent_type).toBe('Explore')
    expect(started).not.toHaveProperty('timestamp')

    const notif = SDKTaskNotificationMessageSchema().parse({
      type: 'system',
      subtype: 'task_notification',
      task_id: 't1',
      status: 'completed',
      reason: 'worker_restart',
      output_file: '/tmp/o',
      summary: 'done',
      resource_links: [{ uri: 'file:///tmp/o' }],
      skip_transcript: true,
      ambient: false,
      uuid: '00000000-0000-4000-8000-000000000009',
      session_id: 's1',
    })
    expect(notif.reason).toBe('worker_restart')
    expect(notif).not.toHaveProperty('timestamp')

    const progress = SDKTaskProgressMessageSchema().parse({
      type: 'system',
      subtype: 'task_progress',
      task_id: 't1',
      description: 'd',
      subagent_type: 'Explore',
      usage: { total_tokens: 1, tool_uses: 0, duration_ms: 1 },
      uuid: '00000000-0000-4000-8000-00000000000a',
      session_id: 's1',
    })
    expect(progress.subagent_type).toBe('Explore')
    expect(progress).not.toHaveProperty('workflow_progress')
    expect(progress).not.toHaveProperty('timestamp')
  })
})

describe('Official 2.1 background_tasks control', () => {
  test('request with optional tool_use_id', () => {
    const all = SDKControlBackgroundTasksRequestSchema().parse({
      subtype: 'background_tasks',
    })
    expect(all.subtype).toBe('background_tasks')
    expect(all.tool_use_id).toBeUndefined()

    const one = SDKControlBackgroundTasksRequestSchema().parse({
      subtype: 'background_tasks',
      tool_use_id: 'tool-use-1',
    })
    expect(one.tool_use_id).toBe('tool-use-1')
  })

  test('control request inner union includes background_tasks', () => {
    const req = SDKControlRequestInnerSchema().parse({
      subtype: 'background_tasks',
      tool_use_id: 'x',
    })
    expect(req.subtype).toBe('background_tasks')
  })
})
