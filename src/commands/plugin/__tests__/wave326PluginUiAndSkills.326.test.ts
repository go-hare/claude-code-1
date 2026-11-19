/**
 * Wave 326 Group 5B — /plugin TUI + SkillChangeDetector + Bundled Skills tests:
 * #126, #129, #153, #256, #260, #270–#273, #331, #344.
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clampMultilineError,
  computeListJumpIndex,
  computePluginListMaxVisible,
  truncateStatsColumn,
} from '../pluginListHelpers.js'
import {
  SECTION_DESKTOP_APP_NOTICE,
  isClaudeDesktopKeybindingsSession,
} from '../../../skills/bundled/keybindings.js'
import {
  buildSettingsSchemaFiles,
  formatAllSettingsIndex,
  generateSettingsSchemaObject,
} from '../../../skills/bundled/updateConfig.js'
import { DOCTOR_SKILL_PROMPT } from '../../../skills/bundled/doctorContent.js'
import { getWatchableParentDirs } from '../../../utils/skills/skillChangeDetector.js'

describe('2.1.326 #270–#273 & #331 & #126 — /plugin TUI helpers & confirm lists', () => {
  test('#270/#272: computePluginListMaxVisible fits short terminal windows', () => {
    expect(computePluginListMaxVisible(12, 10, 3, 5, 1)).toBe(1)
    expect(computePluginListMaxVisible(24, 10, 2, 8, 2)).toBe(7)
    expect(computePluginListMaxVisible(40, 10, 2, 8, 2)).toBe(8)
  })

  test('#270/#272: Home, End, PgUp, PgDn list jumps clamp cleanly', () => {
    expect(computeListJumpIndex('home', 7, 20, 5)).toBe(0)
    expect(computeListJumpIndex('end', 2, 20, 5)).toBe(19)
    expect(computeListJumpIndex('pageUp', 7, 20, 5)).toBe(2)
    expect(computeListJumpIndex('pageUp', 2, 20, 5)).toBe(0)
    expect(computeListJumpIndex('pageDown', 7, 20, 5)).toBe(12)
    expect(computeListJumpIndex('pageDown', 17, 20, 5)).toBe(19)
  })

  test('#271/#273: clampMultilineError truncates long errors and counts hidden lines', () => {
    const longErr = ['line1', 'line2', 'line3', 'line4', 'line5', 'line6'].join(
      '\n',
    )
    const clamped = clampMultilineError(longErr, 3, 80)
    expect(clamped.truncated).toBe(true)
    expect(clamped.hiddenLines).toBe(3)
    expect(clamped.preview.split('\n').length).toBe(3)
    expect(clamped.preview.endsWith('…')).toBe(true)
  })

  test('#273: truncateStatsColumn keeps long skill names bounded', () => {
    const longSkill =
      'very-long-organization-namespace:super-verbose-skill-name'
    const truncated = truncateStatsColumn(longSkill, 20)
    expect(truncated.length).toBe(20)
    expect(truncated.endsWith('…')).toBe(true)
    expect(truncateStatsColumn('short', 20)).toBe('short')
  })

  test('#331 & #126: /plugin confirmation views use PluginConfirmList and Installed clears search cleanly', async () => {
    const managePluginsSrc = await readFile(
      join(import.meta.dir, '../ManagePlugins.tsx'),
      'utf8',
    )
    const manageMarketplacesSrc = await readFile(
      join(import.meta.dir, '../ManageMarketplaces.tsx'),
      'utf8',
    )
    const pluginSettingsSrc = await readFile(
      join(import.meta.dir, '../PluginSettings.tsx'),
      'utf8',
    )
    expect(managePluginsSrc).toContain('PluginConfirmList')
    expect(managePluginsSrc).not.toContain("input === 'y'")
    expect(managePluginsSrc).toContain('pagination.resetScroll()')
    expect(manageMarketplacesSrc).toContain('PluginConfirmList')
    expect(manageMarketplacesSrc).not.toContain("input === 'y'")
    expect(pluginSettingsSrc).toContain('PluginConfirmList')
    expect(pluginSettingsSrc).toContain('formatPluginWarningForDisplay')
  })
})

describe('2.1.326 #129 — skillChangeDetector parent dir discovery', () => {
  test('watches nearest existing parent directory when .claude/skills does not exist yet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'g5b-skills-parent-'))
    try {
      const missingSkills = join(root, '.claude', 'skills')
      const missingCommands = join(root, '.claude', 'commands')
      const missingAgents = join(root, '.claude', 'agents')

      const before = await getWatchableParentDirs(
        [missingSkills, missingCommands, missingAgents],
        [],
      )
      expect(before.missingTargets).toEqual([
        missingSkills,
        missingCommands,
        missingAgents,
      ])
      expect(before.parentDirs).toEqual([root])

      // Once `.claude` exists, parent narrows to `.claude`
      const claudeDir = join(root, '.claude')
      await mkdir(claudeDir, { recursive: true })
      const after = await getWatchableParentDirs(
        [missingSkills, missingCommands, missingAgents],
        [],
      )
      expect(after.parentDirs).toEqual([claudeDir])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('2.1.326 #153, #256, #260, #344 — bundled skill resources & copy', () => {
  test('#153: keybindings-help warns that ~/.claude/keybindings.json is terminal-only in Desktop', () => {
    expect(SECTION_DESKTOP_APP_NOTICE).toContain(
      'The desktop app does not read `~/.claude/keybindings.json`',
    )
    expect(
      isClaudeDesktopKeybindingsSession({
        CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
      }),
    ).toBe(true)
    expect(
      isClaudeDesktopKeybindingsSession({
        CLAUDE_CODE_ENTRYPOINT: 'cli',
      }),
    ).toBe(false)
  })

  test('#256: update-config splits schema into schema/<key>.json and emits compact index', () => {
    const schema = generateSettingsSchemaObject()
    const files = buildSettingsSchemaFiles(schema)
    const keys = Object.keys(schema.properties ?? {})
    expect(keys.length).toBeGreaterThan(10)
    expect(files[`schema/${keys[0]}.json`]).toBeDefined()

    const compactIndex = formatAllSettingsIndex(schema)
    const fullSchema = JSON.stringify(schema, null, 2)
    expect(compactIndex).toContain('## All Settings')
    expect(compactIndex).toContain('Read `schema/<key>.json`')
    // Compact index must be drastically smaller than full schema
    expect(compactIndex.length).toBeLessThan(fullSchema.length / 4)
  })

  test('#260: doctor skill prompt instructs sharing findings as it works', () => {
    expect(DOCTOR_SKILL_PROMPT).toContain(
      'Be quick, and say what you find as you go.',
    )
    expect(DOCTOR_SKILL_PROMPT).toContain(
      'Run every check read-only first, saying what you find as you go, then present the full report.',
    )
  })

  test('#344: claude-api SKILL.md defaults agents to Managed Agents', async () => {
    const skillMd = await readFile(
      join(import.meta.dir, '../../../skills/bundled/claude-api/SKILL.md'),
      'utf8',
    )
    expect(skillMd).toContain('Agents default to Managed Agents.')
    expect(skillMd).toContain('Agent whose loop and compute the user hosts')
    expect(skillMd).toContain('| Any other agent | Agent | **Managed Agents**')
  })
})
