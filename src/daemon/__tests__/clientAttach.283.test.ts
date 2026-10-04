import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  attachSocketErrorMsg,
  createAttachCsiOnlyGate,
} from '../clientAttach.js'

const src = readFileSync(join(import.meta.dir, '../clientAttach.ts'), 'utf8')
const agentSrc = readFileSync(
  join(import.meta.dir, '../../screens/AgentView.tsx'),
  'utf8',
)

describe('attachSocketErrorMsg', () => {
  test('keeps message that already contains ENOENT', () => {
    expect(
      attachSocketErrorMsg({
        message: 'connect ENOENT /x/control.sock',
        code: 'ENOENT',
      }),
    ).toBe('connect ENOENT /x/control.sock')
  })

  test('appends ENOENT when code is set but message lacks it', () => {
    expect(attachSocketErrorMsg({ message: 'connect', code: 'ENOENT' })).toBe(
      'connect ENOENT',
    )
  })

  test("does not rewrite to 'socket missing'", () => {
    expect(
      attachSocketErrorMsg({
        message: 'connect ENOENT /x/control.sock',
        code: 'ENOENT',
      }),
    ).not.toContain('socket missing')
    expect(
      attachSocketErrorMsg({ message: 'connect', code: 'ENOENT' }),
    ).not.toContain('socket missing')
  })
})

describe('gold y8r / Wt CSI-only', () => {
  test('ESC[I and ESC[O are CSI-only', () => {
    const gate = createAttachCsiOnlyGate()
    expect(gate('\x1B[I')).toBe(true)
    expect(gate('\x1B[O')).toBe(true)
  })

  test('printable is not CSI-only', () => {
    const gate = createAttachCsiOnlyGate()
    expect(gate('a')).toBe(false)
    expect(gate('\x1B[Ia')).toBe(false)
  })

  test('incomplete ESC[ holds as CSI-only', () => {
    const gate = createAttachCsiOnlyGate()
    expect(gate('\x1B')).toBe(true)
    expect(gate('[I')).toBe(true)
  })
})

describe('gold e2e ack order + Se', () => {
  test('setRawMode(true) is after ack, before modeSeq write', () => {
    const ack = src.indexOf('ackReceived = true')
    const raw = src.indexOf('stdin.setRawMode(true)', ack)
    const write = src.indexOf("stdout.write('\\x1B[2J\\x1B[H' + modeSeq", raw)
    expect(ack).toBeGreaterThan(0)
    expect(raw).toBeGreaterThan(ack)
    expect(write).toBeGreaterThan(raw)
    expect(src.indexOf('stdin.setRawMode(true)', 0)).toBe(raw)
  })

  test('no connect-before-ack raw; no FOCUS_IN identifier', () => {
    const connect = src.indexOf('socket = connect(socketPath)')
    const firstRaw = src.indexOf('stdin.setRawMode(true)')
    expect(connect).toBeGreaterThan(0)
    expect(firstRaw).toBeGreaterThan(connect)
    expect(src).not.toContain('const FOCUS_IN')
    expect(src).toContain('gateStdinUntilFirstFrame')
    expect(src).toContain('|I|O|')
  })

  test('AgentView fleet attach gates stdin until first frame', () => {
    expect(agentSrc).toContain('gateStdinUntilFirstFrame: true')
    expect(agentSrc).toContain("getPlatform() === 'windows'")
    expect(agentSrc).toContain('handoffRawMode()')
  })
})
