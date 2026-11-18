import { afterEach, describe, expect, test } from 'bun:test'
import {
  disableForkSubagent,
  resetSessionBackgroundGatesForTests,
} from 'src/utils/sessionBackgroundGates.js'
import {
  isForkSubagentEnabled,
  resetForkSubagentSessionSource,
  resolveForkSubagentSource,
} from 'src/utils/forkSubagentGate.js'
import {
  isForkSubagentProductEnabled,
  resetForkSubagentProductSource,
  resolveForkSubagentProductSource,
} from '../forkSubagent.js'

describe('Wave 3 #924 isForkSubagentDisabled()', () => {
  afterEach(() => {
    resetSessionBackgroundGatesForTests()
    resetForkSubagentProductSource()
    resetForkSubagentSessionSource()
  })

  test('resolveForkSubagentProductSource and resolveForkSubagentSource return disabled when isForkSubagentDisabled() is true', () => {
    expect(isForkSubagentProductEnabled()).toBe(true)
    expect(isForkSubagentEnabled({ env: {}, isAnt: false })).toBe(true)

    disableForkSubagent()

    expect(resolveForkSubagentProductSource()).toBe('disabled')
    expect(isForkSubagentProductEnabled()).toBe(false)
    expect(
      resolveForkSubagentSource({ env: { CLAUDE_CODE_FORK_SUBAGENT: '1' } }),
    ).toBe('disabled')
    expect(
      isForkSubagentEnabled({ env: { CLAUDE_CODE_FORK_SUBAGENT: '1' } }),
    ).toBe(false)
  })
})
