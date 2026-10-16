import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  splitWebFetchAgentReport,
  WEB_FETCH_SAVED_FILES_NOTE_PREFIX,
} from '../built-in/webFetchAgent.js'
import {
  AgentResumeInProgressError,
  AgentResumePermanentlyRefusedError,
  AgentResumeTransientError,
  AgentStillStoppingError,
  resumeAgentForReply,
  resumeAgentInline,
} from '../resumeAgent.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const agentToolSource = readFileSync(
  join(__dirname, '..', 'AgentTool.tsx'),
  'utf-8',
)
const uiSource = readFileSync(join(__dirname, '..', 'UI.tsx'), 'utf-8')

describe('densable 2.1.289 remaining analog-weaker wrap', () => {
  test('mapToolResult async/remote/teammate is internal-metadata', () => {
    expect(agentToolSource).toContain(
      'This tool result is internal metadata — never quote or paste any part of it',
    )
    expect(agentToolSource).toContain(
      'Do NOT ${FILE_READ_TOOL_NAME} or tail this file',
    )
    expect(agentToolSource).toContain(
      'Cloud agent launched. (This tool result is internal metadata',
    )
    expect(agentToolSource).not.toContain('Cloud agent launched in CCR.')
  })

  test('spawn stamps spawnedSubagent / webFetchSavedFiles / outputFileReadable', () => {
    expect(agentToolSource).toContain('recordSubagentSpawn')
    expect(agentToolSource).toContain('webFetchSavedFilesForAgent')
    expect(agentToolSource).toContain(
      'persistedToolResultFiles: webFetchSavedFilesForAgent',
    )
    expect(agentToolSource).toContain('outputFileReadable: canReadOutputFile')
    expect(agentToolSource).toContain('subagent_background_launch_not_taken')
    expect(agentToolSource).toContain('lifecycleNotStarted: true')
    expect(agentToolSource).toContain('attachOwnerKeepalive: false')
    expect(agentToolSource).toContain(
      'applyHandbackProvenanceToCompletedContent',
    )
  })

  test('schema omit uses Ier launch-rule exception', () => {
    expect(agentToolSource).toContain('isBackgroundLaunchDisabled()')
    expect(agentToolSource).toContain('launchRule?.parameterDescription')
  })

  test('Fetch completed collapse uses sOo + Received bytes', () => {
    expect(uiSource).toContain('splitWebFetchAgentReport')
    expect(uiSource).toContain('Received')
    expect(uiSource).toContain('formatFileSize(bytes)')
    const peeled = splitWebFetchAgentReport([
      { text: 'page body' },
      { text: `${WEB_FETCH_SAVED_FILES_NOTE_PREFIX}foo.bin` },
    ])
    expect(peeled.report.map(b => b.text)).toEqual(['page body'])
    expect(peeled.savedFilesNote?.text).toContain('foo.bin')
  })

  test('review Important 1–5 source lock', () => {
    expect(agentToolSource).toContain('staticInputSchema')
    expect(agentToolSource).toContain('isBackgroundLaunchDisabled()')
    const promptSource = readFileSync(
      join(__dirname, '..', 'prompt.ts'),
      'utf-8',
    )
    expect(promptSource).toContain('isBackgroundAgentLaunchBlocked()')
    const repoRoot = join(__dirname, '..', '..', '..', '..', '..', '..')
    const sot = readFileSync(
      join(repoRoot, 'src', 'tasks', 'LocalAgentTask', 'LocalAgentTask.tsx'),
      'utf-8',
    )
    expect(sot).toContain('outputFileReadable === false')
    expect(sot).not.toContain(
      '...(!outputFileReadable ? { outputFileUnreadable: true } : {})',
    )
    const query = readFileSync(join(repoRoot, 'src', 'query.ts'), 'utf-8')
    expect(query).toContain('toolNamesChanged')
    expect(query).toContain('getSystemPrompt(')
    expect(query).toContain('buildEffectiveSystemPrompt({')
    expect(query).toContain('if (updatedToolUseContext.agentId)')
    expect(query).toContain('enhanceSystemPromptWithEnvDetails')
    expect(query).toContain("querySource === 'agent:builtin:fork'")
    expect(query).toContain('useExactTools:')
    expect(query).toContain('function* maybeHandbackBounce')
    expect(query).toContain("reason: 'max_turns'")
    expect(query).toContain('sweepStaleKeepaliveReasons(agentId, setAppState)')
    expect(query).toContain('hasHandbackWaitKids(agentId, getAppState)')
    expect(query).toContain('maybeSkillInlineCommandHandoffNotRun')
    expect(query).toContain("return { reason: 'hook_stopped' }")
    const prevent = query.indexOf('if (shouldPreventContinuation)')
    const hookStopped = query.indexOf(
      "return { reason: 'hook_stopped' }",
      prevent,
    )
    const bounceAfterPrevent = query.indexOf('maybeHandbackBounce', prevent)
    expect(prevent).toBeGreaterThan(0)
    expect(hookStopped).toBeGreaterThan(prevent)
    expect(bounceAfterPrevent).toBeGreaterThan(hookStopped)
    const skillInlineInPrevent = query
      .slice(prevent, hookStopped)
      .includes('maybeSkillInlineCommandHandoffNotRun')
    expect(skillInlineInPrevent).toBe(false)
    const nudgeExhausted = query.indexOf(
      'query_thinking_only_response: nudge_exhausted',
    )
    const bounceBeforeStop = query.indexOf(
      'maybeHandbackBounce',
      nudgeExhausted,
    )
    const stopAfterBounce = query.indexOf('handleStopHooks', bounceBeforeStop)
    expect(nudgeExhausted).toBeGreaterThan(0)
    expect(bounceBeforeStop).toBeGreaterThan(nudgeExhausted)
    expect(stopAfterBounce).toBeGreaterThan(bounceBeforeStop)
    const skillInlineCalls = [
      ...query.matchAll(
        /(?<!function )maybeSkillInlineCommandHandoffNotRun\(/g,
      ),
    ]
    expect(skillInlineCalls).toHaveLength(1)
    expect(skillInlineCalls[0]!.index).toBeGreaterThan(nudgeExhausted)
    expect(skillInlineCalls[0]!.index).toBeLessThan(stopAfterBounce)
    const maxTurnsIdx = query.indexOf(
      'if (maxTurns && nextTurnCount > maxTurns)',
    )
    expect(maxTurnsIdx).toBeGreaterThan(0)
    expect(
      query
        .slice(maxTurnsIdx, maxTurnsIdx + 900)
        .includes('maybeSkillInlineCommandHandoffNotRun'),
    ).toBe(false)
    const endTurnIdx = query.indexOf('if (toolRequestedEndTurn)')
    expect(endTurnIdx).toBeGreaterThan(0)
    expect(
      query
        .slice(endTurnIdx, endTurnIdx + 900)
        .includes('maybeSkillInlineCommandHandoffNotRun'),
    ).toBe(false)
    const resume = readFileSync(
      join(__dirname, '..', 'resumeAgent.ts'),
      'utf-8',
    )
    expect(resume).toContain('liveForkedSkillName ?? meta?.forkedSkillName')
    const runAgent = readFileSync(join(__dirname, '..', 'runAgent.ts'), 'utf-8')
    expect(runAgent).toContain('...(forkedSkillName && { forkedSkillName })')
    const handback = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'SubagentHandbackTool',
        'SubagentHandbackTool.ts',
      ),
      'utf-8',
    )
    expect(handback).toContain(
      'recordHandbackDelivery(senderTaskId, recipient, { flagged })',
    )
    expect(handback).not.toContain(
      'recordHandbackDelivery(senderTaskId, deliverTo',
    )
  })

  test('live Ier: installBackgroundLaunchRule after first inputSchema still extends describe', async () => {
    const savedFork = process.env.CLAUDE_CODE_FORK_SUBAGENT
    process.env.CLAUDE_CODE_FORK_SUBAGENT = '0'
    const { resetForkSubagentSessionSource } = await import(
      'src/utils/forkSubagentGate.js'
    )
    resetForkSubagentSessionSource()
    const {
      disableBackgroundTasks,
      installBackgroundLaunchRule,
      resetSessionBackgroundGatesForTests,
    } = await import('src/utils/sessionBackgroundGates.js')
    resetSessionBackgroundGatesForTests()
    try {
      const { inputSchema } = await import('../AgentTool.js')
      const first = inputSchema()
      expect(first.shape.run_in_background).toBeDefined()
      disableBackgroundTasks()
      installBackgroundLaunchRule({
        parameterDescription: 'confirm the launch-rule after first schema',
        ask: () => undefined,
      })
      const second = inputSchema()
      expect(second.shape.run_in_background).toBeDefined()
      expect(second.shape.run_in_background.description).toContain(
        'confirm the launch-rule after first schema',
      )
    } finally {
      resetSessionBackgroundGatesForTests()
      if (savedFork === undefined) delete process.env.CLAUDE_CODE_FORK_SUBAGENT
      else process.env.CLAUDE_CODE_FORK_SUBAGENT = savedFork
      resetForkSubagentSessionSource()
    }
  })

  test('resume error subclasses and inline/reply wrappers exist', () => {
    expect(new AgentResumeTransientError('x').name).toBe(
      'AgentResumeTransientError',
    )
    expect(new AgentResumePermanentlyRefusedError('x').name).toBe(
      'AgentResumePermanentlyRefusedError',
    )
    expect(new AgentResumeInProgressError('x').name).toBe(
      'AgentResumeInProgressError',
    )
    // densable Fle class exists; throw sites need stopPending/loops bag — not invented here.
    expect(new AgentStillStoppingError('x').name).toBe(
      'AgentStillStoppingError',
    )
    expect(typeof resumeAgentInline).toBe('function')
    expect(typeof resumeAgentForReply).toBe('function')
  })

  test('grouped UI launchedAsAsync: omit/undefined/true async; only false foreground', () => {
    // densable Mx: input?.run_in_background!==!1 → async set
    expect(uiSource).toContain('runInBackground !== false')
    expect(uiSource).toContain(
      'const launchedAsAsync = parsedInput.success && runInBackground !== false',
    )
  })
})
