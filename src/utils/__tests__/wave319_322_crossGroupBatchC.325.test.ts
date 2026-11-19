import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  checkUnchangedImageRereadLimit,
  noteImageMediaStripped,
  resetImageRereadState,
  UNCHANGED_IMAGE_REREAD_LIMIT_MESSAGE,
} from '../../../packages/builtin-tools/src/tools/FileReadTool/FileReadTool.js'
import {
  applyWorkerSessionStrips,
  buildDispatchProviderEnv,
  filterDispatchAllowedEnv,
} from '../../daemon/bgHostManagedEnv.js'
import { getSkillDirCommands } from '../../skills/loadSkillsDir.js'
import type { AppState } from '../../state/AppState.js'
import {
  clearRecentRelayFailuresForTests,
  encodeChunk,
  getRecentRelayFailures,
  startUpstreamProxyRelay,
} from '../../upstreamproxy/relay.js'
import {
  buildClassifierUnavailableMessage,
  formatClassifierWaitDetail,
} from '../messages.js'
import { SERVER_CALL_UNAVAILABLE_INPUT_TOO_LONG } from '../permissions/autoModeUnavailable.js'
import {
  countStrippedImageBlocks,
  stripStoredMediaForRequestLimit,
} from '../subagentCacheEvict.js'
import { getTelemetryAttributes } from '../telemetryAttributes.js'
import {
  invalidateVcsRepositoryAttributesCache,
  VCS_OWNER_NAME,
  VCS_PROVIDER_NAME,
  VCS_REPOSITORY_NAME,
  VCS_REPOSITORY_URL_FULL,
} from '../telemetry/vcsRepositoryAttributes.js'
import {
  getCurrentWorktreeSession,
  getWorktreeExtensionRoot,
  restoreWorktreeSession,
  type WorktreeSession,
} from '../worktree.js'

