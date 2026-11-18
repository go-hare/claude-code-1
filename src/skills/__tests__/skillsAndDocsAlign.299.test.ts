import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import reloadSkills from '../../commands/reloadSkills.js'
import { parseSkillFrontmatterFields } from '../loadSkillsDir.js'
import { clearNamesNotShownForTests } from '../../utils/sanitization.js'
import { SkillTool } from '../../../packages/builtin-tools/src/tools/SkillTool/SkillTool.js'

describe('Skills / ReloadSkills / Bundled Docs alignment (#708, #709, #718, #814, #884)', () => {
  test('#708 SkillTool suggests listed skill name when anthropic-skills: prefix is wrongly added', async () => {
    const mockContext = {
      options: {
        commands: [
          {
            type: 'prompt',
            name: 'commit',
            description: 'Commit helper',
            loadedFrom: 'skills',
            source: 'userSettings',
            getPromptForCommand: async () => [],
            userFacingName: () => 'commit',
          },
        ],
        tools: [],
        mcpClients: [],
      },
      getAppState: () => ({ mcp: { commands: [] } }),
      agentId: undefined,
    } as never

    const res = await SkillTool.validateInput!(
      { skill: 'anthropic-skills:commit' },
      mockContext,
    )
    expect(res.result).toBe(false)
    if (!res.result) {
      expect(res.message).toBe(
        'Unknown skill: anthropic-skills:commit. Did you mean commit?',
      )
      expect(res.errorCode).toBe(2)
    }
  })

  test('#709 /reload-skills reports that the full skill list is re-sent to Claude', async () => {
    expect(reloadSkills.description).toContain('added or changed on disk')
    const mod = await reloadSkills.load()
    const result = await mod.call()
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toContain('full skill list')
      expect(result.value).toContain('compaction')
    }
  })

  test('#718 parseSkillFrontmatterFields ignores frontmatter.name with hidden/angle-bracket chars', () => {
    clearNamesNotShownForTests()
    const parsed = parseSkillFrontmatterFields(
      { name: 'bad<name>', description: 'desc' },
      'body',
      'good-dir',
    )
    expect(parsed.displayName).toBeUndefined()

    const valid = parseSkillFrontmatterFields(
      { name: 'good-display', description: 'desc' },
      'body',
      'good-dir',
    )
    expect(valid.displayName).toBe('good-display')
  })

  test('#814 claude-api SKILL.md instructs leaving Managed Agents sessions in place unless asked', () => {
    const skillMd = readFileSync(
      join(import.meta.dir, '..', 'bundled', 'claude-api', 'SKILL.md'),
      'utf8',
    )
    expect(skillMd).toContain(
      'Leave Managed Agents sessions in place unless the user explicitly asks to archive or delete them.',
    )
  })

  test('#884 artifact-design SKILL.md specifies fixed body::before band above sticky header', () => {
    const skillMd = readFileSync(
      join(import.meta.dir, '..', 'bundled', 'artifact-design', 'SKILL.md'),
      'utf8',
    )
    expect(skillMd).toContain('body::before')
    expect(skillMd).toContain('env(safe-area-inset-top, 0px)')
  })
})
