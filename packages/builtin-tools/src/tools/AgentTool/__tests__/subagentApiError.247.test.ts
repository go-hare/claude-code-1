/**
 * densable 2.1.247 #7 — tss() parent formatter + l2e termination.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { mock, describe, expect, test } from 'bun:test'
import { debugMock } from '../../../../../../tests/mocks/debug'
import { bunBundleMock } from '../../../../../../tests/mocks/bunBundle.js'
import { analyticsMock } from '../../../../../../tests/mocks/analytics.js'

mock.module('bun:bundle', bunBundleMock)
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/services/analytics/index.js', analyticsMock)

const { formatApiErrorForParent } = await import('../agentToolUtils.js')
const { AgentApiErrorTerminationError } = await import('src/utils/errors.js')

// Only the fields tss() reads; the full Message shape is irrelevant here.
type ApiErrorMessage = Parameters<typeof formatApiErrorForParent>[0]

function apiErrorAssistant(opts: {
  text: string
  error?: string
  apiErrorStatus?: number
  requestId?: string
}): ApiErrorMessage {
  return {
    type: 'assistant' as const,
    uuid: 'a1',
    isApiErrorMessage: true,
    error: opts.error,
    apiErrorStatus: opts.apiErrorStatus,
    requestId: opts.requestId,
    message: {
      content: [{ type: 'text' as const, text: opts.text }],
    },
  } as unknown as ApiErrorMessage
}

describe('densable 2.1.247 #7 tss / l2e', () => {
  test('tss joins error type, HTTP status, request id, and model', () => {
    const formatted = formatApiErrorForParent(
      apiErrorAssistant({
        text: 'The model is not available',
        error: 'model_not_found',
        apiErrorStatus: 404,
        requestId: 'req_247',
      }),
      'claude-sonnet-4-6',
    )
    expect(formatted).toBe(
      'The model is not available (error type model_not_found, HTTP 404, request id req_247, model sent to the API: claude-sonnet-4-6)',
    )
  })

  test('tss omits model when status and request id are absent', () => {
    const formatted = formatApiErrorForParent(
      apiErrorAssistant({
        text: 'overloaded',
        error: 'overloaded',
      }),
      'claude-sonnet-4-6',
    )
    expect(formatted).toBe('overloaded (error type overloaded)')
  })

  test('l2e user message includes tss detail; telemetry stays generic', () => {
    const err = new AgentApiErrorTerminationError(
      'The model is not available (error type model_not_found, HTTP 404, request id req_247, model sent to the API: claude-sonnet-4-6)',
      'model_not_found',
    )
    expect(err.name).toBe('AgentApiErrorTerminationError')
    expect(err.errorKind).toBe('model_not_found')
    expect(err.message).toBe(
      'Agent terminated early due to an API error: The model is not available (error type model_not_found, HTTP 404, request id req_247, model sent to the API: claude-sonnet-4-6)',
    )
    expect(err.telemetryMessage).toBe(
      'Agent terminated early due to an API error',
    )
  })

  test('runAgent passes flattened options.fallbackModel into query()', () => {
    const src = readFileSync(join(import.meta.dir, '../runAgent.ts'), 'utf8')
    expect(src).toContain('fallbackModel: firstFallbackModel(')
    expect(src).toContain('toolUseContext.options.fallbackModel')
  })

  test('both hosts populate options.fallbackModel, not just headless', () => {
    const repo = join(import.meta.dir, '../../../../../..')
    // densable `_buildToolUseContextWith` destructures fallbackModel, so the
    // interactive host has to supply it too or --fallback-model is headless-only.
    const repl = readFileSync(join(repo, 'src/screens/REPL.tsx'), 'utf8')
    const options = repl.slice(
      repl.indexOf('isNonInteractiveSession: false') - 2000,
      repl.indexOf('isNonInteractiveSession: false'),
    )
    expect(options).toContain('fallbackModel,')

    const main = readFileSync(join(repo, 'src/main.tsx'), 'utf8')
    const sessionConfig = main.slice(
      main.indexOf('const sessionConfig = {'),
      main.indexOf('const resumeContext = {'),
    )
    expect(sessionConfig).toContain('fallbackModel: userSpecifiedFallbackModel')

    const engine = readFileSync(join(repo, 'src/QueryEngine.ts'), 'utf8')
    expect(engine).toContain('fallbackModel,')
  })

  test('async lifecycle throws l2e(tss()) on last assistant API error', () => {
    const src = readFileSync(
      join(import.meta.dir, '../agentToolUtils.ts'),
      'utf8',
    )
    expect(src).toContain('tengu_api_subagent_model_not_found')
    expect(src).toContain('new AgentApiErrorTerminationError(')
    expect(src).toContain('formatApiErrorForParent(lastAssistant, model)')
  })
})
