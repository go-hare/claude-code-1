/**
 * Official claude-code-docs skill content (ported from 2.1.207).
 * Each .md is inlined at build time via Bun's text loader.
 */

import skillPrompt from './claudeCodeDocsContent/SKILL.md'
import claudeTag from './claudeCodeDocsContent/claude-tag.md'
import liveSources from './claudeCodeDocsContent/live-sources.md'
import recentChanges from './claudeCodeDocsContent/recent-changes.md'

export const CLAUDE_CODE_SKILL_NAME = 'claude-code-docs'

/** Official qif — base description + TRIGGER/SKIP guidance. */
export const CLAUDE_CODE_SKILL_DESCRIPTION =
  'Answer questions about Claude Code itself: commands, flags, settings, hooks, skills, MCP servers, subagents, IDE integrations, sandboxing, deployment, and Claude Tag (Claude in Slack). Verifies against the running build before recommending any command, flag, or setting.\n' +
  'TRIGGER when: user asks how Claude Code works ("Can Claude…", "Does Claude…", "How do I…", "Is there a way to…"); user asks about a slash command, CLI flag, settings key, hook, skill, MCP server, subagent, keybinding, or .claude/ directory; user wants to configure, customize, or troubleshoot Claude Code; user asks about Claude in Slack or Claude Tag ("what is Claude Tag", "can Claude live in Slack", "@Claude in Slack", "/install-slack-app", "set up Claude for my Slack workspace"); YOU are about to recommend a Claude Code slash command, flag, or setting and have not verified it exists in this build.\n' +
  "SKIP: questions about building applications with the Claude API or Anthropic SDK (use /claude-api), general programming questions, questions about the user's own codebase."

export const SKILL_PROMPT: string = skillPrompt

export const SKILL_FILES: Record<string, string> = {
  'references/claude-tag.md': claudeTag,
  'references/live-sources.md': liveSources,
  'references/recent-changes.md': recentChanges,
}
