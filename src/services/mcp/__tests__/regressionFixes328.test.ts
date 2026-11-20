import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactTool } from '../../../../packages/builtin-tools/src/tools/ArtifactTool/ArtifactTool.js'
import {
  buildNewArtifactOrgApprovalSurfaceOpts,
  checkNewArtifactOrgApprovalSurface,
  consumeApprovedPublishSourcePin,
  recordApprovedPublishSourcePin,
} from '../../../../packages/builtin-tools/src/tools/ArtifactTool/permissions.js'
import { hasPermissionsToUseTool } from '../../../utils/permissions/permissions.js'
import { runToolUse } from '../../tools/toolExecution.js'
import {
  chromeFileUploadCredentialDeniedMessage,
  chromeFileUploadDeniedMessage,
  isCredentialFileForChromeUpload,
} from '../../../utils/claudeInChrome/fileUpload.js'
import type { MCPServerConnection, ScopedMcpServerConfig } from '../types.js'
import {
  bumpReconnectGeneration,
  runReconnectWithBackoffForServer,
  startSlowBackgroundReconnectForServer,
} from '../useManageMCPConnections.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(d)
  return d
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

describe('Regression fixes — Artifact / Chrome / MCP (P0 #2, P1 #5, P1 #6, P1 #7)', () => {
  test('P0 #2a: ArtifactTool call rejects TOCTOU file content swap when sha256 mismatches after readFile', async () => {
    const dir = makeTempDir('art-toctou-')
    const file = join(dir, 'page.html')
    const approvedBytes = Buffer.from('<h1>Approved</h1>')
    writeFileSync(file, approvedBytes)
    const st = statSync(file, { bigint: true })
    const toolUseId = 'tu-toctou-1'
    recordApprovedPublishSourcePin(toolUseId, {
      pin: {
        kind: 'file',
        dev: st.dev,
        ino: st.ino,
        sizeBytes: st.size,
        mtimeNs: st.mtimeNs,
        leafWasLink: false,
      },
      sha256: createHash('sha256').update(approvedBytes).digest('hex'),
    })
    // Same byte length as approvedBytes, overwritten in-place (same dev/ino/size)
    writeFileSync(file, Buffer.from('<h1>TAMPERED</h1>'))

    const res = await ArtifactTool.call(
      { file_path: file } as never,
      {
        toolUseId,
        abortController: new AbortController(),
        getAppState: () => ({
          orgRequiresNewArtifactApproval: false,
          toolPermissionContext: { mode: 'default' },
        }),
      } as never,
      (async () => ({ behavior: 'allow', updatedInput: {} })) as never,
      {} as never,
    )
    expect((res.data as { error?: string }).error).toContain(
      'changed between approval and publish',
    )
  })

  test('P0 #2b: approvedPublishSourcePins caps at 64 entries with FIFO eviction', () => {
    const pin = {
      kind: 'file' as const,
      dev: 1n,
      ino: 2n,
      sizeBytes: 10n,
      mtimeNs: 100n,
      leafWasLink: false,
    }
    for (let i = 0; i < 70; i++) {
      recordApprovedPublishSourcePin(`fifo-key-${i}`, { pin, sha256: `h${i}` })
    }
    // Oldest 6 evicted
    for (let i = 0; i < 6; i++) {
      expect(consumeApprovedPublishSourcePin(`fifo-key-${i}`)).toBeUndefined()
    }
    // Newest 64 retained
    for (let i = 6; i < 70; i++) {
      expect(consumeApprovedPublishSourcePin(`fifo-key-${i}`)?.sha256).toBe(
        `h${i}`,
      )
    }
  })

  test('P1 #5: Chrome file_upload credential checks, strict template allowlist, and control char sanitization', () => {
    const mustBlock = [
      '/project/tls.key',
      '/project/app.keystore',
      '/project/trust.jks',
      '/home/u/work_rsa',
      '/home/u/work_ed25519_sk',
      '/project/secrets.yaml',
      '/project/secret.toml',
      '/project/prod.env',
      '/home/u/.ssh/known_hosts',
      '/home/u/.aws/config',
      '/home/u/.gnupg/trustdb.gpg',
      '/home/u/.kube/config',
      '/home/u/.claude/state/settings-review.json',
      '/Users/u/Library/Keychains/login.keychain-db',
      '/repo/.git/config',
      '/repo/.envrc',
      '/repo/.mcp.json',
      '/home/u/.pgpass',
      '/home/u/.my.cnf',
      '/home/u/.boto',
      '/home/u/.s3cfg',
      '/home/u/kubeconfig-prod',
      // Removed from SAFE_CREDENTIAL_TEMPLATE_EXTS:
      '/repo/.env.md',
      '/repo/.env.txt',
      '/repo/.env.schema',
      '/repo/.env.types',
    ]
    for (const p of mustBlock) {
      expect(isCredentialFileForChromeUpload(p)).toBe(true)
    }

    const mustAllow = [
      '/repo/.env.example',
      '/repo/.env.sample',
      '/repo/.env.template',
      '/repo/.env.dist',
      '/repo/example.env',
      '/repo/README.md',
    ]
    for (const p of mustAllow) {
      expect(isCredentialFileForChromeUpload(p)).toBe(false)
    }

    // Control characters and quotes sanitized to U+FFFD
    const evilPath = '/tmp/a"b\nc\rd\u0000e\u2028f'
    const credMsg = chromeFileUploadCredentialDeniedMessage(evilPath)
    const denyMsg = chromeFileUploadDeniedMessage(evilPath)
    expect(credMsg).not.toContain('\n')
    expect(credMsg).not.toContain('\r')
    expect(credMsg).not.toContain('\u0000')
    expect(credMsg).toContain('\uFFFD')
    expect(denyMsg).not.toContain('\n')
    expect(denyMsg).toContain('\uFFFD')
  })

  test('P1 #6: Artifact org approval excludes CLAUDE_CODE_ACTION/CLAUDE_JOB_DIR/remote_trigger, forwards allowGivenBy/permissionPipelineResult, and auto mode respects suppressAlwaysAllowRule', async () => {
    const actionOpts = buildNewArtifactOrgApprovalSurfaceOpts({}, 'default', {
      CLAUDE_CODE_ACTION: '1',
    })
    expect(actionOpts.isInteractiveSurface).toBe(false)
    expect(actionOpts.promptsUnavailable).toBe(true)
    expect(
      checkNewArtifactOrgApprovalSurface({
        orgRequiresNewArtifactApproval: true,
        isNewArtifact: true,
        ...actionOpts,
      })?.behavior,
    ).toBe('deny')

    const jobOpts = buildNewArtifactOrgApprovalSurfaceOpts({}, 'default', {
      CLAUDE_JOB_DIR: '/tmp/job-1',
    })
    expect(jobOpts.isInteractiveSurface).toBe(false)
    expect(jobOpts.promptsUnavailable).toBe(true)

    const triggerOpts = buildNewArtifactOrgApprovalSurfaceOpts({}, 'default', {
      CLAUDE_CODE_ENTRYPOINT: 'remote_trigger',
    })
    expect(triggerOpts.scheduledTriggerWithoutHuman).toBe(true)
    expect(
      checkNewArtifactOrgApprovalSurface({
        orgRequiresNewArtifactApproval: true,
        isNewArtifact: true,
        ...triggerOpts,
      })?.behavior,
    ).toBe('deny')

    const outsideOpts = buildNewArtifactOrgApprovalSurfaceOpts(
      {
        messages: [{ type: 'user', origin: { kind: 'channel' } }],
      },
      'default',
      {},
    )
    expect(outsideOpts.outsideOpened).toBe(true)

    // Auto mode must NOT bypass ask when suppressAlwaysAllowRule === true (e.g. subagent)
    const permRes = await ArtifactTool.checkPermissions!(
      { file_path: '/tmp/doc.md' } as never,
      {
        agentId: 'subagent-1',
        abortController: new AbortController(),
        getAppState: () => ({
          toolPermissionContext: { mode: 'auto' },
          orgRequiresNewArtifactApproval: false,
        }),
      } as never,
    )
    expect(permRes.behavior).toBe('ask')

    // callUpload forwards allowGivenBy & permissionPipelineResult to isNewArtifactApprovedByPerson
    const dir = makeTempDir('art-org-approve-')
    const file = join(dir, 'index.html')
    writeFileSync(file, '<p>hi</p>')
    const pluginApproved = await ArtifactTool.call(
      { file_path: file } as never,
      {
        toolUseId: 'tu-plugin-1',
        abortController: new AbortController(),
        allowGivenBy: { toolUseId: 'tu-plugin-1', approver: 'plugin' },
        getAppState: () => ({
          orgRequiresNewArtifactApproval: true,
          sessionHooks: new Map(),
          toolPermissionContext: { mode: 'default' },
        }),
      } as never,
      (async () => ({ behavior: 'allow', updatedInput: {} })) as never,
      {} as never,
    )
    expect((pluginApproved.data as { error?: string }).error).toContain(
      'requires a person to approve each new artifact',
    )
  })

  test('P1 #7: slow background reconnect closes superseded connected transport, passes attemptEpoch, and re-checks policy & live row', async () => {
    const config: ScopedMcpServerConfig = {
      type: 'http',
      url: 'https://mcp.remote.example.com/v1',
      scope: 'user',
    }
    const timers = new Map<string, NodeJS.Timeout>()
    const closedClients: MCPServerConnection[] = []
    const delivered: Array<{ attemptEpoch?: number; type: string }> = []
    let resolveReconnect:
      | ((v: {
          client: MCPServerConnection
          tools: never[]
          commands: never[]
        }) => void)
      | undefined
    let liveRow: MCPServerConnection = {
      name: 'srv-1',
      type: 'failed',
      config,
    }

    const started = startSlowBackgroundReconnectForServer('srv-1', config, {
      timers,
      getLiveRow: () => liveRow,
      onConnectionAttempt: res => {
        delivered.push({
          attemptEpoch: res.attemptEpoch,
          type: res.client.type,
        })
      },
      reconnect: () =>
        new Promise(resolve => {
          resolveReconnect = resolve as typeof resolveReconnect
        }) as never,
      detachAndClose: async c => {
        closedClients.push(c)
      },
      getIdentityEpoch: () => 42,
      isDisabled: () => false,
      getPolicyBlockReason: () => null,
      computeDelayMs: () => 5,
    })
    expect(started).toBe(true)

    // Wait for timer to fire and enter reconnect
    await new Promise(r => setTimeout(r, 25))
    expect(resolveReconnect).toBeDefined()

    // Cancel/supersede while reconnect is in flight
    timers.delete('srv-1')
    const leakedConn = {
      name: 'srv-1',
      type: 'connected',
      config,
      client: { close: async () => {} },
    } as unknown as MCPServerConnection
    resolveReconnect!({ client: leakedConn, tools: [], commands: [] })
    await new Promise(r => setTimeout(r, 15))

    // Must close superseded connection and NOT deliver it
    expect(closedClients).toEqual([leakedConn])
    expect(delivered).toEqual([])

    // Now verify valid slow reconnect forwards captured attemptEpoch
    const timers2 = new Map<string, NodeJS.Timeout>()
    const validConn = {
      name: 'srv-2',
      type: 'connected',
      config,
      client: { close: async () => {} },
    } as unknown as MCPServerConnection
    liveRow = { name: 'srv-2', type: 'failed', config }
    startSlowBackgroundReconnectForServer('srv-2', config, {
      timers: timers2,
      getLiveRow: () => liveRow,
      onConnectionAttempt: res => {
        delivered.push({
          attemptEpoch: res.attemptEpoch,
          type: res.client.type,
        })
      },
      reconnect: (async () => ({
        client: validConn,
        tools: [],
        commands: [],
      })) as never,
      detachAndClose: async c => {
        closedClients.push(c)
      },
      getIdentityEpoch: () => 77,
      isDisabled: () => false,
      getPolicyBlockReason: () => null,
      computeDelayMs: () => 5,
    })
    await new Promise(r => setTimeout(r, 30))
    expect(delivered).toEqual([{ attemptEpoch: 77, type: 'connected' }])
  })

  test('BH2-P1-8: buildNewArtifactOrgApprovalSurfaceOpts & callUpload enforce surface checks and to_this_call human approval', async () => {
    // 1. isInteractiveSurface must be false under bypassPermissions, dontAsk, promptsUnavailable,
    //    scheduledTriggerWithoutHuman, and outsideOpened
    expect(
      buildNewArtifactOrgApprovalSurfaceOpts({}, 'bypassPermissions', {})
        .isInteractiveSurface,
    ).toBe(false)
    expect(
      buildNewArtifactOrgApprovalSurfaceOpts({}, 'dontAsk', {})
        .isInteractiveSurface,
    ).toBe(false)
    expect(
      buildNewArtifactOrgApprovalSurfaceOpts(
        { promptsUnavailable: true },
        'default',
        {},
      ).isInteractiveSurface,
    ).toBe(false)
    expect(
      buildNewArtifactOrgApprovalSurfaceOpts(
        { messages: [{ type: 'user', origin: { kind: 'channel' } }] },
        'default',
        {},
      ).isInteractiveSurface,
    ).toBe(false)
    expect(
      buildNewArtifactOrgApprovalSurfaceOpts({}, 'default', {
        CLAUDE_CODE_ENTRYPOINT: 'remote_trigger',
      }).isInteractiveSurface,
    ).toBe(false)

    // 2. callUpload re-checks checkNewArtifactOrgApprovalSurface and denies in bypassPermissions / outsideOpened
    const dir = makeTempDir('art-bh2-surface-')
    const file = join(dir, 'index.html')
    writeFileSync(file, '<p>hi</p>')

    const bypassRes = await ArtifactTool.call(
      { file_path: file } as never,
      {
        toolUseId: 'tu-bypass-1',
        abortController: new AbortController(),
        getAppState: () => ({
          orgRequiresNewArtifactApproval: true,
          sessionHooks: new Map(),
          toolPermissionContext: { mode: 'bypassPermissions' },
        }),
      } as never,
      (async () => ({ behavior: 'allow', updatedInput: {} })) as never,
      {} as never,
    )
    expect((bypassRes.data as { error?: string }).error).toContain(
      'permission prompts are off or bypassed',
    )

    const outsideRes = await ArtifactTool.call(
      { file_path: file } as never,
      {
        toolUseId: 'tu-outside-1',
        abortController: new AbortController(),
        messages: [{ type: 'user', origin: { kind: 'channel' } }],
        getAppState: () => ({
          orgRequiresNewArtifactApproval: true,
          sessionHooks: new Map(),
          toolPermissionContext: { mode: 'default' },
        }),
      } as never,
      (async () => ({ behavior: 'allow', updatedInput: {} })) as never,
      {} as never,
    )
    expect((outsideRes.data as { error?: string }).error).toContain(
      'permission prompts are off or bypassed',
    )

    // 3. to_this_call (sdk-ts) surface: direct callUpload without human decision or personOnly ask fails closed
    const origEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
    process.env.CLAUDE_CODE_ENTRYPOINT = 'sdk-ts'
    try {
      const sdkNoApproval = await ArtifactTool.call(
        { file_path: file } as never,
        {
          toolUseId: 'tu-sdk-no-ask',
          abortController: new AbortController(),
          options: { isNonInteractiveSession: true },
          getAppState: () => ({
            orgRequiresNewArtifactApproval: true,
            toolPermissionContext: { mode: 'default' },
          }),
        } as never,
        (async () => ({ behavior: 'allow', updatedInput: {} })) as never,
        {} as never,
      )
      expect((sdkNoApproval.data as { error?: string }).error).toContain(
        'no human approval was recorded for this call',
      )

      // When checkPermissions runs first (recording personOnly: true ask) or toolDecisions records user_temporary,
      // callUpload gets past the org approval guard (fails later only at network/auth, not org approval).
      const sdkCtx = {
        toolUseId: 'tu-sdk-approved',
        abortController: new AbortController(),
        options: { isNonInteractiveSession: true },
        toolDecisions: new Map([
          [
            'tu-sdk-approved',
            {
              source: 'user_temporary',
              decision: 'accept',
              timestamp: Date.now(),
            },
          ],
        ]),
        getAppState: () => ({
          orgRequiresNewArtifactApproval: true,
          sessionHooks: new Map(),
          toolPermissionContext: { mode: 'default' },
        }),
      }
      const permRes = await ArtifactTool.checkPermissions!(
        { file_path: file } as never,
        sdkCtx as never,
      )
      expect(permRes.behavior).toBe('ask')
      const sdkApproved = await ArtifactTool.call(
        { file_path: file } as never,
        sdkCtx as never,
        (async () => ({ behavior: 'allow', updatedInput: {} })) as never,
        {} as never,
      )
      expect(
        (sdkApproved.data as { error?: string }).error ?? '',
      ).not.toContain('requires a person to approve each new artifact')
    } finally {
      if (origEntrypoint === undefined) {
        delete process.env.CLAUDE_CODE_ENTRYPOINT
      } else {
        process.env.CLAUDE_CODE_ENTRYPOINT = origEntrypoint
      }
    }
  })

  test('BH2-P1-9: runReconnectWithBackoffForServer aborts superseded in-flight reconnects, disposes stale transports, and strips stale client handles on failure', async () => {
    const config: ScopedMcpServerConfig = {
      type: 'http',
      url: 'https://mcp.remote.example.com/v1',
      scope: 'user',
    }
    const timers = new Map<string, NodeJS.Timeout>()
    const generations = new Map<string, number>()
    const updates: MCPServerConnection[] = []
    const delivered: Array<{
      attemptEpoch?: number
      client: MCPServerConnection
    }> = []
    const closedClients: MCPServerConnection[] = []
    let exhaustedCount = 0

    const closedHandle = { close: async () => {} }
    let liveRow: MCPServerConnection = {
      name: 'srv-race',
      type: 'connected',
      config,
      client: closedHandle,
    } as unknown as MCPServerConnection

    let resolveAttempt:
      | ((v: {
          client: MCPServerConnection
          tools: never[]
          commands: never[]
        }) => void)
      | undefined

    const runPromise = runReconnectWithBackoffForServer('srv-race', config, {
      timers,
      generations,
      getLiveRow: () => liveRow,
      updateServer: u => {
        updates.push(u)
        liveRow = u
      },
      onConnectionAttempt: res => {
        delivered.push({ attemptEpoch: res.attemptEpoch, client: res.client })
        liveRow = res.client
      },
      onExhaustedFailed: () => {
        exhaustedCount++
      },
      reconnect: () =>
        new Promise(resolve => {
          resolveAttempt = resolve as typeof resolveAttempt
        }) as never,
      detachAndClose: async c => {
        closedClients.push(c)
      },
      getIdentityEpoch: () => 5,
      isDisabled: () => false,
      getPolicyBlockReason: () => null,
      maxAttempts: 2,
      initialBackoffMs: 5,
      maxBackoffMs: 10,
      closedClientRef: closedHandle,
    })

    // First pending update has no stale client handle
    expect(updates).toHaveLength(1)
    expect(updates[0]!.type).toBe('pending')
    expect('client' in updates[0]!).toBe(false)
    expect(resolveAttempt).toBeDefined()

    // Manual reconnect succeeds while automatic reconnect is in flight
    bumpReconnectGeneration(generations, 'srv-race')
    const manualHandle = { close: async () => {} }
    liveRow = {
      name: 'srv-race',
      type: 'connected',
      config,
      client: manualHandle,
    } as unknown as MCPServerConnection

    // Late automatic reconnect resolves with a connected transport — must be disposed, not installed
    const lateConn = {
      name: 'srv-race',
      type: 'connected',
      config,
      client: { close: async () => {} },
    } as unknown as MCPServerConnection
    resolveAttempt!({ client: lateConn, tools: [], commands: [] })
    await runPromise

    expect(closedClients).toEqual([lateConn])
    expect(delivered).toEqual([])
    expect(exhaustedCount).toBe(0)
    expect(liveRow.type).toBe('connected')
    expect((liveRow as { client?: unknown }).client).toBe(manualHandle)

    // Exhausted throw path emits clean failed row without any stale client property
    const updates2: MCPServerConnection[] = []
    let liveRow2: MCPServerConnection = {
      name: 'srv-fail',
      type: 'pending',
      config,
    }
    let exhausted2 = 0
    await runReconnectWithBackoffForServer('srv-fail', config, {
      timers,
      generations,
      getLiveRow: () => liveRow2,
      updateServer: u => {
        updates2.push(u)
        liveRow2 = u
      },
      onConnectionAttempt: () => {},
      onExhaustedFailed: () => {
        exhausted2++
      },
      reconnect: async () => {
        throw new Error('network down')
      },
      getIdentityEpoch: () => 5,
      isDisabled: () => false,
      getPolicyBlockReason: () => null,
      maxAttempts: 2,
      initialBackoffMs: 1,
      maxBackoffMs: 2,
    })
    expect(exhausted2).toBe(1)
    const lastUpdate = updates2.at(-1)!
    expect(lastUpdate.type).toBe('failed')
    expect('client' in lastUpdate).toBe(false)
  })

  test('D-P0-2: hasPermissionsToUseTool threads toolUseId and runToolUse attaches real post-pipeline permissionPipelineResult (human approval succeeds; non-human hook override fails closed)', async () => {
    const dir = makeTempDir('art-dp02-')
    const file = join(dir, 'index.html')
    writeFileSync(file, '<h1>New Artifact</h1>')

    const origEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
    process.env.CLAUDE_CODE_ENTRYPOINT = 'sdk-ts'
    try {
      // 1. hasPermissionsToUseTool threads toolUseId into ArtifactTool.checkPermissions
      //    and returns post-pipeline `{ behavior: 'ask', personOnly: true }`
      let capturedToolUseId: string | undefined
      const wrappedArtifactTool = {
        ...ArtifactTool,
        checkPermissions: async (
          inp: Parameters<NonNullable<typeof ArtifactTool.checkPermissions>>[0],
          ctx: Parameters<NonNullable<typeof ArtifactTool.checkPermissions>>[1],
        ) => {
          capturedToolUseId = ctx.toolUseId
          return ArtifactTool.checkPermissions!(inp, ctx)
        },
      }

      const makeBaseCtx = () => ({
        abortController: new AbortController(),
        options: {
          tools: [wrappedArtifactTool],
          isNonInteractiveSession: true,
          mcpClients: [],
          agentDefinitions: { activeAgents: [], allAgents: [] },
        },
        readFileState: new Map(),
        messages: [],
        getAppState: () => ({
          orgRequiresNewArtifactApproval: true,
          sessionHooks: new Map(),
          toolPermissionContext: {
            mode: 'default' as const,
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          },
          mcp: { tools: [], clients: [] },
        }),
        setAppState: () => {},
      })

      const assistantMsg = {
        type: 'assistant',
        uuid: 'asst-dp02',
        message: { id: 'msg-dp02', role: 'assistant', content: [] },
      }

      // Case A: Legitimate human approval after hasPermissionsToUseTool returns personOnly ask
      const humanToolUseId = 'tu-dp02-human'
      const humanResults: string[] = []
      for await (const ev of runToolUse(
        {
          type: 'tool_use',
          id: humanToolUseId,
          name: ArtifactTool.name,
          input: { file_path: file },
        } as never,
        assistantMsg as never,
        (async (
          tool: Parameters<typeof hasPermissionsToUseTool>[0],
          inp: Parameters<typeof hasPermissionsToUseTool>[1],
          ctx: Parameters<typeof hasPermissionsToUseTool>[2],
          msg: Parameters<typeof hasPermissionsToUseTool>[3],
          id: Parameters<typeof hasPermissionsToUseTool>[4],
        ) => {
          const pipelineRes = await hasPermissionsToUseTool(
            tool,
            inp,
            ctx,
            msg,
            id,
          )
          expect(pipelineRes.behavior).toBe('ask')
          expect((pipelineRes as { personOnly?: boolean }).personOnly).toBe(
            true,
          )
          // Human approves prompt -> returns allow without non-human decisionReason
          return { behavior: 'allow', updatedInput: inp }
        }) as never,
        makeBaseCtx() as never,
      )) {
        const raw = JSON.stringify(ev)
        if (raw.includes('tool_result')) humanResults.push(raw)
      }
      expect(capturedToolUseId).toBe(humanToolUseId)
      expect(humanResults.join('\n')).not.toContain(
        'no human approval was recorded for this call',
      )

      // Case B: Non-human hook overrides personOnly ask to allow -> MUST fail closed!
      // Even though ArtifactTool.checkPermissions ran (and recorded personOnlyAsk),
      // toolExecution attaches the post-pipeline hook allow + allowGivenBy: hook.
      const hookToolUseId = 'tu-dp02-hook-override'
      const hookResults: string[] = []
      for await (const ev of runToolUse(
        {
          type: 'tool_use',
          id: hookToolUseId,
          name: ArtifactTool.name,
          input: { file_path: file },
        } as never,
        assistantMsg as never,
        (async (
          tool: Parameters<typeof hasPermissionsToUseTool>[0],
          inp: Parameters<typeof hasPermissionsToUseTool>[1],
          ctx: Parameters<typeof hasPermissionsToUseTool>[2],
          msg: Parameters<typeof hasPermissionsToUseTool>[3],
          id: Parameters<typeof hasPermissionsToUseTool>[4],
        ) => {
          const pipelineRes = await hasPermissionsToUseTool(
            tool,
            inp,
            ctx,
            msg,
            id,
          )
          expect(pipelineRes.behavior).toBe('ask')
          // PermissionRequest hook overrides ask -> allow
          return {
            behavior: 'allow',
            updatedInput: inp,
            decisionReason: { type: 'hook', hookName: 'PermissionRequest' },
          }
        }) as never,
        makeBaseCtx() as never,
      )) {
        const raw = JSON.stringify(ev)
        if (raw.includes('tool_result')) hookResults.push(raw)
      }
      expect(capturedToolUseId).toBe(hookToolUseId)
      expect(hookResults.join('\n')).toContain(
        'no human approval was recorded for this call',
      )

      // Case C: Explicit post-pipeline allow on ArtifactTool.call is NEVER overridden by recordedPersonOnlyAsk
      const explicitToolUseId = 'tu-dp02-explicit-allow'
      const explicitCtx = {
        toolUseId: explicitToolUseId,
        abortController: new AbortController(),
        options: { isNonInteractiveSession: true },
        permissionPipelineResult: {
          behavior: 'allow',
          decisionReason: { type: 'rule' },
        },
        getAppState: () => ({
          orgRequiresNewArtifactApproval: true,
          sessionHooks: new Map(),
          toolPermissionContext: { mode: 'default' },
        }),
      }
      await ArtifactTool.checkPermissions!(
        { file_path: file } as never,
        explicitCtx as never,
      )
      const explicitRes = await ArtifactTool.call(
        { file_path: file } as never,
        explicitCtx as never,
        (async () => ({ behavior: 'allow', updatedInput: {} })) as never,
        {} as never,
      )
      expect((explicitRes.data as { error?: string }).error).toContain(
        'no human approval was recorded for this call',
      )
    } finally {
      if (origEntrypoint === undefined) {
        delete process.env.CLAUDE_CODE_ENTRYPOINT
      } else {
        process.env.CLAUDE_CODE_ENTRYPOINT = origEntrypoint
      }
    }
  })

  test('D-P1-6 + D-P2-9: mid-flight disabled/policy/epoch supersession transitions pending row out of pending (while generation bump leaves it alone) and needs-auth short-circuits backoff immediately', async () => {
    const config: ScopedMcpServerConfig = {
      type: 'http',
      url: 'https://mcp.remote.example.com/v1',
      scope: 'user',
    }

    // 1. Disabled mid-flight while liveRow is pending -> transitions to disabled
    {
      const timers = new Map<string, NodeJS.Timeout>()
      const generations = new Map<string, number>()
      let disabled = false
      let liveRow = {
        name: 'srv-disable-mid',
        type: 'failed',
        config,
      } as MCPServerConnection
      let resolveAttempt:
        | ((v: {
            client: MCPServerConnection
            tools: never[]
            commands: never[]
          }) => void)
        | undefined
      const p = runReconnectWithBackoffForServer('srv-disable-mid', config, {
        timers,
        generations,
        getLiveRow: () => liveRow,
        updateServer: u => {
          liveRow = u
        },
        onConnectionAttempt: res => {
          liveRow = res.client
        },
        reconnect: () =>
          new Promise(r => {
            resolveAttempt = r as typeof resolveAttempt
          }) as never,
        getIdentityEpoch: () => 1,
        isDisabled: () => disabled,
        getPolicyBlockReason: () => null,
        maxAttempts: 3,
        initialBackoffMs: 1,
        maxBackoffMs: 2,
      })
      expect(liveRow.type).toBe('pending')
      disabled = true
      resolveAttempt!({
        client: { name: 'srv-disable-mid', type: 'failed', config },
        tools: [],
        commands: [],
      })
      await p
      expect(liveRow.type).toBe('disabled')
    }

    // 2. Managed-policy block mid-flight while liveRow is pending -> transitions to failed
    {
      const timers = new Map<string, NodeJS.Timeout>()
      const generations = new Map<string, number>()
      let policyBlocked = false
      let liveRow = {
        name: 'srv-policy-mid',
        type: 'failed',
        config,
      } as MCPServerConnection
      let resolveAttempt:
        | ((v: {
            client: MCPServerConnection
            tools: never[]
            commands: never[]
          }) => void)
        | undefined
      const p = runReconnectWithBackoffForServer('srv-policy-mid', config, {
        timers,
        generations,
        getLiveRow: () => liveRow,
        updateServer: u => {
          liveRow = u
        },
        onConnectionAttempt: res => {
          liveRow = res.client
        },
        reconnect: () =>
          new Promise(r => {
            resolveAttempt = r as typeof resolveAttempt
          }) as never,
        getIdentityEpoch: () => 1,
        isDisabled: () => false,
        getPolicyBlockReason: () => (policyBlocked ? 'managed-policy' : null),
        maxAttempts: 3,
        initialBackoffMs: 1,
        maxBackoffMs: 2,
      })
      expect(liveRow.type).toBe('pending')
      policyBlocked = true
      resolveAttempt!({
        client: { name: 'srv-policy-mid', type: 'failed', config },
        tools: [],
        commands: [],
      })
      await p
      expect(liveRow.type).toBe('failed')
    }

    // 3. Identity-epoch change mid-flight while liveRow is pending -> transitions to failed
    {
      const timers = new Map<string, NodeJS.Timeout>()
      const generations = new Map<string, number>()
      let epoch = 10
      let liveRow = {
        name: 'srv-epoch-mid',
        type: 'failed',
        config,
      } as MCPServerConnection
      let resolveAttempt:
        | ((v: {
            client: MCPServerConnection
            tools: never[]
            commands: never[]
          }) => void)
        | undefined
      const p = runReconnectWithBackoffForServer('srv-epoch-mid', config, {
        timers,
        generations,
        getLiveRow: () => liveRow,
        updateServer: u => {
          liveRow = u
        },
        onConnectionAttempt: res => {
          liveRow = res.client
        },
        reconnect: () =>
          new Promise(r => {
            resolveAttempt = r as typeof resolveAttempt
          }) as never,
        getIdentityEpoch: () => epoch,
        isDisabled: () => false,
        getPolicyBlockReason: () => null,
        maxAttempts: 3,
        initialBackoffMs: 1,
        maxBackoffMs: 2,
      })
      expect(liveRow.type).toBe('pending')
      epoch = 11
      resolveAttempt!({
        client: { name: 'srv-epoch-mid', type: 'failed', config },
        tools: [],
        commands: [],
      })
      await p
      expect(liveRow.type).toBe('failed')
    }

    // 4. Generation bump mid-flight (newer manual reconnect owns pending) -> MUST NOT touch pending!
    {
      const timers = new Map<string, NodeJS.Timeout>()
      const generations = new Map<string, number>()
      let liveRow = {
        name: 'srv-gen-mid',
        type: 'failed',
        config,
      } as MCPServerConnection
      let resolveAttempt:
        | ((v: {
            client: MCPServerConnection
            tools: never[]
            commands: never[]
          }) => void)
        | undefined
      const p = runReconnectWithBackoffForServer('srv-gen-mid', config, {
        timers,
        generations,
        getLiveRow: () => liveRow,
        updateServer: u => {
          liveRow = u
        },
        onConnectionAttempt: res => {
          liveRow = res.client
        },
        reconnect: () =>
          new Promise(r => {
            resolveAttempt = r as typeof resolveAttempt
          }) as never,
        getIdentityEpoch: () => 1,
        isDisabled: () => false,
        getPolicyBlockReason: () => null,
        maxAttempts: 3,
        initialBackoffMs: 1,
        maxBackoffMs: 2,
      })
      expect(liveRow.type).toBe('pending')
      bumpReconnectGeneration(generations, 'srv-gen-mid')
      resolveAttempt!({
        client: { name: 'srv-gen-mid', type: 'failed', config },
        tools: [],
        commands: [],
      })
      await p
      expect(liveRow.type).toBe('pending')
    }

    // 5. needs-auth short-circuits backoff immediately after attempt 1
    {
      const timers = new Map<string, NodeJS.Timeout>()
      const generations = new Map<string, number>()
      let attempts = 0
      let exhausted = 0
      const delivered: MCPServerConnection[] = []
      let liveRow = {
        name: 'srv-needs-auth',
        type: 'failed',
        config,
      } as MCPServerConnection
      await runReconnectWithBackoffForServer('srv-needs-auth', config, {
        timers,
        generations,
        getLiveRow: () => liveRow,
        updateServer: u => {
          liveRow = u
        },
        onConnectionAttempt: res => {
          delivered.push(res.client)
          liveRow = res.client
        },
        onExhaustedFailed: () => {
          exhausted++
        },
        reconnect: (async () => {
          attempts++
          return {
            client: { name: 'srv-needs-auth', type: 'needs-auth', config },
            tools: [],
            commands: [],
          }
        }) as never,
        getIdentityEpoch: () => 3,
        isDisabled: () => false,
        getPolicyBlockReason: () => null,
        maxAttempts: 5,
        initialBackoffMs: 1000,
        maxBackoffMs: 5000,
      })
      expect(attempts).toBe(1)
      expect(exhausted).toBe(0)
      expect(delivered).toHaveLength(1)
      expect(delivered[0]!.type).toBe('needs-auth')
      expect(liveRow.type).toBe('needs-auth')
    }
  })
})
