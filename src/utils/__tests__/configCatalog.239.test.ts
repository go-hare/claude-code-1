import { describe, expect, test } from 'bun:test'
import {
  buildConfigDisplayEntries,
  configSectionForId,
  configSectionHeading,
  displayIndexForSetting,
  sortConfigCatalog,
} from '../configCatalog.js'

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

describe('densable 2.1.289 Gi / qi / us / Ki', () => {
  test('Display ranks timeFormat after turnDuration', () => {
    const sorted = sortConfigCatalog([
      { id: 'prStatus' },
      { id: 'timeFormat' },
      { id: 'turnDuration' },
      { id: 'tips' },
    ])
    expect(sorted.map(item => item.id)).toEqual([
      'tips',
      'turnDuration',
      'timeFormat',
      'prStatus',
    ])
  })

  test('Connections ranks remoteHomeSettings after remoteControl', () => {
    const sorted = sortConfigCatalog([
      { id: 'dialogExpiry' },
      { id: 'remoteHomeSettings' },
      { id: 'remoteControl' },
      { id: 'chrome' },
    ])
    expect(sorted.map(item => item.id)).toEqual([
      'chrome',
      'remoteControl',
      'remoteHomeSettings',
      'dialogExpiry',
    ])
  })

  test('dotted plugin ids rank in Plugins before Advanced', () => {
    const sorted = sortConfigCatalog([
      { id: 'autoUpdatesChannel' },
      { id: 'agents-md.instructionFiles' },
      { id: 'theme' },
      { id: 'feedbackDrafts' },
    ])
    expect(sorted.map(item => item.id)).toEqual([
      'theme',
      'agents-md.instructionFiles',
      'autoUpdatesChannel',
      'feedbackDrafts',
    ])
  })

  test('us / Ki: plugin dots → Plugins; Advanced official rows note settings.json', () => {
    expect(configSectionForId('theme')).toBe('Appearance')
    expect(configSectionForId('timeFormat')).toBe('Display')
    expect(configSectionForId('remoteHomeSettings')).toBe('Connections')
    expect(configSectionForId('agents-md.instructionFiles')).toBe('Plugins')
    expect(configSectionForId('feedbackDrafts')).toBe('Advanced')
    expect(configSectionHeading('theme')).toEqual({ name: 'Appearance' })
    expect(configSectionHeading('autoUpdatesChannel')).toEqual({
      name: 'Advanced',
      note: 'moving to settings.json',
    })
    expect(configSectionHeading('feedbackDrafts')).toEqual({ name: 'Advanced' })
  })

  test('maple display entries occupy maxVisible slots; DualInk-off skips headings', () => {
    const items = [{ id: 'theme' }, { id: 'language' }, { id: 'model' }]
    expect(buildConfigDisplayEntries(items, false).map(e => e.kind)).toEqual([
      'item',
      'item',
      'item',
    ])
    const maple = buildConfigDisplayEntries(items, true)
    expect(
      maple.map(e => (e.kind === 'heading' ? e.heading.name : e.item.id)),
    ).toEqual(['Appearance', 'theme', 'language', 'Model & output', 'model'])
    expect(displayIndexForSetting(maple, 2)).toBe(4)
  })
})
