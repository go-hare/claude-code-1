import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../..')

test('detached drain reports a ceiling after CANCEL and normal return, and refuses late permission allows', async () => {
  // Keep the tool runner mock in a child: Bun mock.module is process-global.
  const script = `
import { mock } from 'bun:test'
import { strict as assert } from 'node:assert'
const root = ${JSON.stringify(root)}
const store = await import(root + '/src/utils/detachedToolCallStore.ts')
const { createUserMessage, createAssistantMessage } = await import(root + '/src/utils/messages.ts')
let started, release
let onStart = new Promise(resolve => { started = resolve })
let finish = new Promise(resolve => { release = resolve })
let sawLetGoAtGeneratorEnd = false
let errorResult = false
let mapperCalls = 0
let successData
let mappedText = 'done'
let savedText
const storage = await import(root + '/src/utils/toolResultStorage.ts')
mock.module(root + '/src/utils/toolResultStorage.ts', () => ({...storage,
  persistToolResult: async text => { savedText = text; return {filepath: '/tmp/detached-test-output', originalSize: text.length} },
}))
mock.module(root + '/src/services/tools/toolExecution.ts', () => ({
  isToolBridgeEvent: () => false,
  runToolUse: async function* (block, assistant, canUseTool, context) {
    started(context.abortController)
    await finish
    try {
      yield {message: createUserMessage({content: [{type: 'tool_result', tool_use_id: block.id,
        is_error: errorResult || context.abortController.signal.aborted,
        content: errorResult ? 'Permission denied' : context.abortController.signal.aborted ? 'CANCEL' : 'done'}],
        toolUseResult: errorResult ? 'Error: Permission denied' : successData})}
    } finally {
      sawLetGoAtGeneratorEnd = store.detachedToolCallWasLetGo(block.id)
    }
  },
}))
const { StreamingToolExecutor } = await import(root + '/src/services/tools/StreamingToolExecutor.ts')
const { backgroundForegroundToolCalls } = await import(root + '/src/utils/foregroundToolCalls.ts')
const { createPermissionContext } = await import(root + '/src/hooks/toolPermission/PermissionContext.ts')
const { hasPermissionsToUseTool } = await import(root + '/src/utils/permissions/permissions.ts')
const tool = {name: 'DetachRegression', backgrounding: 'detach', isConcurrencySafe: () => true,
  inputSchema: {safeParse: value => ({success: true, data: value})},
  userFacingName: () => 'DetachRegression', renderToolUseMessage: () => 'detach',
  mapToolResultToToolResultBlockParam: () => { mapperCalls++; return {type: 'tool_result', tool_use_id: 'unused', content: mappedText} }}
const context = {options: {tools: [tool], commands: [], mainLoopModel: 'test', debug: false, verbose: false,
  mcpClients: [], mcpResources: {}, isNonInteractiveSession: true, thinkingConfig: {type: 'disabled'}},
  abortController: new AbortController(), session: {root: {}}, messages: [], readFileState: new Map(),
  getAppState: () => ({toolPermissionContext: {mode: 'default'}}), setAppState: () => {},
  setInProgressToolUseIDs: () => {}, setResponseLength: () => {}}
let ceiling
const realTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...args) => {
  if (ms === 300000) { ceiling = fn; return realTimeout(() => {}, ms) }
  return realTimeout(fn, ms, ...args)
}
const block = {type: 'tool_use', id: 'ceiling-normal-return', name: tool.name, input: {}}
const assistant = createAssistantMessage({content: [block]})
const executor = new StreamingToolExecutor([tool], async () => ({behavior: 'allow', updatedInput: {}}), context)
executor.addTool(block, assistant)
const controller = await onStart
assert.equal(backgroundForegroundToolCalls(context.session), 1)
const foreground = []
for await (const update of executor.getRemainingResults()) foreground.push(update)
assert.ok(foreground.some(update => update.message?.toolUseResult?.detachedToolCall))
assert.equal(store.getDetachedToolCall(block.id).status, 'running')
assert.equal(store.detachedToolCallWasLetGo(block.id), true)
const permission = createPermissionContext(tool, {}, context, assistant, block.id)
assert.equal(permission.buildAllow({}).behavior, 'deny')
assert.equal((await permission.handleUserAllow({}, [])).behavior, 'deny')
assert.equal((await permission.handleHookAllow({}, [])).behavior, 'deny')
assert.equal((await hasPermissionsToUseTool(tool, {}, context, assistant, block.id,
  {behavior: 'allow', updatedInput: {}})).behavior, 'deny')
let resolved
assert.equal(permission.resolveIfAborted(result => { resolved = result }), true)
assert.equal(resolved.behavior, 'deny')
assert.equal(context.abortController.signal.aborted, false)
let lateAllowAtSettle
const unsubscribe = store.subscribeDetachedToolCalls(() => {
  if (store.getDetachedToolCall(block.id)?.status === 'failed') {
    lateAllowAtSettle = permission.buildAllow({}).behavior
  }
})
ceiling()
assert.equal(controller.signal.reason, 'detached-ceiling')
release()
for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve))
const settled = store.getDetachedToolCall(block.id)
assert.equal(sawLetGoAtGeneratorEnd, true)
assert.equal(lateAllowAtSettle, 'deny')
unsubscribe()
assert.equal(settled.status, 'failed')
assert.equal(settled.text, 'The call did not finish within 5 minutes and was stopped.')
assert.equal(store.detachedToolCallWasLetGo(block.id), false)
assert.equal(store.detachedToolCallAbort(block.id), false)
assert.equal(context.abortController.signal.aborted, false)
// Async permission evaluations and persistence can finish after send-now.
const lateId = 'late-permission'
const pendingAllow = hasPermissionsToUseTool(tool, {}, context, assistant, lateId,
  {behavior: 'allow', updatedInput: {}})
store.detachedToolCallLetGo(lateId)
assert.equal((await pendingAllow).behavior, 'deny')
store.detachedToolCallEnded(lateId)
const latePermission = createPermissionContext(tool, {}, context, assistant, lateId)
const pendingUserAllow = latePermission.handleUserAllow({}, [])
store.detachedToolCallLetGo(lateId)
assert.equal((await pendingUserAllow).behavior, 'deny')
store.detachedToolCallEnded(lateId)
const pendingHookAllow = latePermission.handleHookAllow({}, [])
store.detachedToolCallLetGo(lateId)
assert.equal((await pendingHookAllow).behavior, 'deny')
store.detachedToolCallEnded(lateId)
// The abort reason alone must also force failure after a normal generator return.
// User cancellation follows the same path, but settles as stopped.
for (const reason of ['detached-ceiling', 'user-cancel', 'normal']) {
  onStart = new Promise(resolve => { started = resolve })
  finish = new Promise(resolve => { release = resolve })
  const nextBlock = {...block, id: reason}
  const nextAssistant = createAssistantMessage({content: [nextBlock]})
  const nextExecutor = new StreamingToolExecutor([tool], async () => ({behavior: 'allow', updatedInput: {}}), context)
  nextExecutor.addTool(nextBlock, nextAssistant)
  await onStart
  assert.equal(backgroundForegroundToolCalls(context.session), 1)
  for await (const update of nextExecutor.getRemainingResults()) {}
  if (reason !== 'normal') assert.equal(store.detachedToolCallAbort(reason, reason), true)
  release()
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve))
  const nextResult = store.getDetachedToolCall(reason)
  assert.equal(nextResult.status, reason === 'normal' ? 'completed' : reason === 'user-cancel' ? 'stopped' : 'failed')
  assert.equal(nextResult.text, reason === 'normal' ? 'done' : reason === 'user-cancel'
    ? 'The user stopped this call before it finished.'
    : 'The call did not finish within 5 minutes and was stopped.')
  if (reason === 'normal') assert.equal(nextResult.resultQueued, true)
  assert.equal(store.detachedToolCallWasLetGo(reason), false)
}
// An error result is already rendered and must never reach the success mapper.
errorResult = true
onStart = new Promise(resolve => { started = resolve })
finish = new Promise(resolve => { release = resolve })
const deniedBlock = {...block, id: 'denied-result'}
const deniedExecutor = new StreamingToolExecutor([tool], async () => ({behavior: 'allow', updatedInput: {}}), context)
deniedExecutor.addTool(deniedBlock, createAssistantMessage({content: [deniedBlock]}))
await onStart
assert.equal(backgroundForegroundToolCalls(context.session), 1)
for await (const update of deniedExecutor.getRemainingResults()) {}
const callsBeforeError = mapperCalls
release()
for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve))
assert.equal(store.getDetachedToolCall(deniedBlock.id).status, 'failed')
assert.equal(store.getDetachedToolCall(deniedBlock.id).text, 'Permission denied')
assert.equal(mapperCalls, callsBeforeError)
errorResult = false
// Successful structured results still use the mapper and persist oversized output.
successData = {query: 'large result'}
mappedText = 'x'.repeat(99000)
onStart = new Promise(resolve => { started = resolve })
finish = new Promise(resolve => { release = resolve })
const largeBlock = {...block, id: 'large-result'}
const largeExecutor = new StreamingToolExecutor([tool], async () => ({behavior: 'allow', updatedInput: {}}), context)
largeExecutor.addTool(largeBlock, createAssistantMessage({content: [largeBlock]}))
await onStart
assert.equal(backgroundForegroundToolCalls(context.session), 1)
for await (const update of largeExecutor.getRemainingResults()) {}
const callsBeforeSuccess = mapperCalls
release()
for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve))
assert.equal(mapperCalls, callsBeforeSuccess + 1)
assert.equal(savedText, mappedText)
assert.equal(store.getDetachedToolCall(largeBlock.id).status, 'completed')
assert.ok(store.getDetachedToolCall(largeBlock.id).text.includes('/tmp/detached-test-output'))
successData = undefined
mappedText = 'done'
// A non-detachable foreground tool must retain query cancellation after send-now.
for (const withSession of [true, false]) {
  onStart = new Promise(resolve => { started = resolve })
  finish = new Promise(resolve => { release = resolve })
  const foregroundTool = {...tool, backgrounding: undefined}
  const foregroundContext = {...context, options: {...context.options, tools: [foregroundTool]},
    abortController: new AbortController(), session: withSession ? {root: {}} : undefined}
  const foregroundBlock = {...block, id: 'foreground-' + withSession}
  const foregroundExecutor = new StreamingToolExecutor([foregroundTool], async () => ({behavior: 'allow', updatedInput: {}}), foregroundContext)
  foregroundExecutor.addTool(foregroundBlock, createAssistantMessage({content: [foregroundBlock]}))
  const foregroundController = await onStart
  if (withSession) assert.equal(backgroundForegroundToolCalls(foregroundContext.session), 0)
  foregroundContext.abortController.abort('user-cancel')
  assert.equal(foregroundController.signal.aborted, true)
  release()
  for await (const update of foregroundExecutor.getRemainingResults()) {}
}
// Settlement releases abort closures without evicting running or unqueued records.
store.detachedToolCallStarted('retained-running', {tool, input: {}})
store.detachedToolCallStarted('retained-undelivered', {tool, input: {}})
store.detachedToolCallSettled('retained-undelivered', {status: 'completed', data: 'result'})
assert.ok(store.detachedToolCallsAwaitingResult().includes('retained-running'))
assert.ok(store.detachedToolCallsAwaitingResult().includes('retained-undelivered'))
assert.equal(store.getDetachedToolCall('retained-undelivered').data, 'result')
let discardedReason
store.detachedToolCallStarted('removed-running', {tool, input: {}}, reason => { discardedReason = reason })
store.detachedToolCallStarted('other-agent-running', {tool, input: {}})
const { enqueueDetachedToolCallResult } = await import(root + '/src/utils/detachedToolCallNotify.ts')
const { getCommandQueueSnapshot } = await import(root + '/src/utils/messageQueueManager.ts')
enqueueDetachedToolCallResult({toolName: tool.name, toolUseId: 'removed-running', status: 'completed', text: 'old', isOnScreen: false})
const retainedMessages = [
  {type: 'assistant'},
  {type: 'assistant', message: {content: 'plain assistant text'}},
  createAssistantMessage({content: ['retained-running', 'retained-undelivered'].map(id => ({...block, id}))}),
]
store.pruneDetachedToolCalls([...retainedMessages,
  createAssistantMessage({content: [{...block, id: 'removed-running'}]})], retainedMessages)
assert.equal(discardedReason, 'conversation-cleared')
assert.equal(store.getDetachedToolCall('removed-running'), undefined)
assert.equal(store.detachedToolCallSettled('removed-running', {status: 'completed', text: 'late'}), false)
assert.ok(store.getDetachedToolCall('other-agent-running'))
assert.ok(store.getDetachedToolCall('retained-running'))
assert.equal(store.getDetachedToolCall('retained-undelivered').data, 'result')
assert.ok(!getCommandQueueSnapshot().some(command => typeof command.value === 'string' && command.value.includes('<tool-use-id>removed-running</tool-use-id>')))
console.log('DETACHED_DRAIN_OK')
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
  expect(stdout).toContain('DETACHED_DRAIN_OK')
}, 30_000)

test('real runToolUse refuses custom and forced-hook Allow after letGo', async () => {
  const script = `
import { mock } from 'bun:test'
import { strict as assert } from 'node:assert'
const root = ${JSON.stringify(root)}
const { detachedToolCallLetGo, detachedToolCallEnded } = await import(root + '/src/utils/detachedToolCallStore.ts')
const { setAllowedSettingSources } = await import(root + '/src/bootstrap/state.ts')
setAllowedSettingSources([])
const hooks = await import(root + '/src/services/tools/toolHooks.ts')
let forcedHookAllow = false
mock.module(root + '/src/services/tools/toolHooks.ts', () => ({
  ...hooks,
  runPreToolUseHooks: async function* (context, tool, input, id) {
    if (forcedHookAllow) {
      detachedToolCallLetGo(id)
      yield {type: 'hookPermissionResult', hookPermissionResult: {behavior: 'allow', updatedInput: input}}
    }
  },
}))
const { runToolUse } = await import(root + '/src/services/tools/toolExecution.ts')
const { TaskListTool } = await import(root + '/packages/builtin-tools/src/tools/TaskListTool/TaskListTool.ts')
const { getDefaultAppState } = await import(root + '/src/state/AppStateStore.ts')
const { createAssistantMessage } = await import(root + '/src/utils/messages.ts')
let calls = 0, permissions = 0
const tool = {...TaskListTool, call: async () => { calls++; return {data: {tasks: []}} }}
let state = getDefaultAppState()
const context = {
  options: {tools: [tool], commands: [], mcpClients: [], mcpResources: {}, mainLoopModel: 'test',
    thinkingConfig: {type: 'disabled'}, isNonInteractiveSession: true, debug: false, verbose: false,
    agentDefinitions: {activeAgents: [], allAgents: [], allowedAgentTypes: []}},
  abortController: new AbortController(), session: {root: {}}, messages: [], readFileState: new Map(),
  getAppState: () => state, setAppState: update => { state = update(state) },
  setInProgressToolUseIDs: () => {}, setResponseLength: () => {},
}
for (const scenario of ['custom-allow', 'forced-hook-allow']) {
  forcedHookAllow = scenario === 'forced-hook-allow'
  const block = {type: 'tool_use', id: scenario, name: tool.name, input: {}}
  const assistant = createAssistantMessage({content: [block]})
  context.messages = [assistant]
  const messages = []
  for await (const update of runToolUse(block, assistant, async () => {
    permissions++
    detachedToolCallLetGo(block.id)
    return {behavior: 'allow', updatedInput: {}}
  }, context)) {
    if ('message' in update) messages.push(update.message)
  }
  assert.equal(calls, 0, scenario + ' executed despite letGo')
  const result = messages.find(message => message.type === 'user' && Array.isArray(message.message.content)
    && message.message.content.some(block => block.type === 'tool_result' && block.is_error))
  assert.ok(result, scenario + ': ' + JSON.stringify(messages))
  detachedToolCallEnded(block.id)
}
assert.equal(permissions, 1, 'forced hook Allow should bypass the custom callback and still be denied')

// Verify post-permission dOt in real runToolUse, stopRunningDetachedToolCalls, and XML clip/status.
const store = await import(root + '/src/utils/detachedToolCallStore.ts')
const notify = await import(root + '/src/utils/detachedToolCallNotify.ts')
const { backgroundForegroundToolCalls } = await import(root + '/src/utils/foregroundToolCalls.ts')
const { getCommandQueue, resetCommandQueue } = await import(root + '/src/utils/messageQueueManager.ts')
const { getMainThreadAgentId } = await import(root + '/src/bootstrap/state.js')
const { setUserPromptWaitingFor } = await import(root + '/src/utils/sessionHost.ts')

resetCommandQueue()
const clipped = notify.escapeDetachedResultBody('&'.repeat(30000))
assert.ok(clipped.length <= 98000, 'post-escape body must be <= 98000, got ' + clipped.length)
notify.enqueueDetachedToolCallResult({
  toolName: 'TestTool',
  toolUseId: 'stopped-xml',
  status: 'stopped',
  text: 'stopped by user',
  isOnScreen: false,
  passive: true,
})
const queuedStopped = getCommandQueue()[0]
assert.equal(queuedStopped?.agentId, getMainThreadAgentId())
assert.ok(String(queuedStopped?.value).includes('<status>failed</status>'))

const sessionA = {root: {}}
const sessionB = {root: {}}
let abortedA
store.detachedToolCallStarted('sess-a-1', {tool, input: {}}, r => { abortedA = r }, sessionA)
store.detachedToolCallStarted('sess-b-1', {tool, input: {}}, () => {}, sessionB)
assert.equal(store.stopRunningDetachedToolCalls(sessionA), 1)
assert.equal(abortedA, 'user-cancel')
assert.equal(store.getDetachedToolCall('sess-a-1', sessionA)?.stopRequested, true)
assert.equal(store.getDetachedToolCall('sess-b-1', sessionB)?.stopRequested, undefined)

forcedHookAllow = false
let releaseCall, callStartedResolve
const callStarted = new Promise(r => { callStartedResolve = r })
const callDone = new Promise(r => { releaseCall = r })
const detachRealTool = {...TaskListTool,
  backgrounding: 'detach',
  call: async () => { callStartedResolve(); await callDone; return {data: {tasks: []}} },
}
const realSession = {root: {}}
const realCtx = {...context, session: realSession, options: {...context.options, tools: [detachRealTool]}}
const realBlock = {type: 'tool_use', id: 'real-dot-1', name: detachRealTool.name, input: {}}
const realAssistant = createAssistantMessage({content: [realBlock]})
realCtx.messages = [realAssistant]
let bgDuringPermission = -1
const gen = runToolUse(realBlock, realAssistant, async () => {
  // Pre-approval: dOt has not registered foreground call yet!
  bgDuringPermission = backgroundForegroundToolCalls(realSession)
  return {behavior: 'allow', updatedInput: {}}
}, realCtx)
const firstStep = gen.next()
await callStarted
assert.equal(bgDuringPermission, 0, 'foreground detach must not register before permission approval')
// While a permission/user prompt is open on the session, backgroundNow refuses.
setUserPromptWaitingFor(realSession, 'permission')
assert.equal(backgroundForegroundToolCalls(realSession), 0)
setUserPromptWaitingFor(realSession, undefined)
assert.equal(backgroundForegroundToolCalls(realSession), 1)
const firstYield = await firstStep
assert.deepEqual(firstYield.value?.message?.toolUseResult, {detachedToolCall: true})
assert.equal(store.getDetachedToolCall('real-dot-1', realSession)?.status, 'running')
releaseCall()
for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r))
assert.equal(store.getDetachedToolCall('real-dot-1', realSession)?.status, 'completed')
assert.deepEqual(store.getDetachedToolCall('real-dot-1', realSession)?.data, {tasks: []})

console.log('REAL_RUN_TOOL_LETGO_OK')
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
  expect(stdout).toContain('REAL_RUN_TOOL_LETGO_OK')
}, 30_000)
