import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../..')

test('managed pass survives core normalization and carries deny stops and post duration', async () => {
  const script = `
import { mock } from 'bun:test'
import { strict as assert } from 'node:assert'
const root = ${JSON.stringify(root)}
const { setAllowedSettingSources } = await import(root + '/src/bootstrap/state.ts')
setAllowedSettingSources([])
const hooks = await import(root + '/src/utils/hooks.ts')
const realExecutePreToolHooks = hooks.executePreToolHooks
const { matchToolCallManagedPass } = await import(root + '/src/utils/hooks/toolCallManagedPass.ts')
let policyRuns = 0, coreRuns = 0, deny = false, ask = false, postDuration, observedInput, asked = 0
mock.module(root + '/src/utils/hooks.ts', () => ({...hooks,
  executePreToolHooks: async function* (name, id, input, context, mode, signal, timeout, prompt, summary, tiers) {
    if (tiers?.managedHooksOnly) {
      policyRuns++
      if (deny) yield {permissionBehavior: 'deny', hookPermissionDecisionReason: 'policy refuses', preventContinuation: true, stopReason: 'policy stop'}
      if (ask) yield {permissionBehavior: 'ask', hookPermissionDecisionReason: 'policy asks', updatedInput: {}}
      return
    }
    const pass = matchToolCallManagedPass(context.managedPass, id, input)
    if (pass === undefined) policyRuns++
    observedInput = input
    if (pass) {
      assert.ok(pass.yields.every(item => item.permissionBehavior === undefined), 'producer must separate decisions from diagnostic yields')
      yield* pass.yields
      if (pass.result.ask !== undefined) yield {permissionBehavior: 'ask', hookPermissionDecisionReason: pass.result.ask}
    }
    if (ask) yield {permissionBehavior: 'allow', hookSource: 'userSettings'}
  },
  executePostToolHooks: async function* (name, id, input, output, context, mode, signal, timeout, duration, tiers) {
    if (tiers?.managedHooksOnly) postDuration = duration
  },
}))
const { runToolUse } = await import(root + '/src/services/tools/toolExecution.ts')
const { TaskListTool } = await import(root + '/packages/builtin-tools/src/tools/TaskListTool/TaskListTool.ts')
const { getDefaultAppState } = await import(root + '/src/state/AppStateStore.ts')
const { createAssistantMessage } = await import(root + '/src/utils/messages.ts')
const { z } = await import('zod/v4')
const tool = {...TaskListTool,
  inputSchema: z.object({flag: z.string().default('default')}),
  backfillObservableInput: input => { input.derived = 'visible' },
  call: async input => { coreRuns++; assert.deepEqual(input, {flag: 'default'}); return {data: {tasks: []}} },
}
let state = getDefaultAppState()
const context = {
  options: {tools: [tool], commands: [], mcpClients: [], mcpResources: {}, mainLoopModel: 'test',
    thinkingConfig: {type: 'disabled'}, isNonInteractiveSession: true, debug: false, verbose: false,
    agentDefinitions: {activeAgents: [], allAgents: [], allowedAgentTypes: []}},
  abortController: new AbortController(), session: {root: {}}, messages: [], readFileState: new Map(),
  getAppState: () => state, setAppState: update => { state = update(state) },
  setInProgressToolUseIDs: () => {}, setResponseLength: () => {},
}
for (const scenario of ['normal', 'ask-then-allow', 'deny-stop']) {
  deny = scenario === 'deny-stop'
  ask = scenario === 'ask-then-allow'
  const block = {type: 'tool_use', id: scenario, name: tool.name, input: {}}
  const assistant = createAssistantMessage({content: [block]})
  context.messages = [assistant]
  const messages = []
  for await (const update of runToolUse(block, assistant, async (tool, input, context, assistant, id, forced) => {
    if (ask) { assert.equal(forced?.behavior, 'ask'); assert.deepEqual(input, {flag: 'default', derived: 'visible'}); asked++ }
    return {behavior: 'allow', updatedInput: {flag: 'default'}}
  }, context)) {
    if ('message' in update) messages.push(update.message)
  }
  if (!deny) {
    assert.equal(policyRuns, ask ? 2 : 1, 'core normalization must reuse the managed policy pass')
    assert.deepEqual(observedInput, {flag: 'default', derived: 'visible'})
    assert.equal(typeof postDuration, 'number')
  } else {
    assert.equal(policyRuns, 3)
    assert.ok(messages.some(message => message.attachment?.type === 'hook_stopped_continuation' && message.attachment.message === 'policy stop'), JSON.stringify(messages))
    assert.ok(messages.some(message => message.type === 'user' && message.message.content.some(block => block.is_error)))
  }
}
// Exercise the actual hooks.ts replay consumer, without mocking its dispatcher.
const replayed = []
const replayContext = {...context, managedPass: {toolUseId: 'actual-replay', input: {}, inputKey: () => '',
  pass: {result: {ask: 'policy asks', additionalContext: ['managed context']}, yields: [{preventContinuation: true, stopReason: 'keep stop'}]}}}
for await (const item of realExecutePreToolHooks(tool.name, 'actual-replay', {}, replayContext, 'default', context.abortController.signal)) replayed.push(item)
assert.ok(replayed.some(item => item.permissionBehavior === 'ask' && item.hookPermissionDecisionReason === 'policy asks'), JSON.stringify(replayed))
assert.ok(replayed.some(item => item.additionalContexts?.includes('managed context')))
assert.ok(replayed.some(item => item.preventContinuation && item.stopReason === 'keep stop'))
assert.equal(coreRuns, 2)
assert.equal(asked, 1, 'managed ask must reach permission approval despite user hook allow')

// Subagent preserveToolUseResultInSubagents + managed PostToolUse output shape validation.
let subagentPostSawOutput
let rewriteBadShape = false
mock.module(root + '/src/utils/hooks.ts', () => ({...hooks,
  executePreToolHooks: async function* () {},
  executePostToolHooks: async function* (name, id, input, output, context, mode, signal, timeout, duration, tiers) {
    if (tiers?.managedHooksOnly) {
      subagentPostSawOutput = output
      if (rewriteBadShape) {
        yield { updatedToolOutput: { tasks: 'not-an-array' } }
      } else {
        yield {
          updatedToolOutput: {
            tasks: [
              { id: 'rewritten', subject: 'sub', status: 'open', blockedBy: [] },
            ],
          },
        }
      }
    }
  },
}))
const subTool = {
  ...tool,
  preserveToolUseResultInSubagents: true,
  outputSchema: z.object({
    tasks: z.array(
      z.object({
        id: z.string(),
        subject: z.string(),
        status: z.string(),
        blockedBy: z.array(z.string()),
      }),
    ),
  }),
}
const subContext = {
  ...context,
  agentId: 'subagent-1',
  options: { ...context.options, tools: [subTool] },
}
const subBlock = {
  type: 'tool_use',
  id: 'sub-ok',
  name: subTool.name,
  input: {},
}
const subAssistant = createAssistantMessage({ content: [subBlock] })
const okMsgs = []
for await (const update of runToolUse(
  subBlock,
  subAssistant,
  async () => ({ behavior: 'allow', updatedInput: { flag: 'default' } }),
  subContext,
)) {
  if ('message' in update) okMsgs.push(update.message)
}
assert.deepEqual(subagentPostSawOutput, { tasks: [] })
assert.deepEqual(okMsgs.find(m => m.type === 'user')?.toolUseResult, {
  tasks: [{ id: 'rewritten', subject: 'sub', status: 'open', blockedBy: [] }],
})

rewriteBadShape = true
const badBlock = {type: 'tool_use', id: 'sub-bad', name: subTool.name, input: {}}
const badAssistant = createAssistantMessage({content: [badBlock]})
const badMsgs = []
for await (const update of runToolUse(badBlock, badAssistant, async () => ({behavior: 'allow', updatedInput: {flag: 'default'}}), subContext)) {
  if ('message' in update) badMsgs.push(update.message)
}
const badUser = badMsgs.find(m => m.type === 'user')
const badResultBlock = badUser?.message?.content?.find(b => b.type === 'tool_result')
assert.equal(badResultBlock?.is_error, true)
assert.ok(String(badResultBlock?.content).includes('a managed PostToolUse hook rewrote'))
assert.ok(String(badResultBlock?.content).includes('does not match its output shape'))
console.log('MANAGED_PASS_HOST_OK')
process.exit(0)
`
  const child = Bun.spawn({
    cmd: [process.execPath, '--eval', script],
    cwd: root,
    env: {
      ...process.env,
      DISABLE_TELEMETRY: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      NODE_ENV: 'test',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(exit, `${stdout}\n${stderr}`).toBe(0)
  expect(stdout).toContain('MANAGED_PASS_HOST_OK')
}, 30_000)
