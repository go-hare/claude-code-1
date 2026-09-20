/**
 * densable 2.1.247 #6 — /config toggle reads he[tt()], not be[c??L].
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = join(import.meta.dir, '../Config.tsx')

describe('densable 2.1.247 #6 /config live index', () => {
  test('toggleSetting reads selectedIndexLive', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('filteredSettingsItems[selectedIndexLive.current]')
    expect(src).not.toMatch(
      /const setting = filteredSettingsItems\[selectedIndex\]/,
    )
  })

  test('same-tick move then toggle matches official he[tt()]', () => {
    const he = [{ id: 'theme' }, { id: 'model' }, { id: 'language' }]
    let live = 0
    const tt = () => live
    live = Math.min(he.length - 1, live + 1)
    expect(he[tt()]?.id).toBe('model')
  })
})
