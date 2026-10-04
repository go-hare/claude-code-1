/**
 * densable 2.1.283 leftover gold `ke`/`Ot` + leftover `CWt`/`zn`/`Wn` wrap.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  HOOKS_FORWARD_IDLE_COPY,
  HOOKS_FORWARD_NOT_REGISTERED_COPY,
  HOOKS_FORWARD_UNDECIDED_COPY,
  createCloudHooksPack,
  hooksFeatureOff,
  hooksOffReasonFromStanding,
  isCloudHooksForwardingEnabled,
  reportCloudHooksFromStanding,
} from '../cloudHooksPack.js'

const src = readFileSync(join(import.meta.dir, '../cloudHooksPack.ts'), 'utf8')

describe('cloudHooksPack 283 leftover gold ke/Ot wrap', () => {
  test('source-locks gold ke/Ot/Gn/CWt/zn/Wn; no minify public API', () => {
    expect(src).toContain('gold `ke` @202311651')
    expect(src).toContain('gold `Ot` @202308188')
    expect(src).toContain('leftover `CWt` @202277705')
    expect(src).toContain('leftover `zn` @202310643')
    expect(src).toContain('leftover `Wn` @202309915')
    expect(src).toContain('tengu_device_hooks_headless_off')
    expect(src).toContain('device_hooks_client_register')
    expect(src).toContain('consent_unreadable')
    expect(src).toContain('consent_distrusted')
    expect(src).toContain('CLAUDE_CODE_DISABLE_HOOK_FORWARDING')
    expect(src).toContain('run /hooks in claude on this machine to decide.')
    expect(src).toContain(
      'Hooks from this machine are idle for this cloud session',
    )
    expect(src).toContain('isCloudHooksForwardingEnabled')
    expect(src).toContain('seams.enabled ?? isCloudHooksForwardingEnabled')
    expect(src).not.toMatch(/^export (async )?function ke\b/m)
    expect(src).not.toMatch(/^export (async )?function Ot\b/m)
    expect(src).not.toMatch(/^export (async )?function CWt\b/m)
    expect(src).not.toMatch(/^export (async )?function zn\b/m)
    expect(src).not.toMatch(/^export (async )?function Wn\b/m)
    expect(src).not.toContain('settings.set(')
    expect(src).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(src).not.toContain('tengu_violin_amati')
    expect(src).not.toContain('new WebSocket')
  })

  test('Gn 1:1', () => {
    expect(HOOKS_FORWARD_UNDECIDED_COPY).toBe(
      'Hooks from this machine are not used in cloud sessions yet: run /hooks in claude on this machine to decide.',
    )
  })

  test('jn idle / not_registered 1:1', () => {
    expect(HOOKS_FORWARD_IDLE_COPY).toBe(
      'Hooks from this machine are idle for this cloud session: nothing has used it for a while, so their registration was allowed to lapse; it is made again when the session is next used.',
    )
    expect(HOOKS_FORWARD_NOT_REGISTERED_COPY).toBe(
      'Hooks from this machine are not registered with this cloud session yet: it has not answered (it may be asleep); they are registered when it is next used.',
    )
  })

  test('ke no_consent includes Gn; other reasons omit message', () => {
    expect(hooksFeatureOff('no_consent', false, 'default').report()).toEqual({
      state: 'off',
      reason: 'no_consent',
      source: 'default',
      message: HOOKS_FORWARD_UNDECIDED_COPY,
    })
    expect(hooksFeatureOff('not_bound', true).report()).toEqual({
      state: 'off',
      reason: 'not_bound',
    })
    expect(hooksFeatureOff('declined', false, 'stored').report()).toEqual({
      state: 'off',
      reason: 'declined',
      source: 'stored',
    })
    expect(hooksFeatureOff('consent_distrusted', false).report()).toEqual({
      state: 'off',
      reason: 'consent_distrusted',
    })
  })

  test('CWt: not windows AND wood AND !DISABLE_HOOK_FORWARDING', async () => {
    const woodOn = { violinWood: () => true, platform: () => 'macos' }
    expect(await isCloudHooksForwardingEnabled(woodOn)).toBe(true)
    expect(
      await isCloudHooksForwardingEnabled({
        violinWood: () => true,
        platform: () => 'windows',
      }),
    ).toBe(false)
    expect(
      await isCloudHooksForwardingEnabled({
        violinWood: () => false,
        platform: () => 'macos',
      }),
    ).toBe(false)
    const prev = process.env.CLAUDE_CODE_DISABLE_HOOK_FORWARDING
    process.env.CLAUDE_CODE_DISABLE_HOOK_FORWARDING = '1'
    try {
      expect(await isCloudHooksForwardingEnabled(woodOn)).toBe(false)
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_HOOK_FORWARDING
      } else {
        process.env.CLAUDE_CODE_DISABLE_HOOK_FORWARDING = prev
      }
    }
  })

  test('zn lastOutcome including consent_distrusted', () => {
    const standing = { kind: 'idle' }
    expect(
      hooksOffReasonFromStanding(
        { phase: 'registered', lastOutcome: 'consent_distrusted' },
        standing,
      ),
    ).toBe('consent_distrusted')
    expect(
      hooksOffReasonFromStanding(
        { phase: 'registered', lastOutcome: 'no_consent' },
        standing,
      ),
    ).toBe('no_consent')
    expect(
      hooksOffReasonFromStanding(
        { phase: 'registering', lastOutcome: 'muted' },
        standing,
      ),
    ).toBeNull()
    expect(
      hooksOffReasonFromStanding(
        { phase: 'registered', lastOutcome: 'muted' },
        standing,
      ),
    ).toBe('muted')
    expect(
      hooksOffReasonFromStanding(
        { phase: 'registered', lastOutcome: 'unregistered' },
        { kind: 'kept_none' },
      ),
    ).toBe('kept_none')
    expect(
      hooksOffReasonFromStanding(
        { phase: 'registered', lastOutcome: 'unregistered' },
        standing,
      ),
    ).toBe('nothing_to_offer')
    expect(
      hooksOffReasonFromStanding(
        { phase: 'registered', lastOutcome: 'not_ready' },
        { kind: 'paused' },
      ),
    ).toBe('paused')
    expect(
      hooksOffReasonFromStanding(
        { phase: 'registering', lastOutcome: 'stale_epoch' },
        { kind: 'paused' },
      ),
    ).toBeNull()
    expect(
      hooksOffReasonFromStanding(
        { phase: 'idle', lastOutcome: 'failed' },
        { kind: 'dormant' },
      ),
    ).toBeNull()
    expect(
      hooksOffReasonFromStanding(
        { phase: 'idle', lastOutcome: 'failed' },
        { kind: 'paused' },
      ),
    ).toBe('paused')
    expect(
      hooksOffReasonFromStanding(
        { phase: 'idle', lastOutcome: 'failed' },
        standing,
      ),
    ).toBe('failed')
    expect(
      hooksOffReasonFromStanding(
        { phase: 'registered', lastOutcome: 'registered' },
        standing,
      ),
    ).toBeNull()
    expect(
      hooksOffReasonFromStanding(
        { phase: 'stopped', lastOutcome: 'registered' },
        standing,
      ),
    ).toBe('stopped')
    expect(
      hooksOffReasonFromStanding(
        {
          phase: 'stopped',
          lastOutcome: 'registered',
          stoppedReason: 'detached',
        },
        standing,
      ),
    ).toBe('detached')
  })

  test('Wn: zn off (consent_distrusted); idle copy; else forwarded', () => {
    expect(
      reportCloudHooksFromStanding(
        { phase: 'registered', lastOutcome: 'consent_distrusted' },
        { kind: 'idle' },
      ),
    ).toEqual({ state: 'off', reason: 'consent_distrusted' })
    expect(
      reportCloudHooksFromStanding(
        { phase: 'registered', lastOutcome: 'registered' },
        { kind: 'dormant' },
        undefined,
        'dormant',
      ),
    ).toEqual({
      state: 'idle',
      source: 'stored',
      reason: 'dormant',
      message: HOOKS_FORWARD_IDLE_COPY,
    })
    expect(
      reportCloudHooksFromStanding(
        { phase: 'registered', lastOutcome: null },
        { kind: 'idle' },
      ),
    ).toEqual({ state: 'forwarded', source: 'stored' })
  })

  test('Ot disabled → undefined', async () => {
    const pack = createCloudHooksPack({ enabled: () => false })
    expect(await pack({ bound: true })).toBeUndefined()
  })

  test('Ot default enabled is leftover CWt (env disable → undefined)', async () => {
    const prev = process.env.CLAUDE_CODE_DISABLE_HOOK_FORWARDING
    process.env.CLAUDE_CODE_DISABLE_HOOK_FORWARDING = '1'
    try {
      const pack = createCloudHooksPack({
        readConsentPin: async () => 'accepted',
        createPack: () => ({
          sender: { unregister: () => {}, servingMute: () => {} },
          servingMuted: false,
        }),
      })
      expect(await pack({ bound: true })).toBeUndefined()
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_HOOK_FORWARDING
      } else {
        process.env.CLAUDE_CODE_DISABLE_HOOK_FORWARDING = prev
      }
    }
  })

  test('Ot !bound → ke not_bound; attach sets reattach', async () => {
    const pack = createCloudHooksPack({ enabled: () => true })
    const off = await pack({ bound: false, trigger: 'attach' })
    expect(off?.feature).toBe('hooks')
    expect(off?.report()).toEqual({ state: 'off', reason: 'not_bound' })
  })

  test('Ot declined / aborted / unreadable / unset', async () => {
    const declined = await createCloudHooksPack({
      enabled: () => true,
      readConsentPin: async () => 'declined',
    })({ bound: true })
    expect(declined?.report()).toEqual({
      state: 'off',
      reason: 'declined',
      source: 'stored',
    })
    const aborted = await createCloudHooksPack({
      enabled: () => true,
      readConsentPin: async () => 'aborted',
    })({ bound: true })
    expect(aborted?.report()).toEqual({ state: 'off', reason: 'detached' })
    const unreadable = await createCloudHooksPack({
      enabled: () => true,
      readConsentPin: async () => 'unreadable',
    })({ bound: true })
    expect(unreadable?.report()).toEqual({ state: 'off', reason: 'unreadable' })
    const unset = await createCloudHooksPack({
      enabled: () => true,
      readConsentPin: async () => 'unset',
    })({ bound: true })
    expect(unset?.report()).toEqual({
      state: 'off',
      reason: 'no_consent',
      source: 'default',
      message: HOOKS_FORWARD_UNDECIDED_COPY,
    })
  })

  test('Ot accepted → forwarded stored pending (no lastOutcome compositor)', async () => {
    const pack = createCloudHooksPack({
      enabled: () => true,
      readConsentPin: async () => 'accepted',
      createPack: () => ({
        sender: { unregister: () => {}, servingMute: () => {} },
        servingMuted: false,
      }),
    })
    const on = await pack({ bound: true, sessionId: 'session_1' })
    expect(on?.report()).toEqual({
      state: 'forwarded',
      source: 'stored',
      pending: true,
    })
  })
})
