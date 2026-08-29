/**
 * densable xSl / G2e / Fhs — permission requestSource.
 *
 * Gold: xSl(toolUseContext) in gold-iK.txt; G2e/Fhs in gold-wide-nlg.txt.
 * Fhs/LUf sanitizer (WPi/zPi/oge) is not dumped — named arms fall back.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  formatPermissionSourceName,
  formatRequestSourceLabel,
  resolvePermissionRequestSource,
} from '../permissionRequestSource.js'

const root = join(import.meta.dir, '../../..')

describe('densable xSl (resolvePermissionRequestSource)', () => {
  test('forRemoteExecution → remote-agent', () => {
    expect(
      resolvePermissionRequestSource({ forRemoteExecution: true }),
    ).toEqual({ type: 'remote-agent' })
  })

  test('spawnedByWorkflowRunId matches local_workflow name', () => {
    expect(
      resolvePermissionRequestSource({
        spawnedByWorkflowRunId: 'run-1',
        taskRegistry: {
          all: () => ({
            a: {
              type: 'local_workflow',
              workflowRunId: 'run-1',
              workflowName: 'spec',
            },
          }),
        },
      }),
    ).toEqual({ type: 'workflow-agent', workflowName: 'spec' })
  })

  test('spawnedByWorkflowRunId without match still workflow-agent', () => {
    expect(
      resolvePermissionRequestSource({
        spawnedByWorkflowRunId: 'run-missing',
        taskRegistry: { all: () => ({}) },
      }),
    ).toEqual({ type: 'workflow-agent', workflowName: undefined })
  })

  test('teammate agentContext → subagent + agentName', () => {
    expect(
      resolvePermissionRequestSource({
        agentContext: { agentType: 'teammate', agentName: 'researcher' },
      }),
    ).toEqual({ type: 'subagent', agentName: 'researcher' })
  })

  test('subagent + not main session → displayName ?? subagentName', () => {
    expect(
      resolvePermissionRequestSource({
        agentContext: {
          agentType: 'subagent',
          displayName: 'Explore',
          subagentName: 'Explore',
        },
      }),
    ).toEqual({ type: 'subagent', agentName: 'Explore' })
    expect(
      resolvePermissionRequestSource({
        agentContext: {
          agentType: 'subagent',
          isMainSession: true,
          subagentName: 'Explore',
        },
      }),
    ).toBeUndefined()
  })

  test('does not read ALS — empty ctx is undefined', () => {
    expect(resolvePermissionRequestSource(undefined)).toBeUndefined()
    expect(resolvePermissionRequestSource({})).toBeUndefined()
  })
})

describe('densable G2e / Fhs', () => {
  test('Fhs is undefined while LUf sanitizer is undumped', () => {
    expect(formatPermissionSourceName('spec')).toBeUndefined()
    expect(formatPermissionSourceName('researcher')).toBeUndefined()
  })

  test('G2e copy uses fallback when Fhs is undefined', () => {
    expect(
      formatRequestSourceLabel({
        type: 'workflow-agent',
        workflowName: 'spec',
      }),
    ).toBe('from a workflow')
    expect(
      formatRequestSourceLabel({ type: 'subagent', agentName: 'researcher' }),
    ).toBe('from a subagent')
    expect(formatRequestSourceLabel({ type: 'remote-agent' })).toBe(
      'from a remote cloud agent',
    )
    expect(formatRequestSourceLabel(undefined)).toBeUndefined()
  })

  test('Cm passes requestSource + fixed srPrefix; G2e · from copy', () => {
    const dialog = readFileSync(
      join(root, 'src/components/permissions/PermissionDialog.tsx'),
      'utf8',
    )
    expect(dialog).toContain('requestSource={requestSource}')
    expect(dialog).toContain('srPrefix="Permission Required:"')

    const title = readFileSync(
      join(root, 'src/components/permissions/PermissionRequestTitle.tsx'),
      'utf8',
    )
    expect(title).toContain("{'· '}")
    expect(title).toContain('formatRequestSourceLabel')
  })
})
