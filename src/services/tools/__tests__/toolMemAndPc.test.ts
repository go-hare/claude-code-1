/**
 * densable residual — tool.call G/Z memory deltas + catch ...PC(se).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('toolExecution densable mem deltas + catch PC residual', () => {
  const src = readFileSync(join(import.meta.dir, '../toolExecution.ts'), 'utf8')

  test('imports sample/delta + errorAnalyticsFromThrown densable PC/G/Z', () => {
    expect(src).toContain('sampleToolMemoryUsage')
    expect(src).toContain('toolMemoryDeltasForAnalytics')
    expect(src).toContain('errorAnalyticsFromThrown')
  })

  test('memBefore sampled after startTime before call', () => {
    const start = src.indexOf('const startTime = Date.now()')
    // first sampleToolMemoryUsage is the import; use call site
    const mem = src.indexOf('const memBefore = sampleToolMemoryUsage()')
    const call = src.indexOf('tool.call(', start)
    expect(start).toBeGreaterThan(-1)
    expect(mem).toBeGreaterThan(start)
    expect(call).toBeGreaterThan(mem)
  })

  test('success path has rss/heap/external deltas + toolInputSizeBytes', () => {
    const ok = src.indexOf("logEvent('tengu_tool_use_success'")
    expect(ok).toBeGreaterThan(-1)
    const window = src.slice(ok, ok + 1200)
    expect(window).toContain('successMem')
    expect(window).toContain('rssDeltaBytes')
    expect(window).toContain('heapUsedDeltaBytes')
    expect(window).toContain('externalDeltaBytes')
    expect(window).toContain('toolInputSizeBytes')
  })

  test('catch path has PC fields + errorCode + mem deltas + FSt', () => {
    const catchSite = src.lastIndexOf('classifyToolError(')
    expect(catchSite).toBeGreaterThan(-1)
    const window = src.slice(catchSite - 100, catchSite + 2000)
    expect(window).toContain('errorAnalyticsFromThrown')
    expect(window).toContain('error_message_hash')
    expect(window).toContain('error_constructor')
    expect(window).toContain('errorCode:')
    expect(window).toContain('catchMem')
    expect(window).toContain('rssDeltaBytes')
    expect(window).toContain('agentContextForToolAnalytics')
  })
})
