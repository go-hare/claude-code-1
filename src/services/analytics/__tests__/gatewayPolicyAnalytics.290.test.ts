import { afterEach, describe, expect, test } from 'bun:test'
import { getBootstrapSessionHost } from '../../../utils/sessionRoot.js'
import {
  isAnalyticsDisabled,
  isGatewayPolicyOrServerProcess,
  isNonFirstPartyAnalyticsOff,
} from '../config.js'

describe('v2.1.290 #110 — s6e/pOt gateway policy & server process analytics suppression', () => {
  const slots = getBootstrapSessionHost().credentialSlots
  const origServerProcess = slots.gatewayServerProcess()

  afterEach(() => {
    slots.replaceGatewayServerProcess(origServerProcess)
  })

  test('isGatewayPolicyOrServerProcess returns true when gatewayServerProcess() is true', () => {
    slots.replaceGatewayServerProcess(true)
    expect(isGatewayPolicyOrServerProcess({})).toBe(true)
    expect(isNonFirstPartyAnalyticsOff({})).toBe(true)
    expect(isAnalyticsDisabled()).toBe(true)
  })

  test('isGatewayPolicyOrServerProcess respects CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST', () => {
    slots.replaceGatewayServerProcess(true)
    expect(
      isGatewayPolicyOrServerProcess({
        CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
      }),
    ).toBe(false)
  })
})
