import assets from './claudeTestAssets.json' with { type: 'json' }

export type ClaudeTestSkillKey = 'run' | 'execute' | 'draft'

export const CLAUDE_TEST_INSTALLED_FILES: Readonly<Record<string, string>> =
  Object.freeze(assets.INSTALLED_FILES)

export const CLAUDE_TEST_SKILL_MD: Readonly<
  Record<ClaudeTestSkillKey, string>
> = Object.freeze(assets.SKILL_MD)

export async function loadClaudeTestAssets(): Promise<{
  INSTALLED_FILES: Readonly<Record<string, string>>
  SKILL_MD: Readonly<Record<ClaudeTestSkillKey, string>>
}> {
  return {
    INSTALLED_FILES: CLAUDE_TEST_INSTALLED_FILES,
    SKILL_MD: CLAUDE_TEST_SKILL_MD,
  }
}
