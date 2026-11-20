import { APIError } from '@anthropic-ai/sdk'
import { describe, expect, test } from 'bun:test'
import { isEffortUnsupported } from '../../../bootstrap/state.js'
import { query } from '../../../query.js'
import type { ToolUseContext } from '../../../Tool.js'
import { asAgentId } from '../../../types/ids.js'
import type { AssistantMessage, Message } from '../../../types/message.js'
import type { CacheSafeParams } from '../../../utils/forkedAgent.js'
import { asSystemPrompt } from '../../../utils/systemPromptType.js'
import {
  getMaxThinkingTokensForModel,
  getModelMaxOutputTokensDetailed,
  isUnrecognizedModelMaxOutputTokensAssumed,
  resolveOutputTokenLimitForContinuation,
  UNRECOGNIZED_MODEL_CONTINUATION_MAX_OUTPUT_TOKENS,
  UNRECOGNIZED_MODEL_DEFAULT_MAX_OUTPUT_TOKENS,
} from '../../../utils/context.js'
import {
  getModelClientDataWaitTimeoutMs,
  MODEL_CLIENT_DATA_WAIT_INTERACTIVE_MS,
  MODEL_CLIENT_DATA_WAIT_PRINT_MS,
  resolveModelFacts,
  waitForSubagentModelSettings,
} from '../../../utils/model/modelFacts.js'
import { getProxyFetchOptions } from '../../../utils/proxy.js'
import { resolveRaisedConnectionIdleTimeoutMs } from '../../../utils/streamWatchdogGates.js'
import { classifyEffortUnsupportedRetry } from '../../../utils/thinking.js'
import { buildShortSummaryNotes } from '../../AgentSummary/summaryContext.js'
import {
  resolveAgentSummaryMode,
  resolveSummaryWriterModel,
  sanitizeAgentSummaryReply,
  startAgentSummarization,
} from '../../AgentSummary/agentSummary.js'
import {
  createAsyncAgentAttachmentsIfNeeded,
  formatCompletedSubagentCompactReminder,
} from '../../compact/compact.js'
import { groupMessagesByApiRound } from '../../compact/grouping.js'
import {
  formatCompactSummary,
  hasCompactSummaryTag,
  hasUnclosedCompactSummaryTag,
} from '../../compact/prompt.js'
import {
  canOmitToolResultsToRecoverPTL,
  computePtlRecoveryTimeoutMs,
  createPtlRecoveryAbortController,
  isThirdPartyDesktopLargeToolResultOmissionEnabled,
  omitLargestToolResultsForSummary,
  TOOL_RESULT_LEFT_OUT_PREFIX,
} from '../../compact/reactiveCompact.js'
import {
  computeManagedSettingsChecksum,
  extractBillingGroupTagFromJwt,
  getBillingGroupRequestTags,
  getManagedSettingsChecksumHeader,
  MANAGED_SETTINGS_CHECKSUM_HEADER,
  resolveAttributionProject,
} from '../client.js'
import {
  EXTRA_USAGE_OUT_OF_CREDITS_CODE,
  getAssistantMessageFromError,
  isExtraUsageOutOfCreditsError,
} from '../errors.js'

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString(
    'base64url',
  )
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.sig`
}

describe('Wave 327-328 API, Compact & AgentSummary', () => {
  describe('#373 x-claude-code-managed-settings-checksum gateway hint header', () => {
    test('computes deterministic canonical sha256 checksum regardless of key order', () => {
      const a = computeManagedSettingsChecksum({
        z: 1,
        a: { d: 2, b: [3, { y: 4, x: 5 }] },
      })
      const b = computeManagedSettingsChecksum({
        a: { b: [3, { x: 5, y: 4 }], d: 2 },
        z: 1,
      })
      expect(a).toBe(b)
      expect(a).toMatch(/^sha256:[0-9a-f]{64}$/)
    })

    test('emits header for gateway or custom base URL when managed settings set CLAUDE_CODE_GATEWAY_HINT_HEADERS=1', () => {
      const policy = {
        env: { CLAUDE_CODE_GATEWAY_HINT_HEADERS: '1' },
        maxEffortLevel: 'high',
      }
      const expected = computeManagedSettingsChecksum(policy)

      expect(
        getManagedSettingsChecksumHeader({
          provider: 'gateway',
          env: { CLAUDE_CODE_GATEWAY_HINT_HEADERS: '1' },
          policySettings: policy,
        }),
      ).toEqual({ [MANAGED_SETTINGS_CHECKSUM_HEADER]: expected })

      expect(
        getManagedSettingsChecksumHeader({
          provider: 'firstParty',
          env: {
            ANTHROPIC_BASE_URL: 'https://llm-gw.corp.internal',
            CLAUDE_CODE_GATEWAY_HINT_HEADERS: '1',
          },
          policySettings: policy,
        }),
      ).toEqual({ [MANAGED_SETTINGS_CHECKSUM_HEADER]: expected })
    })

    test('omits header on direct first-party API, unix socket, or when policy does not set hint env', () => {
      const policy = { env: { CLAUDE_CODE_GATEWAY_HINT_HEADERS: '1' } }

      expect(
        getManagedSettingsChecksumHeader({
          provider: 'firstParty',
          env: { CLAUDE_CODE_GATEWAY_HINT_HEADERS: '1' },
          policySettings: policy,
        }),
      ).toEqual({})

      expect(
        getManagedSettingsChecksumHeader({
          provider: 'gateway',
          env: {
            CLAUDE_CODE_GATEWAY_HINT_HEADERS: '1',
            ANTHROPIC_UNIX_SOCKET: '/tmp/ssh.sock',
          },
          policySettings: policy,
        }),
      ).toEqual({})

      expect(
        getManagedSettingsChecksumHeader({
          provider: 'gateway',
          env: { CLAUDE_CODE_GATEWAY_HINT_HEADERS: '1' },
          policySettings: { env: {} },
        }),
      ).toEqual({})
    })
  })

  describe('#374 attributionProject billing group tag', () => {
    test('extracts billing_group_tag from JWT payload', () => {
      expect(
        extractBillingGroupTagFromJwt(
          makeJwt({ billing_group_tag: 'cost_center' }),
        ),
      ).toBe('cost_center')
      expect(
        extractBillingGroupTagFromJwt(makeJwt({ sub: 'u1' })),
      ).toBeUndefined()
      expect(extractBillingGroupTagFromJwt('not-a-jwt')).toBeUndefined()
    })

    test('resolves attributionProject in cascade order and emits request tags', () => {
      const res = resolveAttributionProject({
        env: {},
        getSourceSettings: src => {
          if (src === 'projectSettings')
            return { attributionProject: 'team-alpha' }
          if (src === 'policySettings') {
            return { attributionProjectPolicy: { default: 'default-group' } }
          }
          return null
        },
      })
      expect(res).toEqual({ written: 'team-alpha', source: 'projectSettings' })

      const jwt = makeJwt({ billing_group_tag: 'billing_group' })
      expect(
        getBillingGroupRequestTags({
          jwt,
          env: {},
          getSourceSettings: src =>
            src === 'policySettings'
              ? { attributionProjectPolicy: { default: 'org-default' } }
              : null,
        }),
      ).toEqual({ tags: { billing_group: 'org-default' } })

      expect(
        getBillingGroupRequestTags({
          jwt: makeJwt({ sub: 'user-1' }),
          env: { CLAUDE_CODE_ATTRIBUTION_PROJECT: 'proj-1' },
        }),
      ).toEqual({})
    })
  })

  describe('#394 groupMessagesByApiRound after max_output_tokens cut', () => {
    test('keeps synthetic error message inside group when tool_use is still unanswered', () => {
      const messages = [
        {
          type: 'user',
          uuid: 'u1',
          message: { role: 'user', content: 'run it' },
        },
        {
          type: 'assistant',
          uuid: 'a1',
          message: {
            id: 'msg_1',
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} },
            ],
          },
        },
        {
          type: 'assistant',
          uuid: 'a1_err',
          isApiErrorMessage: true,
          message: {
            id: 'msg_err_1',
            model: '<synthetic>',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hit max_output_tokens' }],
          },
        },
        {
          type: 'user',
          uuid: 'u2',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' },
            ],
          },
        },
        {
          type: 'assistant',
          uuid: 'a2',
          message: {
            id: 'msg_2',
            role: 'assistant',
            content: [{ type: 'text', text: 'Done' }],
          },
        },
      ] as unknown as Message[]

      const groups = groupMessagesByApiRound(messages)
      expect(groups).toHaveLength(3)
      expect(groups[0]!.map(m => String(m.uuid))).toEqual(['u1'])
      expect(groups[1]!.map(m => String(m.uuid))).toEqual([
        'a1',
        'a1_err',
        'u2',
      ])
      expect(groups[2]!.map(m => String(m.uuid))).toEqual(['a2'])
    })
  })

  describe('#402 & #523 model client data wait timeout (1.5s interactive / 10s print)', () => {
    test('uses 1500ms interactive and 10000ms non-interactive timeouts', () => {
      expect(getModelClientDataWaitTimeoutMs(false)).toBe(
        MODEL_CLIENT_DATA_WAIT_INTERACTIVE_MS,
      )
      expect(getModelClientDataWaitTimeoutMs(true)).toBe(
        MODEL_CLIENT_DATA_WAIT_PRINT_MS,
      )
      expect(MODEL_CLIENT_DATA_WAIT_INTERACTIVE_MS).toBe(1500)
      expect(MODEL_CLIENT_DATA_WAIT_PRINT_MS).toBe(10000)
    })

    test('continues without hanging when fetch stalls past timeout or aborts', async () => {
      const neverResolving = new Promise<void>(() => {})
      const t0 = performance.now()
      const facts = await resolveModelFacts('claude-sonnet-4-5', undefined, {
        timeoutMs: 25,
        inflightFetchOverride: neverResolving,
      })
      const elapsed = performance.now() - t0
      expect(facts.model).toBe('claude-sonnet-4-5')
      expect(elapsed).toBeLessThan(500)

      const ac = new AbortController()
      setTimeout(() => ac.abort(), 10)
      const subagentFacts = await waitForSubagentModelSettings(
        'claude-sonnet-4-5',
        { abortController: ac },
        { timeoutMs: 5000, inflightFetchOverride: neverResolving },
      )
      expect(subagentFacts.model).toBe('claude-sonnet-4-5')
    })
  })

  describe('#407 linear-time compact summary tag extraction', () => {
    test('strips analysis and formats summary without regex backtracking on large unclosed tags', () => {
      expect(
        formatCompactSummary(
          '<analysis>draft</analysis>\n<summary>\nFinal\n</summary>',
        ),
      ).toBe('Summary:\nFinal')
      expect(
        hasCompactSummaryTag('<analysis>x</analysis><summary>ok</summary>'),
      ).toBe(true)
      expect(hasUnclosedCompactSummaryTag('  <summary>\nstill going')).toBe(
        true,
      )

      const pathological =
        '<analysis>' + 'a'.repeat(100_000) + '<summary>' + 'b'.repeat(100_000)
      const start = performance.now()
      const formatted = formatCompactSummary(pathological)
      const elapsed = performance.now() - start
      expect(formatted.length).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(100)
    })
  })

  describe('#481 unrecognized model continuation 32,000 -> 128,000 output tokens', () => {
    test('defaults to 32k, raises to 128k on continuation, keeps thinking budget < 32k', () => {
      const model = 'custom-gateway-future-model-v9'
      const details = getModelMaxOutputTokensDetailed(model)
      expect(details.default).toBe(UNRECOGNIZED_MODEL_DEFAULT_MAX_OUTPUT_TOKENS)
      expect(details.upperLimit).toBe(
        UNRECOGNIZED_MODEL_CONTINUATION_MAX_OUTPUT_TOKENS,
      )
      expect(details.isAssumed).toBe(true)
      expect(isUnrecognizedModelMaxOutputTokensAssumed(model, {})).toBe(true)
      expect(getMaxThinkingTokensForModel(model)).toBe(31_999)

      expect(
        resolveOutputTokenLimitForContinuation({
          model,
          requestedMaxTokens: 32_000,
          continuesCutReply: true,
          env: {},
        }),
      ).toBe(128_000)

      expect(
        resolveOutputTokenLimitForContinuation({
          model,
          requestedMaxTokens: 32_000,
          continuesCutReply: true,
          cachedModelCeiling: 64_000,
          env: {},
        }),
      ).toBe(64_000)

      expect(
        resolveOutputTokenLimitForContinuation({
          model,
          requestedMaxTokens: 32_000,
          continuesCutReply: false,
          env: {},
        }),
      ).toBe(32_000)
    })
  })

  describe('#482 completed subagent reminder after compaction', () => {
    test('tells Claude to ask the agent with SendMessage if output file cannot be read', () => {
      const withFile = formatCompletedSubagentCompactReminder({
        taskId: 'agent-42',
        status: 'completed',
        outputFilePath: '/tmp/agent-42.output',
        canContinueAgent: true,
        shimmeringClockEnabled: true,
      })
      expect(withFile).toBe(
        'Read the output file to retrieve the result: /tmp/agent-42.output (if you cannot read it and do not already have its result, ask agent agent-42 with SendMessage)',
      )

      const withoutFile = formatCompletedSubagentCompactReminder({
        taskId: 'agent-42',
        status: 'completed',
        canContinueAgent: true,
      })
      expect(withoutFile).toBe(
        'Send it a message with SendMessage to retrieve its result.',
      )
    })
  })

  describe('#526, #675 & #570 AgentSummary short notes + small fast model + leavesEffortSupportAlone', () => {
    test('uses short notes on Bedrock/Vertex/Foundry (own model) and Anthropic API (small fast model, also with telemetry off)', () => {
      for (const provider of ['bedrock', 'vertex', 'foundry'] as const) {
        const decision = resolveAgentSummaryMode({ provider })
        expect(decision).toEqual({ mode: 'short', source: 'release' })
        expect(
          resolveSummaryWriterModel({
            decision,
            agentModel: 'us.anthropic.claude-sonnet-4-5',
          }),
        ).toBe('us.anthropic.claude-sonnet-4-5')
      }

      const firstPartyNoTelemetry = resolveAgentSummaryMode({
        provider: 'firstParty',
        flagValue: null,
      })
      expect(firstPartyNoTelemetry).toEqual({
        mode: 'short',
        source: 'default',
      })
      expect(
        resolveSummaryWriterModel({
          decision: firstPartyNoTelemetry,
          agentModel: 'claude-opus-4-6',
          getSmallFastModelImpl: () => 'claude-haiku-4-5-20251001',
        }),
      ).toBe('claude-haiku-4-5-20251001')
    })

    test('builds XML short notes and runs short-notes summary with leavesEffortSupportAlone: true', async () => {
      const messages = [
        {
          type: 'user',
          uuid: 'u1',
          message: { role: 'user', content: 'Fix auth' },
        },
        {
          type: 'assistant',
          uuid: 'a1',
          message: {
            id: 'm1',
            role: 'assistant',
            content: [
              { type: 'text', text: 'Checking validate.ts' },
              {
                type: 'tool_use',
                id: 't1',
                name: 'Read',
                input: { file_path: 'src/validate.ts' },
              },
            ],
          },
        },
        {
          type: 'user',
          uuid: 'u2',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
            ],
          },
        },
      ] as unknown as Message[]

      const notes = buildShortSummaryNotes({
        task: 'Fix auth null check',
        messages,
      })
      expect(notes).toContain('<task>')
      expect(notes).toContain('<recent_steps>')
      expect(notes).toContain('did: Read - src/validate.ts')

      expect(
        sanitizeAgentSummaryReply('<label>Reading `validate.ts`</label>', true),
      ).toBe('Reading validate.ts')

      let timerCb: (() => Promise<void>) | undefined
      const receivedReqs: Array<{
        model: string
        leavesEffortSupportAlone: boolean
      }> = []
      const updated: string[] = []

      const handle = startAgentSummarization(
        'task-short',
        asAgentId('a000000000000001'),
        {
          model: 'claude-opus-4-6',
          toolUseContext: { options: { mainLoopModel: 'claude-opus-4-6' } },
        } as unknown as CacheSafeParams,
        () => undefined,
        {
          provider: 'firstParty',
          getSmallFastModel: () => 'claude-haiku-4-5',
          taskDescription: 'Fix auth null check',
          getAgentTranscript: async () => ({
            messages,
            contentReplacements: [],
          }),
          runShortNotesSummary: async req => {
            receivedReqs.push({
              model: req.model,
              leavesEffortSupportAlone: req.leavesEffortSupportAlone,
            })
            return [
              {
                type: 'assistant',
                message: {
                  content: [
                    { type: 'text', text: 'Fixing null check in validate.ts' },
                  ],
                },
              } as unknown as AssistantMessage,
            ]
          },
          updateAgentSummary: (_id, summary) => {
            updated.push(summary)
          },
          setTimeout: ((cb: TimerHandler) => {
            timerCb = cb as () => Promise<void>
            return 1 as unknown as ReturnType<typeof setTimeout>
          }) as unknown as typeof setTimeout,
          clearTimeout: () => {},
        },
      )

      await timerCb!()
      handle.stop()

      expect(receivedReqs).toEqual([
        { model: 'claude-haiku-4-5', leavesEffortSupportAlone: true },
      ])
      expect(updated).toEqual(['Fixing null check in validate.ts'])
    })

    test('#570 leavesEffortSupportAlone retries without disabling effort globally for the model', () => {
      const modelId = `us.anthropic.claude-sonnet-4-5-w328-${Date.now()}`
      const err = new APIError(
        400,
        {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'The effort parameter is not supported for this model',
          },
        },
        'The effort parameter is not supported for this model',
        new Headers(),
      )

      const token = classifyEffortUnsupportedRetry(err, {
        model: modelId,
        leavesEffortSupportAlone: true,
      })
      expect(token).toBe('retry:effort-unsupported')
      expect(isEffortUnsupported(modelId)).toBe(false)

      const token2 = classifyEffortUnsupportedRetry(err, {
        model: modelId,
        leavesEffortSupportAlone: false,
      })
      expect(token2).toBe('retry:effort-unsupported')
      expect(isEffortUnsupported(modelId)).toBe(true)
    })
  })

  describe('#555 autocompact rebuilds systemPrompt like /compact', () => {
    test('invokes renderSystemPrompt after autocompact and sends rebuilt prompt to callModel', async () => {
      const seenSystemPrompts: string[][] = []
      let renderCalls = 0
      const toolUseContext = {
        abortController: new AbortController(),
        options: {
          commands: [],
          debug: false,
          tools: [],
          verbose: false,
          mainLoopModel: 'claude-sonnet-4-5-20250929',
          thinkingConfig: { type: 'disabled' },
          isNonInteractiveSession: true,
          mcpClients: [],
          mcpResources: {},
          maxThinkingTokens: 0,
          agentDefinitions: { activeAgents: [], allAgents: [] },
        },
        getAppState: () => ({
          toolPermissionContext: {
            mode: 'default',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          },
          fastMode: false,
          effortValue: undefined,
          advisorModel: undefined,
          sessionHooks: new Map(),
          tasks: {},
          mcp: { clients: [], tools: [], commands: [], resources: {} },
          attribution: { commit: '', pr: '' },
          fileHistory: { snapshots: [], trackedFiles: new Set() },
          agentDefinitions: { activeAgents: [], allAgents: [] },
        }),
        setAppState: () => {},
        readFileState: new Map(),
        setInProgressToolUseIDs: () => {},
        setResponseLength: () => {},
        renderedSystemPrompt: undefined,
      } as unknown as ToolUseContext

      const gen = query({
        messages: [
          {
            type: 'user',
            uuid: 'u-init',
            message: { role: 'user', content: 'hello' },
          } as unknown as Message,
        ],
        systemPrompt: asSystemPrompt(['OLD_SYSTEM_PROMPT']),
        userContext: {},
        systemContext: {},
        canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
        toolUseContext,
        querySource: 'sdk',
        maxTurns: 1,
        renderSystemPrompt: async () => {
          renderCalls += 1
          return asSystemPrompt(['REBUILT_SYSTEM_PROMPT'])
        },
        deps: {
          uuid: () =>
            '00000000-0000-4000-8000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
          microcompact: async (msgs: Message[]) => ({ messages: msgs }),
          autocompact: async () => ({
            wasCompacted: true,
            compactionResult: {
              boundaryMarker: {
                type: 'system',
                subtype: 'compact_boundary',
                uuid: 'cb-1',
                content: 'Conversation compacted',
                isMeta: false,
                level: 'info',
                timestamp: new Date().toISOString(),
                compactMetadata: { trigger: 'auto', preTokens: 100000 },
              } as unknown as Message,
              summaryMessages: [
                {
                  type: 'user',
                  uuid: 'sum-1',
                  isCompactSummary: true,
                  message: { role: 'user', content: 'Summary text' },
                } as unknown as Message,
              ],
              attachments: [],
              hookResults: [],
              preCompactTokenCount: 100000,
              postCompactTokenCount: 1000,
            } as unknown as import('../../compact/compact.js').CompactionResult,
          }),
          callModel: async function* (args: {
            systemPrompt: readonly string[]
          }) {
            seenSystemPrompts.push([...args.systemPrompt])
            yield {
              type: 'assistant',
              uuid: 'a-final',
              message: {
                id: 'msg-final',
                type: 'message',
                role: 'assistant',
                model: 'claude-sonnet-4-5',
                content: [{ type: 'text', text: 'All set!' }],
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: {
                  input_tokens: 10,
                  output_tokens: 5,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0,
                },
              },
            } as unknown as AssistantMessage
          },
        } as unknown as import('../../../query.js').QueryParams['deps'],
      })

      for await (const _ev of gen) {
        // drain
      }

      expect(renderCalls).toBe(1)
      expect(seenSystemPrompts).toEqual([['REBUILT_SYSTEM_PROMPT']])
    })
  })

  describe('#564 mid-response usage credits exhausted error', () => {
    test('reports usage credits ran out instead of rate limit when status is undefined', () => {
      const midStreamErr = new APIError(
        undefined,
        {
          type: 'error',
          error: {
            type: 'rate_limit_error',
            code: EXTRA_USAGE_OUT_OF_CREDITS_CODE,
            message: 'You are out of extra usage credits',
          },
        },
        'extra_usage_out_of_credits',
        new Headers(),
      )
      expect(isExtraUsageOutOfCreditsError(midStreamErr)).toBe(true)

      const msg = getAssistantMessageFromError(
        midStreamErr,
        'claude-sonnet-4-5',
      )
      const text =
        Array.isArray(msg.message.content) &&
        msg.message.content[0]?.type === 'text'
          ? msg.message.content[0].text
          : ''
      expect(text).toBe(
        'API Error: Usage credits ran out before the response was finished.',
      )
      expect(msg.error).toBe('unknown')
    })
  })

  describe('#566 CLAUDE_STREAM_IDLE_TIMEOUT_MS lengthens 5-min connection limit', () => {
    test('computes raised connection timeout > 300s clamped to 30m and wires fetchOptions.timeout', () => {
      expect(resolveRaisedConnectionIdleTimeoutMs({})).toBeUndefined()
      expect(
        resolveRaisedConnectionIdleTimeoutMs({
          CLAUDE_STREAM_IDLE_TIMEOUT_MS: '300000',
        }),
      ).toBeUndefined()
      expect(
        resolveRaisedConnectionIdleTimeoutMs({
          CLAUDE_STREAM_IDLE_TIMEOUT_MS: '900000',
        }),
      ).toBe(900_000)
      expect(
        resolveRaisedConnectionIdleTimeoutMs({
          CLAUDE_STREAM_IDLE_TIMEOUT_MS: '9999999',
        }),
      ).toBe(1_800_000)

      const optsNoWatchdog = getProxyFetchOptions({
        forAnthropicAPI: true,
        hasBodyIdleWatchdog: false,
        raisedBodyIdleTimeoutMs: 900_000,
      })
      expect(optsNoWatchdog.timeout).toBe(900_000)

      const optsWithWatchdog = getProxyFetchOptions({
        forAnthropicAPI: true,
        hasBodyIdleWatchdog: true,
        raisedBodyIdleTimeoutMs: 900_000,
      })
      expect(optsWithWatchdog.timeout).toBe(false)
    })
  })

  describe('#567 3P Desktop PTL large tool-result omission', () => {
    test('gates on 3P Desktop non-scheduled sessions and omits largest tool results', () => {
      expect(
        isThirdPartyDesktopLargeToolResultOmissionEnabled({
          env: {
            CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
            CLAUDE_CODE_ENTRYPOINT: 'claude-desktop-3p',
          },
          provider: 'bedrock',
        }),
      ).toBe(true)

      expect(
        isThirdPartyDesktopLargeToolResultOmissionEnabled({
          env: {
            CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
            CLAUDE_CODE_ENTRYPOINT: 'claude-desktop-3p',
            CLAUDE_CODE_HOST_SCHEDULED_RUN: '1',
          },
          provider: 'bedrock',
        }),
      ).toBe(false)

      const msgs = [
        {
          type: 'user',
          uuid: 'u1',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'small', content: 'tiny' },
              {
                type: 'tool_result',
                tool_use_id: 'huge',
                content: 'x'.repeat(60_000),
              },
            ],
          },
        },
      ] as unknown as Message[]

      expect(
        canOmitToolResultsToRecoverPTL(msgs, {
          env: {
            CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
            CLAUDE_CODE_ENTRYPOINT: 'claude-desktop-3p',
          },
          provider: 'vertex',
        }),
      ).toBe(true)

      const res = omitLargestToolResultsForSummary(msgs, { tokenGap: 10_000 })
      expect(res).not.toBeNull()
      expect(res!.leftOutIds).toEqual(['huge'])
      const content = (
        res!.messages[0] as {
          message: { content: Array<{ tool_use_id: string; content: string }> }
        }
      ).message.content
      expect(content.find(b => b.tool_use_id === 'small')?.content).toBe('tiny')
      expect(content.find(b => b.tool_use_id === 'huge')?.content).toStartWith(
        TOOL_RESULT_LEFT_OUT_PREFIX,
      )
    })
  })

  describe('#625 agent hook timeout aborts PTL recovery compaction immediately', () => {
    test('propagates parent timeout abort (with default reason) to recovery controller', () => {
      const parent = new AbortController()
      const { controller, cleanup } = createPtlRecoveryAbortController(parent, {
        timeoutMs: 60_000,
        querySource: 'hook_agent',
      })
      expect(controller.signal.aborted).toBe(false)
      // Agent hook timeout calls abort() with no user-cancel reason
      parent.abort()
      expect(controller.signal.aborted).toBe(true)
      cleanup()
    })

    test('clamps PTL recovery timeout between 10m and 60m', () => {
      expect(computePtlRecoveryTimeoutMs(10_000)).toBe(600_000)
      expect(computePtlRecoveryTimeoutMs(1_000_000)).toBe(1_500_000)
      expect(computePtlRecoveryTimeoutMs(10_000_000)).toBe(3_600_000)
    })

    test('#567 regression: local-agent with undefined CLAUDE_CODE_DESKTOP_APP_VERSION enables 3P Desktop omission', () => {
      expect(
        isThirdPartyDesktopLargeToolResultOmissionEnabled({
          env: {
            CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
            CLAUDE_CODE_ENTRYPOINT: 'local-agent',
            // CLAUDE_CODE_DESKTOP_APP_VERSION intentionally undefined
          },
          provider: 'bedrock',
        }),
      ).toBe(true)
      expect(
        isThirdPartyDesktopLargeToolResultOmissionEnabled({
          env: {
            CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
            CLAUDE_CODE_ENTRYPOINT: 'local-agent',
            CLAUDE_CODE_DESKTOP_APP_VERSION: '1.2.3',
          },
          provider: 'bedrock',
        }),
      ).toBe(false)
    })

    test('#482 regression: createAsyncAgentAttachmentsIfNeeded persists canContinueAgent: false explicitly', async () => {
      const fakeContext = {
        agentId: undefined,
        options: {
          tools: [{ name: 'Read' }],
        },
        getAppState: () => ({
          tasks: {
            'agent-no-sm': {
              type: 'local_agent',
              agentId: 'agent-no-sm',
              description: 'Read-only worker',
              status: 'completed',
              retrieved: false,
            },
          },
        }),
      } as unknown as ToolUseContext
      const attachments = await createAsyncAgentAttachmentsIfNeeded(fakeContext)
      expect(attachments).toHaveLength(1)
      const att = attachments[0]!.attachment as {
        type: string
        canContinueAgent?: boolean
      }
      expect(att.type).toBe('task_status')
      expect(att.canContinueAgent).toBe(false)

      const reminderWithoutSendMessage = formatCompletedSubagentCompactReminder(
        {
          taskId: 'agent-no-sm',
          status: 'completed',
          outputFilePath: '/tmp/out.txt',
          canContinueAgent: att.canContinueAgent,
        },
      )
      expect(reminderWithoutSendMessage).not.toContain('SendMessage')
    })
  })
})
