/**
 * Official isAskCappedByOrg + densable showAlwaysAllow UI gate:
 * permanent-allow options hide when:
 * - mcpInfo.effectiveMaxPermission === 'ask'
 * - ask + suppressAlwaysAllowRule
 * - tool.suppressesAlwaysAllowRule(input)
 * - extraGate false (e.g. WebFetch empty hostname)
 */
import { describe, expect, mock, test } from 'bun:test'

// Avoid settings side-effects for EYt/shouldShowAlwaysAllowOptions.
mock.module('src/utils/settings/settings.js', () => ({
  getSettingsForSource: () => null,
  getSettings_DEPRECATED: () => ({}),
  getSettingsFilePathForSource: () => '',
}))

import { computeShowAlwaysAllowOptions } from '../../../utils/permissions/suppressAlwaysAllow.js'

function makeTool(opts: {
  effectiveMaxPermission?: 'allow' | 'ask' | 'blocked'
  suppress?: boolean | ((input: Record<string, unknown>) => boolean)
} = {}) {
  return {
    name: 'TestTool',
    mcpInfo: opts.effectiveMaxPermission
      ? { serverName: 's', toolName: 't', effectiveMaxPermission: opts.effectiveMaxPermission }
      : undefined,
    suppressesAlwaysAllowRule:
      typeof opts.suppress === 'function'
        ? opts.suppress
        : opts.suppress
          ? () => true
          : undefined,
  } as any
}

describe('isAskCappedByOrg UI (2.1.x) + densable showAlwaysAllow', () => {
  test('ask ceiling hides always-allow', () => {
    expect(
      computeShowAlwaysAllowOptions({
        tool: makeTool({ effectiveMaxPermission: 'ask' }),
        input: {},
      }),
    ).toBe(false)
  })

  test('allow ceiling keeps always-allow', () => {
    expect(
      computeShowAlwaysAllowOptions({
        tool: makeTool({ effectiveMaxPermission: 'allow' }),
        input: {},
      }),
    ).toBe(true)
  })

  test('WebFetch also requires non-empty hostname', () => {
    expect(
      computeShowAlwaysAllowOptions({
        tool: makeTool(),
        input: {},
        extraGate: false,
      }),
    ).toBe(false)
    expect(
      computeShowAlwaysAllowOptions({
        tool: makeTool(),
        input: {},
        extraGate: true,
      }),
    ).toBe(true)
    expect(
      computeShowAlwaysAllowOptions({
        tool: makeTool({ effectiveMaxPermission: 'ask' }),
        input: {},
        extraGate: true,
      }),
    ).toBe(false)
  })

  test('ask + suppressAlwaysAllowRule hides always-allow', () => {
    expect(
      computeShowAlwaysAllowOptions({
        tool: makeTool(),
        input: {},
        permissionResult: {
          behavior: 'ask',
          message: 'needs approval',
          suppressAlwaysAllowRule: true,
        },
      }),
    ).toBe(false)
  })

  test('tool.suppressesAlwaysAllowRule hides always-allow', () => {
    expect(
      computeShowAlwaysAllowOptions({
        tool: makeTool({ suppress: true }),
        input: { action: 'list' },
      }),
    ).toBe(false)
  })

  test('tool suppress predicate respects input', () => {
    const tool = makeTool({
      suppress: (input: Record<string, unknown>) => input.action === 'list',
    })
    expect(
      computeShowAlwaysAllowOptions({
        tool,
        input: { action: 'write' },
      }),
    ).toBe(true)
    expect(
      computeShowAlwaysAllowOptions({
        tool,
        input: { action: 'list' },
      }),
    ).toBe(false)
  })

  test('source anchors densable showAlwaysAllow wiring', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(import.meta.dir, '../../../utils/permissions/suppressAlwaysAllow.ts'),
      'utf8',
    )
    expect(src).toContain('computeShowAlwaysAllowOptions')
    expect(src).toContain('suppressAlwaysAllowRule')
    expect(src).toContain('suppressesAlwaysAllowRule')
    const fallback = readFileSync(
      join(import.meta.dir, '../FallbackPermissionRequest.tsx'),
      'utf8',
    )
    expect(fallback).toContain('computeShowAlwaysAllowOptions')
  })
})
