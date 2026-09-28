import { describe, expect, test } from 'bun:test'
import { SettingsSchema } from '../settings/types.js'

describe('densable 2.1.283 maxProseWidth', () => {
  test('schema is optional int min 40; below 40 becomes undefined', () => {
    const schema = SettingsSchema()
    expect(schema.shape.maxProseWidth).toBeDefined()
    expect(schema.safeParse({ maxProseWidth: 80 }).success).toBe(true)
    expect(schema.safeParse({ maxProseWidth: 40 }).success).toBe(true)
    const tooSmall = schema.safeParse({ maxProseWidth: 39 })
    expect(tooSmall.success).toBe(true)
    if (tooSmall.success) {
      expect(tooSmall.data.maxProseWidth).toBeUndefined()
    }
  })
})
