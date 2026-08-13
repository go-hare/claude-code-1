/**
 * densable 2.1.229 #14 — GitHub Code Review workflow posts reviews.
 * densable tKm gold: prompt includes `--comment` and claude_args allows
 * `mcp__github_inline_comment__create_inline_comment`.
 */
import { describe, expect, test } from 'bun:test'
import { CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT } from '../github-app.js'

describe('densable 2.1.229 #14 CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT', () => {
  test('prompt includes --comment so review posts to the PR', () => {
    // Avoid biome noTemplateCurlyInString: build GH Actions expr without literal `${{`
    const gh = (expr: string) => '${{ ' + expr + ' }}'
    const promptLine =
      "prompt: '/code-review:code-review --comment " +
      gh('github.repository') +
      '/pull/' +
      gh('github.event.pull_request.number') +
      "'"
    expect(CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT).toContain(promptLine)
    expect(CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT).toContain(
      '/code-review:code-review --comment ',
    )
  })

  test('claude_args allows github inline comment MCP tool', () => {
    expect(CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT).toContain(
      'claude_args: \'--allowedTools "mcp__github_inline_comment__create_inline_comment"\'',
    )
  })

  test('still uses code-review plugin marketplace wiring', () => {
    expect(CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT).toContain(
      "plugins: 'code-review@claude-code-plugins'",
    )
    expect(CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT).toContain(
      "plugin_marketplaces: 'https://github.com/anthropics/claude-code.git'",
    )
  })
})
