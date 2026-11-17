import { describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../../..')

describe('Shard 3 2.1.289 alignment fixes', () => {
  test('BashTool checkPermissionMode preserves full input fields and rejects mixed compound commands', async () => {
    const { checkPermissionMode } = await import(
      '@claude-code/builtin-tools/tools/BashTool/modeValidation.js'
    )
    const acceptEditsCtx = {
      mode: 'acceptEdits' as const,
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    }
    const input = {
      command: 'mkdir -p /tmp/demo-dir',
      description: 'Create demo directory',
      timeout: 45_000,
      run_in_background: true,
      dangerouslyDisableSandbox: false,
    }
    const allowed = checkPermissionMode(input, acceptEditsCtx)
    expect(allowed.behavior).toBe('allow')
    if (allowed.behavior === 'allow') {
      expect(allowed.updatedInput).toEqual(input)
    }

    // Compound command mixing mkdir + curl must NOT auto-allow in acceptEdits mode (w4t @189696492)
    const mixed = checkPermissionMode(
      {
        command: 'mkdir -p /tmp/demo-dir && curl https://example.com',
        description: 'Mixed command',
      },
      acceptEditsCtx,
    )
    expect(mixed.behavior).toBe('passthrough')
  })

  test('createSubagentContext merges permissionLayers and runAgent syncs sessionEffort with pdSessionEffort', async () => {
    const { createSubagentContext } = await import(
      '../../../utils/forkedAgent.js'
    )
    const { getEffortValueFromLayers, getMainLoopModelFromLayers } =
      await import('../../../engine/permissionLayerReaders.js')
    const { levelSessionEffort } = await import('../../../utils/effort.js')
    const { getDefaultAppState } = await import(
      '../../../state/AppStateStore.js'
    )
    const { createFileStateCacheWithSizeLimit } = await import(
      '../../../utils/fileStateCache.js'
    )

    const baseState = getDefaultAppState()
    expect(baseState.sessionEffort).toEqual({ kind: 'inherit' })

    const parentContext = {
      options: {
        tools: [],
        commands: [],
        mcpClients: [],
        mcpResources: {},
        mainLoopModel: 'claude-sonnet-4-6',
        thinkingConfig: { type: 'disabled' as const },
        isNonInteractiveSession: true,
        debug: false,
        verbose: false,
        agentDefinitions: {
          activeAgents: [],
          allAgents: [],
          allowedAgentTypes: [],
        },
      },
      abortController: new AbortController(),
      messages: [],
      readFileState: createFileStateCacheWithSizeLimit(32),
      getAppState: () => ({
        ...baseState,
        effortValue: 'high' as const,
        sessionEffort: levelSessionEffort('high'),
      }),
      setAppState: () => {},
      setToolPermissionContext: () => {},
      setSessionToolPermissionContext: () => {},
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      permissionLayers: [
        { kind: 'allowed_tools' as const, allowedTools: ['Read'] },
      ],
    }

    const childCtx = createSubagentContext(
      parentContext as unknown as Parameters<typeof createSubagentContext>[0],
      {
        permissionLayers: [
          { kind: 'model', mainLoopModel: 'claude-opus-4-6' },
          { kind: 'effort', effort: 'high' },
        ],
      },
    )

    expect(childCtx.permissionLayers).toEqual([
      { kind: 'allowed_tools', allowedTools: ['Read'] },
      { kind: 'model', mainLoopModel: 'claude-opus-4-6' },
      { kind: 'effort', effort: 'high' },
    ])
    expect(getMainLoopModelFromLayers(childCtx)).toBe('claude-opus-4-6')
    expect(getEffortValueFromLayers(childCtx)).toBe('high')
  })

  test('MonitorTool rejects empty command, uses url control-char message, gates isEnabled, and omits removed outputFile from prompt', async () => {
    const { MonitorTool, buildMonitorInputSchema } = await import(
      '@claude-code/builtin-tools/tools/MonitorTool/MonitorTool.js'
    )
    const schema = buildMonitorInputSchema(false)

    expect(
      schema.safeParse({ command: '', description: 'empty command' }).success,
    ).toBe(false)
    const ctrlUrl = schema.safeParse({
      ws: { url: 'ws://example.com/\x07path' },
      description: 'ws with bell char',
    })
    expect(ctrlUrl.success).toBe(false)
    if (!ctrlUrl.success) {
      expect(
        ctrlUrl.error.issues.some(i =>
          i.message.includes(
            'url contains control characters that would be hidden in the approval dialog',
          ),
        ),
      ).toBe(true)
    }

    const prevDisable = process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS
    try {
      delete process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS
      expect(MonitorTool.isEnabled()).toBe(true)
      process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = '1'
      expect(MonitorTool.isEnabled()).toBe(false)
    } finally {
      if (prevDisable === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS
      } else {
        process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = prevDisable
      }
    }

    const promptText = await MonitorTool.prompt()
    expect(promptText).not.toContain('output file path returned by this tool')
    expect(promptText).toContain('WebSocket')
  })

  test('PowerShellTool mapToolResultToToolResultBlockParam preserves stderr on image output and appends backgroundCwdHint', async () => {
    const { PowerShellTool } = await import(
      '@claude-code/builtin-tools/tools/PowerShellTool/PowerShellTool.js'
    )
    const png1x1 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const imgMapped = PowerShellTool.mapToolResultToToolResultBlockParam(
      {
        stdout: png1x1,
        stderr: 'Shell cwd was reset to project root',
        interrupted: false,
        isImage: true,
      },
      'ps-img-1',
    )
    expect(Array.isArray(imgMapped.content)).toBe(true)
    if (Array.isArray(imgMapped.content)) {
      expect(imgMapped.content.some(b => b.type === 'image')).toBe(true)
      expect(
        imgMapped.content.some(
          b =>
            b.type === 'text' &&
            'text' in b &&
            b.text.includes('Shell cwd was reset to project root'),
        ),
      ).toBe(true)
    }

    const bgMapped = PowerShellTool.mapToolResultToToolResultBlockParam(
      {
        stdout: '',
        stderr: '',
        interrupted: false,
        backgroundTaskId: 'b12345',
        backgroundCwdHint:
          'Session cwd remains /repo; directory changes made by the backgrounded command do not apply to subsequent commands.',
      },
      'ps-bg-1',
    )
    expect(String(bgMapped.content)).toContain('Session cwd remains /repo')
  })

  test('toolResultStorage truncateToUtf8Bytes preserves surrogate pairs and persistToolResult rejects EEXIST symlinks', async () => {
    const {
      truncateToUtf8Bytes,
      persistToolResult,
      ensureToolResultsDir,
      getToolResultPath,
    } = await import('../../../utils/toolResultStorage.js')

    // Astral emoji (4 UTF-8 bytes each): 3 emojis = 12 bytes; cap at 10 bytes -> 2 emojis (8 bytes), no lone surrogate
    const emojis = '😀😀😀'
    const clipped = truncateToUtf8Bytes(emojis, 10)
    expect(clipped).toBe('😀😀')
    expect(Buffer.byteLength(clipped, 'utf8')).toBe(8)

    const { getClaudeConfigHomeDir } = await import(
      '../../../utils/envUtils.js'
    )
    const targetDir = await mkdtemp(join(tmpdir(), 'shard3-tr-'))
    const prevCfgDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = targetDir
    getClaudeConfigHomeDir.cache?.clear?.()
    await ensureToolResultsDir()
    const symlinkId = `shard3-symlink-${Date.now()}`
    const targetFile = join(targetDir, 'secret.txt')
    const resultPath = getToolResultPath(symlinkId, false)
    try {
      await writeFile(targetFile, 'existing-target', 'utf8')
      await symlink(targetFile, resultPath)
      const res = await persistToolResult('hello world', symlinkId)
      expect('error' in res).toBe(true)
      if ('error' in res) {
        expect(res.error).toBe('tool result path is a link; not persisted')
      }
    } finally {
      if (prevCfgDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevCfgDir
      }
      getClaudeConfigHomeDir.cache?.clear?.()
      await rm(resultPath, { force: true })
      await rm(targetDir, { recursive: true, force: true })
    }
  })

  test('ShellCommand clamps >32-bit timeout against 1ms overflow and preserves running child on interrupt abort', async () => {
    const { wrapSpawn } = await import('../../../utils/ShellCommand.js')
    const { TaskOutput } = await import('../../../utils/task/TaskOutput.js')
    const { createAbortErrorReason } = await import(
      '../../../utils/abortController.js'
    )

    const ac = new AbortController()
    const child = spawn(
      process.execPath,
      [
        '--eval',
        'setTimeout(() => { process.stdout.write("SURVIVED_OVERFLOW"); process.exit(0); }, 60)',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const taskOut = new TaskOutput(`shard3-shell-${Date.now()}`, null)
    // 3_000_000_000 > 0x7fffffff would overflow setTimeout to 1ms without clamping
    const cmd = wrapSpawn(child, ac.signal, 3_000_000_000, taskOut, false)
    // Interrupt abort reason (DOMException or string) must NOT kill the child
    ac.abort(createAbortErrorReason('interrupt'))
    const res = await cmd.result
    cmd.cleanup()
    expect(res.code).toBe(0)
    expect(res.interrupted).toBe(false)
    expect(res.stdout).toContain('SURVIVED_OVERFLOW')
  })

  test('runAgent and BashTool preserve keepaliveGated, getMaxTimeoutMs clamping, and subagent permission escalation boundaries', async () => {
    const runAgentSrc = await readFile(
      join(ROOT, 'packages/builtin-tools/src/tools/AgentTool/runAgent.ts'),
      'utf8',
    )
    const bashSrc = await readFile(
      join(ROOT, 'packages/builtin-tools/src/tools/BashTool/BashTool.tsx'),
      'utf8',
    )

    // Finding #2: async parked subagents keep background shells + MCP/WS monitors alive
    expect(runAgentSrc).toContain('const keepaliveGated = Boolean(')
    expect(runAgentSrc).toContain(
      '(hasKeepaliveReasons || hasRunningOwnedBackgroundTasks)',
    )
    expect(runAgentSrc).toContain('if (!keepaliveGated) {')

    // Finding #11: bypassPermissions parent check, bubble plan/dontAsk guard, mcpServerPolicy, worktreePath
    expect(runAgentSrc).toContain(
      "spawnMode !== 'bypassPermissions' &&\n          state.toolPermissionContext.mode !== 'bypassPermissions'",
    )
    expect(runAgentSrc).toContain(
      "agentPermissionMode === 'bubble' &&\n      (state.toolPermissionContext.mode === 'plan' ||\n        state.toolPermissionContext.mode === 'dontAsk')",
    )
    expect(runAgentSrc).toContain(
      'state.toolPermissionContext.alwaysAllowRules.mcpServerPolicy',
    )
    expect(runAgentSrc).toContain(
      '!toolPermissionContext.additionalWorkingDirectories.has(worktreePath)',
    )

    // Finding #9: BashTool caps requested timeout against getMaxTimeoutMs() before auto-background clamp
    expect(bashSrc).toContain(
      'Math.min(timeout || getDefaultTimeoutMs(), getMaxTimeoutMs())',
    )
  })

  test('toolExecution validates permissionDecision.updatedInput, routes remote needs_approval with forceDecision + persistence, preserves detached feedback, and validates synthesized tool.call outputSchema', async () => {
    const subCfgDir = await mkdtemp(join(tmpdir(), 'shard3-subcfg-'))
    const script = `
import { strict as assert } from 'node:assert'
process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(subCfgDir)}
const root = ${JSON.stringify(ROOT)}
const { z } = await import(root + '/node_modules/zod/v4/index.js')
const { setAllowedSettingSources } = await import(root + '/src/bootstrap/state.ts')
setAllowedSettingSources([])

const { runToolUse } = await import(root + '/src/services/tools/toolExecution.ts')
const { buildTool } = await import(root + '/src/Tool.ts')
const { getDefaultAppState } = await import(root + '/src/state/AppStateStore.ts')
const { createAssistantMessage } = await import(root + '/src/utils/messages.ts')
const { ToolStateSlots, RemoteToolHosts } = await import(root + '/src/utils/toolState.ts')
const { backgroundForegroundToolCalls } = await import(root + '/src/utils/foregroundToolCalls.ts')
const { discardDetachedToolCallsOutside } = await import(root + '/src/utils/detachedToolCallStore.ts')
const { getCommandQueue, removeByFilter } = await import(root + '/src/utils/messageQueueManager.ts')
const { setLoadedFunctionHooksModules } = await import(root + '/src/utils/plugins/functionHooksModules.ts')

function makeContext(tools, extra = {}) {
  let state = getDefaultAppState()
  const toolState = new ToolStateSlots()
  return {
    options: {
      tools,
      commands: [],
      mcpClients: [],
      mcpResources: {},
      mainLoopModel: 'test',
      thinkingConfig: { type: 'disabled' },
      isNonInteractiveSession: false,
      debug: false,
      verbose: false,
      agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] },
    },
    abortController: new AbortController(),
    session: { root: {} },
    toolState,
    messages: [],
    readFileState: new Map(),
    getAppState: () => state,
    setAppState: u => { state = u(state) },
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    ...extra,
  }
}

// 1) PERMISSION_UPDATED_INPUT validation on malformed permissionDecision.updatedInput (and empty {} ignored)
let calledWith = null
const strictTool = buildTool({
  name: 'StrictEcho',
  maxResultSizeChars: 200,
  inputSchema: z.strictObject({ text: z.string(), count: z.number().optional() }),
  outputSchema: z.object({ echoed: z.string() }),
  async call(input) {
    calledWith = input
    return { data: { echoed: input.text } }
  },
  mapToolResultToToolResultBlockParam(out, id) {
    return { type: 'tool_result', tool_use_id: id, content: out.echoed }
  },
})

const ctx1 = makeContext([strictTool])
const badUse = { type: 'tool_use', id: 'perm-bad-1', name: 'StrictEcho', input: { text: 'ok' } }
const badAsst = createAssistantMessage({ content: [badUse] })
const badOut = []
for await (const u of runToolUse(badUse, badAsst, async () => ({
  behavior: 'allow',
  updatedInput: { text: 12345 },
}), ctx1)) {
  if ('message' in u) badOut.push(u.message)
}
assert.equal(calledWith, null, 'tool.call must not execute when permission updatedInput fails schema')
const errBlock = badOut[0]?.message?.content?.[0]
assert.equal(errBlock?.is_error, true)
assert.ok(String(errBlock?.content).includes('The permission handler returned updatedInput for StrictEcho that failed schema validation'))

// Empty {} updatedInput (Q2e) must NOT clobber valid model input
const emptyUse = { type: 'tool_use', id: 'perm-empty-1', name: 'StrictEcho', input: { text: 'kept' } }
const emptyAsst = createAssistantMessage({ content: [emptyUse] })
for await (const u of runToolUse(emptyUse, emptyAsst, async () => ({
  behavior: 'allow',
  updatedInput: {},
}), ctx1)) {
  void u
}
assert.deepEqual(calledWith, { text: 'kept' })

// 2) Remote routed_host needs_approval: passes 6th arg forceDecision, preserves _host, forwards updatedInput + feedback, and persists >maxResultSizeChars!
process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD = '1'
const remoteTool = buildTool({
  name: 'Bash',
  maxResultSizeChars: 120,
  remoteExecution: { supported: true },
  inputSchema: z.strictObject({ command: z.string() }),
  async call() {
    throw new Error('should not run locally')
  },
  mapToolResultToToolResultBlockParam(out, id) {
    return { type: 'tool_result', tool_use_id: id, content: String(out) }
  },
})
const ctxRemote = makeContext([remoteTool])
const transportCalls = []
ctxRemote.toolState.get(RemoteToolHosts).replaceRemoteHosts('bridge', [
  {
    kind: 'remote',
    source: 'bridge',
    name: 'prodbox',
    status: 'online',
    enforcement: 'self',
    servedTools: new Set(['Bash']),
    protocol: { kind: 'compatible', version: 1 },
    transport: {
      call: async (name, input, env) => {
        transportCalls.push({ name, input, env })
        if (env.op === 'call') {
          return {
            kind: 'result',
            envelope: {
              v: 1,
              outcome: 'needs_approval',
              call_id: 'rcall-99',
              ask: { message: 'Run deploy script' },
            },
          }
        }
        return {
          kind: 'result',
          text: 'X'.repeat(500),
          isError: false,
        }
      },
    },
  },
])
let capturedDialogInput = null
let capturedForceDecision = null
const remoteUse = { type: 'tool_use', id: 'remote-1', name: 'Bash', input: { command: ' ./deploy.sh ', _host: 'prodbox' } }
const remoteAsst = createAssistantMessage({ content: [remoteUse] })
const remoteUpdates = []
for await (const u of runToolUse(remoteUse, remoteAsst, async (_t, inp, _c, _a, _id, forced) => {
  capturedDialogInput = inp
  capturedForceDecision = forced
  return {
    behavior: 'allow',
    updatedInput: { command: './deploy.sh --dry-run', _host: 'prodbox' },
    acceptFeedback: 'use dry-run only',
  }
}, ctxRemote)) {
  if ('message' in u) remoteUpdates.push(u.message)
}
assert.equal(capturedDialogInput?._host, 'prodbox', '_host must be preserved on remote approval dialog input')
assert.equal(capturedForceDecision?.behavior, 'ask', '6th arg forceDecision must force ask instead of local auto-allow')
assert.equal(capturedForceDecision?.suppressAlwaysAllowRule, true)
assert.ok(String(capturedForceDecision?.message).includes('(runs on prodbox) Run deploy script'))
assert.equal(transportCalls.length, 2)
assert.deepEqual(transportCalls[1].input, { command: './deploy.sh --dry-run' })
assert.deepEqual(transportCalls[1].env.updatedInput, { command: './deploy.sh --dry-run' })
assert.equal(transportCalls[1].env.feedback, 'use dry-run only')
const remoteUserMsg = remoteUpdates.find(m => m.type === 'user')
const remoteContent = String(remoteUserMsg?.message?.content?.[0]?.content ?? '')
assert.ok(remoteContent.includes('<persisted-output>'), 'oversized remote result must persist via processPreMappedToolResultBlock; got: ' + remoteContent.slice(0, 200))

// Cross-host privilege edit in approval must be refused without dispatching leg 2
transportCalls.length = 0
const spoofUse = { type: 'tool_use', id: 'remote-spoof', name: 'Bash', input: { command: 'ls', _host: 'prodbox' } }
const spoofOut = []
for await (const u of runToolUse(spoofUse, createAssistantMessage({ content: [spoofUse] }), async () => ({
  behavior: 'allow',
  updatedInput: { command: 'ls', _host: 'otherbox' },
}), ctxRemote)) {
  if ('message' in u && u.message.type === 'user') spoofOut.push(u.message)
}
assert.equal(transportCalls.length, 1, 'must not send outcome_of when approval switched _host')
assert.equal(spoofOut[0]?.message?.content?.[0]?.is_error, true)
delete process.env.CLAUDE_CODE_REMOTE_TOOLS_FORWARD

// 3) Detached tool call: preserves acceptFeedback + pasted image + toolDuration, and drops notification on /clear (stillHeard)
let resolveSlowFetch
const detachTool = buildTool({
  name: 'SlowFetch',
  backgrounding: 'detach',
  maxResultSizeChars: 100_000,
  inputSchema: z.object({ url: z.string() }),
  async call() {
    const body = await new Promise(r => { resolveSlowFetch = r })
    return { data: { body } }
  },
  mapToolResultToToolResultBlockParam(out, id) {
    return { type: 'tool_result', tool_use_id: id, content: out.body }
  },
})
const ctxDetach = makeContext([detachTool])
const detachUse = { type: 'tool_use', id: 'detach-clear-1', name: 'SlowFetch', input: { url: 'https://example.com' } }
const detachAsst = createAssistantMessage({ content: [detachUse] })
removeByFilter(() => true)
const detachPromise = (async () => {
  const all = []
  for await (const u of runToolUse(detachUse, detachAsst, async () => ({
    behavior: 'allow',
    updatedInput: { url: 'https://example.com' },
    acceptFeedback: 'check header',
    contentBlocks: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }],
  }), ctxDetach)) {
    all.push(u)
  }
  return all
})()
await new Promise(r => setTimeout(r, 20))
const detachedCount = backgroundForegroundToolCalls(ctxDetach.session)
assert.equal(detachedCount, 1)
const detachEarlyUpdates = await detachPromise
const earlyMsgUpdate = detachEarlyUpdates.find(u => 'message' in u && u.message.type === 'user')
assert.ok(earlyMsgUpdate?.toolDuration && typeof earlyMsgUpdate.toolDuration.durationMs === 'number')
assert.ok(earlyMsgUpdate.message.message.content.some(b => b.type === 'text' && b.text === 'check header'))
assert.ok(earlyMsgUpdate.message.message.content.some(b => b.type === 'image'))
assert.deepEqual(earlyMsgUpdate.message.imagePasteIds, [1])

// Clear conversation while slow fetch resolves into async persistence -> notification must NOT leak into queue
resolveSlowFetch('Y'.repeat(120_000))
discardDetachedToolCallsOutside([], new Set(['detach-clear-1']), ctxDetach.session)
await new Promise(r => setTimeout(r, 50))
assert.equal(getCommandQueue().filter(q => q.mode === 'task-notification').length, 0, 'cleared detached call must not enqueue notification')

// 4) tool.call synthesized result without core must validate against tool.outputSchema even when result is omitted / text is set
setLoadedFunctionHooksModules([
  {
    name: 'bad-synth-plugin',
    patterns: ['tool.call'],
    hooks: [
      {
        pattern: 'tool.call',
        matcher: 'StrictEcho',
        hook: async () => ({ text: 'spoofed text bypassing outputSchema' }),
      },
    ],
  },
])
const synthUse = { type: 'tool_use', id: 'synth-bad-1', name: 'StrictEcho', input: { text: 'hi' } }
const synthMsgs = []
for await (const u of runToolUse(synthUse, createAssistantMessage({ content: [synthUse] }), async () => ({ behavior: 'allow' }), ctx1)) {
  if ('message' in u && u.message.type === 'user') synthMsgs.push(u.message)
}
setLoadedFunctionHooksModules([])
const synthBlock = synthMsgs[0]?.message?.content?.[0]
assert.equal(synthBlock?.is_error, true)
assert.ok(String(synthBlock?.content).includes('tool.call step resolved StrictEcho with a result that does not match its output shape'))

console.log('SHARD3_SUBPROC_OK')
process.exit(0)
`
    try {
      const child = Bun.spawn({
        cmd: [process.execPath, '--eval', script],
        cwd: ROOT,
        env: {
          ...process.env,
          CLAUDE_CONFIG_DIR: subCfgDir,
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
      expect(stdout).toContain('SHARD3_SUBPROC_OK')
    } finally {
      await rm(subCfgDir, { recursive: true, force: true })
    }
  }, 30_000)
})
