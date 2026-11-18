import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createSubagentTurnHookTracker } from '../../../../packages/builtin-tools/src/tools/AgentTool/subagentTurnHooks.js'
import { setLoadedFunctionHooksModules } from '../../plugins/functionHooksModules.js'

const ROOT = join(import.meta.dir, '../../../..')

describe('#733 inProcessRunner teammate turn.start hook wiring', () => {
  afterEach(() => {
    setLoadedFunctionHooksModules([])
  })

  test('inProcessRunner passes promptMessages and agentId to runAgent which invokes createSubagentTurnHookTracker', () => {
    const runnerSrc = readFileSync(
      join(ROOT, 'src/utils/swarm/inProcessRunner.ts'),
      'utf8',
    )
    expect(runnerSrc).toContain('for await (const message of runAgent({')
    expect(runnerSrc).toContain('promptMessages,')
    expect(runnerSrc).toContain('agentId: asAgentId(taskId),')

    const runAgentSrc = readFileSync(
      join(ROOT, 'packages/builtin-tools/src/tools/AgentTool/runAgent.ts'),
      'utf8',
    )
    expect(runAgentSrc).toContain('createSubagentTurnHookTracker({')
    expect(runAgentSrc).toContain('turnHookTracker.saw(message)')
    expect(runAgentSrc).toContain('turnHookTracker.ended({')
  })

  test('createSubagentTurnHookTracker emits turn.start and turn.complete with teammate agentId and prompt text', async () => {
    const events: Array<{ event: string; payload: Record<string, unknown> }> =
      []
    setLoadedFunctionHooksModules([
      {
        name: 'teammate-turn-observer',
        root: '/tmp/teammate-turn-observer',
        patterns: ['turn.start', 'turn.complete'],
        hooks: [
          {
            pattern: 'turn.start',
            hook: async (_$, e, next) => {
              events.push({
                event: 'turn.start',
                payload: e as Record<string, unknown>,
              })
              return next(e)
            },
          },
          {
            pattern: 'turn.complete',
            hook: async (_$, e, next) => {
              events.push({
                event: 'turn.complete',
                payload: e as Record<string, unknown>,
              })
              return next(e)
            },
          },
        ],
      },
    ])

    const ac = new AbortController()
    const tracker = createSubagentTurnHookTracker({
      text: '<teammate-message from="team-lead">check status</teammate-message>',
      agentId: 'researcher@my-team',
      signal: ac.signal,
    })

    tracker.saw({
      type: 'assistant',
      message: {
        id: 'msg-1',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'All good.' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    })
    tracker.ended({ isAborted: false, hasFailed: false })

    // Allow microtask chain for turn.start -> turn.complete to flush
    await new Promise(resolve => setTimeout(resolve, 25))

    expect(events.map(e => e.event)).toEqual(['turn.start', 'turn.complete'])
    expect(events[0]?.payload.agentId).toBe('researcher@my-team')
    expect(events[0]?.payload.text).toBe(
      '<teammate-message from="team-lead">check status</teammate-message>',
    )
    expect(typeof events[0]?.payload.turnId).toBe('string')
    expect(events[1]?.payload.agentId).toBe('researcher@my-team')
    expect(events[1]?.payload.answer).toBe('All good.')
    expect(events[1]?.payload.turnId).toBe(events[0]?.payload.turnId)
  })
})
