import { describe, expect, test } from 'bun:test'
import { sortConfigCatalog } from '../configCatalog.js'

describe('densable U_c /config catalog order', () => {
  test('sorts known ids by official section map', () => {
    const sorted = sortConfigCatalog([
      { id: 'autoUpdatesChannel' },
      { id: 'theme' },
      { id: 'model' },
    ])
    expect(sorted.map(item => item.id)).toEqual([
      'theme',
      'model',
      'autoUpdatesChannel',
    ])
  })

  test('aliases local ids onto official catalog keys', () => {
    const sorted = sortConfigCatalog([
      { id: 'verbose' },
      { id: 'autoCompactEnabled' },
      { id: 'theme' },
    ])
    expect(sorted.map(item => item.id)).toEqual([
      'theme',
      'verbose',
      'autoCompactEnabled',
    ])
  })

  test('official bvr ids sort without needing aliases', () => {
    const sorted = sortConfigCatalog([
      { id: 'verbose' },
      { id: 'autoCompact' },
      { id: 'theme' },
    ])
    expect(sorted.map(item => item.id)).toEqual([
      'theme',
      'verbose',
      'autoCompact',
    ])
  })

  test('unknown ids keep input order after official rows', () => {
    const sorted = sortConfigCatalog([
      { id: 'localOnlyA' },
      { id: 'theme' },
      { id: 'localOnlyB' },
    ])
    expect(sorted.map(item => item.id)).toEqual([
      'theme',
      'localOnlyA',
      'localOnlyB',
    ])
  })
})
