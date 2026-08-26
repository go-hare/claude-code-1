/**
 * densable 2.1.236 #6 — ModelPicker `LFh`/`sgM`/`r7l` height formula.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  MODEL_PICKER_CHROME_RESERVE,
  MODEL_PICKER_MAX_VISIBLE,
  MODEL_PICKER_MIN_VISIBLE,
  computeModelPickerVisibleSlots,
  isModelPickerFastModeNoticeChrome,
} from '../modelPickerVisible.js'

const pickerSrc = readFileSync(
  join(import.meta.dir, '../../../components/ModelPicker.tsx'),
  'utf8',
)

describe('densable 2.1.236 #6 model-picker-height', () => {
  test('LFh is chrome reserve 14, sgM cap stays 10', () => {
    expect(MODEL_PICKER_CHROME_RESERVE).toBe(14)
    expect(MODEL_PICKER_MAX_VISIBLE).toBe(10)
    expect(MODEL_PICKER_MIN_VISIBLE).toBe(2)
  })

  test('sgM = max(2, min(10, floor((rows-LFh-ngM-ogM-igM)/2)))', () => {
    expect(
      computeModelPickerVisibleSlots({
        rows: 34,
        searchChrome: false,
        fastModeNotice: false,
        sessionModelBanner: false,
      }),
    ).toBe(10)
    expect(
      computeModelPickerVisibleSlots({
        rows: 24,
        searchChrome: false,
        fastModeNotice: false,
        sessionModelBanner: false,
      }),
    ).toBe(5)
    expect(
      computeModelPickerVisibleSlots({
        rows: 24,
        searchChrome: false,
        fastModeNotice: true,
        sessionModelBanner: true,
      }),
    ).toBe(2)
    expect(
      computeModelPickerVisibleSlots({
        rows: 8,
        searchChrome: false,
        fastModeNotice: false,
        sessionModelBanner: false,
      }),
    ).toBe(2)
    expect(
      computeModelPickerVisibleSlots({
        rows: 40,
        searchChrome: true,
        fastModeNotice: true,
        sessionModelBanner: true,
      }),
    ).toBe(Math.max(2, Math.min(10, Math.floor((40 - 14 - 4 - 3 - 2) / 2))))
  })

  test('r7l is Iu && (showNotice || (available && !cooldown))', () => {
    expect(isModelPickerFastModeNoticeChrome(false, true, true, false)).toBe(
      false,
    )
    expect(isModelPickerFastModeNoticeChrome(true, true, false, true)).toBe(
      true,
    )
    expect(isModelPickerFastModeNoticeChrome(true, false, true, false)).toBe(
      true,
    )
    expect(isModelPickerFastModeNoticeChrome(true, false, true, true)).toBe(
      false,
    )
    expect(isModelPickerFastModeNoticeChrome(true, false, false, false)).toBe(
      false,
    )
  })

  test('ModelPicker hosts sgM and does not invent XKl search', () => {
    expect(pickerSrc).toContain('computeModelPickerVisibleSlots')
    expect(pickerSrc).toContain('isModelPickerFastModeNoticeChrome')
    expect(pickerSrc).toContain('searchChrome: false')
    expect(pickerSrc).not.toContain('const maxVisible = 10')
  })
})
