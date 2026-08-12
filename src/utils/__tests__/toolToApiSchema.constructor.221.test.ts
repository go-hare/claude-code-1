/**
 * Official 2.1.221 #10 — preparing API requests for SDK MCP tools named after
 * built-in object properties (e.g. `constructor`) must not crash.
 *
 * Crash repro: plain `{}` map lookup `SWARM_FIELDS_BY_TOOL['constructor']`
 * returns Object.prototype.constructor (Function); `for…of` then throws
 * "X is not iterable" inside filterSwarmFieldsFromSchema → toolToAPISchema.
 */
import { describe, expect, test } from 'bun:test'
import type { Tool } from '../../Tool.js'
import { filterSwarmFieldsFromSchema, toolToAPISchema } from '../api.js'
import { AGENT_TOOL_NAME } from '@claude-code/builtin-tools/tools/AgentTool/constants.js'

const baseSchema = {
  type: 'object' as const,
  properties: {
    foo: { type: 'string' },
    launchSwarm: { type: 'boolean' },
    name: { type: 'string' },
  },
}

describe('filterSwarmFieldsFromSchema (221 #10 constructor)', () => {
  test('prototype-key tool names do not throw / do not filter', () => {
    for (const name of [
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
      '__proto__',
    ]) {
      const out = filterSwarmFieldsFromSchema(name, baseSchema)
      expect(out).toEqual(baseSchema)
      // Must not return a mutated clone when no swarm fields apply
      expect(out.properties).toBe(baseSchema.properties)
    }
  })

  test('known Agent tool still strips swarm fields', () => {
    const out = filterSwarmFieldsFromSchema(AGENT_TOOL_NAME, baseSchema)
    const props = out.properties as Record<string, unknown>
    expect(props.foo).toEqual({ type: 'string' })
    expect(props.name).toBeUndefined()
    expect(props.launchSwarm).toEqual({ type: 'boolean' })
  })
})

describe('toolToAPISchema with constructor-named MCP-shaped tool', () => {
  test('does not throw when tool.name is constructor', async () => {
    const tool = {
      name: 'constructor',
      description: async () => 'sdk mcp tool named constructor',
      prompt: async () => 'sdk mcp tool named constructor',
      inputJSONSchema: {
        type: 'object',
        properties: { arg: { type: 'string' } },
      },
      inputSchema: {} as never,
      isConcurrencySafe: () => true,
      isReadOnly: () => true,
      isMcp: true,
    } as unknown as Tool

    const schema = await toolToAPISchema(tool, {
      getToolPermissionContext: async () => ({ mode: 'default' }) as never,
      tools: [tool],
      agents: [],
    })

    expect(schema).toMatchObject({
      name: 'constructor',
      description: 'sdk mcp tool named constructor',
    })
    expect(
      (schema as { input_schema?: { properties?: unknown } }).input_schema
        ?.properties,
    ).toEqual({ arg: { type: 'string' } })
  })
})
