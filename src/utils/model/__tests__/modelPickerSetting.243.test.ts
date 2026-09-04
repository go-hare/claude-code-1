import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'

describe('modelPicker setting 243', () => {
  test('settings schema and pP/gP helpers exist', () => {
    const types = readFileSync(
      join(import.meta.dir, '../../settings/types.ts'),
      'utf8',
    )
    expect(types).toContain('modelPicker:')
    expect(types).toContain('replaceBuiltInOptions')
    expect(types).toContain('Rows to show in the /model picker, in order.')

    const helper = readFileSync(
      join(import.meta.dir, '../modelPickerSetting.ts'),
      'utf8',
    )
    expect(helper).toContain("getSecuritySensitiveSetting('modelPicker')")
    expect(helper).toContain('getModelPickerLabel')

    const options = readFileSync(
      join(import.meta.dir, '../modelOptions.ts'),
      'utf8',
    )
    expect(options).toContain('applyCuratedModelPickerOptions')
    expect(options).toContain('replaceBuiltInOptions === true')
  })
})
