import { describe, expect, test } from 'bun:test'

const g = globalThis as unknown as { MACRO?: { VERSION: string } }
g.MACRO = { VERSION: 'test' }

const { clearBundledSkills, getBundledSkills } = await import(
  '../../bundledSkills.js'
)
const { registerExplainUsageSkill } = await import('../explainUsage.js')
const { registerFewerPermissionPromptsSkill } = await import(
  '../fewerPermissionPrompts.js'
)
const { PLUGIN_AUTHORING_FILES } = await import('../goldSkillMarkdown.js')
const { buildDesignHubPrompt, registerGoldOfficialMissingSkills } =
  await import('../goldOfficialMissingSkills.js')
const { registerMemoryTypesSkill } = await import('../memoryTypes.js')
const { registerPrSkill } = await import('../pr.js')

const GOLD_NAMES = [
  'fewer-permission-prompts',
  'explain-usage',
  'memory-types',
  'pr',
  'plugin-authoring',
  'artifact-design',
  'artifact-diagramming',
  'artifact-components',
  'artifact-capabilities',
  'artifact-pr-review',
  'workshop',
  'whiteboard',
  'prototype',
  'design',
  'design-sync',
  'setup-claude',
  'run',
  'run-skill-generator',
  'cowork-plugin',
] as const

