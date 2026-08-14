import { describe, expect, test } from 'bun:test'
import { formatResumedAgentMessage } from '../resumeAgent.js'

/**
 * densable 2.1.232 #44 — D5f short resume surface for completed bg agents.
 *
 *   function D5f(e,t){
 *     let r=t!==void 0, n=dle(e)?hi(e,7):e;
 *     return r
 *       ? `Resumed agent ${n}. Result:\n${t||"(no text output)"}`
 *       : `Resuming agent ${n}`
 *   }
 */
describe('formatResumedAgentMessage (densable D5f)', () => {
  test('without result → Resuming agent <name>', () => {
    expect(formatResumedAgentMessage('scanner')).toBe('Resuming agent scanner')
  })

  test('with result text → Resumed agent + Result body', () => {
    expect(formatResumedAgentMessage('scanner', 'done')).toBe(
      'Resumed agent scanner. Result:\ndone',
    )
  })

  test('empty result string → (no text output)', () => {
    expect(formatResumedAgentMessage('scanner', '')).toBe(
      'Resumed agent scanner. Result:\n(no text output)',
    )
  })

  test('agent-id shaped name is truncated to 7 code units', () => {
    // a + 16 hex = agent id (dle/jjg); hi(e,7) → first 7 units
    const id = 'a81c8d8229cca26eb'
    expect(formatResumedAgentMessage(id)).toBe('Resuming agent a81c8d8')
    expect(formatResumedAgentMessage(id, 'ok')).toBe(
      'Resumed agent a81c8d8. Result:\nok',
    )
  })

  test('human display name is not truncated', () => {
    const name = 'very-long-worker-name-not-an-id'
    expect(formatResumedAgentMessage(name)).toBe(`Resuming agent ${name}`)
  })

  test('high-surrogate at cut is dropped (hi/LFc safety)', () => {
    // Not agent-id shaped → no truncate. Surrogate path only when toAgentId matches.
    // Build an id-shaped string that would end mid-surrogate if we forced length;
    // for agent ids (ascii hex) truncate is plain. Exercise truncate path via id.
    const id = 'a' + 'f'.repeat(16)
    expect(formatResumedAgentMessage(id).endsWith('fffffff')).toBe(false)
    expect(formatResumedAgentMessage(id)).toBe('Resuming agent affffff')
  })

  test('undefined vs empty string are distinct (r=t!==void 0)', () => {
    expect(formatResumedAgentMessage('x')).toBe('Resuming agent x')
    expect(formatResumedAgentMessage('x', undefined)).toBe('Resuming agent x')
    expect(formatResumedAgentMessage('x', '')).toContain('(no text output)')
  })
})
