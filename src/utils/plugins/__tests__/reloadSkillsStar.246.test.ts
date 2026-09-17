/**
 * densable 2.1.246 #22 — /reload-plugins must count skills/<name>/SKILL.md.
 *
 * Official refreshActivePlugins:
 *   Promise.all([getPluginCommands(), getPluginSkills(), agents])
 *   return { command_count: f.length, skill_count: g.length }
 *
 * Official /reload-plugins display:
 *   r(o.command_count + o.skill_count, "skill")
 *
 * getPluginCommands does not load those SKILL.md files — that is
 * getPluginSkills (loadSkillsFromDirectory). A skills-only plugin must
 * not report 0 skills.
 *
 * Invent-ban: storageV5 / credentials / warnings merge /
 * enabled_count builtin filter / user-SHA skip.
 * 246 wires applyStagedInstalls (option + official false call sites) and
 * serverPluginId (attribution copy).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { plural } from '../../stringUtils.js'

const refreshSrc = readFileSync(join(import.meta.dir, '../refresh.ts'), 'utf8')
const reloadSrc = readFileSync(
  join(import.meta.dir, '../../../commands/reload-plugins/reload-plugins.ts'),
  'utf8',
)
const loaderSrc = readFileSync(
  join(import.meta.dir, '../loadPluginCommands.ts'),
  'utf8',
)

function n(count: number, noun: string): string {
  return `${count} ${plural(count, noun)}`
}

describe('/reload-plugins skills/*/SKILL.md (2.1.246 #22)', () => {
  test('refreshActivePlugins loads getPluginSkills in the same Promise.all as commands', () => {
    expect(refreshSrc).toContain('getPluginSkills')
    expect(refreshSrc).toMatch(
      /Promise\.all\(\[\s*getPluginCommands\(\),\s*getPluginSkills\(\),/,
    )
    expect(refreshSrc).toContain('skill_count: pluginSkills.length')
    expect(refreshSrc).toContain(
      '${pluginCommands.length} commands, ${pluginSkills.length} skills',
    )
  })

  test('AppState still stores pluginCommands only (skills stay on the skills loader)', () => {
    expect(refreshSrc).toContain('commands: pluginCommands')
    expect(refreshSrc).not.toMatch(/commands:\s*\[\s*\.\.\.pluginCommands/)
  })

  test('/reload-plugins display sums command_count + skill_count as skill', () => {
    expect(reloadSrc).toContain("n(r.command_count + r.skill_count, 'skill')")
  })

  test('getPluginSkills scans SKILL.md via loadSkillsFromDirectory', () => {
    expect(loaderSrc).toContain('export const getPluginSkills')
    expect(loaderSrc).toContain('loadSkillsFromDirectory')
    expect(loaderSrc).toContain("join(skillDirPath, 'SKILL.md')")
  })

  test('refreshActivePlugins and official callers wire applyStagedInstalls', () => {
    expect(refreshSrc).toContain('applyStagedInstalls ?? true')
    expect(refreshSrc).toContain(
      'if (applyStagedInstalls) clearInstalledPluginsCache()',
    )
    expect(refreshSrc).toContain(
      'if (applyStagedInstalls) clearPluginCacheExclusions()',
    )
    expect(reloadSrc).toContain('applyStagedInstalls: false')
    const replSrc = readFileSync(
      join(import.meta.dir, '../../../screens/REPL.tsx'),
      'utf8',
    )
    expect(replSrc).toContain('applyStagedInstalls: false')
    const printSrc = readFileSync(
      join(import.meta.dir, '../../../cli/print.ts'),
      'utf8',
    )
    expect(printSrc).toContain(
      'reloadPlugins: async () => {\n                      await refreshActivePlugins(setAppState, {\n                        applyStagedInstalls: false,',
    )
    expect(printSrc).toContain(
      'const r = await refreshActivePlugins(setAppState, {\n                applyStagedInstalls: false,',
    )
  })

  test('getPluginCommands copies serverPluginId onto prompt pluginInfo', () => {
    expect(loaderSrc).toContain(
      'u.pluginInfo.serverPluginId = plugin.serverPluginId',
    )
    expect(loaderSrc).toContain(
      'g.pluginInfo.serverPluginId = plugin.serverPluginId',
    )
  })

  test('skills-only plugin is not reported as 0 skills', () => {
    expect(n(0 + 2, 'skill')).toBe('2 skills')
    expect(n(3 + 1, 'skill')).toBe('4 skills')
    expect(n(0 + 0, 'skill')).toBe('0 skills')
    expect(n(1 + 0, 'skill')).toBe('1 skill')
  })
})
