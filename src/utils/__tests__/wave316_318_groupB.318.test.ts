import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  getSubagentEffortEnvOverride,
  resolveSubagentDefaultEffort,
} from '../effort.js'
import { isRefusalFallbackStuckWithoutDialog } from '../refusalFallback.js'
import {
  classifySafeguardsUnclaimedRetry,
  isUltrathinkEnabled,
} from '../thinking.js'
import { DANGEROUS_TOOL_USE_BETA_HEADER } from '../../constants/betas.js'
import { APIError } from '@anthropic-ai/sdk'
import {
  countAutoModeUnavailableResponsesInARow,
  noteAutoModeUnavailableResponse,
  resetRequestLatches,
  resetStateForTests,
  stickySendBeta,
} from '../../bootstrap/state.js'
import { OnFailureSchema } from '../../schemas/hooks.js'
import { applyOnFailureBlockToAggregatedHookResult } from '../hooks.js'
import { isPromptHookAdditionalContextAttachment } from '../messages.js'
import {
  getHookEnvFilePath,
  getSessionEnvDirPath,
} from '../sessionEnvironment.js'

const srcRoot = join(import.meta.dir, '../..')

describe('Wave 316-318 Group B: utils', () => {
  const prevEnv: Record<string, string | undefined> = {}

  function setEnv(k: string, v: string | undefined) {
    if (!(k in prevEnv)) prevEnv[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }

  afterEach(() => {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    for (const k of Object.keys(prevEnv)) delete prevEnv[k]
    resetStateForTests()
    resetRequestLatches()
  })

  test('#1473: CLAUDE_CODE_DISABLE_ULTRATHINK disables isUltrathinkEnabled', () => {
    setEnv('CLAUDE_CODE_DISABLE_ULTRATHINK', '1')
    expect(isUltrathinkEnabled()).toBe(false)
    const thinkingSrc = readFileSync(join(srcRoot, 'utils/thinking.ts'), 'utf8')
    expect(thinkingSrc).toContain('CLAUDE_CODE_DISABLE_ULTRATHINK')
  })

  test('#1476: CLAUDE_CODE_SUBAGENT_EFFORT overrides default subagent effort', () => {
    setEnv('CLAUDE_CODE_SUBAGENT_EFFORT', 'medium')
    expect(getSubagentEffortEnvOverride()).toBe('medium')
    expect(resolveSubagentDefaultEffort()).toBe('medium')
    expect(
      resolveSubagentDefaultEffort({ agentEffort: 'high' }),
    ).toBeUndefined()
    expect(resolveSubagentDefaultEffort({ isIneligible: true })).toBeUndefined()
    expect(
      resolveSubagentDefaultEffort({ hasPermissionLayerEffort: true }),
    ).toBeUndefined()
    setEnv('CLAUDE_CODE_SUBAGENT_EFFORT', 'inherit')
    expect(getSubagentEffortEnvOverride()).toBeUndefined()
  })

  test('#1538: classifySafeguardsUnclaimedRetry handles gateway 403/422 and preserves apiKeyHelper 403', () => {
    setEnv('ANTHROPIC_BASE_URL', 'https://gateway.example.com')
    stickySendBeta(DANGEROUS_TOOL_USE_BETA_HEADER)
    const err422 = new APIError(
      422,
      { message: 'unprocessable' },
      'unprocessable',
      new Headers(),
    )
    expect(
      classifySafeguardsUnclaimedRetry(err422, {
        model: 'claude-sonnet-4-6',
        lastSentDisplay: undefined,
        lastRequestBetas: [DANGEROUS_TOOL_USE_BETA_HEADER],
      }),
    ).toBe('retry:safeguards-unclaimed')

    resetStateForTests()
    stickySendBeta(DANGEROUS_TOOL_USE_BETA_HEADER)
    const err403 = new APIError(
      403,
      { message: 'forbidden' },
      'forbidden',
      new Headers(),
    )
    expect(
      classifySafeguardsUnclaimedRetry(err403, {
        model: 'claude-sonnet-4-6',
        lastSentDisplay: undefined,
        lastRequestBetas: [DANGEROUS_TOOL_USE_BETA_HEADER],
      }),
    ).toBe('retry:safeguards-unclaimed')
  })

  test('#1671: isRefusalFallbackStuckWithoutDialog includes isAgentThread', () => {
    expect(
      isRefusalFallbackStuckWithoutDialog({
        isMainThread: false,
        isAgentThread: true,
        switchModelsOnFlag: false,
      }),
    ).toBe(true)
    expect(
      isRefusalFallbackStuckWithoutDialog({
        isMainThread: false,
        isAgentThread: true,
        switchModelsOnFlag: true,
      }),
    ).toBe(false)
  })

  test('#1532: sessionSlots noCheckOnly filters autoModeUnavailableResponsesInARow', () => {
    const req1 = { id: 1 }
    const req2 = { id: 2 }
    noteAutoModeUnavailableResponse(req1, {
      runKey: 'main',
      position: 1,
      waited: Promise.resolve(true),
      noCheck: true,
    })
    noteAutoModeUnavailableResponse(req2, {
      runKey: 'main',
      position: 2,
      waited: Promise.resolve(true),
    })
    expect(countAutoModeUnavailableResponsesInARow('main')).toBe(2)
    expect(
      countAutoModeUnavailableResponsesInARow('main', { noCheckOnly: true }),
    ).toBe(1)
  })

  test('#1530: OnFailureSchema validates continue/block and ignores Stop events', () => {
    expect(OnFailureSchema().parse('block')).toBe('block')
    expect(OnFailureSchema().parse('continue')).toBe('continue')
    expect(() => OnFailureSchema().parse('invalid')).toThrow()

    const blocked = applyOnFailureBlockToAggregatedHookResult(
      { type: 'callback', onFailure: 'block' },
      { command: 'callback', succeeded: false, output: 'boom', blocked: false },
      'PreToolUse',
    )
    expect(blocked.blocked).toBe(true)

    const ignoredOnStop = applyOnFailureBlockToAggregatedHookResult(
      { type: 'callback', onFailure: 'block' },
      { command: 'callback', succeeded: false, output: 'boom', blocked: false },
      'Stop',
    )
    expect(ignoredOnStop.blocked).toBe(false)
  })

  test('#1674: isPromptHookAdditionalContextAttachment matches prompt.submit and prompt.mention', () => {
    expect(
      isPromptHookAdditionalContextAttachment({
        type: 'hook_additional_context',
        hookName: 'prompt.submit',
        hookEvent: 'UserPromptSubmit',
        content: ['ctx'],
      } as Parameters<typeof isPromptHookAdditionalContextAttachment>[0]),
    ).toBe(true)
    expect(
      isPromptHookAdditionalContextAttachment({
        type: 'hook_additional_context',
        hookName: 'prompt.mention',
        hookEvent: 'UserPromptSubmit',
        content: ['ctx'],
      } as Parameters<typeof isPromptHookAdditionalContextAttachment>[0]),
    ).toBe(true)
    expect(
      isPromptHookAdditionalContextAttachment({
        type: 'hook_additional_context',
        hookName: 'tool.call',
        hookEvent: 'PreToolUse',
        content: ['ctx'],
      } as Parameters<typeof isPromptHookAdditionalContextAttachment>[0]),
    ).toBe(false)
  })

  test('#1643: getHookEnvFilePath honors envFileSessionId and executeSetupHooks invalidates cache', async () => {
    const dir = await getSessionEnvDirPath('custom-cloud-session-id')
    expect(dir).toContain('custom-cloud-session-id')
    const file = await getHookEnvFilePath('Setup', 0, 'custom-cloud-session-id')
    expect(file).toContain('setup-hook-0.sh')
    const hooksSrc = readFileSync(join(srcRoot, 'utils/hooks.ts'), 'utf8')
    expect(hooksSrc).toContain('invalidateSessionEnvCache()')
  })

  test('#1529, #1574, #1595: source assertions for context.ts, attachments.ts, queryHelpers.ts', () => {
    const ctxSrc = readFileSync(join(srcRoot, 'context.ts'), 'utf8')
    expect(ctxSrc).toContain('tengu_prancy_pebble')
    expect(ctxSrc).toContain('User-Agent')

    const attSrc = readFileSync(join(srcRoot, 'utils/attachments.ts'), 'utf8')
    expect(attSrc).toContain('rereadEntry')
    expect(attSrc).not.toContain("result.data.type === 'file_unchanged'")

    const qhSrc = readFileSync(join(srcRoot, 'utils/queryHelpers.ts'), 'utf8')
    expect(qhSrc).toContain('FILE_UNCHANGED_STUB')
    expect(qhSrc).toContain('rereadEntry')
  })
})
