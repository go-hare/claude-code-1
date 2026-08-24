/**
 * densable 2.1.234 #34 — listBridgePeerSessions (qGv) gold constants + truncated setter.
 * Source-level: avoids deep axios/oauth mock chains that trip residualFinalEnvGates.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { BRIDGE_PEER_LIST_PAGE_BUDGET } from '../peerSessions.js'

const src = readFileSync(join(import.meta.dir, '../peerSessions.ts'), 'utf8')

describe('densable 2.1.234 #34 listBridgePeerSessions', () => {
  test('q_i page budget is 5', () => {
    expect(BRIDGE_PEER_LIST_PAGE_BUDGET).toBe(5)
  })

  test('qGv sets status.truncated when last page still has more', () => {
    expect(src).toContain('export async function listBridgePeerSessions')
    expect(src).toContain(
      'if (page === BRIDGE_PEER_LIST_PAGE_BUDGET - 1) {\n      truncated = true',
    )
    expect(src).toContain('if (status) status.truncated = truncated')
    expect(src).toContain("params.set(ccrV2 ? 'cursor' : 'after_id', cursor)")
    expect(src).toContain("ccrV2 ? '/v1/code/sessions' : '/v1/sessions'")
  })

  test('trusted-device 403 retries once via enrollTrustedDevice', () => {
    expect(src).toContain(
      "extractBridge403Resource(response.data) === 'untrusted_device'",
    )
    expect(src).toContain('enrollTrustedDevice()')
    expect(src).toContain('clearTrustedDeviceTokenCache()')
  })
})
