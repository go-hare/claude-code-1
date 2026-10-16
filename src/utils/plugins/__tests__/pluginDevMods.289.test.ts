/**
 * densable 2.1.289 J / go / wfr / Ho / bOn — plugin_dev_mods ask.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { DEV_MODS_PLACEHOLDER } from '../pluginDevMods.js'

const root = join(import.meta.dir, '../../../..')

describe('densable 2.1.289 plugin_dev_mods', () => {
  test('placeholder', () => {
    expect(DEV_MODS_PLACEHOLDER).toBe('${CLAUDE_DEV_MODS_DIR}')
  })

  test('source-lock J/go/WKe/bOn', () => {
    const mods = readFileSync(
      join(root, 'src/utils/plugins/pluginDevMods.ts'),
      'utf8',
    )
    expect(mods).toContain("ASK_SOURCE = 'mod_hot_reload'")
    expect(mods).toContain('source: ASK_SOURCE')
    expect(mods).toContain("header: 'Mods'")
    expect(mods).toContain('personOnly: true')
    expect(mods).toContain('Enable hot reloading for this session?')
    expect(mods).toContain('How does this work?')
    expect(mods).toContain('Enable for this session')
    expect(mods).toContain('restorePluginDevModsHost')
    expect(mods).toContain('replaceDevModsPlaceholder')

    const skill = readFileSync(
      join(root, 'src/skills/bundled/goldOfficialMissingSkills.ts'),
      'utf8',
    )
    expect(skill).toContain('restorePluginDevModsHost')
    expect(skill).toContain('replaceDevModsPlaceholder')

    const load = readFileSync(join(root, 'src/skills/loadSkillsDir.ts'), 'utf8')
    expect(load).toContain('replaceDevModsPlaceholder')
  })
})
