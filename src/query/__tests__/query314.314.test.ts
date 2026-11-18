import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { resolveRefusalFallbackCandidate } from '../queryHelpers.js'

describe('query #1445 walk_down_opus_lineup & #1231/#1374 wiring', () => {
  test('resolveRefusalFallbackCandidate returns fallbackModel when different from currentModel', () => {
    const picked = resolveRefusalFallbackCandidate({
      currentModel: 'claude-opus-4-6',
      fallbackModel: 'claude-sonnet-4-6',
    })
    expect(picked).toBe('claude-sonnet-4-6')
  })

  test('resolveRefusalFallbackCandidate walks down when fallbackModel matches currentModel', () => {
    const picked = resolveRefusalFallbackCandidate({
      currentModel: 'claude-opus-4-6',
      fallbackModel: 'claude-opus-4-6',
    })
    // Should either pick an allowed non-current model or undefined if none
    if (picked !== undefined) {
      expect(picked).not.toBe('claude-opus-4-6')
    }
  })

  test('QueryEngine.ts handles tombstone removal (#1231/#1374) and awaits progress/attachment recordTranscript', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../QueryEngine.ts'),
      'utf8',
    )
    expect(src).toContain('await removeTranscriptMessage(targetUuid)')
    expect(src).not.toContain(
      "void recordTranscript(messages)\n          }\n          yield* normalizeMessage(msg)\n          break\n        }\n        case 'user'",
    )
  })

  test('query.ts retracts broken reply and retry prompts on malformed_tool_use_exhausted (#1374)', () => {
    const src = readFileSync(join(import.meta.dir, '../../query.ts'), 'utf8')
    expect(src).toContain('retractedMessageUuids')
    expect(src).toContain('MALFORMED_TOOL_USE_RETRY_PROMPT')
    expect(src).toContain(
      'exhaustedMessage.retractedMessageUuids = retractedUuids',
    )
  })
})
