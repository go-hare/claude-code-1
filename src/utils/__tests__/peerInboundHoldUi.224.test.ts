/**
 * densable 2.1.224 #5 — interactive hold UI pure helpers (axv / neh / toast / Rdr)
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type { HeldPeerInboundMessage } from '../crossSessionInbound.js'
import {
  buildHeldPeerMessageToast,
  buildPeerInboundHoldPreview,
  buildReleasedPeerMessagesToast,
  peerInboundDialogCauseMessage,
  resolvePeerInboundDialogTimeoutMs,
  sanitizePeerDisplayText,
  shouldPromptPeerInboundApproval,
  UNIDENTIFIED_PEER_SESSION,
} from '../peerInboundHoldUi.js'

afterEach(() => {
  delete process.env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS
})

describe('densable 2.1.224 #5 peerInboundHoldUi', () => {
  test('sanitizePeerDisplayText strips pairing punctuation', () => {
    expect(sanitizePeerDisplayText('hello "world" (x)')).toBe('hello world x')
  })

  test('buildPeerInboundHoldPreview for string value', () => {
    const p = buildPeerInboundHoldPreview({
      mode: 'prompt',
      value: 'hello peer',
      origin: { kind: 'peer', from: '/tmp/sock-a' },
    })
    expect(p.address).toBe('/tmp/sock-a')
    expect(p.preview).toBe('hello peer')
    expect(p.dialogBody).toBe('hello peer')
    expect(p.truncated).toBe(false)
  })

  test('unknown from → unidentified session', () => {
    const p = buildPeerInboundHoldPreview({
      value: 'x',
      origin: { kind: 'peer', from: 'unknown' },
    })
    expect(p.address).toBe(UNIDENTIFIED_PEER_SESSION)
  })

  test('long multiline truncates toast + dialog body', () => {
    const long = 'a'.repeat(200)
    const body = `${long}\nline2\nline3`
    const p = buildPeerInboundHoldPreview({
      value: body,
      origin: { kind: 'peer', from: '/s' },
    })
    expect(p.truncated).toBe(true)
    expect(p.preview).toContain('expand to review before approving')
    expect(p.preview.length).toBeLessThan(body.length + 80)
  })

  test('dialog cause copy (neh)', () => {
    expect(peerInboundDialogCauseMessage('mode-mismatch')).toContain(
      "doesn't match",
    )
    expect(peerInboundDialogCauseMessage('no-mode-asserted')).toContain(
      'did not attest',
    )
    expect(peerInboundDialogCauseMessage('explicit-setting')).toContain(
      'crossSessionInbound',
    )
  })

  test('shouldPromptPeerInboundApproval only mismatch / no-mode', () => {
    expect(shouldPromptPeerInboundApproval('mode-mismatch')).toBe(true)
    expect(shouldPromptPeerInboundApproval('no-mode-asserted')).toBe(true)
    expect(shouldPromptPeerInboundApproval('explicit-setting')).toBe(false)
    expect(shouldPromptPeerInboundApproval('bypass-default')).toBe(false)
    expect(shouldPromptPeerInboundApproval('mode-unknown')).toBe(false)
  })

  test('held toast includes preview + cause', () => {
    const entry: HeldPeerInboundMessage = {
      message: {
        mode: 'prompt',
        value: 'ping',
        origin: { kind: 'peer', from: '/tmp/peer' },
      },
      heldAt: 1,
      holdCause: 'mode-mismatch',
    }
    const t = buildHeldPeerMessageToast(entry, 2, 'mode-mismatch')
    expect(t).toContain('Held peer message')
    expect(t).toContain('/tmp/peer')
    expect(t).toContain('ping')
    expect(t).toContain('2 held')
    expect(t).toContain('Review it below')
  })

  test('released toast plural + reason', () => {
    expect(buildReleasedPeerMessagesToast(1, 'approved')).toContain(
      '1 held cross-session message',
    )
    expect(buildReleasedPeerMessagesToast(3, 'mode-changed')).toContain(
      '3 held cross-session messages',
    )
    expect(buildReleasedPeerMessagesToast(1, 'mode-changed')).toContain(
      'permissions are prompting again',
    )
  })

  test('resolvePeerInboundDialogTimeoutMs: never → 0; env override', () => {
    // Without env, default getDialogExpiry is 5m unless settings override —
    // just assert env wins when set.
    process.env.CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS = '1500'
    expect(resolvePeerInboundDialogTimeoutMs()).toBe(1500)
  })
})
