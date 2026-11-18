import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { resolvePermissionRequestSource } from '../permissionRequestSource.js'

const root = join(import.meta.dir, '../../..')

describe('2.1.290 #127 stoppableByKillAgents + ctrl+x ctrl+k hint', () => {
  test('ro(e): async subagent carries stoppableByKillAgents: true', () => {
    expect(
      resolvePermissionRequestSource({
        agentContext: {
          agentType: 'subagent',
          displayName: 'worker',
          isAsync: true,
        },
      }),
    ).toEqual({
      type: 'subagent',
      agentName: 'worker',
      stoppableByKillAgents: true,
    })
  })

  test('ro(e): sync subagent and teammate do not carry stoppableByKillAgents', () => {
    expect(
      resolvePermissionRequestSource({
        agentContext: {
          agentType: 'subagent',
          displayName: 'worker',
          isAsync: false,
        },
      }),
    ).toEqual({
      type: 'subagent',
      agentName: 'worker',
    })

    expect(
      resolvePermissionRequestSource({
        agentContext: {
          agentType: 'teammate',
          agentName: 'peer',
          isAsync: true,
        },
      }),
    ).toEqual({
      type: 'subagent',
      agentName: 'peer',
    })
  })

  test('ro(e): async workflow-agent carries stoppableByKillAgents: true', () => {
    expect(
      resolvePermissionRequestSource({
        spawnedByWorkflowRunId: 'wf-1',
        taskRegistry: {
          all: () => ({
            t1: {
              type: 'local_workflow',
              workflowRunId: 'wf-1',
              workflowName: 'deploy',
            },
          }),
        },
        agentContext: {
          agentType: 'subagent',
          isAsync: true,
        },
      }),
    ).toEqual({
      type: 'workflow-agent',
      workflowName: 'deploy',
      stoppableByKillAgents: true,
    })
  })

  test('iXe(o): PermissionPrompt wires chat:killAgents + kill-agents-confirm copy', () => {
    const src = readFileSync(
      join(root, 'src/components/permissions/PermissionPrompt.tsx'),
      'utf8',
    )
    expect(src).toContain(
      "useShortcutDisplay('chat:killAgents', 'Chat', 'ctrl+x ctrl+k')",
    )
    expect(src).toContain(
      "s.notifications.current?.key === 'kill-agents-confirm'",
    )
    expect(src).toContain('again to stop background agents')
    expect(src).toContain('twice to stop background agents')
    expect(src).toContain('stoppableByKillAgents === true')
    expect(src).toContain("wrap={killAgentsHint ? 'truncate' : undefined}")
  })
})
