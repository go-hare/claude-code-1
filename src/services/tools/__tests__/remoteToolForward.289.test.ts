import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const SRC = readFileSync(
  new URL('../toolExecution.ts', import.meta.url),
  'utf8',
)

test('real runner waits and asks to reannounce in its own session after another session expires', async () => {
  const root = resolve(import.meta.dir, '../../../..')
  const script = `
    import { strict as assert } from 'node:assert'
    import { mock } from 'bun:test'
    import * as growthbook from './src/services/analytics/growthbook.ts'
    mock.module('src/services/analytics/growthbook.ts', () => ({
      ...growthbook,
      getFeatureValue_CACHED_MAY_BE_STALE: (key, fallback) => key === 'tengu_violin_wood' || key === 'tengu_violin_pegbox' ? true : fallback,
    }))
    const { runToolUse } = await import('./src/services/tools/toolExecution.ts')
    const { ToolStateSlots } = await import('./src/utils/toolState.ts')
    const { createAssistantMessage } = await import('./src/utils/messages.ts')
    const { acceptRemoteMachineAnnounce, announceWaitAlreadyExpired, askRemoteToolsReannounce, waitForAnnouncedMachine } = await import('./src/services/tools/remoteToolHost.ts')
    const first = new ToolStateSlots()
    const second = new ToolStateSlots()
    const third = new ToolStateSlots()
    const signal = new AbortController().signal
    const requests = []
    const send = request => requests.push(request)
    assert.equal(askRemoteToolsReannounce(send, 100, first), true)
    assert.equal(askRemoteToolsReannounce(send, 100, first), false)
    // Even a default announce cannot suppress another session's request.
    acceptRemoteMachineAnnounce({instanceId: 'default', name: 'desk', tools: [{name: 'Read', refusedInputFields: []}]})
    assert.equal(askRemoteToolsReannounce(send, 100, third), true)
    assert.equal(requests.length, 2)
    assert.equal(await waitForAnnouncedMachine('missing', signal, 0, first), 'gave_up')
    assert.equal(announceWaitAlreadyExpired(second), undefined)
    const call = {type: 'tool_use', id: 'toolu_isolated', name: 'Read', input: {_host: 'desk'}}
    const assistant = createAssistantMessage({content: [call]})
    const context = {
      toolState: second,
      options: {tools: [{name: 'Read', remoteExecution: {supported: true}}], mcpClients: []},
      abortController: new AbortController(),
    }
    const updates = []
    let finished = false
    const running = (async () => {
      for await (const update of runToolUse(call, assistant, async () => ({behavior: 'allow'}), context)) updates.push(update)
      finished = true
    })()
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(finished, false, 'B must still wait after A timed out and default desk announced')
    assert.equal(askRemoteToolsReannounce(send, 100, second), false, 'the actual runner must consume B reannounce slot')
    acceptRemoteMachineAnnounce({instanceId: 'second', name: 'desk', tools: [{name: 'Bash', refusedInputFields: []}]}, second)
    await running
    const content = updates[0].message.message.content[0].content
    assert.ok(content.includes('does not serve Read'), content)
    assert.equal(announceWaitAlreadyExpired(second), undefined)
    console.log('SESSION_ISOLATION_OK')
    process.exit(0)
  `
  const child = Bun.spawn({
    cmd: [process.execPath, '-e', script],
    cwd: root,
    env: {
      ...process.env,
      CLAUDE_CODE_REMOTE_TOOLS_FORWARD: '1',
      CLAUDE_CODE_REMOTE_TOOLS_SESSION_CHANNEL: '1',
      CLAUDE_CODE_WORKER_EPOCH: '2',
      DISABLE_TELEMETRY: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(exit, `${stdout}\n${stderr}`).toBe(0)
  expect(stdout).toContain('SESSION_ISOLATION_OK')
}, 30_000)

test('remote background IDs survive session envelopes and the Bash output filter', async () => {
  const { extractRemoteBackgroundTaskId } = await import('../toolExecution.js')
  const { remoteHostEnvelopeMessage } = await import('../remoteToolHost.js')
  const response = {
    envelope: {
      outcome: 'completed',
      target: { name: 'desk', working_dir: '/work' },
      output: {
        backgroundTaskId: 'bg-remote',
        stdout: '',
        privateField: 'drop',
      },
    },
  }
  expect(extractRemoteBackgroundTaskId(response)).toBe('bg-remote')
  expect(
    remoteHostEnvelopeMessage('desk', 'session', response.envelope, [])?.output,
  ).toEqual({ backgroundTaskId: 'bg-remote', stdout: '' })
  expect(
    extractRemoteBackgroundTaskId({ envelope: { output: null } }),
  ).toBeUndefined()
})

describe('remote tool forward gate (densable dr / Eh)', () => {
  test('does not refuse every remoteExecution tool before the local run', () => {
    expect(SRC).not.toContain('the machine is not announcing on this session')
  })

  test('a named host is routed, and a resolved machine is sent', () => {
    expect(SRC).toContain('remoteHostRoute(')
    expect(SRC).toContain('toolUse.input')
    expect(SRC).toContain('tool.name')
    expect(SRC).toContain('callRemoteTool(')
  })
})
