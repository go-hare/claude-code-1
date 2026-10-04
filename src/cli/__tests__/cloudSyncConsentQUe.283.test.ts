/**
 * densable 2.1.283 leftover QUe / Cgt HeadlessCloudDialogs wrap.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 * - `QUe` @202330206 kind cloud_sync_consent, result sync|device_tools|not_now
 * - `Cgt` @202331200 kind device_mcp_consent, result allow|deny|not_now
 * - `on` @202404312 asks when dialogs.kinds has QUe.kind; no dialogs → []
 */
import { describe, expect, test } from 'bun:test'
import {
  askHostDeviceMcpConsent,
  CLOUD_SYNC_CONSENT_DEFAULT,
  CLOUD_SYNC_CONSENT_KIND,
  CLOUD_SYNC_CONSENT_RESULTS,
  DEVICE_MCP_CONSENT_DEFAULT,
  DEVICE_MCP_CONSENT_KIND,
  DEVICE_MCP_CONSENT_RESULTS,
  deviceMcpConsentSnapshot,
  promptDirSyncConsent,
} from '../cloudSession.js'

describe('QUe/Cgt HeadlessCloudDialogs wrap', () => {
  test('QUe/Cgt schema constants 1:1', () => {
    expect(CLOUD_SYNC_CONSENT_KIND).toBe('cloud_sync_consent')
    expect([...CLOUD_SYNC_CONSENT_RESULTS]).toEqual([
      'sync',
      'device_tools',
      'not_now',
    ])
    expect(CLOUD_SYNC_CONSENT_DEFAULT).toBe('not_now')
    expect(DEVICE_MCP_CONSENT_KIND).toBe('device_mcp_consent')
    expect([...DEVICE_MCP_CONSENT_RESULTS]).toEqual([
      'allow',
      'deny',
      'not_now',
    ])
    expect(DEVICE_MCP_CONSENT_DEFAULT).toBe('not_now')
  })

  test('on() no dialogs host → unattended []', async () => {
    expect(await promptDirSyncConsent({})).toEqual([])
  })

  test('on() kinds empty + flagOn → [] without request', async () => {
    let requested = 0
    expect(
      await promptDirSyncConsent({
        dialogs: {
          kinds: new Set(),
          request: async () => {
            requested += 1
            return { answer: 'sync', answered: true }
          },
        },
        seams: { flagOn: async () => true },
      }),
    ).toEqual([])
    expect(requested).toBe(0)
  })

  test('on() kinds has cloud_sync_consent + flagOn → dialogs.request', async () => {
    let requested = 0
    expect(
      await promptDirSyncConsent({
        dialogs: {
          kinds: new Set([CLOUD_SYNC_CONSENT_KIND]),
          request: async (kind, payload) => {
            requested += 1
            expect(kind.kind).toBe(CLOUD_SYNC_CONSENT_KIND)
            expect(kind.result).toEqual(CLOUD_SYNC_CONSENT_RESULTS)
            expect(kind.default).toBe(CLOUD_SYNC_CONSENT_DEFAULT)
            expect(
              payload &&
                typeof payload === 'object' &&
                'folder' in payload &&
                typeof (payload as { folder: unknown }).folder === 'string',
            ).toBe(true)
            return { answer: 'not_now', answered: true }
          },
        },
        seams: { flagOn: async () => true },
      }),
    ).toEqual([])
    expect(requested).toBe(1)
  })

  test('on() kinds has kind but flagOff → skip request', async () => {
    let requested = 0
    expect(
      await promptDirSyncConsent({
        dialogs: {
          kinds: new Set([CLOUD_SYNC_CONSENT_KIND]),
          request: async () => {
            requested += 1
            return { answer: 'sync', answered: true }
          },
        },
        seams: { flagOn: async () => false },
      }),
    ).toEqual([])
    expect(requested).toBe(0)
  })

  test('Cgt askHostDeviceMcpConsent requests when kinds has device_mcp_consent', async () => {
    const snapshot = deviceMcpConsentSnapshot({
      machineName: 'box',
      offered: [['mcp', { scope: 'user', type: 'stdio' }]],
    })
    expect(await askHostDeviceMcpConsent({})).toBe('settled')
    let requested = 0
    expect(
      await askHostDeviceMcpConsent({
        snapshot,
        dialogs: {
          kinds: new Set([DEVICE_MCP_CONSENT_KIND]),
          request: async kind => {
            requested += 1
            expect(kind.kind).toBe(DEVICE_MCP_CONSENT_KIND)
            expect(kind.result).toEqual(DEVICE_MCP_CONSENT_RESULTS)
            expect(kind.default).toBe(DEVICE_MCP_CONSENT_DEFAULT)
            return { answer: 'not_now', answered: true }
          },
        },
        seams: {
          gateOn: async () => true,
          servingOn: () => true,
          egressDenied: () => false,
          readConsent: async () => 'unset',
          resolveConfigs: async () => ({
            mcp: { scope: 'user', type: 'stdio' },
          }),
        },
      }),
    ).toBe('settled')
    expect(requested).toBe(1)
  })
})
