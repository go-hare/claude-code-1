/**
 * densable 2.1.246 — torn-pair Kn + auth-revive Yn/Jn.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const init = readFileSync(join(import.meta.dir, '../initReplBridge.ts'), 'utf8')
const hook = readFileSync(
  join(import.meta.dir, '../../hooks/useReplBridge.tsx'),
  'utf8',
)

describe('densable 2.1.246 torn-pair + revive', () => {
  test('Qe/JJe/xe: sessionFile basename vs live sid', () => {
    expect(init).toContain('getProject().sessionFile')
    expect(init).toContain('basename(sessionFile) === `${sessionId}.jsonl`')
    expect(init).toContain('tornEntryPair')
    expect(init).toContain('isTornEntryPair()')
  })

  test('Kn skips permanent taint when xe', () => {
    expect(init).toContain(
      'veto under a TORN entry pair (mid-/resume window): precautionary suppression only, no permanent taint write',
    )
    expect(init).toContain("'torn_entry_pair'")
    const tornIdx = init.indexOf('if (tornEntryPair)')
    const writeIdx = init.indexOf('writeHistorySuppression(', tornIdx)
    expect(tornIdx).toBeGreaterThan(-1)
    expect(writeIdx).toBeGreaterThan(tornIdx)
    const slice = init.slice(tornIdx, writeIdx)
    expect(slice).toContain('return')
    expect(init).toContain('if (!tornEntryPair)')
    expect(init).toContain('targetExists: true')
  })

  test('Jn(jn) revive identity recheck before policy', () => {
    expect(init).toContain('expectedAccount')
    expect(init).toContain('revive_identity_recheck_failed')
    expect(init).toContain(
      'revive identity re-check failed (store changed or unreadable since the watcher validated)',
    )
    const reviveIdx = init.indexOf('revive_identity_recheck_failed')
    const policyIdx = init.indexOf("getPolicyDenyKind('allow_remote_control')")
    expect(reviveIdx).toBeGreaterThan(-1)
    expect(policyIdx).toBeGreaterThan(reviveIdx)
  })

  test('hook consumes Yn/Dr and auth-revive watcher', () => {
    expect(hook).toContain('reviveLatchRef')
    expect(hook).toContain('reviveExpectedAccountRef')
    expect(hook).toContain(
      '(reviveInitiated && lastBridgeSessionIdRef.current !== undefined) ||',
    )
    expect(hook).toContain('expectedAccount: reviveInitiated ? expectedAccount')
    expect(hook).toContain(
      'reviveInitiated || (!outboundOnly && !replBridgeExplicit)',
    )
    expect(hook).toContain('tengu_bridge_repl_auth_revive')
    expect(hook).toContain(
      'Auth-revive watcher: fresh same-account credential — re-enabling Remote Control',
    )
    expect(hook).toContain(
      'Auth-revive watcher: credential belongs to a different account — disarming',
    )
    expect(hook).toContain('300_000')
    expect(hook).toContain("kind: kind ?? 'terminal'")
  })
})
