/**
 * densable 2.1.234 #39 — claude-api on-demand (~25k) assembler (Dy0 / Oy0 / Hy0).
 */
import { describe, expect, test } from 'bun:test'
import {
  clearBundledSkills,
  getBundledSkills,
  registerBundledSkill,
} from '../../bundledSkills.js'
import {
  buildClaudeApiPrompt,
  matchSubcommand,
  processSkillFiles,
} from '../claudeApi.js'
import * as content from '../claudeApiContent.js'
import { SKILL_FILES, SKILL_PROMPT } from '../claudeApiContent.js'

function docPaths(prompt: string): string[] {
  return [...prompt.matchAll(/<doc path="([^"]+)">/g)].map(m => m[1]!)
}

describe('claude-api on-demand densable 2.1.234 Dy0', () => {
  test('SKILL.md Reading Guide keeps the on-demand sentence', () => {
    expect(SKILL_PROMPT).toContain('## Reading Guide')
    expect(SKILL_PROMPT).toContain(
      "none of those files' content is included above — Read each one on demand before relying on what it covers.",
    )
  })

  test('extracted + detected lang inlines only that lang README', () => {
    const prompt = buildClaudeApiPrompt('python', '', content, true)
    expect(prompt).toContain('## Reading Guide')
    expect(prompt).toContain('## When to Use WebFetch')
    expect(prompt).toContain('## Detected Language: python')
    expect(prompt).toContain(
      'Read the other referenced files from the base directory on demand',
    )
    expect(prompt).not.toContain('## Included Documentation')
    expect(prompt).not.toContain('## Reference Files Unavailable')
    expect(docPaths(prompt)).toEqual(['python/claude-api/README.md'])
    expect(prompt).not.toContain('<doc path="python/claude-api/tool-use.md">')
    expect(prompt).not.toContain('<doc path="typescript/claude-api/README.md">')
    expect(prompt).not.toContain('<doc path="shared/live-sources.md">')
  })

  test('extract-fail inlines live-sources only, plus lang README if detected', () => {
    const prompt = buildClaudeApiPrompt('typescript', 'hello', content, false)
    expect(prompt).toContain('## Reference Files Unavailable')
    expect(prompt).toContain('could not be written to disk for this session')
    expect(prompt).toContain('## Detected Language: typescript')
    expect(prompt).not.toContain(
      'Read the other referenced files from the base directory on demand',
    )
    expect(docPaths(prompt)).toEqual([
      'shared/live-sources.md',
      'typescript/claude-api/README.md',
    ])
    expect(prompt).toContain('## User Request')
    expect(prompt).toContain('hello')
    expect(prompt).not.toContain('## Included Documentation')
  })

  test('no language + extract success asks then Read from base dir', () => {
    const prompt = buildClaudeApiPrompt(null, 'migrate', content, true)
    expect(matchSubcommand('migrate')).toBe('migrate')
    expect(prompt).toContain(
      'No project language was auto-detected. Ask the user which language they are using (see Language Detection above), then Read the matching `{lang}/claude-api/README.md`',
    )
    expect(prompt).not.toContain('## Reference Files Unavailable')
    expect(docPaths(prompt)).toEqual([])
  })

  test('no language + extract fail asks before writing code', () => {
    const prompt = buildClaudeApiPrompt(null, '', content, false)
    expect(prompt).toContain('## Reference Files Unavailable')
    expect(prompt).toContain(
      'No project language was auto-detected. Ask the user which language they are using (see Language Detection above) before writing code.',
    )
    expect(docPaths(prompt)).toEqual(['shared/live-sources.md'])
  })

  test('prompt-audit skips the no-language ask', () => {
    const extracted = buildClaudeApiPrompt(
      null,
      'prompt-audit ./skills',
      content,
      true,
    )
    const failed = buildClaudeApiPrompt(null, 'prompt-audit', content, false)
    expect(extracted).not.toContain('No project language was auto-detected')
    expect(failed).not.toContain('No project language was auto-detected')
    expect(extracted).toContain('## User Request')
    expect(extracted).toContain('prompt-audit ./skills')
  })

  test('Hy0 processes every SKILL_FILES entry', () => {
    const files = processSkillFiles(content)
    expect(Object.keys(files).sort()).toEqual(Object.keys(SKILL_FILES).sort())
    expect(files['shared/live-sources.md']).toContain(
      '# Live Documentation Sources',
    )
  })
})

describe('claude-api Kwd files fn + extract dir (densable 2.1.234)', () => {
  test('files function extracts and prefixes Base directory; 3rd arg is string', async () => {
    clearBundledSkills()
    const g = globalThis as { MACRO?: { VERSION?: string } }
    const prevMacro = g.MACRO
    g.MACRO = { ...(prevMacro ?? {}), VERSION: '0.0.0-test-39' }
    let seenExtracted: string | null | undefined
    try {
      registerBundledSkill({
        name: 'claude-api-kwd-probe',
        description: 'probe',
        files: async () => ({ 'shared/live-sources.md': '# Live\n' }),
        async getPromptForCommand(_args, _ctx, extractedDir) {
          seenExtracted = extractedDir
          return [{ type: 'text', text: 'PROMPT' }]
        },
      })
      const skill = getBundledSkills().find(
        s => s.name === 'claude-api-kwd-probe',
      )
      expect(skill?.type).toBe('prompt')
      if (!skill || skill.type !== 'prompt') throw new Error('expected prompt')
      const blocks = await skill.getPromptForCommand('', {
        options: {},
      } as never)
      const text = blocks.map(b => (b.type === 'text' ? b.text : '')).join('')
      expect(typeof seenExtracted).toBe('string')
      expect(text.startsWith('Base directory for this skill: ')).toBe(true)
      expect(text).toContain('PROMPT')
    } finally {
      if (prevMacro === undefined) delete g.MACRO
      else g.MACRO = prevMacro
      clearBundledSkills()
    }
  })

  test('extract fail (traversal path) yields null 3rd arg and no Base directory prefix', async () => {
    clearBundledSkills()
    const g = globalThis as { MACRO?: { VERSION?: string } }
    const prevMacro = g.MACRO
    g.MACRO = { ...(prevMacro ?? {}), VERSION: '0.0.0-test-39-fail' }
    let seenExtracted: string | null | undefined = 'unset'
    try {
      registerBundledSkill({
        name: 'claude-api-kwd-fail',
        description: 'probe',
        files: async () => ({ '../escape.md': 'nope' }),
        async getPromptForCommand(_args, _ctx, extractedDir) {
          seenExtracted = extractedDir ?? null
          return [{ type: 'text', text: 'FAILPROMPT' }]
        },
      })
      const skill = getBundledSkills().find(
        s => s.name === 'claude-api-kwd-fail',
      )
      if (!skill || skill.type !== 'prompt') throw new Error('expected prompt')
      const blocks = await skill.getPromptForCommand('', {
        options: {},
      } as never)
      const text = blocks.map(b => (b.type === 'text' ? b.text : '')).join('')
      expect(seenExtracted).toBeNull()
      expect(text).toBe('FAILPROMPT')
      expect(text).not.toContain('Base directory for this skill:')
    } finally {
      if (prevMacro === undefined) delete g.MACRO
      else g.MACRO = prevMacro
      clearBundledSkills()
    }
  })
})
