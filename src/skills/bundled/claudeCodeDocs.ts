/**
 * Official registerClaudeCodeSkill denser (2.1.207).
 *
 * Skill name: claude-code-docs
 * Gated by:
 *   - CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL (env force-off at registration)
 *   - GrowthBook tengu_birch_kettle (isEnabled)
 *
 * Builds a "Current Build" snapshot from the running CLI so answers
 * override stale training data about commands/flags/settings.
 */

import type { ToolUseContext } from '../../Tool.js'
import { logEvent } from '../../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isUsing3PServices } from '../../utils/auth.js'
import {
  getAllReleaseNotes,
  getStoredChangelog,
} from '../../utils/releaseNotes.js'
import { isClaudeCodeSkillDisabled } from '../../utils/residualMoreEnvGates.js'
import { gt } from '../../utils/semver.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { registerBundledSkill } from '../bundledSkills.js'
import {
  CLAUDE_CODE_SKILL_DESCRIPTION,
  CLAUDE_CODE_SKILL_NAME,
  SKILL_FILES,
  SKILL_PROMPT,
} from './claudeCodeDocsContent.js'

function isBuiltinOrBundledCommand(cmd: {
  type?: string
  source?: string
}): boolean {
  return (
    cmd.type !== 'prompt' ||
    cmd.source === 'builtin' ||
    cmd.source === 'bundled'
  )
}

function versionBase(version: string): string {
  const m = version.match(/^\d+\.\d+\.\d+/)
  return m?.[0] ?? version
}

function versionsAtOrBelow(versionA: string, current: string): boolean {
  try {
    return !gt(versionA, current)
  } catch {
    return true
  }
}

/**
 * Official GEb densable — live snapshot of this running build.
 */
export function buildClaudeCodeDocsBuildSnapshot(
  context: ToolUseContext,
  changelogContent: string,
): string {
  const sections: string[] = []
  const commands = context.options.commands.filter(c => !c.isHidden)
  const builtin = commands.filter(isBuiltinOrBundledCommand)
  if (builtin.length > 0) {
    const lines = builtin
      .map(m => {
        const aliases =
          m.aliases && m.aliases.length > 0
            ? ` (aliases: ${m.aliases.map(a => `/${a}`).join(', ')})`
            : ''
        return `- /${m.name}${aliases}: ${m.description}`
      })
      .sort()
    sections.push(
      `**Available commands (${builtin.length} in this build):**\n${lines.join('\n')}`,
    )
  }

  const customSkills = commands.filter(c => !isBuiltinOrBundledCommand(c))
  if (customSkills.length > 0) {
    const lines = customSkills.map(m => `- /${m.name}: ${m.description}`).sort()
    sections.push(`**Custom skills configured:**\n${lines.join('\n')}`)
  }

  const customAgents = context.options.agentDefinitions.activeAgents.filter(
    a => a.source !== 'built-in',
  )
  if (customAgents.length > 0) {
    const lines = customAgents
      .map(m => `- ${m.agentType}: ${m.whenToUse}`)
      .sort()
    sections.push(`**Custom agents configured:**\n${lines.join('\n')}`)
  }

  const mcpClients = context.options.mcpClients
  if (mcpClients && mcpClients.length > 0) {
    const lines = mcpClients.map(m => `- ${m.name}`).sort()
    sections.push(`**Configured MCP servers:**\n${lines.join('\n')}`)
  }

  try {
    const settings = getInitialSettings() as Record<string, unknown>
    const keys = Object.keys(settings).sort()
    if (keys.length > 0) {
      sections.push(
        `**Settings keys configured (values omitted):** ${keys.join(', ')}. To see values, the user can run \`claude config list\` or open \`~/.claude/settings.json\`.`,
      )
    }
  } catch {
    // settings optional
  }

  const currentVersion = versionBase(
    typeof MACRO !== 'undefined' && MACRO.VERSION ? MACRO.VERSION : '0.0.0',
  )
  const recent = getAllReleaseNotes(changelogContent)
    .filter(([ver]) => versionsAtOrBelow(ver, currentVersion))
    .slice(-10)
    .reverse()
  if (recent.length > 0) {
    const body = recent
      .map(
        ([ver, notes]) => `### ${ver}\n` + notes.map(n => `- ${n}`).join('\n'),
      )
      .join('\n\n')
    sections.push(
      `**Recent releases (you are running v${currentVersion}):**\n${body}`,
    )
  }

  if (isUsing3PServices()) {
    sections.push(
      "**Provider context:** This session is not using Anthropic's first-party API. WebSearch may be unavailable, `/feedback` is unavailable, and some features behave differently — check the docs page for the user's specific provider. Direct issues to https://github.com/anthropics/claude-code/issues.",
    )
  }

  return sections.join('\n\n')
}

function buildPrompt(
  skillPrompt: string,
  args: string,
  context: ToolUseContext,
  changelogContent: string,
): string {
  const parts: string[] = [skillPrompt]
  const snapshot = buildClaudeCodeDocsBuildSnapshot(context, changelogContent)
  if (snapshot) {
    parts.push(
      `---\n\n# Current Build\n\nGenerated from the running Claude Code binary at invocation time. This is ground truth — it overrides your training data and any documentation when they disagree about what exists in this build.\n\n${snapshot}`,
    )
  }
  if (args.trim()) {
    parts.push(`---\n\n## User Request\n\n${args}`)
  }
  return parts.join('\n\n')
}

/**
 * Official zEb / registerClaudeCodeSkill.
 * Caller must already have checked DISABLE_CLAUDE_CODE_SKILL.
 */
export function registerClaudeCodeSkill(): void {
  registerBundledSkill({
    name: CLAUDE_CODE_SKILL_NAME,
    description: CLAUDE_CODE_SKILL_DESCRIPTION,
    allowedTools: ['Read', 'Grep', 'Glob', 'WebFetch'],
    argumentHint: '[question]',
    userInvocable: true,
    files: SKILL_FILES,
    // Official: isEnabled(){return Qe("tengu_birch_kettle",!1)}
    isEnabled: () =>
      getFeatureValue_CACHED_MAY_BE_STALE<boolean>('tengu_birch_kettle', false),
    async getPromptForCommand(args, context) {
      logEvent('tengu_claude_code_skill_loaded', {
        has_args: args.trim().length > 0,
      })
      const changelog = await getStoredChangelog()
      const prompt = buildPrompt(SKILL_PROMPT, args, context, changelog)
      return [{ type: 'text', text: prompt }]
    },
  })
}

/**
 * Official init path: only register when env is not force-off.
 * `if(!ct(process.env.CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL)){registerClaudeCodeSkill()}`
 */
export function maybeRegisterClaudeCodeSkill(): void {
  if (isClaudeCodeSkillDisabled()) return
  registerClaudeCodeSkill()
}
