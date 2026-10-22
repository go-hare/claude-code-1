/**
 * promptEngineeringAudit.test.ts
 *
 * 验证 prompts.ts 中从 Opus 4.7 官方 prompt 借鉴的提示词工程改进。
 * 对应审计文档: docs/features/opus-4.7-prompt-engineering-audit.md
 *
 * 测试策略: 通过 getSystemPrompt() 生成完整 system prompt，
 * 然后检查关键段落是否存在。大部分被测函数是 module-private，
 * 只能通过最终输出间接验证。
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'

// --- MACRO 全局注入 (编译时 define 在测试中不可用) ---
;(globalThis as any).MACRO = {
  VERSION: '2.1.888',
  BUILD_TIME: '2026-04-22T00:00:00Z',
  FEEDBACK_CHANNEL: '',
  ISSUES_EXPLAINER: 'report issues on GitHub',
  NATIVE_PACKAGE_URL: '',
  PACKAGE_URL: '',
  VERSION_CHANGELOG: '',
}

// --- Mock 链 (阻断副作用) ---

mock.module('src/bootstrap/state.js', () => ({
  getIsNonInteractiveSession: () => false,
  sessionId: 'test-session',
  getCwd: () => '/test/project',
}))
mock.module('src/utils/cwd.js', () => ({
  getCwd: () => '/test/project',
}))
mock.module('src/utils/git.js', () => ({
  getIsGit: async () => true,
}))
mock.module('src/utils/worktree.js', () => ({
  getCurrentWorktreeSession: () => null,
}))
mock.module('src/constants/common.js', () => ({
  getSessionStartDate: () => '2026-04-22',
}))
mock.module('src/utils/settings/settings.js', () => ({
  getInitialSettings: () => ({ language: undefined }),
}))
mock.module('src/commands/poor/poorMode.js', () => ({
  isPoorModeActive: () => false,
}))
mock.module('src/utils/env.js', () => ({
  env: { platform: 'linux' },
}))
mock.module('src/utils/envUtils.js', () => ({
  isEnvTruthy: () => false,
}))
mock.module('src/utils/model/model.js', () => ({
  getCanonicalName: (id: string) => id,
  getMarketingNameForModel: (id: string) => {
    if (id.includes('opus-4-7')) return 'Claude Opus 4.7'
    if (id.includes('opus-4-6')) return 'Claude Opus 4.6'
    if (id.includes('sonnet-4-6')) return 'Claude Sonnet 4.6'
    return null
  },
}))
mock.module('src/commands.js', () => ({
  getSkillToolCommands: async () => [],
}))
mock.module('src/constants/outputStyles.js', () => ({
  getOutputStyleConfig: async () => null,
}))
mock.module('src/utils/embeddedTools.js', () => ({
  hasEmbeddedSearchTools: () => false,
}))
mock.module('src/utils/permissions/filesystem.js', () => ({
  isScratchpadEnabled: () => false,
  getScratchpadDir: () => '/tmp/scratchpad',
}))
mock.module('src/utils/betas.js', () => ({
  shouldUseGlobalCacheScope: () => false,
}))
mock.module('src/utils/undercover.js', () => ({
  isUndercover: () => false,
}))
mock.module('src/utils/model/antModels.js', () => ({
  getAntModelOverrideConfig: () => null,
}))
mock.module('src/utils/mcpInstructionsDelta.js', () => ({
  isMcpInstructionsDeltaEnabled: () => false,
}))
mock.module('src/memdir/memdir.js', () => ({
  loadMemoryPrompt: async () => null,
}))
mock.module('src/utils/debug.js', debugMock)
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/services/analytics/growthbook.js', growthbookMock)
mock.module('bun:bundle', bunBundleMock)
mock.module('src/constants/systemPromptSections.js', () => ({
  systemPromptSection: (_name: string, fn: () => any) => fn(),
  DANGEROUS_uncachedSystemPromptSection: (_name: string, fn: () => any) => fn(),
  resolveSystemPromptSections: async (sections: any[]) =>
    sections.filter(s => s !== null),
}))

// 工具常量 mock
const TOOL_NAMES = {
  Bash: 'Bash',
  Read: 'Read',
  Edit: 'Edit',
  Write: 'Write',
  Glob: 'Glob',
  Grep: 'Grep',
  Agent: 'Agent',
  AskUserQuestion: 'AskUserQuestion',
  TaskCreate: 'TaskCreate',
  DiscoverSkills: 'DiscoverSkills',
  Skill: 'Skill',
  Sleep: 'Sleep',
}

mock.module('@claude-code/builtin-tools/tools/BashTool/toolName.js', () => ({
  BASH_TOOL_NAME: TOOL_NAMES.Bash,
}))
mock.module('@claude-code/builtin-tools/tools/FileReadTool/prompt.js', () => ({
  FILE_READ_TOOL_NAME: TOOL_NAMES.Read,
}))
mock.module(
  '@claude-code/builtin-tools/tools/FileEditTool/constants.js',
  () => ({ FILE_EDIT_TOOL_NAME: TOOL_NAMES.Edit }),
)
mock.module('@claude-code/builtin-tools/tools/FileWriteTool/prompt.js', () => ({
  FILE_WRITE_TOOL_NAME: TOOL_NAMES.Write,
}))
mock.module('@claude-code/builtin-tools/tools/GlobTool/prompt.js', () => ({
  GLOB_TOOL_NAME: TOOL_NAMES.Glob,
}))
mock.module('@claude-code/builtin-tools/tools/GrepTool/prompt.js', () => ({
  GREP_TOOL_NAME: TOOL_NAMES.Grep,
}))
mock.module('@claude-code/builtin-tools/tools/AgentTool/constants.js', () => ({
  AGENT_TOOL_NAME: TOOL_NAMES.Agent,
  VERIFICATION_AGENT_TYPE: 'verification',
}))
mock.module(
  '@claude-code/builtin-tools/tools/AgentTool/forkSubagent.js',
  () => ({
    isForkSubagentProductEnabled: () => false,
    isForkSubagentScriptCallEnabled: () => false,
  }),
)
mock.module(
  '@claude-code/builtin-tools/tools/AgentTool/builtInAgents.js',
  () => ({ areExplorePlanAgentsEnabled: () => false }),
)
mock.module(
  '@claude-code/builtin-tools/tools/AgentTool/built-in/exploreAgent.js',
  () => ({
    EXPLORE_AGENT: { agentType: 'explore' },
    EXPLORE_AGENT_MIN_QUERIES: 5,
  }),
)
mock.module(
  '@claude-code/builtin-tools/tools/AskUserQuestionTool/prompt.js',
  () => ({ ASK_USER_QUESTION_TOOL_NAME: TOOL_NAMES.AskUserQuestion }),
)
mock.module(
  '@claude-code/builtin-tools/tools/TodoWriteTool/constants.js',
  () => ({ TODO_WRITE_TOOL_NAME: 'TodoWrite' }),
)
mock.module(
  '@claude-code/builtin-tools/tools/TaskCreateTool/constants.js',
  () => ({ TASK_CREATE_TOOL_NAME: TOOL_NAMES.TaskCreate }),
)
mock.module(
  '@claude-code/builtin-tools/tools/DiscoverSkillsTool/prompt.js',
  () => ({ DISCOVER_SKILLS_TOOL_NAME: TOOL_NAMES.DiscoverSkills }),
)
mock.module('@claude-code/builtin-tools/tools/SkillTool/constants.js', () => ({
  SKILL_TOOL_NAME: TOOL_NAMES.Skill,
}))
mock.module('@claude-code/builtin-tools/tools/SleepTool/prompt.js', () => ({
  SLEEP_TOOL_NAME: TOOL_NAMES.Sleep,
}))
mock.module('@claude-code/builtin-tools/tools/REPLTool/constants.js', () => ({
  isReplModeEnabled: () => false,
}))

// --- 导入被测模块 ---

import {
  getSystemPrompt,
  prependBullets,
  computeSimpleEnvInfo,
  getScratchpadInstructions,
} from './prompts.js'
import type { Tools } from '../Tool.js'
import { bunBundleMock } from '../../tests/mocks/bunBundle.js'
import { debugMock } from '../../tests/mocks/debug.js'
import { growthbookMock } from '../../tests/mocks/growthbook.js'

// --- 辅助 ---

const standardTools: Tools = [
  { name: 'Bash' },
  { name: 'Read' },
  { name: 'Edit' },
  { name: 'Write' },
  { name: 'Glob' },
  { name: 'Grep' },
  { name: 'Agent' },
  { name: 'AskUserQuestion' },
  { name: 'TaskCreate' },
] as any

async function getFullPrompt(
  tools: Tools = standardTools,
  model = 'claude-opus-4-7',
): Promise<string> {
  const sections = await getSystemPrompt(tools, model)
  return sections.join('\n\n')
}

// =====================================================================
// 第一部分: 提示词工程技巧验证
// 对应审计文档 第一部分 #1-#10
// =====================================================================

describe('Opus 4.7 Prompt Engineering Audit', () => {
  // densable 2.1.289 rgo/ago/lgo/dgo/ugo/mgo anchors (fork-added copy removed)
  describe('#1 Dedicated tools over shell', () => {
    test('prefers dedicated tools when one fits', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).toContain('Prefer dedicated tools over')
      expect(prompt).toContain('when one fits')
      expect(prompt).toContain('shell-only operations')
    })

    test('lists dedicated tool names that fit', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).toContain('Read')
      expect(prompt).toContain('Edit')
      expect(prompt).toContain('Write')
    })

    test('does not enumerate a Core tools catalog', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).not.toContain('Core tools')
    })
  })

  describe('#2 Anti-pattern / deny / file creation', () => {
    test('denied tool calls are not retried verbatim', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).toContain('do not re-attempt the exact same tool call')
    })

    test('prefers editing existing files', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).toContain(
        'Prefer editing existing files to creating new ones',
      )
    })
  })

  describe('#3 Parallel tool calls', () => {
    test('instructs independent tools in one response', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).toContain(
        'You can call multiple tools in a single response',
      )
      expect(prompt).toContain('do NOT call these tools in parallel')
    })
  })

  describe('#4 Exploratory questions', () => {
    test('2-3 sentence recommendation before implementing', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).toContain('For exploratory questions')
      expect(prompt).toContain("Don't implement until the user agrees")
    })
  })

  describe('#5 Cost asymmetry', () => {
    test('pausing to confirm is cheap vs unwanted action', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).toContain('cost of pausing to confirm is low')
    })
  })

  describe('#6 Git / stash caution', () => {
    test('git status before discard and stash -u', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).toContain('git status')
      expect(prompt).toContain('stash (with `-u` for untracked)')
    })
  })

  describe('#7 Tone and style (mgo)', () => {
    test('uses gold heading not Communication style', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).toContain('# Tone and style')
      expect(prompt).not.toContain('# Communication style')
      expect(prompt).toContain('Your responses should be short and concise')
      expect(prompt).toContain('Do not use a colon before tool calls')
    })
  })

  describe('#8 Query construction', () => {
    test('Grep and Glob named in dedicated-fits list', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).toContain('Grep')
      expect(prompt).toContain('Glob')
    })
  })

  describe('#9 Prompt injection defense', () => {
    test('warns about prompt injection in tool results', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).toContain('prompt injection')
    })
  })

  describe('#10 UI verification', () => {
    test('start the dev server for frontend changes', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).toContain(
        'start the dev server and use the feature in a browser',
      )
    })
  })

  describe('#13 Product information', () => {
    test('env info contains Claude Code product description', async () => {
      const envInfo = await computeSimpleEnvInfo('claude-opus-4-7')
      expect(envInfo).toContain('Claude Code')
      expect(envInfo).toContain('CLI')
    })

    test('env info contains model family', async () => {
      const envInfo = await computeSimpleEnvInfo('claude-opus-4-7')
      expect(envInfo).toContain('Claude 5 family')
      expect(envInfo).toContain('Haiku 4.5')
    })

    test('env info contains correct model IDs', async () => {
      const envInfo = await computeSimpleEnvInfo('claude-opus-4-7')
      expect(envInfo).toContain('claude-opus-4-7')
      expect(envInfo).toContain('claude-sonnet-4-6')
      expect(envInfo).toContain('claude-haiku-4-5')
    })

    test('mentions CLI surfaces and Fast mode Opus', async () => {
      const envInfo = await computeSimpleEnvInfo('claude-opus-4-7')
      expect(envInfo).toContain('claude.ai/code')
      expect(envInfo).toContain('does not downgrade')
      expect(envInfo).toContain('/fast')
    })
  })

  describe('Existing behavioral anchors (regression)', () => {
    test('fork-added Default to helping copy is gone', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).not.toContain('Default to helping')
      expect(prompt).not.toContain('self-abasement')
      expect(prompt).not.toContain(
        "Don't proactively mention your knowledge cutoff",
      )
      expect(prompt).not.toContain("Don't narrate internal machinery")
      expect(prompt).not.toContain('Search before saying unknown')
    })

    test('gold iIt dynamic sections are present', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).toContain('# Text output (does not apply to tool calls)')
      expect(prompt).toContain('use they/them')
      expect(prompt).toContain('When a task has been agreed')
      expect(prompt).toContain('# Context management')
      expect(prompt).toContain('# Delivering work')
      expect(prompt).toContain('# Corrections')
      expect(prompt).toContain('never write parameter-tag markup')
    })

    test('CYBER_RISK_INSTRUCTION: allows security testing', async () => {
      const prompt = await getFullPrompt()
      expect(prompt).not.toContain(
        'does not write or explain or work on malicious code',
      )
    })
  })

  // =====================================================================
  // 第四部分: prependBullets 工具函数
  // =====================================================================

  describe('prependBullets utility', () => {
    test('flat items get single bullet', () => {
      const result = prependBullets(['A', 'B'])
      expect(result).toEqual([' - A', ' - B'])
    })

    test('nested arrays get double-indented bullets', () => {
      const result = prependBullets(['A', ['sub1', 'sub2'], 'B'])
      expect(result).toEqual([' - A', '  - sub1', '  - sub2', ' - B'])
    })

    test('empty array returns empty', () => {
      expect(prependBullets([])).toEqual([])
    })
  })

  // =====================================================================
  // 第五部分: 环境信息与模型 cutoff
  // =====================================================================

  describe('Knowledge cutoff correctness', () => {
    test('Opus 4.7 cutoff is January 2026', async () => {
      const envInfo = await computeSimpleEnvInfo('claude-opus-4-7')
      expect(envInfo).toContain('January 2026')
    })

    test('Opus 4.6 cutoff is May 2025', async () => {
      const envInfo = await computeSimpleEnvInfo('claude-opus-4-6')
      expect(envInfo).toContain('May 2025')
    })

    test('Sonnet 4.6 cutoff is August 2025', async () => {
      const envInfo = await computeSimpleEnvInfo('claude-sonnet-4-6')
      expect(envInfo).toContain('August 2025')
    })

    test('Opus 4.7 frontier model name is correct', async () => {
      const envInfo = await computeSimpleEnvInfo('claude-opus-4-7')
      expect(envInfo).toContain('Claude Opus 4.7')
    })
  })
})
