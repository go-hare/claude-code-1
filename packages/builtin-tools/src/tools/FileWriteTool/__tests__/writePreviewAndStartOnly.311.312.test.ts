import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileWriteTool } from '../FileWriteTool.js'
import { computePreviewHiddenMetrics } from '../UI.js'

describe('FileWriteTool preview wrapping (#1249)', () => {
  test('counts hidden lines accurately when a line wraps across multiple terminal rows', () => {
    // 15 lines total: line 1 is 160 chars (wraps into 2 rows at width 80), leaving 8 rows for lines 2..9.
    const lines = [
      'x'.repeat(160),
      ...Array.from({ length: 14 }, (_, i) => `line ${i + 2}`),
    ]
    const content = lines.join('\n') + '\n'
    const codeWidth = 80
    const preview = content
      .split('\n')
      .slice(0, 10)
      .join('\n')
      .slice(0, 10 * (codeWidth + 1))

    const { hiddenLines, hiddenChars } = computePreviewHiddenMetrics(
      content,
      preview,
      codeWidth,
      false,
    )
    // Line 1 takes 2 visual rows + lines 2..9 take 8 visual rows = 9 source lines rendered -> 6 hidden lines.
    expect(hiddenLines).toBe(6)
    expect(hiddenChars).toBeUndefined()
  })

  test('computes hiddenChars when a single very long line exceeds MAX_LINES_TO_RENDER rows', () => {
    const content = 'a'.repeat(500)
    const codeWidth = 20
    const preview = content.slice(0, 10 * (codeWidth + 1))

    const { hiddenLines, hiddenChars } = computePreviewHiddenMetrics(
      content,
      preview,
      codeWidth,
      false,
    )
    expect(hiddenLines).toBe(1)
    expect(hiddenChars).toBeGreaterThan(0)
  })
})

describe('FileWriteTool start-only file guard (#1318)', () => {
  test('blocks Write with errorCode 19 when readFileState.holdsOnlyStartOf returns true', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-start-only-'))
    const filePath = join(dir, 'CLAUDE.md')
    writeFileSync(filePath, 'line1\nline2\n')
    try {
      const fakeContext = {
        readFileState: {
          holdsOnlyStartOf: (p: string) => p === filePath,
          get: () => undefined,
        },
        getAppState: () => ({
          toolPermissionContext: {
            mode: 'default',
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
            additionalWorkingDirectories: new Map(),
          },
        }),
      } as unknown as Parameters<
        NonNullable<typeof FileWriteTool.validateInput>
      >[1]

      const res = await FileWriteTool.validateInput!(
        { file_path: filePath, content: 'overwrite' },
        fakeContext,
      )
      expect(res.result).toBe(false)
      if (!res.result) {
        expect(res.errorCode).toBe(19)
        expect(res.message).toContain(
          'You were given only the start of this file',
        )
        expect(res.message).toContain('allow_large: true')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('blocks Write with errorCode 20 when startOnlyFiles includes path or is unreadable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-start-only-20-'))
    const filePath = join(dir, 'rules.md')
    writeFileSync(filePath, 'rule 1\n')
    try {
      const ctxKnown = {
        readFileState: { get: () => undefined },
        startOnlyFiles: [filePath],
        getAppState: () => ({
          toolPermissionContext: {
            mode: 'default',
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
            additionalWorkingDirectories: new Map(),
          },
        }),
      } as unknown as Parameters<
        NonNullable<typeof FileWriteTool.validateInput>
      >[1]

      const resKnown = await FileWriteTool.validateInput!(
        { file_path: filePath, content: 'overwrite' },
        ctxKnown,
      )
      expect(resKnown.result).toBe(false)
      if (!resKnown.result) {
        expect(resKnown.errorCode).toBe(20)
        expect(resKnown.message).toContain(
          'Only the start of this file was given in this session',
        )
      }

      const ctxUnreadable = {
        readFileState: { get: () => undefined },
        startOnlyFiles: 'unreadable' as const,
        getAppState: () => ({
          toolPermissionContext: {
            mode: 'default',
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
            additionalWorkingDirectories: new Map(),
          },
        }),
      } as unknown as Parameters<
        NonNullable<typeof FileWriteTool.validateInput>
      >[1]

      const resUnreadable = await FileWriteTool.validateInput!(
        { file_path: filePath, content: 'overwrite' },
        ctxUnreadable,
      )
      expect(resUnreadable.result).toBe(false)
      if (!resUnreadable.result) {
        expect(resUnreadable.errorCode).toBe(20)
        expect(resUnreadable.message).toContain(
          'could not be checked that this path is a different file',
        )
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
