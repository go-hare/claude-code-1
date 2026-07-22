/**
 * densable kMf / a$f / uUt — mcp_set_servers tools[].org_max_permission
 * must survive schema parse and fold into toolPermissions.
 */
import { describe, expect, test } from 'bun:test'
import {
  McpServerConfigForProcessTransportSchema,
  McpServerToolPolicySchema,
  SDKMessageOriginSchema,
  SDKUserMessageSchema,
} from '../coreSchemas.js'

describe('McpServerToolPolicySchema densable kMf', () => {
  test('accepts permission_policy + org_max_permission', () => {
    const r = McpServerToolPolicySchema().parse({
      name: 'danger',
      permission_policy: 'always_deny',
      org_max_permission: 'blocked',
    })
    expect(r.org_max_permission).toBe('blocked')
    expect(r.permission_policy).toBe('always_deny')
  })
})

describe('McpServerConfigForProcessTransportSchema keeps tools/org ceiling', () => {
  test('http config tools[] not stripped', () => {
    const r = McpServerConfigForProcessTransportSchema().parse({
      type: 'http',
      url: 'https://mcp.example/mcp',
      tools: [
        { name: 'rm', org_max_permission: 'blocked' },
        { name: 'read', org_max_permission: 'allow' },
        { name: 'write', org_max_permission: 'ask' },
      ],
    })
    expect(r.type).toBe('http')
    if (r.type === 'http') {
      expect(r.tools).toEqual([
        { name: 'rm', org_max_permission: 'blocked' },
        { name: 'read', org_max_permission: 'allow' },
        { name: 'write', org_max_permission: 'ask' },
      ])
    }
  })

  test('sse config toolPermissions retained', () => {
    const r = McpServerConfigForProcessTransportSchema().parse({
      type: 'sse',
      url: 'https://mcp.example/sse',
      toolPermissions: { shell: 'blocked' },
    })
    if (r.type === 'sse') {
      expect(r.toolPermissions).toEqual({ shell: 'blocked' })
    }
  })
})

describe('SDK user origin densable NMf/W6a', () => {
  test('origin peer/channel/observer/task-notification/auto-continuation parse', () => {
    for (const kind of [
      'peer',
      'channel',
      'observer',
      'observer-activity',
      'human',
      'task-notification',
      'auto-continuation',
      'coordinator',
    ] as const) {
      const o = SDKMessageOriginSchema().parse({
        kind,
        senderTaskId: 't1',
      })
      expect(o.kind).toBe(kind)
      expect(o.senderTaskId).toBe('t1')
    }
  })

  test('SDKUserMessageSchema keeps origin (not stripped)', () => {
    const msg = SDKUserMessageSchema().parse({
      type: 'user',
      message: { role: 'user', content: 'hi' },
      parent_tool_use_id: null,
      isSynthetic: true,
      origin: { kind: 'peer', senderTaskId: 'a-1' },
    })
    expect(msg.origin).toEqual({ kind: 'peer', senderTaskId: 'a-1' })
  })
})
