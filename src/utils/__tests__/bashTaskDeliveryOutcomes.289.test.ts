import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { spliceBashTaskDelivery } from '../bashTaskDelivery.js'
import {
  GET_TASK_TOOL_NAME,
  isBashTaskDeliveryHosted,
  resetBashTaskDeliveryForTests,
  setBashTaskDeliveryOutcome,
} from '../bashTaskDeliveryOutcomes.js'

afterEach(() => {
  resetBashTaskDeliveryForTests()
})

describe('densable 2.1.289 As bashTaskDeliveryOutcomes', () => {
  test('eg is GetTask', () => {
    expect(GET_TASK_TOOL_NAME).toBe('GetTask')
  })

  test('unset messageId and missing map entry are hosted', () => {
    expect(isBashTaskDeliveryHosted(undefined)).toBe(true)
    expect(isBashTaskDeliveryHosted('msg_1')).toBe(true)
  })

  test('no_host hides the GetTask delivery suffix', () => {
    setBashTaskDeliveryOutcome('msg_1', 'no_host')
    expect(isBashTaskDeliveryHosted('msg_1')).toBe(false)
    setBashTaskDeliveryOutcome('msg_2', 'spliced')
    expect(isBashTaskDeliveryHosted('msg_2')).toBe(true)
  })

  test('KRr splice records no_host without an assistant host', () => {
    const id = randomUUID()
    const now = new Date().toISOString()
    const ok = spliceBashTaskDelivery(
      [],
      {
        taskId: 't1',
        status: 'completed',
        statusMessage: 'Command completed (exit code 0).',
        createdAt: now,
        lastUpdatedAt: now,
        result: { content: [{ type: 'text', text: 'ok' }], isError: false },
      },
      id,
      { report: true, startsTurn: true },
    )
    expect(ok).toBe(false)
    expect(isBashTaskDeliveryHosted(id)).toBe(false)
  })

  test('KRr splice records spliced onto a hosting assistant', () => {
    const id = randomUUID()
    const now = new Date().toISOString()
    const host = {
      type: 'assistant' as const,
      uuid: randomUUID(),
      timestamp: now,
      message: {
        id: 'msg_host',
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'working' }],
      },
    }
    const api = [host]
    const ok = spliceBashTaskDelivery(
      api,
      {
        taskId: 't1',
        status: 'completed',
        statusMessage: 'Command completed (exit code 0).',
        createdAt: now,
        lastUpdatedAt: now,
        result: { content: [{ type: 'text', text: 'ok' }], isError: false },
      },
      id,
      { report: true, startsTurn: true },
    )
    expect(ok).not.toBe(false)
    expect(isBashTaskDeliveryHosted(id)).toBe(true)
    const hasGetTask = api.some(m => {
      if (m.type !== 'assistant') return false
      const content = m.message?.content
      if (!Array.isArray(content)) return false
      return content.some(
        (b: { type?: string; name?: string }) =>
          b.type === 'tool_use' && b.name === GET_TASK_TOOL_NAME,
      )
    })
    expect(hasGetTask).toBe(true)
  })

  test('JZe drain ids only when previous non-skip row is a tool_result user', () => {
    const { queuedCommandDeliveryDrainIds } =
      require('../bashTaskDelivery.js') as typeof import('../bashTaskDelivery.js')
    const attUuid = randomUUID()
    const msgs = [
      {
        type: 'user',
        uuid: randomUUID(),
        message: {
          content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }],
        },
      },
      {
        type: 'attachment',
        uuid: attUuid,
        attachment: {
          type: 'queued_command',
          taskDelivery: { taskId: 't1', status: 'completed' },
        },
      },
    ]
    expect(queuedCommandDeliveryDrainIds(msgs).has(attUuid)).toBe(true)
    const noDrain = queuedCommandDeliveryDrainIds([
      {
        type: 'assistant',
        uuid: randomUUID(),
        message: { content: [{ type: 'text', text: 'hi' }] },
      },
      msgs[1]!,
    ])
    expect(noDrain.has(attUuid)).toBe(false)
  })

  test('print and QE stamp taskDelivery onto ask / processUserInput', () => {
    const print = readFileSync(
      join(import.meta.dir, '../../cli/print.ts'),
      'utf8',
    )
    const engine = readFileSync(
      join(import.meta.dir, '../../QueryEngine.ts'),
      'utf8',
    )
    const pui = readFileSync(
      join(import.meta.dir, '../processUserInput/processUserInput.ts'),
      'utf8',
    )
    const msgs = readFileSync(join(import.meta.dir, '../messages.ts'), 'utf8')
    expect(msgs).toContain('spliceBashTaskDelivery')
    expect(msgs).toContain('behindEarlierMessages: behindEarlierIds.has')
    expect(msgs).toContain('queuedCommandDeliveryBehindEarlierIds')
    expect(msgs).toContain('inHumanTurn: false')
    const bag = readFileSync(
      join(import.meta.dir, '../bashTaskDeliveryOutcomes.ts'),
      'utf8',
    )
    expect(bag).toContain('getBootstrapSessionHost')
    expect(bag).toContain('rememberBashTaskSnapshot')
    expect(bag).toContain('withdrawQueuedBashTaskNotification')
    expect(bag).toContain('const SNAPSHOT_CAP = 200')
    expect(bag).toContain("reason: 'delivered_as_tool_result'")
    expect(bag).toContain('agentId ?? getMainThreadAgentId()')
    expect(bag).toContain('bashTaskOwnerAgentId(cmd.agentId) === s')
    expect(bag).toContain('hasPairedGetTaskResult')
    expect(bag).toContain('unmarkBashTaskSnapshotFetched')
    expect(bag).toContain('registryHasGetTaskResult')
    const krr = readFileSync(
      join(import.meta.dir, '../bashTaskDelivery.ts'),
      'utf8',
    )
    expect(krr).toContain('[SYSTEM NOTIFICATION - NOT USER INPUT]')
    expect(krr).toContain('leftoverY')
    expect(krr).toContain('leftoverM')
    expect(krr).toContain('leftoverP')
    const leftover = readFileSync(
      join(import.meta.dir, '../leftoverOt.ts'),
      'utf8',
    )
    expect(leftover).toContain("logEvent('tengu_feature_ok'")
    expect(leftover).toContain("logEvent('tengu_feature_bad'")
    expect(leftover).toContain("logEvent('tengu_feature_sad'")
    expect(leftover).toContain('feature_name')
    expect(leftover).toContain('error_code')
    expect(leftover).not.toContain('logOTelEvent')
    expect(leftover).toContain('nonconforming')
    expect(krr).toContain('task_local_shell_delivery')
    expect(krr).not.toContain("logEvent('task_local_shell_delivery'")
    expect(krr).toContain("model === '<synthetic>'")
    expect(krr).not.toContain('withdrawShellNotification')
    expect(krr).toContain("resultType: 'task'")
    expect(krr).toContain('memory_pressure')
    expect(krr).toContain('earlier output omitted; full output:')
    const yve = readFileSync(
      join(import.meta.dir, '../../tasks/LocalShellTask/LocalShellTask.tsx'),
      'utf8',
    )
    expect(yve).toContain(
      'bag.withdrawShellNotification ??= withdrawQueuedBashTaskNotification',
    )
    expect(yve).toContain('agentId: agentId ?? getMainThreadAgentId()')
    expect(yve).toContain("leftoverY('task_local_shell')")
    expect(yve).toContain('task_local_shell_failed')
    expect(bag).toContain('removeKeepaliveReason')
    expect(bag).toContain('addKeepaliveReason')
    expect(bag).toContain('bash:${taskId}')
    const getTask = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/GetTaskTool/GetTaskTool.ts',
      ),
      'utf8',
    )
    expect(getTask).toContain('withdrawShellNotification')
    expect(getTask).toContain('markBashTaskSnapshotFetched')
    expect(getTask).toContain('getAgentContext')
    expect(getTask).toContain('RemoteBackgroundShells')
    expect(getTask).toContain('formatWorkingGetTaskStatusMessage')
    expect(getTask).toContain('jboRemoteBackground')
    expect(getTask).toContain('host.transport')
    expect(getTask).toContain("op: 'outcome_of'")
    expect(getTask).toContain('discriminatedUnion')
    const execRemote = readFileSync(
      join(import.meta.dir, '../../services/tools/toolExecution.ts'),
      'utf8',
    )
    expect(execRemote).toContain('rememberRemoteBackgroundShell')
    expect(execRemote).toContain('.started(')
    const persist = readFileSync(
      join(import.meta.dir, '../toolResultStorage.ts'),
      'utf8',
    )
    expect(persist).toContain('truncateToUtf8Bytes')
    expect(persist).toContain('truncatedAtBytes')
    expect(yve).toContain("'deadline'")
    const bash = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/BashTool/BashTool.tsx',
      ),
      'utf8',
    )
    expect(bash).toContain('formatBackgroundTaskResult')
    expect(bash).toContain('formatBackgroundShellCopy')
    expect(bash).toContain('truncatedAtBytes')
    expect(bash).toContain('isBackgroundedToDeliverMessage')
    expect(bash).toContain('timedOutAfterMs')
    const exec = readFileSync(
      join(import.meta.dir, '../../services/tools/StreamingToolExecutor.ts'),
      'utf8',
    )
    expect(exec).toContain('processPreMappedToolResultBlock')
    expect(print).toContain('taskDelivery: cmd.taskDelivery')
    expect(engine).toContain('taskDelivery: options?.taskDelivery')
    expect(pui).toContain('taskDelivery,')
    expect(krr).toContain('getIsNonInteractiveSession')
    expect(krr).toContain('tengu_cosmic_shore')
    expect(krr).toContain('claude-vscode')
    expect(krr).toContain('backgroundShellDeadlineMs')
    expect(krr).not.toContain('if (!getIsInteractive()) return undefined')
    expect(getTask).toContain('backgroundTaskEnding')
    expect(getTask).toContain('ctx.isAsync === false')
    expect(getTask).toContain('RemoteToolHosts')
    expect(getTask).toContain('.resolve(rec.hostName)')
    expect(getTask).toContain('host.transport')
    const rF = readFileSync(join(import.meta.dir, '../toolState.ts'), 'utf8')
    expect(rF).toContain('replaceRemoteHosts')
    expect(rF).toContain("'session'")
    expect(rF).toContain("'bridge'")
    expect(rF).toContain("'loopback'")
    expect(rF).toContain("status: 'offline'")
    expect(rF).toContain('changed:')
    expect(rF).toContain('servedTools')
    expect(rF).toContain('hosts()')
    expect(rF).toContain('#t()')
    const host = readFileSync(
      join(import.meta.dir, '../../services/tools/remoteToolHost.ts'),
      'utf8',
    )
    expect(host).toContain('hostsForTable')
    expect(host).toContain('syncSessionRemoteHosts')
    expect(host).toContain('refreshRemoteToolHosts')
    expect(host).toContain('applyBridgeRemoteHosts')
    expect(host).toContain("logEvent('tengu_remote_tool_targets'")
    expect(host).toContain("source: 'session'")
    expect(host).toContain("? 'withdrawn'")
    expect(host).toContain("replaceRemoteHosts('bridge'")
    expect(host).toContain('DEVICE_BRIDGE_MCP_NAME')
    expect(host).toContain('class RemoteSessionRegistry')
    expect(host).toContain('bridgeHostsFromToolList')
    expect(host).toContain('skipBridgeListingForAgent')
    expect(host).toContain('attached-machine')
    expect(host).toContain('anthropic/remoteToolExecution')
    expect(host).toContain('anthropic/devicePassthrough')
    expect(host).toContain('createBridgeTransport')
    expect(host).toContain('parseBridgeToolList')
    expect(host).toContain('two_names')
    expect(host).toContain('unreadableMarkers')
    expect(host).toContain('__remote_tool_call')
    expect(host).toContain('callPlumbing')
    expect(host).toContain('plumbingTools')
    expect(host).toContain('rejectedPassthroughTools')
    expect(host).toContain('malformed result envelope')
    expect(host).toContain('rejected the session again')
    expect(host).toContain('office_bridge.kind')
    expect(host).toContain('ensureConnectedClient')
    expect(host).toContain('../mcp/client.js')
    expect(host).toContain('remote tool execution')
    expect(host).toContain('remaining <= 0')
    expect(host).toContain('isMcpSessionExpiredError')
    expect(host).toContain('claudeai-proxy')
    const mcpClient = readFileSync(
      join(import.meta.dir, '../../services/mcp/client.ts'),
      'utf8',
    )
    expect(mcpClient).toContain('timeoutMs')
    expect(mcpClient).toContain('connectToServerMemo')
    expect(mcpClient).not.toContain('connectToServerMemo.cache.delete')
    expect(mcpClient).toContain('do not abandon the shared handshake')
    expect(mcpClient).toContain('wrappedClient.cleanup()')
    expect(mcpClient).toContain(
      'deadline reached before the request could be sent',
    )
    const extras = readFileSync(
      join(import.meta.dir, '../../cli/printControlExtras.ts'),
      'utf8',
    )
    expect(extras).toContain('refreshRemoteToolHosts')
    expect(extras).toContain('refreshRemoteToolHosts(')
    expect(print).toContain('toolState: sessionToolState')
    expect(getTask).toContain('.call(')
    expect(getTask).toContain("op: 'outcome_of'")
    expect(getTask).not.toContain('getIsNonInteractiveSession')
    expect(getTask).not.toContain('isBackgroundAgent === false')
    expect(getTask).toContain('truncateUtf16Chars')
    expect(getTask).toContain('utf16le')
    expect(getTask).toContain('31_622_400_000')
    expect(getTask).toContain(
      'no status for a background command on an attached machine',
    )
    expect(getTask).toContain("kind === 'remote'")
    expect(getTask).toContain('task.agentId !== caller')
    expect(yve).toContain('tengu_background_shell_settled')
    expect(yve).toContain('installBackgroundDeadline')
    expect(yve).toContain('backgroundShellDeadlineMs')
    expect(yve).toContain("leftoverY('task_local_shell_background_all')")
  })

  test('qce rejects malformed snapshots and append strips apiBlockIndices', () => {
    const id = randomUUID()
    const now = new Date().toISOString()
    const host = {
      type: 'assistant' as const,
      uuid: randomUUID(),
      timestamp: now,
      apiBlockIndex: 0,
      apiBlockIndices: [0],
      message: {
        id: 'msg_host',
        role: 'assistant' as const,
        content: [
          { type: 'tool_use' as const, id: 'tu_1', name: 'Bash', input: {} },
        ],
      },
    }
    expect(
      spliceBashTaskDelivery(
        [host],
        { taskId: 't1', status: 'completed' },
        id,
        { report: true, inDrainPosition: true },
      ),
    ).toBe(false)

    const api = [host]
    const spliced = spliceBashTaskDelivery(
      api,
      {
        taskId: 't1',
        status: 'completed',
        statusMessage: 'done',
        createdAt: now,
        lastUpdatedAt: now,
        result: { content: [{ type: 'text', text: 'out' }], isError: false },
      },
      randomUUID(),
      { report: true, inDrainPosition: true },
    )
    expect(spliced).toBe('append')
    expect(api[0]).not.toHaveProperty('apiBlockIndex')
    expect(api[0]).not.toHaveProperty('apiBlockIndices')
  })
})
