import { createHash } from 'crypto'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { WORKFLOW_TOOL_PROMPT } from '@claude-code/workflow-engine'
import { clearInvokedSkills } from '../../../bootstrap/state.js'
import type { PromptCommand } from '../../../types/command.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'
import { clearBundledSkills, getBundledSkills } from '../../bundledSkills.js'
import {
  getWorkflowAuthoringAutoloadMessages,
  getWorkflowAuthoringPromptBlocks,
  registerWorkflowAuthoringSkill,
} from '../workflowAuthoring.js'
import {
  WORKFLOW_AUTHORING_MENU_DESCRIPTION,
  WORKFLOW_AUTHORING_PROMPT,
  WORKFLOW_AUTHORING_PROMPT_SHA16,
  WORKFLOW_AUTHORING_PXT_GOLD_SHA16,
  WORKFLOW_AUTHORING_PXT_INNER_SHA16,
  WORKFLOW_AUTHORING_PXT_START,
  WORKFLOW_AUTHORING_SKILL_DESCRIPTION,
  WORKFLOW_AUTHORING_SKILL_NAME,
} from '../workflowAuthoringContent.js'

// mock.module is process-global — pin GB/settings so co-suites that leave
// getFeatureValue → false (or settings.disableBundledSkills) do not zero T().
const settingsSnap = snapshotModuleExports(
  await import('src/utils/settings/settings.js'),
)
const growthbookSnap = snapshotModuleExports(
  await import('src/services/analytics/growthbook.js'),
)

mock.module(
  'src/utils/settings/settings.js',
  createSettingsMock(settingsSnap, {
    getInitialSettings: () => ({}),
    getSettingsForSource: () => ({}),
  }),
)

mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: (_key: string, defaultValue: unknown) =>
    defaultValue ?? true,
}))

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

function asPrompt(c: { type: string }): PromptCommand {
  return c as unknown as PromptCommand
}