describe('Wave 319-322 cross-group wiring Batch C', () => {
  const tempDirs: string[] = []
  const origEnv: Record<string, string | undefined> = {}

  function setEnv(key: string, val: string | undefined): void {
    if (!(key in origEnv)) {
      origEnv[key] = process.env[key]
    }
    if (val === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = val
    }
  }

  afterEach(async () => {
    resetImageRereadState()
    restoreWorktreeSession(null)
    getSkillDirCommands.cache?.clear?.()
    clearRecentRelayFailuresForTests()
    invalidateVcsRepositoryAttributesCache()
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    for (const k of Object.keys(origEnv)) delete origEnv[k]
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('#1929: stripStoredMediaForRequestLimit collects stripped images and feeds noteImageMediaStripped -> Wit=3 throttle', () => {
    const agentId = 'batch-c-agent-1929'
    const messages = [
      {
        message: {
          content: [
            { type: 'image', source: { type: 'base64', data: 'IMG1' } },
            { type: 'document', source: { type: 'base64', data: 'DOC1' } },
            { type: 'image', source: { type: 'base64', data: 'IMG2' } },
          ],
        },
      },
    ]
    const strippedOut: Array<{ type: string }> = []
    stripStoredMediaForRequestLimit(
      messages,
      1,
      0,
      Number.POSITIVE_INFINITY,
      0,
      strippedOut,
    )
    expect(strippedOut.map(b => b.type)).toEqual(['image', 'document'])
    const strippedImageCount = countStrippedImageBlocks(strippedOut)
    expect(strippedImageCount).toBe(1)

    noteImageMediaStripped(agentId, strippedImageCount)
    // Official Wit=3, S$r=48: warm up 48 recent repeat reads across images,
    // then reading an unchanged image past its 3rd return is refused.
    for (let i = 0; i < 48; i++) {
      expect(
        checkUnchangedImageRereadLimit(agentId, `/tmp/other-${i}.png`, 'same'),
      ).toBeUndefined()
    }
    for (let i = 0; i < 3; i++) {
      expect(
        checkUnchangedImageRereadLimit(agentId, '/tmp/a.png', 'same-img'),
      ).toBeUndefined()
    }
    expect(
      checkUnchangedImageRereadLimit(agentId, '/tmp/a.png', 'same-img'),
    ).toBe(UNCHANGED_IMAGE_REREAD_LIMIT_MESSAGE)

    // Reporting 0 stripped images clears mediaStripped so reads are allowed again
    noteImageMediaStripped(agentId, 0)
    expect(
      checkUnchangedImageRereadLimit(agentId, '/tmp/a.png', 'same-img'),
    ).toBeUndefined()
  })

  test('#1871: WorktreeSession.extensionRoot preserves discovery of original repo skills & commands without duplicates', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'batchc-repo-'))
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'batchc-wt-'))
    tempDirs.push(repoRoot, worktreeRoot)

    await mkdir(join(repoRoot, '.claude', 'skills', 'orig-skill'), {
      recursive: true,
    })
    await writeFile(
      join(repoRoot, '.claude', 'skills', 'orig-skill', 'SKILL.md'),
      '---\ndescription: Original repo skill\n---\nRun original skill.\n',
    )
    await mkdir(join(repoRoot, '.claude', 'commands'), { recursive: true })
    await writeFile(
      join(repoRoot, '.claude', 'commands', 'orig-cmd.md'),
      '---\ndescription: Original repo command\n---\nRun original cmd.\n',
    )
    await mkdir(join(worktreeRoot, '.claude', 'skills', 'wt-skill'), {
      recursive: true,
    })
    await writeFile(
      join(worktreeRoot, '.claude', 'skills', 'wt-skill', 'SKILL.md'),
      '---\ndescription: Worktree skill\n---\nRun wt skill.\n',
    )

    const session: WorktreeSession = {
      originalCwd: repoRoot,
      worktreePath: worktreeRoot,
      worktreeName: 'wt-1871',
      sessionId: 'sess-1871',
      extensionRoot: repoRoot,
    }
    restoreWorktreeSession(session)
    expect(getCurrentWorktreeSession()?.extensionRoot).toBe(repoRoot)
    expect(getWorktreeExtensionRoot()).toBe(repoRoot)

    getSkillDirCommands.cache?.clear?.()
    const commands = await getSkillDirCommands(worktreeRoot)
    const names = commands.map(c => c.name)
    expect(names).toContain('wt-skill')
    expect(names).toContain('orig-skill')
    expect(names).toContain('orig-cmd')
    // No duplicate entries for orig-skill
    expect(names.filter(n => n === 'orig-skill')).toHaveLength(1)
  })

  test('#1730: buildClassifierUnavailableMessage uses dedicated hard-failure copy for server_call_unavailable_input_too_long', () => {
    const msg = buildClassifierUnavailableMessage(
      'Bash',
      'The server-side auto mode classifier',
      undefined,
      SERVER_CALL_UNAVAILABLE_INPUT_TOO_LONG,
    )
    expect(msg).toContain(
      'The server-side auto mode classifier gave no verdict (the conversation is too long for the check), so auto mode cannot determine the safety of Bash.',
    )
    expect(msg).toContain('This is a hard failure, not a transient one')
    expect(msg).toContain("Don't retry it.")
    expect(
      formatClassifierWaitDetail(
        undefined,
        SERVER_CALL_UNAVAILABLE_INPUT_TOO_LONG,
      ),
    ).toBe(' (the conversation is too long for the check)')
  })

  test('#1873: getTelemetryAttributes gates vcs.* on OTEL_METRICS_INCLUDE_REPOSITORY and honors OTEL_RESOURCE_ATTRIBUTES overrides', () => {
    setEnv('OTEL_METRICS_INCLUDE_REPOSITORY', undefined)
    setEnv(
      'OTEL_RESOURCE_ATTRIBUTES',
      `${VCS_REPOSITORY_URL_FULL}=https://github.com/acme/demo,${VCS_OWNER_NAME}=acme,${VCS_REPOSITORY_NAME}=demo,${VCS_PROVIDER_NAME}=github`,
    )
    const attrsOff = getTelemetryAttributes()
    expect(attrsOff[VCS_REPOSITORY_URL_FULL]).toBeUndefined()

    setEnv('OTEL_METRICS_INCLUDE_REPOSITORY', '1')
    const attrsOn = getTelemetryAttributes()
    expect(attrsOn[VCS_REPOSITORY_URL_FULL]).toBe(
      'https://github.com/acme/demo',
    )
    expect(attrsOn[VCS_OWNER_NAME]).toBe('acme')
    expect(attrsOn[VCS_REPOSITORY_NAME]).toBe('demo')
    expect(attrsOn[VCS_PROVIDER_NAME]).toBe('github')
  })

  test('#1890: bgHostManagedEnv forwards CLAUDE_AX_SCREEN_READER=1 on dispatch and strips inherited/non-1 values', () => {
    const dispatched = buildDispatchProviderEnv({
      source: 'repl',
      currentCwd: '/repo',
      parentEnv: { CLAUDE_AX_SCREEN_READER: '1' },
    })
    expect(dispatched.CLAUDE_AX_SCREEN_READER).toBe('1')

    const notSet = buildDispatchProviderEnv({
      source: 'repl',
      currentCwd: '/repo',
      parentEnv: { CLAUDE_AX_SCREEN_READER: '0' },
    })
    expect(notSet.CLAUDE_AX_SCREEN_READER).toBeUndefined()

    const inheritedEnv: Record<string, string | undefined> = {
      CLAUDE_AX_SCREEN_READER: '1',
    }
    applyWorkerSessionStrips(inheritedEnv)
    expect(inheritedEnv.CLAUDE_AX_SCREEN_READER).toBeUndefined()

    const explicitOne: Record<string, string | undefined> = {
      CLAUDE_AX_SCREEN_READER: '1',
    }
    applyWorkerSessionStrips(explicitOne, { CLAUDE_AX_SCREEN_READER: '1' })
    expect(explicitOne.CLAUDE_AX_SCREEN_READER).toBe('1')

    const explicitZero: Record<string, string | undefined> = {
      CLAUDE_AX_SCREEN_READER: '0',
    }
    applyWorkerSessionStrips(explicitZero, { CLAUDE_AX_SCREEN_READER: '0' })
    expect(explicitZero.CLAUDE_AX_SCREEN_READER).toBeUndefined()

    const allowed = new Set(['CLAUDE_AX_SCREEN_READER', 'PATH'])
    expect(
      filterDispatchAllowedEnv(
        { CLAUDE_AX_SCREEN_READER: '1', PATH: '/usr/bin' },
        allowed,
      ),
    ).toEqual({ CLAUDE_AX_SCREEN_READER: '1', PATH: '/usr/bin' })
    expect(
      filterDispatchAllowedEnv(
        { CLAUDE_AX_SCREEN_READER: '0', PATH: '/usr/bin' },
        allowed,
      ),
    ).toEqual({ PATH: '/usr/bin' })
  })

  test('#1892: upstreamproxy relay distinguishes HTTP 502 (connect_unreachable) from 403 (connect_rejected)', async () => {
    let nextReply = 'HTTP/1.1 502 Bad Gateway\r\n\r\n'
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req)) return undefined
        return new Response('ok')
      },
      websocket: {
        message(ws) {
          ws.sendBinary(
            encodeChunk(new Uint8Array(Buffer.from(nextReply, 'utf8'))),
          )
          setTimeout(() => ws.close(), 15)
        },
      },
    })
    const relay = await startUpstreamProxyRelay({
      wsUrl: `ws://127.0.0.1:${server.port}`,
      sessionId: 'sess-1892',
      token: 'tok-1892',
    })

    const runConnect = async (target: string): Promise<string> =>
      new Promise((resolve, reject) => {
        const sock = createConnection({ host: '127.0.0.1', port: relay.port })
        const chunks: Buffer[] = []
        sock.on('connect', () => {
          sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)
        })
        sock.on('data', chunk =>
          chunks.push(
            typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk,
          ),
        )
        sock.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')))
        sock.on('error', reject)
      })

    try {
      clearRecentRelayFailuresForTests()
      const res502 = await runConnect('dead.internal:443')
      expect(res502).toContain('502')

      nextReply = 'HTTP/1.1 403 Forbidden\r\n\r\n'
      const res403 = await runConnect('blocked.example.com:443')
      expect(res403).toContain('403')

      const failures = getRecentRelayFailures()
      expect(failures).toHaveLength(2)
      expect(failures[0]).toMatchObject({
        host: 'dead.internal:443',
        kind: 'connect_unreachable',
      })
      expect(failures[1]).toMatchObject({
        host: 'blocked.example.com:443',
        kind: 'connect_rejected',
      })
    } finally {
      relay.stop()
      server.stop(true)
    }
  })

  test('#1717: print.ts readPersistedSep2663TaskMetas and restoreHeadlessSep2663Tasks restore SEP-2663 sidecars on resume', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'batchc-mcp-'))
    tempDirs.push(projectDir)
    const sessionId = '11111111-2222-3333-4444-555555555555'
    const tasksDir = join(projectDir, sessionId, 'mcp-tasks')
    await mkdir(tasksDir, { recursive: true })
    await writeFile(
      join(tasksDir, 'mcp-task-task-sep.meta.json'),
      JSON.stringify({
        taskId: 'task-sep',
        serverName: 'claude.ai Demo',
        toolName: 'long_export',
        mcpTaskId: 'srv-task-42',
        protocol: 'sep2663',
        pollIntervalMs: 50,
      }),
    )
    await writeFile(
      join(tasksDir, 'mcp-task-task-legacy.meta.json'),
      JSON.stringify({
        taskId: 'task-legacy',
        serverName: 'old-server',
        toolName: 'legacy_op',
        mcpTaskId: 'srv-old-1',
      }),
    )

    const { readPersistedSep2663TaskMetas, restoreHeadlessSep2663Tasks } =
      await import('../../cli/print.js')
    const metas = await readPersistedSep2663TaskMetas(sessionId, projectDir)
    expect(metas).toHaveLength(2)

    let state = { tasks: {} } as unknown as AppState
    const notifications: Array<{
      taskId: string
      status: string
      resultText?: string
    }> = []
    const mockMcpClient = {
      name: 'claude.ai Demo',
      type: 'connected' as const,
      client: {
        request: async (req: { method: string }) => {
          if (req.method === 'tasks/get') {
            return { status: 'completed', statusMessage: 'all done' }
          }
          if (req.method === 'tasks/result') {
            return { content: [{ type: 'text', text: 'exported-42' }] }
          }
          return {}
        },
      },
    }

    const res = await restoreHeadlessSep2663Tasks({
      sessionId,
      projectDir,
      setAppState: updater => {
        state = updater(state)
      },
      getMcpClients: () => [
        mockMcpClient as unknown as import('../../services/mcp/types.js').MCPServerConnection,
      ],
      onNotify: n => notifications.push(n),
    })

    expect(res.restoredTaskIds).toEqual(['task-sep'])
    expect(res.skippedTaskIds).toEqual(['task-legacy'])
    await new Promise(r => setTimeout(r, 30))
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({
      taskId: 'task-sep',
      status: 'completed',
      resultText: 'exported-42',
    })
  })
})
