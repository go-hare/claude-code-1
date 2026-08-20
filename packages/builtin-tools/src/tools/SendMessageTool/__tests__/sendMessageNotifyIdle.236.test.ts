/**
 * densable 2.1.236 review C1 + I7 — notify_when_idle routing contracts.
 *
 * Source probes (same style as sendMessageBareName.232) — avoid process-global
 * feature()/udsClient mocks that poison sibling suites.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const toolPath = join(import.meta.dir, '../SendMessageTool.ts')
const toolSrc = readFileSync(toolPath, 'utf8')

describe('densable 2.1.236 C1/I7 SendMessage notify_when_idle', () => {
  test('C1: bare-name peer resolve requires non-empty text (no empty send)', () => {
    // densable: pure idle must not hit sendToUdsSocket('') via typeof==='string'
    expect(toolSrc).toContain(
      "typeof input.message === 'string' &&\n        input.message.trim().length > 0 &&\n        input.to !== '*' &&\n        input.to !== MAIN_RECIPIENT &&\n        parseAddress(input.to).scheme === 'other'",
    )
  })

  test('C1: bare-name pure idle resolve+subscribe branch exists', () => {
    expect(toolSrc).toContain('pureIdleSubscribe &&')
    expect(toolSrc).toContain("addr.scheme === 'other'")
    expect(toolSrc).toContain('C1 — bare-name pure notify')
    // Pure path uses maybeSubscribePeerIdle, not sendToUdsSocket with empty body
    const c1Idx = toolSrc.indexOf('C1 — bare-name pure notify')
    expect(c1Idx).toBeGreaterThan(0)
    const c1Block = toolSrc.slice(c1Idx, c1Idx + 3500)
    expect(c1Block).toContain('maybeSubscribePeerIdle')
    expect(c1Block).not.toContain('sendToUdsSocket')
  })

  test('I7: validateInput refuses bridge/tcp only for pure notify', () => {
    // biome may collapse the condition onto one line
    expect(toolSrc).toMatch(
      /pureNotify && \(addr\.scheme === 'bridge' \|\| addr\.scheme === 'tcp'\)/,
    )
    expect(toolSrc).toContain(
      'bridge/tcp hard-refuse only for pure notify; message+notify may deliver',
    )
  })

  test('I7: call appends THIS_MACHINE_ONLY after bridge/tcp delivery', () => {
    expect(toolSrc).toContain(
      'Nothing was subscribed either: ${idle.NOTIFY_WHEN_IDLE_THIS_MACHINE_ONLY}',
    )
    expect(toolSrc).toContain(
      'I7 — message+notify on bridge: deliver text, refuse subscribe',
    )
    expect(toolSrc).toContain(
      'I7 — message+notify on tcp: deliver text, refuse subscribe',
    )
  })
})
