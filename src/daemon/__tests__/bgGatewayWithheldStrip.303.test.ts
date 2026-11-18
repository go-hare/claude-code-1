import { describe, expect, test } from 'bun:test'
import {
  BG_SESSION_INHERIT_STRIP_KEYS,
  applySpareSessionStrips,
  applyWorkerSessionStrips,
} from '../bgHostManagedEnv.js'

describe('#922 CLAUDE_BG_GATEWAY_WITHHELD daemon env strip', () => {
  test('BG_SESSION_INHERIT_STRIP_KEYS includes CLAUDE_BG_GATEWAY_WITHHELD', () => {
    expect(BG_SESSION_INHERIT_STRIP_KEYS).toContain(
      'CLAUDE_BG_GATEWAY_WITHHELD',
    )
  })

  test('applyWorkerSessionStrips drops inherited CLAUDE_BG_GATEWAY_WITHHELD unless set in dispatchEnv', () => {
    const inherited: Record<string, string | undefined> = {
      CLAUDE_BG_GATEWAY_WITHHELD: '/tmp/other-repo',
    }
    applyWorkerSessionStrips(inherited)
    expect(inherited.CLAUDE_BG_GATEWAY_WITHHELD).toBeUndefined()

    const dispatched: Record<string, string | undefined> = {
      CLAUDE_BG_GATEWAY_WITHHELD: '/tmp/caller-repo',
    }
    applyWorkerSessionStrips(dispatched, {
      CLAUDE_BG_GATEWAY_WITHHELD: '/tmp/caller-repo',
    })
    expect(dispatched.CLAUDE_BG_GATEWAY_WITHHELD).toBe('/tmp/caller-repo')
  })

  test('applySpareSessionStrips unconditionally deletes CLAUDE_BG_GATEWAY_WITHHELD', () => {
    const env: Record<string, string | undefined> = {
      CLAUDE_BG_GATEWAY_WITHHELD: '/tmp/other-repo',
    }
    applySpareSessionStrips(env)
    expect(env.CLAUDE_BG_GATEWAY_WITHHELD).toBeUndefined()
  })
})
