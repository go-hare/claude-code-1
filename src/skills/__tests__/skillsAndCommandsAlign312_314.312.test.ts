import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { filterValidCommands } from '../../commands.js'
import { clearDynamicSkills } from '../loadSkillsDir.js'

describe('#1319 per-directory and paths skills after Bash cd deeper into git repo', () => {
  test('loadSkillsDir tracks deferredSkillDirs and exports discoverAndActivateSkillsForFilePath', () => {
    const src = readFileSync(join(__dirname, '..', 'loadSkillsDir.ts'), 'utf8')
    expect(src).toContain('deferredSkillDirs')
    expect(src).toContain('checkGitIgnoreInWorkTree')
    expect(src).toContain(
      'export async function discoverAndActivateSkillsForFilePath',
    )
    clearDynamicSkills()
  })
})

describe('#1321 invalid command name does not stop all commands from loading', () => {
  test('filterValidCommands skips commands with non-string name or display name', () => {
    const bad = {
      type: 'prompt',
      name: 123 as unknown as string,
      description: 'bad',
      userFacingName: () => 123 as unknown as string,
      getPromptForCommand: async () => [],
    }
    const good = {
      type: 'prompt',
      name: 'good-cmd',
      description: 'good',
      userFacingName: () => 'good-cmd',
      getPromptForCommand: async () => [],
    }
    const filtered = filterValidCommands([bad as never, good as never])
    expect(filtered.map(c => c.name)).toEqual(['good-cmd'])
  })

  test('filterValidCommands skips MCP commands exceeding 512 chars', () => {
    const longMcp = {
      type: 'prompt',
      name: 'a'.repeat(513),
      description: 'too long',
      isMcp: true,
      userFacingName: () => 'a'.repeat(513),
      getPromptForCommand: async () => [],
    }
    expect(filterValidCommands([longMcp as never])).toEqual([])
  })
})

describe('#1329 /verify uses short menuDescription while keeping full SKILL.md', () => {
  test('verify.ts sets menuDescription and verify/SKILL.md has full instructions', () => {
    const verifyTs = readFileSync(
      join(__dirname, '..', 'bundled', 'verify.ts'),
      'utf8',
    )
    const skillMd = readFileSync(
      join(__dirname, '..', 'bundled', 'verify', 'SKILL.md'),
      'utf8',
    )
    expect(verifyTs).toMatch(
      /menuDescription:\s*'Verify a code change does what it should by running the app'/,
    )
    expect(skillMd).toContain('name: verify')
    expect(skillMd).toContain('Verification is runtime observation.')
  })
})

describe('#1437 dataviz donut/pie requests -> ranked bars or segmented bar', () => {
  test('choosing-a-form.md and components.md specify ranked horizontal bars and segmented bar', () => {
    const choosing = readFileSync(
      join(
        __dirname,
        '..',
        'bundled',
        'datavizContent',
        'references',
        'choosing-a-form.md',
      ),
      'utf8',
    )
    const components = readFileSync(
      join(
        __dirname,
        '..',
        'bundled',
        'datavizContent',
        'references',
        'components.md',
      ),
      'utf8',
    )
    expect(choosing).toContain('**Ranked horizontal bars**')
    expect(choosing).toContain('**Tall segmented bar**')
    expect(choosing).toContain('**Thin segmented bar**')
    expect(components).toContain('**Segmented bar**')
  })
})
