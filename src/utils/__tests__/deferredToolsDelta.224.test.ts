/**
 * densable 2.1.224 #12 — mid-turn MCP deferred tools must be announced.
 * Gold: NVs (listed vs announced, readdedNames), L3o, CM, MCP status fields.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

// Incomplete growthbook strip returns null for every flag — poisons fullscreen
// feature gate (expects boolean false, gets null) under process-global mock.module.
const realAnalytics = await import('src/services/analytics/index.js')
const analyticsSnap = snapshotModuleExports(realAnalytics)
const realGrowthbook = await import('src/services/analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)
mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: () => {},
}))
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: () => null,
}))
afterAll(() => {
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

import {
  DEFERRED_DELTA_LIST_CAP,
  formatFailedMcpServerLine,
  getDeferredToolsDelta,
  isMcpPolicyBlockError,
  mapFailedMcpServersForDelta,
  summarizeByServerPrefix,
  type DeferredToolsDelta,
} from '../searchExtraTools.js'
import { formatDeferredToolLine } from '@claude-code/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
import type { Tools } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { normalizeAttachmentForAPI } from '../messages.js'

function deferredTool(name: string, description = `desc for ${name}`) {
  return {
    name,
    description: async () => description,
    isMcp: name.startsWith('mcp__'),
    shouldDefer: true,
    mcpInfo: name.startsWith('mcp__')
      ? {
          serverName: name.split('__')[1] ?? 'srv',
          toolName: name.split('__').slice(2).join('__') || name,
        }
      : undefined,
  }
}

function dtdAttachment(
  partial: Partial<DeferredToolsDelta> & {
    addedNames?: string[]
    addedLines?: string[]
    removedNames?: string[]
  },
): Message {
  return {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-000000000001',
    timestamp: new Date().toISOString(),
    attachment: {
      type: 'deferred_tools_delta',
      addedNames: partial.addedNames ?? [],
      addedLines: partial.addedLines ?? [],
      removedNames: partial.removedNames ?? [],
      ...(partial.readdedNames !== undefined && {
        readdedNames: partial.readdedNames,
      }),
      ...(partial.pendingMcpServers !== undefined && {
        pendingMcpServers: partial.pendingMcpServers,
      }),
      ...(partial.needsAuthMcpServers !== undefined && {
        needsAuthMcpServers: partial.needsAuthMcpServers,
      }),
      ...(partial.failedMcpServers !== undefined && {
        failedMcpServers: partial.failedMcpServers,
      }),
    },
  } as Message
}

describe('densable 2.1.224 #12 getDeferredToolsDelta (NVs)', () => {
  test('first-time mid-turn deferred MCP tools get addedNames + addedLines', () => {
    const tools = [
      deferredTool('mcp__alpha__list'),
      deferredTool('mcp__alpha__get'),
    ] as unknown as Tools
    const delta = getDeferredToolsDelta(tools, [])
    expect(delta).not.toBeNull()
    expect(delta!.addedNames).toEqual(['mcp__alpha__get', 'mcp__alpha__list'])
    expect(delta!.addedLines.length).toBe(2)
    expect(delta!.removedNames).toEqual([])
    expect(delta!.readdedNames).toEqual([])
  })

  test('reconnect after remove yields readdedNames without full lines', () => {
    const tools = [deferredTool('mcp__svc__tool')] as unknown as Tools
    const history: Message[] = [
      dtdAttachment({
        addedNames: ['mcp__svc__tool'],
        addedLines: [formatDeferredToolLine(tools[0]!)],
        removedNames: [],
      }),
      dtdAttachment({
        addedNames: [],
        addedLines: [],
        removedNames: ['mcp__svc__tool'],
      }),
    ]
    const delta = getDeferredToolsDelta(tools, history)
    expect(delta).not.toBeNull()
    expect(delta!.readdedNames).toEqual(['mcp__svc__tool'])
    // densable b = unlisted only; readded tools already listed → no lines
    expect(delta!.addedLines).toEqual([])
    // densable So([_ , b]) still includes readded in addedNames
    expect(delta!.addedNames).toContain('mcp__svc__tool')
  })

  test('pending MCP servers only fire when list changes', () => {
    const tools = [] as unknown as Tools
    const history: Message[] = [
      dtdAttachment({
        addedNames: [],
        addedLines: [],
        removedNames: [],
        pendingMcpServers: ['github'],
      }),
    ]
    // same pending → null
    expect(
      getDeferredToolsDelta(tools, history, undefined, ['github']),
    ).toBeNull()
    // new pending → delta with pending
    const delta = getDeferredToolsDelta(tools, history, undefined, [
      'github',
      'slack',
    ])
    expect(delta).not.toBeNull()
    expect(delta!.pendingMcpServers).toEqual(['github', 'slack'])
  })

  test('needsAuth / failed optional args only compared when passed', () => {
    const tools = [] as unknown as Tools
    // no MCP args → null even if pool empty
    expect(getDeferredToolsDelta(tools, [])).toBeNull()
    const withAuth = getDeferredToolsDelta(tools, [], undefined, undefined, [
      'oauth-srv',
    ])
    expect(withAuth?.needsAuthMcpServers).toEqual(['oauth-srv'])
    const withFailed = getDeferredToolsDelta(
      tools,
      [],
      undefined,
      undefined,
      undefined,
      [{ name: 'bad', error: 'ECONNREFUSED' }],
    )
    expect(withFailed?.failedMcpServers).toEqual([
      { name: 'bad', error: 'ECONNREFUSED' },
    ])
  })

  test('undefer (still in pool, not deferred) is silent — not removed', () => {
    const deferred = deferredTool('AlwaysLoad')
    const loaded = {
      ...deferred,
      shouldDefer: false,
      isMcp: false,
    }
    const history: Message[] = [
      dtdAttachment({
        addedNames: ['AlwaysLoad'],
        addedLines: ['AlwaysLoad - was deferred'],
        removedNames: [],
      }),
    ]
    // tool still in pool but not deferred → silent
    const delta = getDeferredToolsDelta([loaded] as unknown as Tools, history)
    expect(delta).toBeNull()
  })
})

describe('densable 2.1.224 #12 L3o / CM helpers', () => {
  test('summarizeByServerPrefix groups mcp__server__*', () => {
    expect(
      summarizeByServerPrefix([
        'mcp__foo__a',
        'mcp__foo__b',
        'mcp__foo__c',
        'BareTool',
      ]),
    ).toBe('BareTool, mcp__foo__* (3)')
  })

  test('DEFERRED_DELTA_LIST_CAP is 30', () => {
    expect(DEFERRED_DELTA_LIST_CAP).toBe(30)
  })

  test('mapFailedMcpServersForDelta drops UNCONFIGURED', () => {
    const mapped = mapFailedMcpServersForDelta([
      {
        type: 'failed',
        name: 'ok',
        error: 'boom',
        errorCode: '500',
      },
      {
        type: 'failed',
        name: 'ghost',
        errorCode: 'UNCONFIGURED',
      },
      { type: 'connected', name: 'live' },
    ])
    expect(mapped).toEqual([{ name: 'ok', errorCode: '500', error: 'boom' }])
  })

  test('formatFailedMcpServerLine + policy block detect', () => {
    expect(
      formatFailedMcpServerLine({
        name: 'x',
        errorCode: '500',
        error: 'nope',
      }),
    ).toBe('x (500): "nope"')
    expect(isMcpPolicyBlockError('Blocked by enterprise managed policy')).toBe(
      true,
    )
    expect(isMcpPolicyBlockError('ECONNREFUSED')).toBe(false)
  })
})

describe('densable 2.1.224 #12 messages render', () => {
  test('readded + pending + failed render without throw', () => {
    const out = normalizeAttachmentForAPI({
      type: 'deferred_tools_delta',
      addedNames: [],
      addedLines: [],
      removedNames: [],
      readdedNames: ['mcp__svc__a', 'mcp__svc__b'],
      pendingMcpServers: ['connecting'],
      needsAuthMcpServers: ['oauth'],
      failedMcpServers: [
        { name: 'dead', error: 'timeout' },
        {
          name: 'blocked',
          error: 'Blocked by enterprise managed policy',
        },
      ],
    } as never)
    expect(Array.isArray(out)).toBe(true)
    const text = JSON.stringify(out)
    expect(text).toContain('available again')
    expect(text).toContain('still connecting')
    expect(text).toContain('require authentication')
    expect(text).toContain('failed to connect')
    expect(text).toContain('managed policy')
    // L3o grouping for readded
    expect(text).toContain('mcp__svc__*')
  })

  test('long removed list uses CM=30 collapsed form', () => {
    const many = Array.from({ length: 35 }, (_, i) => `mcp__s__t${i}`)
    const out = normalizeAttachmentForAPI({
      type: 'deferred_tools_delta',
      addedNames: [],
      addedLines: [],
      removedNames: many,
    } as never)
    const text = JSON.stringify(out)
    expect(text).toContain('35 deferred tools are no longer available')
    expect(text).toContain('mcp__s__*')
  })
})
