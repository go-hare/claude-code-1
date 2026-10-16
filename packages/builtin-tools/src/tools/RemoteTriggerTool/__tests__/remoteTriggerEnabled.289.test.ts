import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('densable 2.1.289 RemoteTrigger isEnabled sn(s7)', () => {
  test('isEnabled gates allow_remote_sessions and allow_routines', () => {
    const src = readFileSync(
      join(import.meta.dir, '../RemoteTriggerTool.ts'),
      'utf8',
    )
    expect(src).toContain("isPolicyLimitsAllowed('allow_remote_sessions')")
    expect(src).toContain("isPolicyLimitsAllowed('allow_routines')")
    expect(src).toContain("getAPIProvider() === 'firstParty'")
  })
})
