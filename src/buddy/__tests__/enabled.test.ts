import { afterEach, describe, expect, test } from 'bun:test'
import { isBuddyEnabled } from '../enabled.js'

const ORIGINAL_ENV = {
  CLAUDE_CODE_ENABLE_BUDDY: process.env.CLAUDE_CODE_ENABLE_BUDDY,
  USER_TYPE: process.env.USER_TYPE,
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

afterEach(restoreEnv)

describe('isBuddyEnabled', () => {
  test('allows explicit env disable to win', () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_ENABLE_BUDDY = '0'

    expect(isBuddyEnabled()).toBe(false)
  })

  test('keeps buddy available by default for external builds', () => {
    process.env.USER_TYPE = 'external'
    delete process.env.CLAUDE_CODE_ENABLE_BUDDY

    expect(isBuddyEnabled()).toBe(true)
  })
})
