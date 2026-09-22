/**
 * densable 2.1.248 #37 — invalid crossSessionInbound → user warning + HOLD.
 * N() @196196105 sha=8852096933c85ace
 * w() if(p[e??"accept"]<p.hold&&N())e="hold",o="invalidSetting"
 * sne @202504085 / Qje @202716145
 * Invent-ban: no managed refuse-from-invalid.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyPeerInboundPolicy,
  clearPeerInboundHoldBuffer,
  decidePeerInboundPolicy,
  getHeldPeerInboundMessages,
  peerInboundHoldCauseMessage,
} from '../crossSessionInbound.js'
import {
  peerInboundDialogCauseMessage,
  shouldPromptPeerInboundApproval,
} from '../peerInboundHoldUi.js'
import {
  CROSS_SESSION_INBOUND_SETTING_PATH,
  hasInvalidCrossSessionInboundWarning,
  parseSettingsFile,
  resolveCrossSessionInbound,
  resolveCrossSessionInboundDecision,
} from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'

const settingsSrc = readFileSync(
  join(import.meta.dir, '../settings/settings.ts'),
  'utf8',
)

const GOLD_N =
  'function N(){return k_().errors.some((e)=>e.path===Zjt&&e.severity==="warning"&&!e.statusOnly)}'

const GOLD_QJE =
  'A settings file has an unrecognized "crossSessionInbound" value ' +
  '(the settings warning names the file); messages are held while it ' +
  'is present — set it to "accept", "hold", or "refuse".'

const GOLD_SNE =
  'A settings file has an unrecognized "crossSessionInbound" value ' +
  '(see the settings warning), so messages are held while it is present.'

afterEach(() => {
  clearPeerInboundHoldBuffer()
})

function sourceMap(
  map: Partial<Record<string, SettingsJson | null>>,
): (s: string) => SettingsJson | null {
  return s => map[s] ?? null
}

describe('densable 2.1.248 #37 N() / invalidSetting hold', () => {
  test('gold N() excerpt is pinned in settings.ts', () => {
    expect(settingsSrc).toContain(GOLD_N)
    expect(settingsSrc).toContain(
      'if(p[e??"accept"]<p.hold&&N())e="hold",o="invalidSetting"',
    )
  })

  test('Zjt path is crossSessionInbound', () => {
    expect(CROSS_SESSION_INBOUND_SETTING_PATH).toBe('crossSessionInbound')
  })

  test('N() true only for warning on Zjt without statusOnly', () => {
    expect(
      hasInvalidCrossSessionInboundWarning([
        {
          path: 'crossSessionInbound',
          message: 'x',
          severity: 'warning',
        },
      ]),
    ).toBe(true)
    expect(
      hasInvalidCrossSessionInboundWarning([
        {
          path: 'crossSessionInbound',
          message: 'x',
          severity: 'warning',
          statusOnly: true,
        },
      ]),
    ).toBe(false)
    expect(
      hasInvalidCrossSessionInboundWarning([
        {
          path: 'crossSessionInbound',
          message: 'x',
          severity: 'fatal',
        },
      ]),
    ).toBe(false)
    expect(
      hasInvalidCrossSessionInboundWarning([
        {
          path: 'theme',
          message: 'x',
          severity: 'warning',
        },
      ]),
    ).toBe(false)
  })

  test('unset or accept + N() → hold / invalidSetting (not refuse)', () => {
    const get = sourceMap({})
    expect(
      resolveCrossSessionInboundDecision(
        get,
        () => true,
        () => true,
      ),
    ).toEqual({ value: 'hold', decidedBy: 'invalidSetting' })
    expect(
      resolveCrossSessionInbound(
        sourceMap({ userSettings: { crossSessionInbound: 'accept' } }),
        () => true,
        () => true,
      ),
    ).toBe('hold')
  })

  test('already hold or refuse is not rewritten by N()', () => {
    expect(
      resolveCrossSessionInbound(
        sourceMap({ userSettings: { crossSessionInbound: 'hold' } }),
        () => true,
        () => true,
      ),
    ).toBe('hold')
    expect(
      resolveCrossSessionInbound(
        sourceMap({ userSettings: { crossSessionInbound: 'refuse' } }),
        () => true,
        () => true,
      ),
    ).toBe('refuse')
    expect(
      resolveCrossSessionInboundDecision(
        sourceMap({ userSettings: { crossSessionInbound: 'refuse' } }),
        () => true,
        () => true,
      ).decidedBy,
    ).toBeUndefined()
  })

  test('N() false leaves unset as undefined (no invented policy)', () => {
    expect(
      resolveCrossSessionInbound(
        () => null,
        () => true,
        () => false,
      ),
    ).toBeUndefined()
  })

  test('parseSettingsFile warns, strips invalid, keeps the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xsession-248-invalid-'))
    const file = join(dir, 'settings.json')
    try {
      writeFileSync(
        file,
        JSON.stringify({
          crossSessionInbound: 'bogus',
          spinnerTipsEnabled: false,
        }),
      )
      const parsed = parseSettingsFile(file)
      expect(parsed.settings?.crossSessionInbound).toBeUndefined()
      expect(parsed.settings?.spinnerTipsEnabled).toBe(false)
      expect(parsed.errors).toHaveLength(1)
      const err = parsed.errors[0]!
      expect(err.path).toBe('crossSessionInbound')
      expect(err.severity).toBe('warning')
      expect(err.expected).toBe('"accept", "hold", "refuse"')
      expect(err.message).toContain(
        'must be one of "accept", "hold", "refuse"; received "bogus"',
      )
      expect(err.message).toContain(
        'This value was ignored; while it is present, ' +
          'cross-session messages are held',
      )
      expect(err.message).not.toContain('treated as "refuse"')
      expect(err.message).not.toContain('administrator')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('valid enum parse does not emit the Zjt warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xsession-248-valid-'))
    const file = join(dir, 'settings.json')
    try {
      writeFileSync(file, JSON.stringify({ crossSessionInbound: 'accept' }))
      const parsed = parseSettingsFile(file)
      expect(parsed.settings?.crossSessionInbound).toBe('accept')
      expect(parsed.errors.some(e => e.path === 'crossSessionInbound')).toBe(
        false,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('densable 2.1.248 #37 sne / Qje / holdCause', () => {
  test('Qje hold-cause copy (invalid-setting)', () => {
    expect(peerInboundHoldCauseMessage('invalid-setting')).toBe(GOLD_QJE)
  })

  test('sne dialog-cause copy (invalid-setting)', () => {
    expect(peerInboundDialogCauseMessage('invalid-setting')).toBe(GOLD_SNE)
  })

  test('decidedBy invalidSetting → holdCause invalid-setting', () => {
    expect(
      decidePeerInboundPolicy({
        explicit: 'hold',
        decidedBy: 'invalidSetting',
        selfMode: { mode: 'default' },
      }),
    ).toEqual({ policy: 'hold', holdCause: 'invalid-setting' })
    expect(
      applyPeerInboundPolicy(
        { value: 'hi' },
        { policy: 'hold', holdCause: 'invalid-setting' },
      ),
    ).toBe('held')
    expect(getHeldPeerInboundMessages()[0]?.holdCause).toBe('invalid-setting')
  })

  test('invalid-setting does not open the approval dialog', () => {
    expect(shouldPromptPeerInboundApproval('invalid-setting')).toBe(false)
  })
})
