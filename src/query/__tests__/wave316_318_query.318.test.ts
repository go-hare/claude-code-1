import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const srcRoot = join(import.meta.dir, '../..')

describe('Wave 316-318 Group B: Query / TurnStepHooks / QueryEngine', () => {
  test('#1620: query.ts does not yield tombstones on malformed_tool_use_exhausted', () => {
    const src = readFileSync(join(srcRoot, 'query.ts'), 'utf8')
    const idx = src.indexOf("if (malformedToolUse.action === 'exhausted')")
    expect(idx).toBeGreaterThan(-1)
    const slice = src.slice(idx, idx + 700)
    expect(slice).toContain('const retractedUuids: string[] = []')
    expect(slice).not.toContain("type: 'tombstone'")
  })

  test('#1633 & #1653: turnStepHooks.ts propagates AbortError on aborted signal and thrown error', () => {
    const src = readFileSync(join(srcRoot, 'query/turnStepHooks.ts'), 'utf8')
    expect(src).toContain(
      'new AbortError(errorMessage(callArgs.signal.reason))',
    )
    expect(src).toContain(
      'state.thrown !== undefined &&\n      (!callArgs.signal.aborted || isAbortError(state.thrown.error))',
    )
  })

  test('#1493, #1632, #1633, #1653: QueryEngine.ts consumes stop notice, slash cmd stderr, and terminal failure', () => {
    const src = readFileSync(join(srcRoot, 'QueryEngine.ts'), 'utf8')
    expect(src).toContain('getAutoModeUnavailableStopNotice()')
    expect(src).toContain('localCommandFallbackText')
    expect(src).toContain('TERMINAL_FAILURE_REASONS')
    expect(src).toContain('terminatedWithFailure')
  })
})
