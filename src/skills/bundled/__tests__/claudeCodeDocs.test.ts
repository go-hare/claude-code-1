import { describe, expect, test } from 'bun:test'
import {
  buildClaudeCodeDocsBuildSnapshot,
  maybeRegisterClaudeCodeSkill,
  registerClaudeCodeSkill,
} from '../claudeCodeDocs.js'
import { clearBundledSkills, getBundledSkills } from '../../bundledSkills.js'
import type { ToolUseContext } from '../../../Tool.js'

function makeContext(
  overrides: Partial<ToolUseContext['options']> = {},
): ToolUseContext {
  return {
    options: {
      commands: [
        {
          type: 'local',
          name: 'help',
          description: 'Show help',
          isHidden: false,
          source: 'builtin',
        } as any,
        {
          type: 'prompt',
          name: 'claude-code-docs',
          description: 'docs skill',
          isHidden: false,
          source: 'bundled',
        } as any,
        {
          type: 'prompt',
          name: 'my-skill',
          description: 'custom skill',
          isHidden: false,
          source: 'projectSettings',
        } as any,
        {
          type: 'local',
          name: 'hidden',
          description: 'hidden',
          isHidden: true,
          source: 'builtin',
        } as any,
      ],
      agentDefinitions: {
        activeAgents: [
          {
            agentType: 'Explore',
            whenToUse: 'explore code',
            source: 'built-in',
          } as any,
          {
            agentType: 'MyAgent',
            whenToUse: 'custom agent',
            source: 'projectSettings',
          } as any,
        ],
      },
      mcpClients: [{ name: 'demo-mcp' } as any],
      debug: false,
      mainLoopModel: 'test',
      tools: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      ...overrides,
    },
  } as ToolUseContext
}

describe('buildClaudeCodeDocsBuildSnapshot', () => {
  test('lists builtin commands, custom skills, agents, mcp', () => {
    const snap = buildClaudeCodeDocsBuildSnapshot(makeContext(), '')
    expect(snap).toContain('Available commands (2 in this build)')
    expect(snap).toContain('/help')
    expect(snap).toContain('/claude-code-docs')
    expect(snap).not.toContain('/hidden')
    expect(snap).toContain('Custom skills configured')
    expect(snap).toContain('/my-skill')
    expect(snap).toContain('Custom agents configured')
    expect(snap).toContain('MyAgent')
    expect(snap).not.toContain('Explore')
    expect(snap).toContain('Configured MCP servers')
    expect(snap).toContain('demo-mcp')
  })

  test('includes recent release notes filtered by version', () => {
    const changelog = `## 0.0.1\n- first\n\n## 99.0.0\n- future\n`
    const snap = buildClaudeCodeDocsBuildSnapshot(makeContext(), changelog)
    // Without MACRO in test, version is 0.0.0 so only notes <= 0.0.0 appear;
    // future 99.0.0 must be excluded.
    expect(snap).not.toContain('future')
  })
})

describe('maybeRegisterClaudeCodeSkill', () => {
  test('skips registration when DISABLE_CLAUDE_CODE_SKILL is set', () => {
    clearBundledSkills()
    const prev = process.env.CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL
    process.env.CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL = '1'
    try {
      maybeRegisterClaudeCodeSkill()
      expect(getBundledSkills()).toEqual([])
    } finally {
      if (prev === undefined)
        delete process.env.CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL
      else process.env.CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL = prev
      clearBundledSkills()
    }
  })

  test('registers claude-code-docs when env is unset (may need MACRO for files path)', () => {
    // registerBundledSkill extracts files and uses MACRO.VERSION for the path.
    // In unit tests MACRO may be undefined; only assert the name/description
    // when registration succeeds without throwing.
    clearBundledSkills()
    const prev = process.env.CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL
    delete process.env.CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL
    // Provide MACRO for filesystem path
    const g = globalThis as { MACRO?: { VERSION?: string } }
    const prevMacro = g.MACRO
    g.MACRO = { ...(prevMacro ?? {}), VERSION: '0.0.0-test' }
    try {
      registerClaudeCodeSkill()
      const skills = getBundledSkills()
      expect(skills.some(s => s.name === 'claude-code-docs')).toBe(true)
      const skill = skills.find(s => s.name === 'claude-code-docs')!
      expect(skill.description).toContain(
        'Answer questions about Claude Code itself',
      )
      expect(typeof skill.isEnabled).toBe('function')
    } finally {
      if (prev === undefined)
        delete process.env.CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL
      else process.env.CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL = prev
      if (prevMacro === undefined) delete g.MACRO
      else g.MACRO = prevMacro
      clearBundledSkills()
    }
  })
})
