import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../..')

test('managed PreToolUse early-deny paths emit hook_stopped_continuation with findLast stopReason (SEA lHs)', async () => {
  const script = `
import { mock } from 'bun:test'
import { strict as assert } from 'node:assert'
const root = ${JSON.stringify(root)}
const { setAllowedSettingSources } = await import(root + '/src/bootstrap/state.ts')
setAllowedSettingSources([])
const hooks = await import(root + '/src/utils/hooks.ts')
let scenario = 'multi-stop-deny'
mock.module(root + '/src/utils/hooks.ts', () => ({
  ...hooks,
  executePreToolHooks: async function* (name, id, input, context, mode, signal, timeout, prompt, summary, tiers) {
    if (!tiers?.managedHooksOnly) return
    if (scenario === 'multi-stop-deny') {
      yield { preventContinuation: true, stopReason: 'first stop' }
      yield { preventContinuation: true, stopReason: 'last stop' }
      yield { permissionBehavior: 'deny', hookPermissionDecisionReason: 'policy refuses', preventContinuation: true }
    } else if (scenario === 'deny-fallback-reason') {
      yield { permissionBehavior: 'deny', hookPermissionDecisionReason: 'policy refuses', preventContinuation: true }
    } else if (scenario === 'account-memory-rewrite') {
      yield { preventContinuation: true, stopReason: 'first account stop' }
      yield { updatedInput: { key: 'rewritten' }, preventContinuation: true, stopReason: 'final account stop' }
    } else if (scenario === 'account-memory-rewrite-aborted') {
      context.abortController.abort()
      yield { updatedInput: { key: 'rewritten' }, preventContinuation: true, stopReason: 'should not emit' }
    }
  },
}))
const { runToolUse } = await import(root + '/src/services/tools/toolExecution.ts')
const { TaskListTool } = await import(root + '/packages/builtin-tools/src/tools/TaskListTool/TaskListTool.ts')
const { getDefaultAppState } = await import(root + '/src/state/AppStateStore.ts')
const { createAssistantMessage } = await import(root + '/src/utils/messages.ts')
const { z } = await import('zod/v4')

const baseTool = {
  ...TaskListTool,
  inputSchema: z.object({ key: z.string().optional() }),
  call: async () => {
    throw new Error('core tool.call should not execute on early deny')
  },
}
const accountMemoryTool = {
  ...baseTool,
  name: 'AccountMemoryTestTool',
  mcpInfo: { serverName: 'account-memory', toolName: 'mem_set', accountMemoryServer: true },
}

let state = getDefaultAppState()
const makeContext = () => ({
  options: {
    tools: [baseTool, accountMemoryTool],
    commands: [],
    mcpClients: [],
    mcpResources: {},
    mainLoopModel: 'test',
    thinkingConfig: { type: 'disabled' },
    isNonInteractiveSession: true,
    debug: false,
    verbose: false,
    agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] },
  },
  abortController: new AbortController(),
  session: { root: {} },
  messages: [],
  readFileState: new Map(),
  getAppState: () => state,
  setAppState: update => { state = update(state) },
  setInProgressToolUseIDs: () => {},
  setResponseLength: () => {},
})

async function runScenario(name, tool) {
  scenario = name
  const context = makeContext()
  const block = { type: 'tool_use', id: name, name: tool.name, input: { key: 'orig' } }
  const assistant = createAssistantMessage({ content: [block] })
  context.messages = [assistant]
  const messages = []
  for await (const update of runToolUse(
    block,
    assistant,
    async () => ({ behavior: 'allow', updatedInput: { key: 'orig' } }),
    context,
  )) {
    if ('message' in update) messages.push(update.message)
  }
  return messages
}

// 1. Multiple preventContinuation yields on deny: must use findLast stopReason.
const multiMsgs = await runScenario('multi-stop-deny', baseTool)
const multiStops = multiMsgs.filter(m => m.attachment?.type === 'hook_stopped_continuation')
assert.equal(multiStops.length, 1)
assert.equal(multiStops[0].attachment.message, 'last stop')

// 2. preventContinuation without stopReason on deny: falls back to deny reason.
const fallbackMsgs = await runScenario('deny-fallback-reason', baseTool)
const fallbackStops = fallbackMsgs.filter(m => m.attachment?.type === 'hook_stopped_continuation')
assert.equal(fallbackStops.length, 1)
assert.equal(fallbackStops[0].attachment.message, 'policy refuses')

// 3. Account memory input rewrite early-deny: must emit hook_stopped_continuation with findLast stopReason.
const acctMsgs = await runScenario('account-memory-rewrite', accountMemoryTool)
assert.ok(acctMsgs.some(m => m.type === 'user' && m.message.content.some(b => b.is_error)), JSON.stringify(acctMsgs))
const acctStops = acctMsgs.filter(m => m.attachment?.type === 'hook_stopped_continuation')
assert.equal(acctStops.length, 1, JSON.stringify(acctMsgs))
assert.equal(acctStops[0].attachment.message, 'final account stop')

// 4. Aborted signal suppresses hook_stopped_continuation.
const abortedMsgs = await runScenario('account-memory-rewrite-aborted', accountMemoryTool)
assert.ok(abortedMsgs.some(m => m.type === 'user' && m.message.content.some(b => b.is_error)))
assert.equal(abortedMsgs.filter(m => m.attachment?.type === 'hook_stopped_continuation').length, 0)
`
  const proc = Bun.spawnSync(['bun', '-e', script], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (proc.exitCode !== 0) {
    throw new Error(
      `Subprocess failed (${proc.exitCode}):\n${proc.stderr.toString()}\n${proc.stdout.toString()}`,
    )
  }
  expect(proc.exitCode).toBe(0)
})
