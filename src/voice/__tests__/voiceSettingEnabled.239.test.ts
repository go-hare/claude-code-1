/**
 * densable 2.1.239 #31 Ldo — voice.enabled ?? voiceEnabled.
 */
import { describe, expect, test } from 'bun:test'
import { isVoiceSettingEnabled } from '../voiceModeEnabled.js'

describe('isVoiceSettingEnabled densable 2.1.239 Ldo', () => {
  test('nested voice.enabled wins over flat voiceEnabled', () => {
    expect(
      isVoiceSettingEnabled({ voice: { enabled: true }, voiceEnabled: false }),
    ).toBe(true)
    expect(
      isVoiceSettingEnabled({ voice: { enabled: false }, voiceEnabled: true }),
    ).toBe(false)
  })

  test('falls back to legacy flat voiceEnabled', () => {
    expect(isVoiceSettingEnabled({ voiceEnabled: true })).toBe(true)
    expect(isVoiceSettingEnabled({ voiceEnabled: false })).toBe(false)
    expect(isVoiceSettingEnabled({})).toBe(false)
  })
})
