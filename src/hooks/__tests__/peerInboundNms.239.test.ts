/**
 * densable 2.1.239 rSh n(UOo) — hook hosts requestDialog, not local JSX queue.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const hook = readFileSync(
  join(import.meta.dir, '../usePeerInboundUdsDrain.ts'),
  'utf8',
)
const repl = readFileSync(
  join(import.meta.dir, '../../screens/REPL.tsx'),
  'utf8',
)

describe('usePeerInboundUdsDrain n(UOo)', () => {
  test('opens peerInboundApprovalSpec via requestDialog queueBehind', () => {
    expect(hook).toContain('peerInboundApprovalSpec')
    expect(hook).toContain('requestDialog')
    expect(hook).toContain('queueBehind: true')
    expect(hook).not.toContain('createPeerInboundApprovalQueue')
    expect(hook).not.toContain('createElement')
    expect(hook).not.toContain('PeerInboundApprovalDialog')
  })

  test('cancelled+expired → expire; cancelled → deny (gold ctn)', () => {
    expect(hook).toContain("hold.expired() ? 'expire' : 'deny'")
    expect(hook).toContain("k.behavior === 'cancelled'")
    expect(hook).toContain('resolveHeldPeerInboundMessage')
  })

  test('dropped∧approve toasts policy-off (not dead dropped∧approve)', () => {
    expect(hook).toContain("outcome === 'dropped' && k.behavior === 'approve'")
    expect(hook).toContain('cross-session messaging was turned off')
  })

  test('REPL wires requestDialog and does not mount peer JSX', () => {
    expect(repl).toContain('usePeerInboundUdsDrain({ requestDialog })')
    expect(repl).not.toContain('peerInboundApprovalDialog')
    expect(repl).not.toContain('isDialogSlotFree')
  })
})