function sha16(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

const PREV_WORKFLOWS = process.env.CLAUDE_CODE_WORKFLOWS
const PREV_DISABLE = process.env.CLAUDE_CODE_DISABLE_WORKFLOWS
const PREV_BUNDLED = process.env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS
const PREV_ENTRY = process.env.CLAUDE_CODE_ENTRYPOINT

beforeEach(() => {
  process.env.CLAUDE_CODE_WORKFLOWS = '1'
  delete process.env.CLAUDE_CODE_DISABLE_WORKFLOWS
  delete process.env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS
  delete process.env.CLAUDE_CODE_ENTRYPOINT
  clearInvokedSkills()
  clearBundledSkills()
})

afterEach(() => {
  clearBundledSkills()
  clearInvokedSkills()
  if (PREV_WORKFLOWS === undefined) delete process.env.CLAUDE_CODE_WORKFLOWS
  else process.env.CLAUDE_CODE_WORKFLOWS = PREV_WORKFLOWS
  if (PREV_DISABLE === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_WORKFLOWS
  } else {
    process.env.CLAUDE_CODE_DISABLE_WORKFLOWS = PREV_DISABLE
  }
  if (PREV_BUNDLED === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS
  } else {
    process.env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS = PREV_BUNDLED
  }
  if (PREV_ENTRY === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
  else process.env.CLAUDE_CODE_ENTRYPOINT = PREV_ENTRY
})

describe('densable 2.1.248 #40 workflow-authoring', () => {
  test('register matches Fmr name/description/menuDescription', () => {
    clearBundledSkills()
    registerWorkflowAuthoringSkill()
    const skill = getBundledSkills().find(
      s => s.name === WORKFLOW_AUTHORING_SKILL_NAME,
    )
    expect(skill).toBeDefined()
    expect(skill!.name).toBe('workflow-authoring')
    expect(skill!.userInvocable).toBe(true)
    expect(skill!.description).toBe(WORKFLOW_AUTHORING_SKILL_DESCRIPTION)
    expect(skill!.menuDescription).toBe(WORKFLOW_AUTHORING_MENU_DESCRIPTION)
    expect(skill!.description).toContain(
      'does not itself authorize running one',
    )
    expect(typeof skill!.isEnabled).toBe('function')
  })

  test('gTt / pXt head and evaluated sha', async () => {
    expect(WORKFLOW_AUTHORING_PXT_START).toBe(196766972)
    expect(WORKFLOW_AUTHORING_PXT_GOLD_SHA16).toBe('498a85cdc7e27a20')
    expect(WORKFLOW_AUTHORING_PXT_INNER_SHA16).toBe('1af6404b4ee1ab88')
    expect(
      WORKFLOW_AUTHORING_PROMPT.startsWith('# Workflow authoring reference'),
    ).toBe(true)
    expect(WORKFLOW_AUTHORING_PROMPT).toContain(
      'A workflow structures work across many agents',
    )
    expect(sha16(WORKFLOW_AUTHORING_PROMPT)).toBe(
      WORKFLOW_AUTHORING_PROMPT_SHA16,
    )

    clearBundledSkills()
    registerWorkflowAuthoringSkill()
    const skill = getBundledSkills().find(
      s => s.name === WORKFLOW_AUTHORING_SKILL_NAME,
    )!
    const blocks = await asPrompt(skill).getPromptForCommand('', {} as never)
    expect(blocks).toEqual(getWorkflowAuthoringPromptBlocks())
    expect(blocks[0]).toEqual({
      type: 'text',
      text: WORKFLOW_AUTHORING_PROMPT,
    })
  })

  test('init register is called from bundled index', async () => {
    const src = await Bun.file(new URL('../index.ts', import.meta.url)).text()
    expect(src).toContain('registerWorkflowAuthoringSkill')
  })

  test('playbook no longer contains moved script-API dump', () => {
    expect(WORKFLOW_TOOL_PROMPT).toContain(
      'ONLY call this tool when the user has explicitly opted',
    )
    expect(WORKFLOW_TOOL_PROMPT).toContain(
      'load the `workflow-authoring` skill',
    )
    expect(WORKFLOW_TOOL_PROMPT.length).toBeLessThan(4000)
    expect(WORKFLOW_TOOL_PROMPT).not.toContain('Script body hooks')
    expect(WORKFLOW_TOOL_PROMPT).not.toContain(
      'Quality patterns — common shapes',
    )
    expect(WORKFLOW_TOOL_PROMPT).not.toContain(
      'Date.now()/Math.random()/new Date()',
    )
    expect(WORKFLOW_AUTHORING_PROMPT).toContain('Script body hooks')
    expect(WORKFLOW_AUTHORING_PROMPT).toContain(
      'Date.now()/Math.random()/new Date()',
    )
  })

  test('T() autoloads on workflow_keyword_request when Skill tool present', async () => {
    const turn = [
      {
        type: 'attachment',
        uuid: 'kw-1',
        attachment: { type: 'workflow_keyword_request' },
      },
    ]
    const out = await getWorkflowAuthoringAutoloadMessages(
      turn,
      [],
      [{ name: 'Skill' }],
    )
    expect(out).toHaveLength(2)
    expect(out[0]!.isMeta).toBe(true)
    expect(out[0]!.turnCompanion).toBe(true)
    expect(out[1]!.isMeta).toBe(true)
    expect(out[1]!.turnCompanion).toBe(true)
    const first =
      typeof out[0]!.message.content === 'string' ? out[0]!.message.content : ''
    expect(first).toContain('workflow-authoring')
  })

  test('T() is a no-op without keyword/ultracode trigger', async () => {
    const out = await getWorkflowAuthoringAutoloadMessages(
      [{ type: 'user', message: { content: 'hello' } }],
      [],
      [{ name: 'Skill' }],
    )
    expect(out).toEqual([])
  })
})
