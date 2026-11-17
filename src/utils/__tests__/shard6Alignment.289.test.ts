import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod/v4'
import {
  PostModelSwitchHookInputSchema,
  PreModelSwitchHookInputSchema,
} from '../../entrypoints/sdk/coreSchemas.js'
import type {
  SDKStatus,
  StopHookInput,
  SubagentStopHookInput,
} from '../../entrypoints/sdk/coreTypes.generated.js'
import {
  claimShutdown,
  isShuttingDown,
  releaseShutdownClaim,
  resetShutdownState,
} from '../gracefulShutdown.js'
import { leftoverM, leftoverP, leftoverY } from '../leftoverOt.js'
import { toJSONSchemaClaude } from '../settings/schemaOutput.js'
import { SettingsSchema } from '../settings/types.js'
import { isShutdownCommitted } from '../shutdownCommitted.js'
import { behaviorsOverMin, scanUsageTranscripts } from '../usageSessionScan.js'

const REPO_ROOT = new URL('../../../', import.meta.url).pathname

describe('Shard 6 2.1.289 alignment fixes', () => {
  test('#5 toJSONSchemaClaude (JOe): syncClaudeAiSkills is optional on input, catch injects default, tuples drop items:false', () => {
    const inputSchema = toJSONSchemaClaude(SettingsSchema(), {
      io: 'input',
      unrepresentable: 'any',
    })
    const required = Array.isArray(inputSchema.required)
      ? inputSchema.required
      : []
    expect(required).not.toContain('syncClaudeAiSkills')

    let overrideCalled = false
    const custom = z.object({
      withCatch: z.string().catch('fallback'),
      strictField: z.number(),
      pair: z.tuple([z.string(), z.number()]),
    })
    const customInput = toJSONSchemaClaude(custom, {
      io: 'input',
      override() {
        overrideCalled = true
      },
    })
    expect(overrideCalled).toBe(true)
    expect(customInput.required).toEqual(['strictField', 'pair'])
    const props = customInput.properties as Record<
      string,
      Record<string, unknown>
    >
    expect(props.withCatch?.default).toBe('fallback')
    expect(props.pair?.items).toBeUndefined()
    expect(props.pair?.additionalItems).toBeUndefined()

    const customOutput = toJSONSchemaClaude(custom, { io: 'output' })
    expect(customOutput.required).toEqual(['withCatch', 'strictField', 'pair'])

    const dynamicCatch = z.string().catch(() => {
      throw new Error('dynamic')
    })
    expect(() => toJSONSchemaClaude(dynamicCatch, { io: 'input' })).toThrow(
      'Dynamic catch values are not supported in JSON Schema',
    )
  })

  test('#16 SettingsSchema validates skillListingMaxDescChars (>0 int) and skillListingBudgetFraction ((0,1])', () => {
    expect(
      SettingsSchema().safeParse({ skillListingMaxDescChars: 2048 }).success,
    ).toBe(true)
    expect(
      SettingsSchema().safeParse({ skillListingMaxDescChars: 0 }).success,
    ).toBe(false)
    expect(
      SettingsSchema().safeParse({ skillListingMaxDescChars: -10 }).success,
    ).toBe(false)
    expect(
      SettingsSchema().safeParse({ skillListingMaxDescChars: 12.5 }).success,
    ).toBe(false)

    expect(
      SettingsSchema().safeParse({ skillListingBudgetFraction: 0.05 }).success,
    ).toBe(true)
    expect(
      SettingsSchema().safeParse({ skillListingBudgetFraction: 1 }).success,
    ).toBe(true)
    expect(
      SettingsSchema().safeParse({ skillListingBudgetFraction: 0 }).success,
    ).toBe(false)
    expect(
      SettingsSchema().safeParse({ skillListingBudgetFraction: 1.01 }).success,
    ).toBe(false)
  })

  test('#8 usageSessionScan: workspace path containing "subagents" does not misclassify main-thread transcripts', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'usage-subagents-slug-'))
    const prev = process.env.CLAUDE_CONFIG_DIR
    try {
      process.env.CLAUDE_CONFIG_DIR = configDir
      // Project slug for /Users/dev/my-subagents-repo contains "subagents"
      const projectDir = join(
        configDir,
        'projects',
        '-Users-dev-my-subagents-repo',
      )
      await mkdir(projectDir, { recursive: true })
      const nowIso = new Date().toISOString()
      await writeFile(
        join(projectDir, 'main-sess.jsonl'),
        [1, 2, 3]
          .map(i =>
            JSON.stringify({
              type: 'assistant',
              timestamp: nowIso,
              sessionId: 'main-sess',
              uuid: `m-${i}`,
              model: 'claude-sonnet-4-6',
              usage: { input_tokens: 200, output_tokens: 100 },
            }),
          )
          .join('\n') + '\n',
      )

      const res = await scanUsageTranscripts(null)
      expect(res.day.requestCount).toBe(3)
      expect(behaviorsOverMin(res.day).map(b => b.key)).not.toContain(
        'subagent_heavy',
      )
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prev
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test('#10 claimShutdown / releaseShutdownClaim do not prematurely latch irreversible isShutdownCommitted', () => {
    resetShutdownState()
    try {
      expect(isShuttingDown()).toBe(false)
      expect(isShutdownCommitted()).toBe(false)

      claimShutdown()
      expect(isShuttingDown()).toBe(true)
      expect(isShutdownCommitted()).toBe(false)

      releaseShutdownClaim()
      expect(isShuttingDown()).toBe(false)
      expect(isShutdownCommitted()).toBe(false)
    } finally {
      resetShutdownState()
    }
  })

  test('#15 ModelSwitch source enums, narrowed StopHookInput / SubagentStopHookInput, and nullable SDKStatus', () => {
    const base = {
      session_id: 's1',
      transcript_path: '/tmp/t.jsonl',
      cwd: '/tmp',
      from_model: 'claude-sonnet-4-6',
      to_model: 'claude-opus-4-7',
      requested_model: 'opus',
      context_tokens: 100,
      prompt_cache_warm: true,
      cache_ttl: '5m' as const,
      estimated_cache_write_usd: 0.01,
      pricing: 'catalog' as const,
    }
    for (const src of ['command', 'picker', 'sdk']) {
      expect(
        PreModelSwitchHookInputSchema().safeParse({
          ...base,
          hook_event_name: 'PreModelSwitch',
          source: src,
        }).success,
      ).toBe(true)
    }
    for (const bad of ['auto', 'resume', 'bogus']) {
      expect(
        PreModelSwitchHookInputSchema().safeParse({
          ...base,
          hook_event_name: 'PreModelSwitch',
          source: bad,
        }).success,
      ).toBe(false)
    }
    for (const src of ['command', 'picker', 'sdk', 'auto', 'resume']) {
      expect(
        PostModelSwitchHookInputSchema().safeParse({
          ...base,
          hook_event_name: 'PostModelSwitch',
          source: src,
        }).success,
      ).toBe(true)
    }
    expect(
      PostModelSwitchHookInputSchema().safeParse({
        ...base,
        hook_event_name: 'PostModelSwitch',
        source: 'bogus',
      }).success,
    ).toBe(false)

    // Compile-time checks: StopHookInput / SubagentStopHookInput expose background_tasks & session_crons, SDKStatus accepts null
    const nullStatus: SDKStatus = null
    expect(nullStatus).toBeNull()
    const checkStop = (s: StopHookInput, sub: SubagentStopHookInput) => [
      s.background_tasks,
      s.session_crons,
      sub.agent_id,
      sub.background_tasks,
    ]
    expect(typeof checkStop).toBe('function')
  })

  test('#17 leftoverOt accepts string, number, boolean, and undefined telemetry attributes', () => {
    expect(() => {
      leftoverY('test_feature', {
        count: 2,
        active: true,
        tag: 'a',
        skip: undefined,
      })
      leftoverM('test_feature', 'err_code', { retries: 1, fatal: false })
      leftoverP('test_feature', 'sad_code', { duration_ms: 42 })
    }).not.toThrow()
  })

  test('#4 applySettingsChange preserves sessionEffort & orthogonal ultracode across settings reloads', async () => {
    const cfgDir = await mkdtemp(join(tmpdir(), 'shard6-apply-'))
    try {
      const child = Bun.spawnSync(
        [
          process.execPath,
          '-e',
          `
import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { logMock } from './tests/mocks/log.ts'
import { debugMock } from './tests/mocks/debug.ts'
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

const { enableConfigs } = await import('src/utils/config.ts')
enableConfigs()

const realSettings = { ...await import('src/utils/settings/settings.ts') }
let diskSettings = { effortLevel: 'medium', ultracode: false }
mock.module('src/utils/settings/settings.ts', () => ({
  ...realSettings,
  getInitialSettings: () => ({ ...diskSettings }),
  getSettingsForSource: src => (src === 'userSettings' ? { ...diskSettings } : {}),
  getEnabledSettingSources: () => ['userSettings'],
}))

const { getDefaultAppState } = await import('src/state/AppStateStore.ts')
const { applySettingsChange } = await import('src/utils/settings/applySettingsChange.ts')
const { pdSessionEffort, levelSessionEffort, INHERIT_SESSION_EFFORT } = await import('src/utils/effort.ts')

// 1) Explicit sessionEffort + active ultracode survive effortLevel change on disk
let state = {
  ...getDefaultAppState(),
  mainLoopModel: 'claude-opus-4-7',
  sessionEffort: levelSessionEffort('low'),
  effortValue: 'low',
  ultracode: true,
  settings: { effortLevel: 'high', ultracode: false },
}
applySettingsChange('userSettings', updater => { state = updater(state) })
assert.deepEqual(state.sessionEffort, { kind: 'level', value: 'low' })
assert.equal(pdSessionEffort(state, 'claude-opus-4-7'), 'low')
assert.equal(state.ultracode, true)

// 2) Enabling settings.ultracode flips ultracode:true WITHOUT forcing sessionEffort to xhigh
diskSettings = { modelSettings: { 'claude-opus-4-7': { effortLevel: 'medium' } }, ultracode: true }
state = {
  ...getDefaultAppState(),
  mainLoopModel: 'claude-opus-4-7',
  sessionEffort: INHERIT_SESSION_EFFORT,
  settings: { ultracode: false },
}
applySettingsChange('flagSettings', updater => { state = updater(state) })
assert.equal(state.ultracode, true)
assert.deepEqual(state.sessionEffort, { kind: 'inherit' })
assert.equal(pdSessionEffort(state, 'claude-opus-4-7'), 'medium')
console.log('applySettingsChange-ok')
`,
        ],
        {
          cwd: REPO_ROOT,
          env: { ...process.env, HOME: cfgDir, CLAUDE_CONFIG_DIR: cfgDir },
        },
      )
      expect(child.stderr.toString()).toBe('')
      expect(child.exitCode).toBe(0)
      expect(child.stdout.toString()).toContain('applySettingsChange-ok')
    } finally {
      await rm(cfgDir, { recursive: true, force: true })
    }
  })

  test('#2 /compact checks endedByModel upfront and always emits compact_end + setSDKStatus(null) on hook block & SM compact', async () => {
    const cfgDir = await mkdtemp(join(tmpdir(), 'shard6-compact-'))
    try {
      const child = Bun.spawnSync(
        [
          process.execPath,
          '-e',
          `
import { mock } from 'bun:test'
import assert from 'node:assert/strict'
globalThis.MACRO = { VERSION: '2.1.289' }
import { logMock } from './tests/mocks/log.ts'
import { debugMock } from './tests/mocks/debug.ts'
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

const { enableConfigs } = await import('src/utils/config.ts')
enableConfigs()

let hookCalls = 0
let blockWithError = false
const realHooks = { ...await import('src/utils/hooks.ts') }
mock.module('src/utils/hooks.ts', () => ({
  ...realHooks,
  executePreCompactHooks: async () => {
    hookCalls++
    if (blockWithError) {
      return { newCustomInstructions: undefined, userDisplayMessage: undefined, blockedBy: 'blocked by policy' }
    }
    return { newCustomInstructions: undefined, userDisplayMessage: 'ok' }
  },
}))

const realSm = { ...await import('src/services/compact/sessionMemoryCompact.ts') }
let smResult = null
mock.module('src/services/compact/sessionMemoryCompact.ts', () => ({
  ...realSm,
  trySessionMemoryCompaction: async () => smResult,
}))

const { call } = await import('src/commands/compact/compact.ts')
const { createUserMessage } = await import('src/utils/messages.ts')
const { getDefaultAppState } = await import('src/state/AppStateStore.ts')

function makeCtx(endedByModel, statuses, progress) {
  const state = { ...getDefaultAppState(), endedByModel }
  return {
    abortController: new AbortController(),
    messages: [createUserMessage({ content: 'hello' })],
    readFileState: { entries: () => [], get: () => undefined, clear: () => {} },
    getAppState: () => state,
    setAppState: () => {},
    options: {
      mainLoopModel: 'claude-sonnet-4-6',
      tools: [],
      mcpClients: [],
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    onCompactProgress: ev => progress.push(ev.type),
    setSDKStatus: st => statuses.push(st),
  }
}

// 1) endedByModel throws BEFORE executePreCompactHooks
{
  const statuses = [], progress = []
  await assert.rejects(() => call('', makeCtx(true, statuses, progress)), /ended this conversation/i)
  assert.equal(hookCalls, 0)
  assert.deepEqual(statuses, [])
}

// 2) Hook block emits compact_end + setSDKStatus(null)
{
  blockWithError = true
  const statuses = [], progress = []
  const out = await call('', makeCtx(false, statuses, progress))
  assert.equal(out.type, 'text')
  assert.deepEqual(statuses, ['compacting', null])
  assert.deepEqual(progress, ['hooks_start', 'compact_end'])
}

// 3) Session-memory compact emits compact_end + setSDKStatus(null)
{
  blockWithError = false
  smResult = {
    boundaryMarker: createUserMessage({ content: 'b' }),
    summaryMessages: [createUserMessage({ content: 's' })],
    attachments: [],
    hookResults: [],
    preCompactTokenCount: 1000,
    postCompactTokenCount: 200,
    truePostCompactTokenCount: 200,
  }
  const statuses = [], progress = []
  const out = await call('', makeCtx(false, statuses, progress))
  assert.equal(out.type, 'compact')
  assert.deepEqual(statuses, ['compacting', null])
  assert.ok(progress.includes('compact_end'))
}
console.log('compact-ok')
`,
        ],
        {
          cwd: REPO_ROOT,
          env: { ...process.env, HOME: cfgDir, CLAUDE_CONFIG_DIR: cfgDir },
        },
      )
      expect(child.stderr.toString()).toBe('')
      expect(child.exitCode).toBe(0)
      expect(child.stdout.toString()).toContain('compact-ok')
    } finally {
      await rm(cfgDir, { recursive: true, force: true })
    }
  })

  test('#11 /clear preserves WebSearch budget & runningSubagents when background agent survives, resets when none survive', async () => {
    const cfgDir = await mkdtemp(join(tmpdir(), 'shard6-clear-'))
    try {
      const child = Bun.spawnSync(
        [
          process.execPath,
          '-e',
          `
import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { logMock } from './tests/mocks/log.ts'
import { debugMock } from './tests/mocks/debug.ts'
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

const { enableConfigs } = await import('src/utils/config.ts')
enableConfigs()

const realHooks = { ...await import('src/utils/hooks.ts') }
mock.module('src/utils/hooks.ts', () => ({
  ...realHooks,
  executeSessionEndHooks: async () => {},
}))

const { clearConversation } = await import('src/commands/clear/conversation.ts')
const { getDefaultAppState } = await import('src/state/AppStateStore.ts')

let resets = 0
const fakeRegistry = {
  resetWebSearchCalls() { resets++ },
}
const readFileState = { clear() {} }

// 1) Surviving background local_agent -> do NOT reset WebSearch budget, keep runningSubagents
{
  let state = {
    ...getDefaultAppState(),
    runningSubagents: 2,
    tasks: {
      a1: { id: 'a1', type: 'local_agent', agentId: 'ag-1', status: 'running', isBackgrounded: true, description: 'bg' },
    },
  }
  await clearConversation({
    setMessages: () => {},
    readFileState,
    getAppState: () => state,
    setAppState: fn => { state = fn(state) },
    taskRegistry: fakeRegistry,
  })
  assert.equal(resets, 0)
  assert.equal(state.runningSubagents, 2)
}

// 2) Only local_bash survives -> reset WebSearch budget AND reset runningSubagents to 0
{
  let state = {
    ...getDefaultAppState(),
    runningSubagents: 2,
    tasks: {
      b1: { id: 'b1', type: 'local_bash', status: 'running', isBackgrounded: true, description: 'sh' },
    },
  }
  await clearConversation({
    setMessages: () => {},
    readFileState,
    getAppState: () => state,
    setAppState: fn => { state = fn(state) },
    taskRegistry: fakeRegistry,
  })
  assert.equal(resets, 1)
  assert.equal(state.runningSubagents, 0)
}
console.log('clear-ok')
`,
        ],
        {
          cwd: REPO_ROOT,
          env: { ...process.env, HOME: cfgDir, CLAUDE_CONFIG_DIR: cfgDir },
        },
      )
      expect(child.stderr.toString()).toBe('')
      expect(child.exitCode).toBe(0)
      expect(child.stdout.toString()).toContain('clear-ok')
    } finally {
      await rm(cfgDir, { recursive: true, force: true })
    }
  })

  test('#1 & #12.3b & #3 print.ts headless MCP and settings control invariants', async () => {
    const src = await readFile(join(REPO_ROOT, 'src/cli/print.ts'), 'utf-8')
    // Deferred AppState flush after dynamicMcpState assignment
    const assignIdx = src.indexOf('dynamicMcpState = result.newDynamicState')
    const flushIdx = src.indexOf(
      'for (const updater of deferredAppStateUpdates)',
    )
    expect(assignIdx).toBeGreaterThan(0)
    expect(flushIdx).toBeGreaterThan(assignIdx)

    // Parked spare stdio guard + enterprise policy refusal + removeMcpServer ownership guard
    expect(src).toContain(
      'if (isSpareParked() && isHeldBackParkedStdioServer(name, config))',
    )
    expect(src).toContain("refused: 'policy'")
    expect(src).toContain('if (!Object.hasOwn(dynamicMcpState.configs, name))')

    // Effort control alignment (#3)
    expect(src).toContain(
      'const sessionEffortValue = pdSessionEffort(currentAppState, model)',
    )
    expect(src).toContain(
      'effortModelSettingsPatch(currentModel, persistableEffort)',
    )
    expect(src).toContain('getSessionEffort: () => getAppState().sessionEffort')
  })

  test('#7 getAttachments with inputMentionsOnly clears 1000ms timer and wraps nested_memory in maybe()', async () => {
    const src = await readFile(
      join(REPO_ROOT, 'src/utils/attachments.ts'),
      'utf-8',
    )
    const idx = src.indexOf('if (mentionsOnly)')
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 320)
    expect(slice).toContain("maybe('nested_memory', () =>")
    expect(slice).toContain('clearTimeout(timeoutId)')
  })
})
