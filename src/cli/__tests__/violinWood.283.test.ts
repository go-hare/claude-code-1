/**
 * densable 2.1.283 `Wd` / `es` source-lock — tengu_violin_wood only.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(import.meta.dir, '../violinWood.ts'), 'utf8')

describe('violinWood 283 Wd / es', () => {
  test('source-locks gold GB twins, remote_desktop pegbox AND, catch→false', () => {
    expect(src).toContain(
      'getFeatureValue_CACHED_MAY_BE_STALE(VIOLIN_WOOD, false)',
    )
    expect(src).toContain('checkGate_CACHED_OR_BLOCKING(VIOLIN_WOOD)')
    expect(src).toContain("const VIOLIN_WOOD = 'tengu_violin_wood'")
    expect(src).toContain("const VIOLIN_PEGBOX = 'tengu_violin_pegbox'")
    expect(src).toContain(
      "process.env.CLAUDE_CODE_ENTRYPOINT === 'remote_desktop'",
    )
    expect(src).toContain('} catch {\n    return false\n  }')
    expect(src).not.toContain('tengu_violin_amati')
    expect(src).toContain('tengu_violin_strad')
    expect(src).toContain('isViolinStradEnabled')
    expect(src).toContain('isSettingsToCloudEnabled')
    expect(src).toContain('tengu_violin_chinrest')
    expect(src).toContain('isHostedServeDialogsEnabled')
    expect(src).toContain('tengu_violin_bassbar')
    expect(src).toContain('isViolinBassbarEnabledSync')
    expect(src).toContain(
      'getFeatureValue_CACHED_MAY_BE_STALE(VIOLIN_BASSBAR, true as boolean)',
    )
    expect(src).not.toContain('tengu_violin_tailpiece')
    expect(src).not.toContain('tengu_violin_speculative_classifier')
    expect(src).toContain('tengu_eventual_haven')
    expect(src).toContain('tengu_violin_bridgepin')
    expect(src).toContain('isEventualHavenEnabledSync')
    expect(src).toContain('isRepositoryTrustPollEnabled')
  })

  test('does not invent vVo/EVo SDK-host', () => {
    expect(src).not.toContain('vVo')
    expect(src).not.toContain('EVo')
  })
})
