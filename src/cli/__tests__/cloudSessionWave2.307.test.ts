import { describe, expect, test } from 'bun:test'
import {
  checkSdkMcpManifestsOrigin,
  parseSdkMcpServerManifests,
  readAutoCompactWindowSurface,
  type HeadlessCloudSessionHost,
} from '../cloudSession.js'

describe('#1081 sdkMcpServerManifests parsing and origin checks', () => {
  test('parseSdkMcpServerManifests validates object map and per-server entries', () => {
    expect(
      parseSdkMcpServerManifests('not-an-obj', ['srv']).malformedField,
    ).toBe(true)

    const parsed = parseSdkMcpServerManifests(
      {
        srv1: { initializeResult: { protocolVersion: '2025-03-26' } },
        srv2: { bad: true },
        ignored: { initializeResult: { protocolVersion: '2025-03-26' } },
      },
      ['srv1', 'srv2'],
    )
    expect(parsed.malformedField).toBe(false)
    expect(parsed.malformedServerNames).toEqual(['srv2'])
    expect(parsed.manifests.has('srv1')).toBe(true)
    expect(parsed.manifests.has('ignored')).toBe(false)
  })

  test('checkSdkMcpManifestsOrigin enforces host_per_send and 5-minute frame age', () => {
    expect(checkSdkMcpManifestsOrigin({ origin: undefined })).toBe(
      'no_origin_marker',
    )
    expect(
      checkSdkMcpManifestsOrigin({
        origin: 'host_per_send',
        frameCreatedAt: 1000,
        now: 302_000,
      }),
    ).toBe('frame_too_old')
    expect(
      checkSdkMcpManifestsOrigin({
        origin: 'host_per_send',
        frameCreatedAt: 100_000,
        now: 200_000,
      }),
    ).toBeUndefined()
  })
})

describe('#1083 readAutoCompactWindowSurface', () => {
  test('reads autoCompactWindowSurface from HeadlessCloudSessionHost', () => {
    const host: HeadlessCloudSessionHost = {
      launchOptions: {
        mayForwardHomeSettings: () => false,
        homeSettingsHostConsent: () => null,
        autoCompactWindowSurface: () => 'claude-desktop',
      },
      extensionsConfig: {
        allowedChannels: () => [],
      },
    }
    expect(readAutoCompactWindowSurface(host)).toBe('claude-desktop')
    expect(readAutoCompactWindowSurface(undefined)).toBeUndefined()
  })
})
