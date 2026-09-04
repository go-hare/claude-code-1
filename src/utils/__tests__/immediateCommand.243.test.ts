import { afterEach, describe, expect, test } from 'bun:test'

import { shouldInferenceConfigCommandBeImmediate } from '../immediateCommand.js'

const PREV_USER = process.env.USER_TYPE
const PREV_TELEMETRY = process.env.DISABLE_TELEMETRY

afterEach(() => {
  if (PREV_USER === undefined) delete process.env.USER_TYPE
  else process.env.USER_TYPE = PREV_USER
  if (PREV_TELEMETRY === undefined) delete process.env.DISABLE_TELEMETRY
  else process.env.DISABLE_TELEMETRY = PREV_TELEMETRY
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
})

describe('immediateCommand 243 #54', () => {
  test('DISABLE_TELEMETRY makes /model /fast /effort immediate', () => {
    process.env.USER_TYPE = 'external'
    process.env.DISABLE_TELEMETRY = '1'
    expect(shouldInferenceConfigCommandBeImmediate()).toBe(true)
  })
})
