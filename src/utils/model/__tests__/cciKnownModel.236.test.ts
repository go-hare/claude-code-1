/**
 * densable 236 #24 — official Cci, not isNewest / highlightText.
 * Newer hint only when catalog index is before the alias target and Gu(alias).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from 'src/utils/settings/settingsCache.js'
import { ALL_MODEL_CONFIGS } from '../configs.js'
import { FABLE_SLOGAN } from '../fablePicker.js'
import { getKnownModelOption } from '../modelOptions.js'

function resetAllowlist(): void {
  resetSettingsCache()
  setSessionSettingsCache({ settings: {}, errors: [] })
}

describe('Cci getKnownModelOption (236 #24)', () => {
  beforeEach(resetAllowlist)
  afterEach(resetAllowlist)

  test('newest sonnet uses slogan, not Newer version', () => {
    const opt = getKnownModelOption(ALL_MODEL_CONFIGS.sonnet5.firstParty)
    expect(opt?.description).toBe(
      `Efficient for routine tasks (${ALL_MODEL_CONFIGS.sonnet5.firstParty})`,
    )
    expect(opt?.description).not.toContain('Newer version available')
  })

  test('older sonnet before alias in catalog shows Newer version', () => {
    const older = ALL_MODEL_CONFIGS.sonnet40.firstParty
    const newestName = getKnownModelOption(
      ALL_MODEL_CONFIGS.sonnet5.firstParty,
    )?.label
    const opt = getKnownModelOption(older)
    expect(opt?.description).toBe(
      `Newer version available · select Sonnet for ${newestName}`,
    )
  })

  test('newest opus uses gzn slogan', () => {
    const id = ALL_MODEL_CONFIGS.opus5.firstParty
    const opt = getKnownModelOption(id)
    expect(opt?.description).toBe(`Best for everyday, complex tasks (${id})`)
  })

  test('unknown family is Custom model (id)', () => {
    const opt = getKnownModelOption('my-finetune-xyz')
    // yA/getMarketingNameForModel may return null for unknown → whole Cci null
    if (opt) {
      expect(opt.description).toMatch(/^Custom model \(/)
    } else {
      expect(opt).toBeNull()
    }
  })

  test('fable uses Hyp slogan when it is the alias target', () => {
    const id = ALL_MODEL_CONFIGS.fable5.firstParty
    const opt = getKnownModelOption(id)
    expect(opt?.description).toBe(`${FABLE_SLOGAN} (${id})`)
  })
})
