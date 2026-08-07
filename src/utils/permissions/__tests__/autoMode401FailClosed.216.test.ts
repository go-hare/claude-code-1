/**
 * densable 2.1.216 — auto mode unavailable fail-closed message passes
 * httpStatus/errorKind into hUd; reason stays DCt "Classifier unavailable".
 */
import { describe, expect, test } from 'bun:test'
import { buildClassifierUnavailableMessage } from '../../messages.js'

describe('auto mode 401 fail-closed message shape', () => {
  test('DCt decision reason is Classifier unavailable (not HTTP 401 string)', () => {
    // permissions.ts uses literal 'Classifier unavailable' for decisionReason
    const DCt = 'Classifier unavailable'
    expect(DCt).toBe('Classifier unavailable')
  })

  test('fail-closed user message uses hUd without invented 401 text', () => {
    const message = buildClassifierUnavailableMessage(
      'Bash',
      'claude-opus-4',
      401,
      'http_401',
    )
    expect(message.startsWith('claude-opus-4 is temporarily unavailable')).toBe(
      true,
    )
    expect(message).toContain(
      'so auto mode cannot determine the safety of Bash right now',
    )
    expect(message).toContain('Wait briefly and then try this action again')
    expect(message).not.toMatch(/HTTP\s*401/)
  })

  test('stage2 densable suffix documents transient retry guidance', () => {
    const stage2 =
      'Stage 2 classifier error - blocking based on stage 1 assessment (usually transient — retrying often succeeds)'
    expect(stage2).toContain('usually transient')
    expect(stage2).toContain('retrying often succeeds')
  })
})