describe('gold 2.1.289 missing bundled skills', () => {
  test('registers every leftover gold name', () => {
    clearBundledSkills()
    registerFewerPermissionPromptsSkill()
    registerExplainUsageSkill()
    registerMemoryTypesSkill()
    registerPrSkill()
    registerGoldOfficialMissingSkills()
    const names = getBundledSkills().map(s => s.name)
    for (const name of GOLD_NAMES) {
      expect(names).toContain(name)
    }
    clearBundledSkills()
  })

  test('fewer-permission-prompts gold BODY', async () => {
    clearBundledSkills()
    registerFewerPermissionPromptsSkill()
    const skill = getBundledSkills().find(
      s => s.name === 'fewer-permission-prompts',
    )
    expect(skill?.type).toBe('prompt')
    if (!skill || skill.type !== 'prompt') throw new Error('expected prompt')
    const blocks = await skill.getPromptForCommand('', { options: {} } as never)
    const text = blocks.map(b => (b.type === 'text' ? b.text : '')).join('')
    expect(text).toContain('# Fewer Permission Prompts')
    expect(text).toContain('permissions.allow')
    expect(text).toContain('Never allowlist a pattern that grants arbitrary')
    clearBundledSkills()
  })

  test('setup-claude aliases setup-cowork', () => {
    clearBundledSkills()
    registerGoldOfficialMissingSkills()
    const skill = getBundledSkills().find(s => s.name === 'setup-claude')
    expect(skill?.aliases).toContain('setup-cowork')
    clearBundledSkills()
  })

  test('design invoke uses gold Cn hub when ClaudeDesign is on', async () => {
    clearBundledSkills()
    registerGoldOfficialMissingSkills()
    const skill = getBundledSkills().find(s => s.name === 'design')
    expect(skill?.type).toBe('prompt')
    if (!skill || skill.type !== 'prompt') throw new Error('expected prompt')
    const blocks = await skill.getPromptForCommand('landing page', {
      options: {},
    } as never)
    const text = blocks.map(b => (b.type === 'text' ? b.text : '')).join('')
    expect(text).toContain('You are handling a `/design` command')
    expect(text).toContain('ClaudeDesign({operation: "list"})')
    expect(text).toContain('landing page')
    clearBundledSkills()
  })

  test('design En falls to consent/null when Artifact quickstart is off and gAe is off', async () => {
    const prev = process.env.CLAUDE_CODE_USE_BEDROCK
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    try {
      clearBundledSkills()
      registerGoldOfficialMissingSkills()
      const skill = getBundledSkills().find(s => s.name === 'design')
      expect(skill?.type).toBe('prompt')
      if (!skill || skill.type !== 'prompt') throw new Error('expected prompt')
      expect(skill.isEnabled?.()).toBe(false)
      const blocks = await skill.getPromptForCommand('landing page', {
        options: {},
      } as never)
      const text = blocks.map(b => (b.type === 'text' ? b.text : '')).join('')
      expect(text).toContain('`/design` was invoked.')
      expect(text).toContain('/design consent')
      expect(text).not.toContain('type_query: "Design"')
      expect(text).not.toContain('You are handling a `/design` command')
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK
      else process.env.CLAUDE_CODE_USE_BEDROCK = prev
      clearBundledSkills()
    }
  })

  test('design yOn quickstart branch when CLAUDE_CODE_ARTIFACT_QUICKSTART=1', async () => {
    const prev = process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART
    process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = '1'
    try {
      clearBundledSkills()
      registerGoldOfficialMissingSkills()
      const skill = getBundledSkills().find(s => s.name === 'design')
      expect(skill?.type).toBe('prompt')
      if (!skill || skill.type !== 'prompt') throw new Error('expected prompt')
      const blocks = await skill.getPromptForCommand('landing page', {
        options: {},
      } as never)
      const text = blocks.map(b => (b.type === 'text' ? b.text : '')).join('')
      expect(text).toContain('action: "quickstart"')
      expect(text).toContain('intent: "design"')
      expect(text).toContain('The brief:')
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART
      else process.env.CLAUDE_CODE_ARTIFACT_QUICKSTART = prev
      clearBundledSkills()
    }
  })

  test('setup-claude prompt is gold SETUP_COWORK_PROMPT', async () => {
    clearBundledSkills()
    registerGoldOfficialMissingSkills()
    const skill = getBundledSkills().find(s => s.name === 'setup-claude')
    expect(skill?.type).toBe('prompt')
    if (!skill || skill.type !== 'prompt') throw new Error('expected prompt')
    const blocks = await skill.getPromptForCommand('', { options: {} } as never)
    const text = blocks.map(b => (b.type === 'text' ? b.text : '')).join('')
    expect(text).toContain('# Guided setup')
    expect(text).toContain('## Step 1 — Role')
    expect(text).toContain('ShowOnboardingRolePicker')
    clearBundledSkills()
  })

  test('plugin-authoring prompt is SKILL.md body not listing stub', async () => {
    clearBundledSkills()
    registerGoldOfficialMissingSkills()
    const skill = getBundledSkills().find(s => s.name === 'plugin-authoring')
    expect(skill?.type).toBe('prompt')
    if (!skill || skill.type !== 'prompt') throw new Error('expected prompt')
    const blocks = await skill.getPromptForCommand('', {
      options: {},
    } as never)
    const text = blocks.map(b => (b.type === 'text' ? b.text : '')).join('')
    expect(text).toContain('WHERE TO WRITE IT')
    expect(text).toContain('hooks/register.tsx')
    clearBundledSkills()
  })

  test('plugin-authoring files include gold examples/*.tsx', () => {
    expect(PLUGIN_AUTHORING_FILES['examples/pane.tsx']).toContain(
      "component: 'Pane'",
    )
    expect(PLUGIN_AUTHORING_FILES['examples/band.tsx']).toContain(
      "component: 'AbovePrompt'",
    )
    expect(PLUGIN_AUTHORING_FILES['examples/tool-call.ts']).toContain(
      '$.ui.status',
    )
    expect(PLUGIN_AUTHORING_FILES['examples/pane-state.d.ts']).toContain(
      'tool-calls',
    )
    expect(PLUGIN_AUTHORING_FILES['examples/band-state.d.ts']).toContain(
      'turn-band',
    )
    expect(PLUGIN_AUTHORING_FILES['reference.md']).toContain(
      'Function hooks: the long form',
    )
    expect(PLUGIN_AUTHORING_FILES['types/claude-code.d.ts']).toContain(
      'declare module',
    )
  })

  test('design reserved first-words are not treated as a brief', async () => {
    clearBundledSkills()
    registerGoldOfficialMissingSkills()
    const skill = getBundledSkills().find(s => s.name === 'design')
    expect(skill?.type).toBe('prompt')
    if (!skill || skill.type !== 'prompt') throw new Error('expected prompt')
    expect(skill.subcommands?.sync).toBe('design-sync')
    expect(skill.subcommands?.consent).toBe('design-consent')
    expect(skill.subcommandsBareOnly).toBe(true)
    expect(skill.isEnabled?.()).toBe(true)
    const consent = await skill.getPromptForCommand('consent', {
      options: {},
    } as never)
    const consentText = consent
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('')
    expect(consentText).toContain('`/design` was invoked.')
    expect(consentText).toContain('type themselves')
    expect(consentText).not.toContain('type_query: "Design"')
    const imported = await skill.getPromptForCommand('import abc', {
      options: {},
    } as never)
    const importText = imported
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('')
    expect(importText).toContain('You are handling a `/design` command')
    expect(importText).toContain('get_project')
    // Gold Ka in En==="hub": extra args after consent still hub, not types brief.
    const consentNow = await skill.getPromptForCommand('consent now', {
      options: {},
    } as never)
    const consentNowText = consentNow
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('')
    expect(consentNowText).toContain('You are handling a `/design` command')
    expect(consentNowText).not.toContain('type_query: "Design"')
    clearBundledSkills()
  })

  test('design hub prompt is gold Cn BODY', () => {
    const text = buildDesignHubPrompt('landing page')
    expect(text).toContain('You are handling a `/design` command')
    expect(text).toContain('ClaudeDesign({operation: "list"})')
    expect(text).toContain('get_claude_design_prompt')
    expect(text).toContain('landing page')
  })

  test('artifact-capabilities prompt is gold rt listing plus unreachable roster', async () => {
    clearBundledSkills()
    registerGoldOfficialMissingSkills()
    const skill = getBundledSkills().find(
      s => s.name === 'artifact-capabilities',
    )
    expect(skill?.type).toBe('prompt')
    if (!skill || skill.type !== 'prompt') throw new Error('expected prompt')
    const blocks = await skill.getPromptForCommand('', {
      options: {},
    } as never)
    const text = blocks.map(b => (b.type === 'text' ? b.text : '')).join('')
    expect(text).toContain('# Artifact runtime capabilities')
    expect(text).toContain('capabilities: {name: config}')
    expect(text).toContain('capability roster could not be fetched')
    clearBundledSkills()
  })

  test('artifact-design registers gold sz (userInvocable false, Est body)', async () => {
    clearBundledSkills()
    registerGoldOfficialMissingSkills()
    const skill = getBundledSkills().find(s => s.name === 'artifact-design')
    expect(skill?.type).toBe('prompt')
    if (!skill || skill.type !== 'prompt') throw new Error('expected prompt')
    expect(skill.userInvocable).toBe(false)
    expect(skill.whenToUse).toContain(
      'Markdown is never a shortcut past the design pass',
    )
    const blocks = await skill.getPromptForCommand('', {
      options: {},
    } as never)
    const text = blocks.map(b => (b.type === 'text' ? b.text : '')).join('')
    expect(text).toContain(
      'Work the way the design lead at a small, versatile studio would',
    )
    const diagramming = getBundledSkills().find(
      s => s.name === 'artifact-diagramming',
    )
    expect(diagramming?.description).toContain('Diagramming know-how')
    clearBundledSkills()
  })
})
