/**
 * densable 2.1.289 TVt — PostToolBatch ownTool remap.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { remapHookInputForOwnTool } from '../../hooks.js'
import {
  getPluginHookRunner,
  setPluginHookRunner,
} from '../pluginHookRunner.js'
import type { Tool } from '../../../Tool.js'

const root = join(import.meta.dir, '../../..')

const own = { name: 'plugin__Bash' } as Tool

describe('densable 2.1.289 TVt ownTool remap', () => {
  afterEach(() => {
    setPluginHookRunner(undefined)
  })

  test('no runner → undefined (no-op)', () => {
    expect(getPluginHookRunner()).toBeUndefined()
    expect(
      remapHookInputForOwnTool({
        hook_event_name: 'PostToolBatch',
        session_id: 's',
        transcript_path: '/t',
        cwd: '/tmp',
        permission_mode: 'default',
        tool_calls: [
          {
            tool_name: 'Bash',
            tool_input: {},
            tool_use_id: '1',
          },
        ],
      } as never),
    ).toBeUndefined()
  })

  test('PostToolBatch remaps each tool_calls[].tool_name', () => {
    setPluginHookRunner({
      ownTool: name => (name === 'Bash' ? own : undefined),
    })
    const remapped = remapHookInputForOwnTool({
      hook_event_name: 'PostToolBatch',
      session_id: 's',
      transcript_path: '/t',
      cwd: '/tmp',
      permission_mode: 'default',
      tool_calls: [
        { tool_name: 'Bash', tool_input: {}, tool_use_id: '1' },
        { tool_name: 'Read', tool_input: {}, tool_use_id: '2' },
      ],
    } as never)
    expect(remapped?.tools).toEqual([])
    const calls = (
      remapped?.hookInput as {
        tool_calls: Array<{ tool_name: string }>
      }
    ).tool_calls
    expect(calls.map(c => c.tool_name)).toEqual(['plugin__Bash', 'Read'])
  })

  test('getMatchingHooks and executeHooks stringify call TVt', () => {
    const hooks = readFileSync(join(root, 'utils/hooks.ts'), 'utf8')
    expect(hooks).toContain('remapHookInputForOwnTool')
    expect(hooks).toContain('getPluginHookRunner')
    expect(hooks).toContain('asOwnTool')
    expect(hooks).toContain('getJsonInput(asOwnTool === true)')
  })
})
