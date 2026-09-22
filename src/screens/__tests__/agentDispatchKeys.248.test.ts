/**
 * densable 2.1.248 #45 — agent view dispatch keys.
 *
 * Gold Fs @192220123 sha=3623b53aea0f1119: help footer shows
 * "ctrl+enter to start and open" when canDispatchAndOpen.
 * Gold Lc @192158881: Ne=d.ctrl on name==="return" → dispatch then
 * F({type:"open",…}). canDispatchAndOpen is cm==="local" && EHt()
 * (EHt leftover = supportsExtendedKeys).
 *
 * Shift+enter / ctrl+j newline is leftover. Do not steal Enter-on-list-row attach.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildFleetFooterHints,
  canFleetDispatchAndOpen,
  isFleetDispatchAndOpenKey,
  isFleetDispatchNewlineKey,
} from '../fleetView/helpers.js'

const ROOT = join(import.meta.dir, '..')

const footerBase = {
  focusArea: 'list' as const,
  viewMode: 'list' as const,
  deletePending: false,
  ungroupPending: false,
  canPin: false,
  canGroup: false,
  canRename: false,
  openSlots: 0,
  exitArmed: false,
  runningCount: 0,
}

describe('densable 2.1.248 #45 agent dispatch keys', () => {
  test('shift+enter and ctrl+j insert a newline', () => {
    expect(
      isFleetDispatchNewlineKey({ return: true, shift: true, ctrl: false }, ''),
    ).toBe(true)
    expect(
      isFleetDispatchNewlineKey(
        { return: false, shift: false, ctrl: true },
        'j',
      ),
    ).toBe(true)
  })

  test('plain enter and ctrl+enter are not newline', () => {
    expect(
      isFleetDispatchNewlineKey(
        { return: true, shift: false, ctrl: false },
        '',
      ),
    ).toBe(false)
    expect(
      isFleetDispatchNewlineKey({ return: true, shift: false, ctrl: true }, ''),
    ).toBe(false)
  })

  test('ctrl+enter without shift is dispatch-and-open', () => {
    expect(
      isFleetDispatchAndOpenKey({ return: true, ctrl: true, shift: false }),
    ).toBe(true)
  })

  test('shift+enter / plain enter / ctrl-only are not dispatch-and-open', () => {
    expect(
      isFleetDispatchAndOpenKey({ return: true, ctrl: false, shift: false }),
    ).toBe(false)
    expect(
      isFleetDispatchAndOpenKey({ return: true, ctrl: true, shift: true }),
    ).toBe(false)
    expect(
      isFleetDispatchAndOpenKey({ return: false, ctrl: true, shift: false }),
    ).toBe(false)
  })

  test('canDispatchAndOpen is local tab + extended keys (EHt leftover)', () => {
    expect(canFleetDispatchAndOpen('local', true)).toBe(true)
    expect(canFleetDispatchAndOpen('local', false)).toBe(false)
    expect(canFleetDispatchAndOpen('remote', true)).toBe(false)
  })

  test('gold Fs help footer copy when canDispatchAndOpen', () => {
    const withOpen = buildFleetFooterHints({
      ...footerBase,
      helpOpen: true,
      canDispatchAndOpen: true,
    })
    expect(withOpen).toContain('ctrl+j for newline')
    expect(withOpen).toContain('ctrl+enter to start and open')

    const withoutOpen = buildFleetFooterHints({
      ...footerBase,
      helpOpen: true,
      canDispatchAndOpen: false,
    })
    expect(withoutOpen).toContain('ctrl+j for newline')
    expect(withoutOpen).not.toContain('ctrl+enter to start and open')
  })

  test('dispatch-focus leftover footer is not invented', () => {
    expect(
      buildFleetFooterHints({
        ...footerBase,
        focusArea: 'dispatch',
        helpOpen: false,
        canDispatchAndOpen: true,
      }),
    ).toBe(
      'enter dispatch \u00b7 ! bash \u00b7 @ mention \u00b7 ctrl+j for newline \u00b7 \u2191 list \u00b7 esc clear',
    )
  })

  test('AgentView wires gold Lc ctrl+enter attach on dispatch only', () => {
    const src = readFileSync(join(ROOT, 'AgentView.tsx'), 'utf8')
    expect(src).toContain('isFleetDispatchNewlineKey(key, input)')
    expect(src).toContain('isFleetDispatchAndOpenKey(key)')
    expect(src).toContain(
      "canFleetDispatchAndOpen('local', supportsExtendedKeys())",
    )
    expect(src).toContain(
      'isFleetDispatchAndOpenKey(key) && canDispatchAndOpen',
    )
    expect(src).toContain("type: 'open'")
    expect(src).toContain('result.sessionId')
    expect(src).toContain('result.short')
    // List-row Enter attach stays in the non-dispatch branch.
    expect(src).toContain('} else if (key.return && flatRows.length > 0) {')
  })
})
