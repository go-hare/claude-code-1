/**
 * densable SIt/Yul residual — tool_${snakeCase(Vs(name))} feature names.
 */
import { describe, expect, test } from 'bun:test'
import {
  cmdFeatureNameForAnalytics,
  hookFeatureNameForAnalytics,
  sanitizeToolNameForAnalytics,
  toolFeatureNameForAnalytics,
} from '../metadata.js'

// AnalyticsMetadata is typed `never` (brand only); cast for runtime asserts.
const asStr = (v: unknown): string => String(v)

describe('toolFeatureNameForAnalytics densable SIt/Yul', () => {
  test('Read → tool_read', () => {
    expect(asStr(toolFeatureNameForAnalytics('Read'))).toBe('tool_read')
  })

  test('AskUserQuestion → tool_ask_user_question', () => {
    expect(asStr(toolFeatureNameForAnalytics('AskUserQuestion'))).toBe(
      'tool_ask_user_question',
    )
  })

  test('mcp__server__tool → tool_mcp_tool (Vs sanitize first)', () => {
    expect(asStr(sanitizeToolNameForAnalytics('mcp__my_server__list'))).toBe(
      'mcp_tool',
    )
    expect(asStr(toolFeatureNameForAnalytics('mcp__my_server__list'))).toBe(
      'tool_mcp_tool',
    )
  })

  test('WebFetch → tool_web_fetch', () => {
    expect(asStr(toolFeatureNameForAnalytics('WebFetch'))).toBe('tool_web_fetch')
  })

  test('densable Vbt/sJe cmd_ and hook_ prefixes', () => {
    expect(asStr(cmdFeatureNameForAnalytics('Radio'))).toBe('cmd_radio')
    expect(asStr(hookFeatureNameForAnalytics('SessionStart'))).toBe(
      'hook_session_start',
    )
  })

  test('source anchors densable feature_bad wire in toolExecution', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(
      join(import.meta.dir, '../../tools/toolExecution.ts'),
      'utf8',
    )
    expect(src).toContain("logEvent('tengu_feature_bad'")
    expect(src).toContain('toolFeatureNameForAnalytics')
    expect(src).toContain("'tool_not_found'")
    expect(src).toContain("'NO_SUCH_TOOL'")
    expect(src).toContain('errorCode:')
  })
})
