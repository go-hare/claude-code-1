import { beforeEach, describe, expect, test } from 'bun:test'
import {
  clearAutoModeDenialsForTesting,
  computeAutoModeDenialInputKey,
  consumeApprovedAutoModeDenial,
  getAutoModeDenials,
  markAutoModeDenialApproved,
  recordAutoModeDenial,
} from '../autoModeDenials.js'

describe('2.1.307 autoModeDenials (#1087)', () => {
  beforeEach(() => {
    clearAutoModeDenialsForTesting()
  })

  test('#1087: computeAutoModeDenialInputKey strips description, timeout, and false sandbox/bg flags', () => {
    const k1 = computeAutoModeDenialInputKey('Bash', {
      command: 'rm -rf /tmp/foo',
      description: 'Remove temp dir',
      timeout: 5000,
      dangerouslyDisableSandbox: false,
      run_in_background: false,
    })
    const k2 = computeAutoModeDenialInputKey('Bash', {
      command: 'rm -rf /tmp/foo',
      description: 'Different description on retry',
    })
    expect(k1).toBe(k2)

    const k3 = computeAutoModeDenialInputKey('Bash', {
      command: 'rm -rf /tmp/foo',
      dangerouslyDisableSandbox: true,
    })
    expect(k3).not.toBe(k1)
  })

  test('#1087: markAutoModeDenialApproved and consumeApprovedAutoModeDenial allow retried command once', () => {
    const inputKey = computeAutoModeDenialInputKey('Bash', {
      command: 'git push --force',
    })
    recordAutoModeDenial({
      toolName: 'Bash',
      display: 'git push --force',
      command: 'git push --force',
      inputKey,
      reason: 'Force push blocked',
      timestamp: 1000,
    })
    expect(getAutoModeDenials()).toHaveLength(1)
    expect(consumeApprovedAutoModeDenial('Bash', inputKey)).toBeUndefined()

    markAutoModeDenialApproved({
      toolName: 'Bash',
      inputKey,
      timestamp: 1000,
    })
    const approved = consumeApprovedAutoModeDenial('Bash', inputKey)
    expect(approved?.command).toBe('git push --force')
    expect(approved?.approved).toBe(true)
    // Consumed: second retry does not auto-approve again
    expect(consumeApprovedAutoModeDenial('Bash', inputKey)).toBeUndefined()
  })
})
