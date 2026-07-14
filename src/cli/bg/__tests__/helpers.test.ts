import { describe, expect, test } from 'bun:test'
import {
  APC_ERROR_CODE_RE,
  canBackgroundSession,
  deriveBackgroundSeed,
  formatBgHints,
  shouldOpenAgentsViewOnDetach,
  stripBgFlags,
} from '../helpers.js'

describe('shouldOpenAgentsViewOnDetach (official GCp)', () => {
  test('opens only for APC detached success with both TTYs', () => {
    expect(
      shouldOpenAgentsViewOnDetach(
        { outcome: 'detached', viaApc: true },
        true,
        true,
      ),
    ).toBe(true)
  })

  test('rejects non-APC, non-detached, error codes, or non-TTY', () => {
    expect(
      shouldOpenAgentsViewOnDetach(
        { outcome: 'detached', viaApc: false },
        true,
        true,
      ),
    ).toBe(false)
    expect(
      shouldOpenAgentsViewOnDetach(
        { outcome: 'error', viaApc: true },
        true,
        true,
      ),
    ).toBe(false)
    expect(
      shouldOpenAgentsViewOnDetach(
        { outcome: 'detached', viaApc: true, msg: 'ESTALLED: timed out' },
        true,
        true,
      ),
    ).toBe(false)
    expect(
      shouldOpenAgentsViewOnDetach(
        { outcome: 'detached', viaApc: true },
        true,
        false,
      ),
    ).toBe(false)
  })

  test('APC_ERROR_CODE_RE matches official hQr', () => {
    expect(APC_ERROR_CODE_RE.test('ESTALLED: x')).toBe(true)
    expect(APC_ERROR_CODE_RE.test('detached ok')).toBe(false)
  })
})

describe('stripBgFlags (official Iia)', () => {
  test('strips --bg and --background before --', () => {
    expect(stripBgFlags(['--bg', '-p', 'hi'])).toEqual(['-p', 'hi'])
    expect(stripBgFlags(['--background', 'x', '--bg'])).toEqual(['x'])
  })

  test('keeps args after -- including bg-looking tokens', () => {
    expect(stripBgFlags(['--bg', '--', '--background', 'keep'])).toEqual([
      '--',
      '--background',
      'keep',
    ])
  })
})

describe('formatBgHints (official Vdt)', () => {
  test('includes attach/logs/stop/agents lines', () => {
    const text = formatBgHints('abc123', undefined, 'my-job')
    expect(text).toContain('backgrounded · abc123')
    expect(text).toContain('my-job')
    expect(text).toContain('claude agents')
    expect(text).toContain('claude attach abc123')
    expect(text).toContain('claude logs abc123')
    expect(text).toContain('claude stop abc123')
  })
})

describe('deriveBackgroundSeed (official p1t)', () => {
  test('returns null without user and without fallback', () => {
    expect(deriveBackgroundSeed([], '')).toBeNull()
  })

  test('uses latest non-meta user text + assistant detail', () => {
    const seed = deriveBackgroundSeed(
      [
        {
          type: 'user',
          message: { content: 'fix the flaky test' },
        },
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Looking into it' }] },
        },
      ],
      '',
      { sessionTitle: 'my-session', agentColor: 'blue' },
    )
    expect(seed).toEqual({
      intent: 'fix the flaky test',
      name: 'my-session',
      nameSource: 'user',
      color: 'blue',
      detail: 'Looking into it',
    })
  })

  test('fallback intent when only systemish user content', () => {
    const seed = deriveBackgroundSeed(
      [
        {
          type: 'user',
          message: { content: '<command-name>foo</command-name>' },
        },
      ],
      'keep going',
    )
    expect(seed?.intent).toBe('keep going')
  })
})

describe('canBackgroundSession (official mOo)', () => {
  test('requires feature + not bg + seed', () => {
    const messages = [{ type: 'user', message: { content: 'hi' } }]
    expect(
      canBackgroundSession(messages, {
        featureEnabled: true,
        isBgSession: false,
        skipHistory: false,
        adoptDisabled: false,
      }),
    ).toBe(true)
    expect(
      canBackgroundSession(messages, {
        featureEnabled: true,
        isBgSession: true,
        skipHistory: false,
        adoptDisabled: false,
      }),
    ).toBe(false)
    expect(
      canBackgroundSession([], {
        featureEnabled: true,
        isBgSession: false,
        skipHistory: false,
        adoptDisabled: false,
      }),
    ).toBe(false)
  })
})

describe('GCp attach → AgentsView gate contract', () => {
  test('TailAttachResult-shaped detach opens AgentsView only when viaApc+TTY', () => {
    // Portable stand-in: log-tail Ctrl+C with both TTYs → viaApc true.
    const detached = { outcome: 'detached' as const, viaApc: true }
    expect(shouldOpenAgentsViewOnDetach(detached, true, true)).toBe(true)
    // Non-TTY attach (pipe/CI) must not open interactive AgentsView.
    expect(shouldOpenAgentsViewOnDetach(detached, false, true)).toBe(false)
  })
})
