import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import * as dom from '../dom.js'
import Ink from '../ink.js'
import { InputGate } from '../inputGate.js'
import type { ParsedKey } from '../parse-keypress.js'

function makeReturnKey(): ParsedKey {
  return {
    kind: 'key',
    name: 'return',
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    fn: false,
    sequence: '\r',
    raw: '\r',
  }
}

function makeCharKey(ch: string): ParsedKey {
  return {
    kind: 'key',
    name: ch,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    fn: false,
    sequence: ch,
    raw: ch,
  }
}

function makeFakeStream() {
  const ee = new EventEmitter() as unknown as NodeJS.WriteStream &
    NodeJS.ReadStream
  ;(ee as unknown as { isTTY: boolean }).isTTY = false
  ;(ee as unknown as { columns: number }).columns = 80
  ;(ee as unknown as { rows: number }).rows = 24
  ;(ee as unknown as { write: (s: string) => boolean }).write = () => true
  ;(ee as unknown as { setEncoding: () => void }).setEncoding = () => {}
  ;(ee as unknown as { ref: () => void }).ref = () => {}
  ;(ee as unknown as { unref: () => void }).unref = () => {}
  ;(ee as unknown as { read: () => null }).read = () => null
  return ee
}

describe('2.1.328 Ink InputGate (class Kh) & wantEveryKey opt-out', () => {
  test('drops consecutive Return bleed-through into newly painted menu/dialog and respects wantEveryKey', () => {
    const owners: unknown[] = []
    const gate = new InputGate(owner => owners.includes(owner))

    const root = dom.createNode('ink-root')
    const menu = dom.createNode('ink-box')
    const droppedEvents: Array<string | null | undefined> = []
    menu.firstFrame = { writtenAt: 1050 }
    menu.wait = {
      isMenu: true,
      owner: null,
      onChange: d => droppedEvents.push(d),
    }
    dom.appendChildNode(root, menu)

    // Return before menu mounts (t=1000)
    expect(gate.drops(root, 'return', 1000)).toBe(false)
    // Consecutive Return within 700ms after menu mounts (t=1100) is DROPPED
    expect(gate.drops(menu, 'return', 1100)).toBe(true)

    // After 700ms gap, a deliberate Return passes through
    expect(gate.drops(menu, 'return', 2500)).toBe(false)

    // With wantEveryKey registered for the owner, even immediate consecutive Return passes
    owners.push(null)
    expect(gate.drops(root, 'return', 3000)).toBe(false)
    expect(gate.drops(menu, 'return', 3050)).toBe(false)
  })

  test('Ink.dispatchKeyboardEvent consumes InputGate with rootNode.wantEveryKey opt-out', () => {
    let clock = 1000
    const stdout = makeFakeStream()
    const stdin = makeFakeStream()
    const stderr = makeFakeStream()
    const ink = new Ink({
      stdout,
      stdin,
      stderr,
      exitOnCtrlC: false,
      patchConsole: false,
      pressClock: () => clock,
      timesPresses: () => true,
    })

    const rootNode = (ink as unknown as { rootNode: dom.DOMElement }).rootNode
    const dialog = dom.createNode('ink-box', rootNode.yogaNode?.config)
    const receivedKeys: string[] = []
    dialog._eventHandlers = {
      onKeyDown: e => {
        receivedKeys.push(e.name || e.key)
      },
    }
    const droppedChanges: Array<string | null | undefined> = []
    dialog.wait = {
      isMenu: false,
      owner: 'dialog-1',
      onChange: d => droppedChanges.push(d),
    }
    dom.appendChildNode(rootNode, dialog)
    // Simulate first frame paint of the dialog at t=1000
    dialog.firstFrame = { writtenAt: 1000 }
    ink.focusManager.focus(dialog)

    // Early Return at t=1100 (< 1000 + 700) is dropped by InputGate
    ink.dispatchKeyboardEvent(makeReturnKey(), { pressedAt: 1100 })
    expect(receivedKeys).toEqual([])
    expect(droppedChanges).toEqual(['return'])

    // Opting into wantEveryKey for owner 'dialog-1' bypasses InputGate immediately
    rootNode.wantEveryKey = ['dialog-1']
    clock = 1150
    ink.dispatchKeyboardEvent(makeCharKey('a'), { pressedAt: 1150 })
    ink.dispatchKeyboardEvent(makeReturnKey(), { pressedAt: 1160 })
    expect(receivedKeys).toEqual(['a', 'return'])

    ink.unmount()
  })
})
