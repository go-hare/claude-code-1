/**
 * densable residual — tengu_tool_use_success fields (permissionDurationMs,
 * toolResultAttachmentBytes, filePathLen, bashCommand*, readHas*).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('toolExecution densable success analytics residual', () => {
  const src = readFileSync(join(import.meta.dir, '../toolExecution.ts'), 'utf8')

  test('imports z5n/Wkc helpers', () => {
    expect(src).toContain('bashCommandFileExtensionsForAnalytics')
    expect(src).toContain('toolResultAttachmentBytesFromMessages')
  })

  test('success event has densable field anchors', () => {
    const ok = src.indexOf("logEvent('tengu_tool_use_success'")
    expect(ok).toBeGreaterThan(-1)
    const window = src.slice(ok, ok + 2200)
    for (const field of [
      'permissionDurationMs',
      'toolResultAttachmentBytes',
      'toolInputSizeBytes',
      'filePathLen',
      'bashCommandLen',
      'bashCommandFileExtensions',
      'readHasLimit',
      'readHasOffset',
      'rssDeltaBytes',
    ]) {
      expect(window).toContain(field)
    }
  })

  test('filePathLen prefers callInput original path densable w', () => {
    expect(src).toContain('filePathLen = originalPath.length')
    expect(src).toContain('callInput')
  })

  test('Bash sets z5n + bashCommandLen; Read sets hasLimit/Offset', () => {
    expect(src).toContain('bashCommandFileExtensionsForAnalytics(')
    expect(src).toContain('bashCommandLen = bashInput.command.length')
    expect(src).toContain('readHasLimit')
    expect(src).toContain('readHasOffset')
  })
})
