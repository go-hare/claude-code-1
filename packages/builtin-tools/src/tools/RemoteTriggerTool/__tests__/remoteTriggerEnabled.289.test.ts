import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('densable 2.1.289 RemoteTrigger isEnabled sn(s7)', () => {
  test('isEnabled gates allow_remote_sessions and allow_routines', () => {
    const src = readFileSync(
      join(import.meta.dir, '../RemoteTriggerTool.ts'),
      'utf8',
    )
    expect(src).toContain("isRemotePolicyAllowed('allow_remote_sessions')")
    expect(src).toContain("isPolicyLimitsAllowed('allow_routines')")
    expect(src).toContain("getAPIProvider() === 'firstParty'")
    expect(src).toContain("scopes.includes('user:inference')")
    expect(src).toContain('!process.env.CLAUDE_CODE_REMOTE')
    expect(src).not.toContain('isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)')
  })
})
