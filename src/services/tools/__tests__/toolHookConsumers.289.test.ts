import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { runInNewContext } from 'vm'
import { createAttachmentMessage } from '../../../utils/attachments.js'
import { createUserMessage } from '../../../utils/messages.js'
import { isMcpTool } from '../../mcp/utils.js'

const transpiler = new Bun.Transpiler({ loader: 'ts' })
const hooksSource = readFileSync(
  new URL('../toolHooks.ts', import.meta.url),
  'utf8',
)
const executionSource = readFileSync(
  new URL('../toolExecution.ts', import.meta.url),
  'utf8',
)

function postHookConsumer(results: Record<string, unknown>[]) {
  const body = hooksSource
    .slice(
      hooksSource.indexOf('export async function* runPostToolUseHooks<'),
      hooksSource.indexOf('export async function* runPostToolUseFailureHooks<'),
    )
    .replace('export ', '')
  let dispatchArgs: unknown[] = []
  const consume = runInNewContext(
    transpiler.transformSync(body) + '\nrunPostToolUseHooks',
    {
      executePostToolHooks: async function* (...args: unknown[]) {
        dispatchArgs = args
        yield* results
      },
      createAttachmentMessage,
      isMcpTool,
      logEvent: () => {},
      logError: () => {},
      logForDebugging: () => {},
      sanitizeToolNameForAnalytics: (name: string) => name,
      formatError: String,
    },
  )
  return { consume, args: () => dispatchArgs }
}

const context = {
  options: {},
  getAppState: () => ({ toolPermissionContext: { mode: 'auto' } }),
  abortController: new AbortController(),
}

async function drain(generator: AsyncGenerator): Promise<any[]> {
  const results = []
  for await (const result of generator) results.push(result)
  return results
}

describe('PostToolUse actual host wrapper', () => {
  test('all falsey generic MCP rewrites reach the output consumer', async () => {
    for (const value of [null, false, 0, '']) {
      const wrapper = postHookConsumer([{ updatedToolOutput: value }])
      const results = await drain(
        wrapper.consume(
          context,
          { name: 'mcp__server__tool', isMcp: true },
          'call',
          'message',
          {},
          { text: 'original' },
          undefined,
          'sdk',
          undefined,
          45,
        ),
      )
      expect(results).toEqual([{ updatedToolOutput: value }])
      expect(wrapper.args()[8]).toBe(45)
    }
  })

  test('rewrites precede contexts and hooks observe the original result', async () => {
    const original = { text: 'original' }
    const wrapper = postHookConsumer([
      { updatedToolOutput: { text: 'rewrite' } },
      {
        classifierContexts: [{ value: 'assertion', hostPrincipal: true }],
        pairedRewrite: 'direct',
      },
    ])
    const results = await drain(
      wrapper.consume(
        context,
        { name: 'Fixture' },
        'call',
        'message',
        {},
        original,
        undefined,
        undefined,
        undefined,
        45,
      ),
    )
    expect(wrapper.args()[3]).toBe(original)
    expect(results).toEqual([
      { updatedToolOutput: { text: 'rewrite' } },
      {
        classifierContext: { value: 'assertion', hostPrincipal: true },
        pairing: 'pending',
      },
    ])
  })

  test('legacy suppressed and non-MCP rewrites never claim an applied pairing', async () => {
    for (const pairedRewrite of ['suppressed', 'legacy_mcp']) {
      const wrapper = postHookConsumer([
        {
          pairedRewrite,
          classifierContexts: [{ value: 'context', hostPrincipal: true }],
        },
      ])
      const results = await drain(
        wrapper.consume(
          context,
          { name: 'Fixture' },
          'call',
          'message',
          {},
          {},
          undefined,
        ),
      )
      expect(results[0].pairing).toBe('never-applied')
    }
  })

  test('account memory rejects rewrites while preserving independent assertions', async () => {
    const wrapper = postHookConsumer([
      { updatedToolOutput: 'rewrite' },
      {
        pairedRewrite: 'none',
        classifierContexts: [{ value: 'independent', hostPrincipal: false }],
      },
    ])
    const results = await drain(
      wrapper.consume(
        context,
        {
          name: 'mcp__memory__read',
          isMcp: true,
          mcpInfo: { accountMemory: true },
        },
        'call',
        'message',
        {},
        'original',
        undefined,
      ),
    )
    expect(results).toEqual([
      {
        classifierContext: { value: 'independent', hostPrincipal: false },
        pairing: 'none',
      },
    ])
  })
})

describe('PostToolUseFailure actual host wrapper', () => {
  test('passes actual execution duration after the timeout argument', async () => {
    const start = hooksSource.indexOf(
      'export async function* runPostToolUseFailureHooks<',
    )
    const end = hooksSource.indexOf('\n/**', start)
    let captured: unknown[] = []
    const consume = runInNewContext(
      transpiler.transformSync(
        hooksSource.slice(start, end).replace('export ', ''),
      ) + '\nrunPostToolUseFailureHooks',
      {
        executePostToolUseFailureHooks: async function* (...args: unknown[]) {
          captured = args
          yield* []
        },
        logError: () => {},
      },
    )
    await drain(
      consume(
        context,
        { name: 'Fixture' },
        'call',
        'message',
        {},
        'failed',
        false,
        undefined,
        undefined,
        undefined,
        78,
      ),
    )
    expect(captured[8]).toBeUndefined()
    expect(captured[9]).toBe(78)
  })
})

describe('PermissionDenied actual retry consumer', () => {
  test('hook retry cannot turn a no-verdict denial into retry guidance', async () => {
    const start = executionSource.indexOf(
      '    // If a hook returns {retry: true}',
    )
    const end = executionSource.indexOf('\n    return resultingMessages', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const body = executionSource.slice(start, end)
    for (const noVerdict of [true, false, undefined]) {
      const messages: unknown[] = []
      const run = runInNewContext(
        transpiler.transformSync('async function consume() {' + body + '}') +
          '\nconsume',
        {
          feature: () => true,
          permissionDecision: {
            behavior: 'deny',
            decisionReason: {
              type: 'classifier',
              classifier: 'auto-mode',
              noVerdict,
            },
          },
          executePermissionDeniedHooks: async function* () {
            yield { retry: true }
          },
          tool: { name: 'Fixture' },
          toolUseID: 'call',
          processedInput: {},
          toolUseContext: context,
          permissionMode: 'auto',
          resultingMessages: messages,
          createUserMessage,
        },
      )
      await run()
      expect(messages).toHaveLength(noVerdict ? 0 : 1)
    }
  })
})
