import { describe, expect, test } from 'bun:test'
import { shouldTagIsMetaMessages, withTagIsMeta } from '../tagIsMetaMessages.js'

describe('shouldTagIsMetaMessages', () => {
  test('default off', () => {
    expect(shouldTagIsMetaMessages({})).toBe(false)
  })
  test('env on', () => {
    expect(
      shouldTagIsMetaMessages({ CLAUDE_CODE_TAG_ISMETA_MESSAGES: '1' }),
    ).toBe(true)
  })
})

describe('withTagIsMeta', () => {
  test('forces true when gate on', () => {
    expect(withTagIsMeta(false, { CLAUDE_CODE_TAG_ISMETA_MESSAGES: '1' })).toBe(
      true,
    )
  })
  test('passthrough when gate off', () => {
    expect(withTagIsMeta(undefined, {})).toBeUndefined()
    expect(withTagIsMeta(false, {})).toBe(false)
  })
})
