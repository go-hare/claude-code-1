import { describe, expect, test } from 'bun:test'
import { maybeInsertFablePickerRow } from '../fablePicker.js'

describe('v2.1.295 #374 fablePicker gateway support', () => {
  test('does not skip gateway provider when inserting fable picker row', () => {
    const options = [
      { value: null, label: 'Default', description: 'Default' },
      { value: 'sonnet', label: 'Sonnet', description: 'Sonnet' },
    ]
    maybeInsertFablePickerRow(options, {
      isSubscriber: false,
      provider: 'gateway',
      insertDeps: {
        unrestrictedList: true,
        isAllowed: () => true,
      },
    })
    expect(options.some(o => o.value === 'fable')).toBe(true)
  })
})
