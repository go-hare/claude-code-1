/**
 * densable cWr resolve + vKu tengu_dead_probe_tool_alias_exec residual.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

const analyticsEvents: Array<{ name: string; data?: unknown }> = []

mock.module('src/services/analytics/index.js', () => ({
  logEvent: (name: string, data?: unknown) => {
    analyticsEvents.push({ name, data })
  },
  logEventAsync: async () => {},
  stripProtoFields: (v: unknown) => v,
  attachAnalyticsSink: () => {},
  _resetForTesting: () => {},
}))

// Avoid pulling full tools registry for default baseTools; tests pass baseTools.
mock.module('src/tools.js', () => ({
  getAllBaseTools: () => [],
}))

import { buildTool } from '../../../Tool.js'
import {
  resetDeadProbeToolAliasExecForTests,
  resolveToolForExecution,
} from '../toolExecution.js'

function makeTool(name: string, aliases?: string[]) {
  return buildTool({
    name,
    aliases,
    inputSchema: { type: 'object' } as any,
    maxResultSizeChars: 1000,
    call: async () => ({ data: 'ok' }),
    description: async () => name,
    prompt: async () => name,
    mapToolResultToToolResultBlockParam: (c, id) => ({
      type: 'tool_result' as const,
      tool_use_id: id,
      content: String(c),
    }),
    renderToolUseMessage: () => null,
  })
}

describe('resolveToolForExecution densable dead_probe / I8 alias fallback', () => {
  beforeEach(() => {
    analyticsEvents.length = 0
    resetDeadProbeToolAliasExecForTests()
  })

  test('resolves primary from session tools', () => {
    const bash = makeTool('Bash')
    const tools = [bash]
    expect(resolveToolForExecution(tools, 'Bash')?.name).toBe('Bash')
    expect(analyticsEvents).toEqual([])
  })

  test('session toolAliases single-hop still works without dead_probe', () => {
    const bash = makeTool('Bash')
    // remap shell→Bash via primary name — not a builtin alias, so no dead_probe
    expect(
      resolveToolForExecution([bash], 'shell', { shell: 'Bash' })?.name,
    ).toBe('Bash')
    expect(
      analyticsEvents.some(e => e.name === 'tengu_dead_probe_tool_alias_exec'),
    ).toBe(false)
  })

  test('base-tools fallback accepts only builtin alias (no session toolAliases on I8 path)', () => {
    const stop = makeTool('TaskStop', ['KillShell'])
    // Session tools empty; resolve via base tools alias only
    const found = resolveToolForExecution([], 'KillShell', null, [stop])
    expect(found?.name).toBe('TaskStop')
  })

  test('base-tools fallback rejects primary name not present in session tools', () => {
    const bash = makeTool('Bash')
    // densable: if !s, Tc(I8(),i) then only if aliases.includes(i) — primary Bash is not alias
    expect(resolveToolForExecution([], 'Bash', null, [bash])).toBeUndefined()
  })

  test('session toolAliases alone does not unlock I8 fallback without aliases.includes', () => {
    const bash = makeTool('Bash')
    // Old local path accepted session toolAliases remap on getAllBaseTools;
    // densable I8 path has no toolAliases and requires aliases.includes.
    expect(
      resolveToolForExecution([], 'shell', { shell: 'Bash' }, [bash]),
    ).toBeUndefined()
  })

  test('logs tengu_dead_probe_tool_alias_exec once when executing via builtin alias', () => {
    const stop = makeTool('TaskStop', ['KillShell'])
    const a = resolveToolForExecution([stop], 'KillShell')
    expect(a?.name).toBe('TaskStop')
    expect(
      analyticsEvents.filter(e => e.name === 'tengu_dead_probe_tool_alias_exec'),
    ).toHaveLength(1)
    const evt = analyticsEvents.find(
      e => e.name === 'tengu_dead_probe_tool_alias_exec',
    )
    expect(evt?.data).toMatchObject({
      alias: 'KillShell',
      tool: 'TaskStop',
    })

    // second resolve does not re-log (densable vKu)
    resolveToolForExecution([stop], 'KillShell')
    expect(
      analyticsEvents.filter(e => e.name === 'tengu_dead_probe_tool_alias_exec'),
    ).toHaveLength(1)
  })

  test('source anchors densable dead_probe residual', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(join(import.meta.dir, '../toolExecution.ts'), 'utf8')
    expect(src).toContain('tengu_dead_probe_tool_alias_exec')
    expect(src).toContain('resolveToolForExecution')
    expect(src).toContain('loggedDeadProbeToolAliasExec')
    // densable I8 fallback: findToolByName(baseTools, toolName) without aliases map
    expect(src).toContain('findToolByName(baseTools, toolName)')
    expect(src).toContain('fallbackTool?.aliases?.includes(toolName)')
  })
})
