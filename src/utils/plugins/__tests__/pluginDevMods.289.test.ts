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
    expect(mods).toContain('export function isDevModsPersonTurn')
    expect(mods).toContain('Enable hot reloading for this session?')
    expect(mods).toContain('How does this work?')
    expect(mods).toContain('Enable for this session')
    expect(mods).toContain('restorePluginDevModsHost')
    expect(mods).toContain('replaceDevModsPlaceholder')
    expect(mods).toContain('const QUIET_MS = 2000')
    expect(mods).toContain(
      "Mod hot-reloading is on; this session's mods load when this turn ends.",
    )
    expect(mods).toContain("loaded from this session's mods folder")
    expect(mods).toContain('on hold: /reload-plugins applies it')
    expect(mods).toContain(
      "stage?.stage === 'enabled' && stage.folder === folder",
    )
    expect(mods).toContain('ctrl.askedAt = Number.NEGATIVE_INFINITY')
    expect(mods).toContain('setInlinePlugins(')
    expect(mods).toContain(
      "join(getClaudeConfigHomeDir(), 'dev-mods', getSessionId())",
    )
    expect(mods).not.toContain('Mods under ')

    const skill = readFileSync(
      join(root, 'src/skills/bundled/goldOfficialMissingSkills.ts'),
      'utf8',
    )
    expect(skill).toContain('restorePluginDevModsHost')
    expect(skill).toContain('replaceDevModsPlaceholder')

    const load = readFileSync(join(root, 'src/skills/loadSkillsDir.ts'), 'utf8')
    expect(load).toContain('replaceDevModsPlaceholder')

    const query = readFileSync(join(root, 'src/query.ts'), 'utf8')
    expect(query).toContain('params.toolUseContext.agentId === undefined')
    expect(query).toContain('isDevModsPersonTurn(params.messages)')
    expect(query).toContain('restorePluginDevModsHost()')
  })
})
