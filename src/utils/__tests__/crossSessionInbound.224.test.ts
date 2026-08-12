/**
 * densable 2.1.224 #5 — crossSessionInbound gate + dialogExpiry
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  applyPeerInboundPolicy,
  clearPeerInboundHoldBuffer,
  clearPeerInboundModeGetter,
  decidePeerInboundPolicy,
  decideSessionInboundPolicy,
  gatePeerInboundMessage,
  gatePeerInboundQueuedCommand,
  getHeldPeerInboundMessages,
  PEER_INBOUND_HOLD_BUFFER_MAX,
  peerInboundHoldCauseMessage,
  peerInboundReleaseReasonMessage,
  permissionModeClassOf,
  releaseHeldPeerInboundMessages,
  resolveHeldPeerInboundMessage,
  setPeerInboundHoldListeners,
  setPeerInboundModeGetter,
} from '../crossSessionInbound.js'
import {
  dialogExpiryToMs,
  resolveCrossSessionInbound,
  resolveDialogExpiryFromSources,
} from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'

afterEach(() => {
  clearPeerInboundHoldBuffer()
  clearPeerInboundModeGetter()
  setPeerInboundHoldListeners({})
  delete process.env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS
})

function sourceMap(
  map: Partial<Record<string, SettingsJson | null>>,
): (s: string) => SettingsJson | null {
  return (s: string) => map[s] ?? null
}

describe('densable 2.1.224 #5 resolveCrossSessionInbound (TPr)', () => {
  test('user accept wins; project cannot loosen to accept over user hold', () => {
    const get = sourceMap({
      userSettings: { crossSessionInbound: 'hold' },
      projectSettings: { crossSessionInbound: 'accept' },
    })
    expect(resolveCrossSessionInbound(get as never, () => true)).toBe('hold')
  })

  test('project can tighten user accept → refuse', () => {
    const get = sourceMap({
      userSettings: { crossSessionInbound: 'accept' },
      projectSettings: { crossSessionInbound: 'refuse' },
    })
    expect(resolveCrossSessionInbound(get as never, () => true)).toBe('refuse')
  })

  test('policy beats user', () => {
    const get = sourceMap({
      policySettings: { crossSessionInbound: 'refuse' },
      userSettings: { crossSessionInbound: 'accept' },
    })
    expect(resolveCrossSessionInbound(get as never, () => true)).toBe('refuse')
  })

  test('unset → undefined', () => {
    expect(
      resolveCrossSessionInbound(
        () => null,
        () => true,
      ),
    ).toBeUndefined()
  })
})

describe('densable 2.1.224 #5 decidePeerInboundPolicy (Bqp)', () => {
  test('explicit hold/refuse/accept', () => {
    expect(
      decidePeerInboundPolicy({
        explicit: 'hold',
        selfMode: { mode: 'default' },
      }).policy,
    ).toBe('hold')
    expect(
      decidePeerInboundPolicy({
        explicit: 'refuse',
        selfMode: { mode: 'default' },
      }).policy,
    ).toBe('refuse')
  })

  test('selfSent always accept when unset', () => {
    expect(
      decidePeerInboundPolicy({
        selfMode: { mode: 'bypassPermissions' },
        origin: { selfSent: true },
      }),
    ).toEqual({ policy: 'accept', holdCause: 'bypass-default' })
  })

  test('bypass session + no fromMode → hold (no-mode-asserted)', () => {
    expect(
      decidePeerInboundPolicy({
        selfMode: { mode: 'bypassPermissions' },
      }),
    ).toEqual({ policy: 'hold', holdCause: 'no-mode-asserted' })
  })

  test('prompting session + no fromMode → accept', () => {
    expect(
      decidePeerInboundPolicy({
        selfMode: { mode: 'default' },
      }),
    ).toEqual({ policy: 'accept', holdCause: 'bypass-default' })
  })

  test('honorFromMode: class match accept, mismatch hold', () => {
    expect(
      decidePeerInboundPolicy({
        selfMode: { mode: 'default' },
        origin: { fromMode: 'prompting' },
        honorFromMode: true,
      }).policy,
    ).toBe('accept')
    expect(
      decidePeerInboundPolicy({
        selfMode: { mode: 'default' },
        origin: { fromMode: 'bypass' },
        honorFromMode: true,
      }),
    ).toEqual({ policy: 'hold', holdCause: 'mode-mismatch' })
  })

  test('mode null → hold mode-unknown', () => {
    expect(decidePeerInboundPolicy({ selfMode: null })).toEqual({
      policy: 'hold',
      holdCause: 'mode-unknown',
    })
  })

  test('plan + isBypassPermissionsModeAvailable → bypass class', () => {
    expect(
      permissionModeClassOf({
        mode: 'plan',
        isBypassPermissionsModeAvailable: true,
      }),
    ).toBe('bypass')
    expect(
      decideSessionInboundPolicy({
        selfMode: { mode: 'plan', isBypassPermissionsModeAvailable: true },
      }).policy,
    ).toBe('hold')
  })
})

describe('densable 2.1.224 #5 hold buffer', () => {
  test('hold parks; approve releases; deny drops', () => {
    const r = applyPeerInboundPolicy(
      { from: 'uds:/tmp/a.sock', value: 'hi' },
      { policy: 'hold', holdCause: 'mode-mismatch' },
    )
    expect(r).toBe('held')
    expect(getHeldPeerInboundMessages()).toHaveLength(1)
    const entry = getHeldPeerInboundMessages()[0]!
    expect(resolveHeldPeerInboundMessage(entry, 'approve')).toBe('delivered')
    expect(getHeldPeerInboundMessages()).toHaveLength(0)

    applyPeerInboundPolicy(
      { from: 'uds:/tmp/b.sock', value: 'no' },
      { policy: 'hold', holdCause: 'explicit-setting' },
    )
    const e2 = getHeldPeerInboundMessages()[0]!
    expect(resolveHeldPeerInboundMessage(e2, 'deny')).toBe('dropped')
    expect(getHeldPeerInboundMessages()).toHaveLength(0)
  })

  test('refuse does not buffer', () => {
    expect(
      applyPeerInboundPolicy(
        { value: 'x' },
        { policy: 'refuse', holdCause: 'explicit-setting' },
      ),
    ).toBe('refused')
    expect(getHeldPeerInboundMessages()).toHaveLength(0)
  })

  test('buffer cap 100 evicts oldest', () => {
    for (let i = 0; i < PEER_INBOUND_HOLD_BUFFER_MAX + 3; i++) {
      applyPeerInboundPolicy(
        { from: `uds:${i}`, value: String(i) },
        { policy: 'hold', holdCause: 'explicit-setting' },
      )
    }
    expect(getHeldPeerInboundMessages()).toHaveLength(
      PEER_INBOUND_HOLD_BUFFER_MAX,
    )
    const first = getHeldPeerInboundMessages()[0]!.message as { from: string }
    // first three evicted; remaining starts at index 3
    expect(first.from).toBe('uds:3')
  })
})

describe('densable 2.1.224 #5 dialogExpiry', () => {
  test('default enum maps; never → null; env override', () => {
    expect(dialogExpiryToMs('60s')).toBe(60_000)
    expect(dialogExpiryToMs('5m')).toBe(300_000)
    expect(dialogExpiryToMs('10m')).toBe(600_000)
    expect(dialogExpiryToMs('never')).toBe(null)
    process.env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS = '1234'
    expect(dialogExpiryToMs('never')).toBe(1234)
  })

  test('resolveDialogExpiryFromSources ignores project', () => {
    const get = sourceMap({
      projectSettings: { dialogExpiry: '10m' },
      userSettings: { dialogExpiry: '60s' },
    })
    expect(resolveDialogExpiryFromSources(get as never, () => true)).toBe('60s')
    const onlyProject = sourceMap({
      projectSettings: { dialogExpiry: '10m' },
    })
    expect(
      resolveDialogExpiryFromSources(onlyProject as never, () => true),
    ).toBeUndefined()
  })
})

describe('densable 2.1.224 #5 gate + release (PRn / vPr / xRn)', () => {
  // Force TPr() unset so local settings cannot loosen/tighten these gold paths.
  const unset = { explicit: undefined as undefined }

  test('gatePeerInboundQueuedCommand holds bypass + no fromMode', () => {
    setPeerInboundModeGetter(() => ({ mode: 'bypassPermissions' }))
    const r = gatePeerInboundQueuedCommand(
      {
        mode: 'prompt',
        value: 'hi',
        origin: { kind: 'peer', from: 'uds:/tmp/a.sock' },
      },
      unset,
    )
    expect(r).toBe('held')
    expect(getHeldPeerInboundMessages()).toHaveLength(1)
  })

  test('gate accepts prompting session without fromMode', () => {
    setPeerInboundModeGetter(() => ({ mode: 'default' }))
    const r = gatePeerInboundMessage(
      {
        mode: 'prompt',
        value: 'hi',
        origin: { kind: 'peer', from: 'uds:/tmp/a.sock' },
      },
      { ...unset, honorFromMode: false },
    )
    expect(r).toBe('accept')
    expect(getHeldPeerInboundMessages()).toHaveLength(0)
  })

  test('vPr mode-changed releases hold when mode becomes prompting', () => {
    const released: unknown[] = []
    setPeerInboundHoldListeners({
      onReleased: entries => {
        released.push(...entries.map(e => e.message))
      },
    })
    applyPeerInboundPolicy(
      {
        mode: 'prompt',
        value: 'held-msg',
        origin: { kind: 'peer', from: 'uds:/tmp/x' },
      },
      { policy: 'hold', holdCause: 'no-mode-asserted' },
    )
    expect(
      releaseHeldPeerInboundMessages('mode-changed', {
        explicit: undefined,
        selfMode: { mode: 'default' },
        honorFromMode: false,
      }),
    ).toBe(1)
    expect(getHeldPeerInboundMessages()).toHaveLength(0)
    expect(released).toHaveLength(1)
    expect((released[0] as { value: string }).value).toBe('held-msg')
  })

  test('vPr policy refuse drops held', () => {
    applyPeerInboundPolicy(
      { value: 'x', origin: { kind: 'peer', from: 'a' } },
      { policy: 'hold', holdCause: 'explicit-setting' },
    )
    expect(
      releaseHeldPeerInboundMessages('policy-accepts', {
        explicit: 'refuse',
        selfMode: { mode: 'default' },
      }),
    ).toBe(0)
    expect(getHeldPeerInboundMessages()).toHaveLength(0)
  })

  test('honorFromMode mismatch stays held', () => {
    setPeerInboundModeGetter(() => ({ mode: 'default' }))
    expect(
      gatePeerInboundMessage(
        {
          value: 'x',
          origin: { kind: 'peer', fromMode: 'bypass' },
        },
        { ...unset, honorFromMode: true },
      ),
    ).toBe('held')
    expect(
      releaseHeldPeerInboundMessages('mode-changed', {
        explicit: undefined,
        selfMode: { mode: 'default' },
        honorFromMode: true,
      }),
    ).toBe(0)
    expect(getHeldPeerInboundMessages()).toHaveLength(1)
  })

  test('hold-cause / release-reason gold copy (cxv / lxv)', () => {
    expect(peerInboundHoldCauseMessage('no-mode-asserted')).toContain(
      'did not attest',
    )
    expect(peerInboundHoldCauseMessage('mode-mismatch')).toContain(
      'permission mode class',
    )
    expect(peerInboundReleaseReasonMessage('policy-accepts')).toBe(
      'crossSessionInbound now accepts',
    )
    expect(peerInboundReleaseReasonMessage('mode-changed')).toBe(
      'permissions are prompting again',
    )
  })
})
