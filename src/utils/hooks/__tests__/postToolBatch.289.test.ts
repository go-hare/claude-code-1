/**
 * densable 2.1.289 Acn / YH / UK — PostToolBatch hook executor.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { HOOK_EVENTS as sdkEvents } from '../../../entrypoints/agentSdkTypes.js'
import {
  HOOK_EVENTS,
  PostToolBatchHookInputSchema,
  PostToolBatchHookSpecificOutputSchema,
} from '../../../entrypoints/sdk/coreSchemas.js'
import { HOOK_EVENTS as typeEvents } from '../../../entrypoints/sdk/coreTypes.js'
import { hookJSONOutputSchema } from '../../../types/hooks.js'
import { isAfterEditHook } from '../../../cli/leftoverCloudHookOffer.js'

const root = join(import.meta.dir, '../../..')

describe('densable 2.1.289 PostToolBatch registry', () => {
  test('HOOK_EVENTS sits immediately after PostToolUseFailure', () => {
    for (const events of [HOOK_EVENTS, typeEvents, sdkEvents]) {
      const list = events as readonly string[]
      const at = list.indexOf('PostToolUseFailure')
      expect(at).toBeGreaterThan(-1)
      expect(list[at + 1]).toBe('PostToolBatch')
    }
  })

  test('YH input schema accepts tool_calls batch', () => {
    const parsed = PostToolBatchHookInputSchema().safeParse({
      session_id: 'sess',
      transcript_path: '/tmp/t.jsonl',
      cwd: '/tmp',
      hook_event_name: 'PostToolBatch',
      tool_calls: [
        {
          tool_name: 'Bash',
          tool_input: { command: 'true' },
          tool_use_id: 'toolu_1',
          tool_response: { stdout: '' },
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  test('UK specific output accepts additionalContext', () => {
    const parsed = PostToolBatchHookSpecificOutputSchema().safeParse({
      hookEventName: 'PostToolBatch',
      additionalContext: 'batch note',
    })
    expect(parsed.success).toBe(true)
  })

  test('runtime syncHookResponseSchema accepts PostToolBatch specific output', () => {
    const parsed = hookJSONOutputSchema().safeParse({
      hookSpecificOutput: {
        hookEventName: 'PostToolBatch',
        additionalContext: 'batch note',
      },
    })
    expect(parsed.success).toBe(true)
  })

  test('Acn executor + query fire sites are wired 1:1', () => {
    const hooks = readFileSync(join(root, 'utils/hooks.ts'), 'utf8')
    expect(hooks).toContain("hook_event_name: 'PostToolBatch'")
    expect(hooks).toContain('executePostToolBatchHooks')
    expect(hooks).toContain("case 'PostToolBatch':")
    expect(hooks).toContain("'for PostToolBatch':")

    const query = readFileSync(join(root, 'query.ts'), 'utf8')
    expect(query).toContain('executePostToolBatchHooks')
    expect(query).toContain(
      'PostToolBatch hooks cancelled (control stream closed)',
    )
    expect(query).toContain('Execution stopped by PostToolBatch hook')
    expect(query).toContain(
      '[end-turn] PostToolBatch block discarded (turn ended by',
    )
    expect(query).toContain(
      'densable command Stop / goal / TeammateIdle still run',
    )
    expect(query).toContain("return { reason: 'hook_stopped' }")
    expect(query).toContain('refreshMcpClients')
    expect(query).toContain('tengu_mcp_tools_refreshed_mid_turn')

    const tool = readFileSync(join(root, 'Tool.ts'), 'utf8')
    expect(tool).toContain('refreshMcpClients?: () => MCPServerConnection[]')
    expect(tool).toContain('export function resolveMcpClients')

    const repl = readFileSync(join(root, 'screens/REPL.tsx'), 'utf8')
    expect(repl).toContain('refreshMcpClients: computeMcpClients')
    expect(query).toContain("hookEvent: 'PostToolBatch'")
  })

  test('leftover g1o treats PostToolBatch as after-edit', () => {
    expect(isAfterEditHook('PostToolBatch')).toBe(true)
    expect(isAfterEditHook('PostToolBatch', 'Bash')).toBe(true)
    expect(isAfterEditHook('PostToolUse', 'Write')).toBe(true)
    expect(isAfterEditHook('PostToolUse', 'Bash')).toBe(false)
  })
})
