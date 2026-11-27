import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { BashTool } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import { FileEditTool } from '@claude-code/builtin-tools/tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from '@claude-code/builtin-tools/tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from '@claude-code/builtin-tools/tools/FileWriteTool/FileWriteTool.js'
import { GlobTool } from '@claude-code/builtin-tools/tools/GlobTool/GlobTool.js'
import { GrepTool } from '@claude-code/builtin-tools/tools/GrepTool/GrepTool.js'
import { MonitorTool } from '@claude-code/builtin-tools/tools/MonitorTool/MonitorTool.js'
import { SendUserFileTool } from '@claude-code/builtin-tools/tools/SendUserFileTool/SendUserFileTool.js'
import { getMacroDefines } from '../../../scripts/defines.js'
import {
  clearRemoteNativeToolRunners,
  createExplicitToolDeps,
  createToolCallContext,
  NeverRunsInThisProcessError,
  registerRemoteNativeToolRunner,
  resolveToolUseContext,
  type RemoteNativeToolRunner,
} from '../../Tool.js'
import type { AssistantMessage } from '../../types/message.js'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

const WORKER_SCRIPT_SOURCE = `
import { createInterface } from 'readline'
import { BashTool } from '${join(REPO_ROOT, 'packages/builtin-tools/src/tools/BashTool/BashTool.tsx')}'
import { FileEditTool } from '${join(REPO_ROOT, 'packages/builtin-tools/src/tools/FileEditTool/FileEditTool.ts')}'
import { FileReadTool } from '${join(REPO_ROOT, 'packages/builtin-tools/src/tools/FileReadTool/FileReadTool.ts')}'
import { FileWriteTool } from '${join(REPO_ROOT, 'packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.ts')}'
import { GlobTool } from '${join(REPO_ROOT, 'packages/builtin-tools/src/tools/GlobTool/GlobTool.ts')}'
import { GrepTool } from '${join(REPO_ROOT, 'packages/builtin-tools/src/tools/GrepTool/GrepTool.ts')}'
import { createExplicitToolDeps, createToolCallContext } from '${join(REPO_ROOT, 'src/Tool.ts')}'

// Notice: NO AsyncLocalStorage host setup, NO ToolUseContext, NO bootstrap!
// Pure explicit Tool.create(deps) worker in a separate OS process.
const toolMap = {
  Write: FileWriteTool,
  Read: FileReadTool,
  Edit: FileEditTool,
  Glob: GlobTool,
  Grep: GrepTool,
  Bash: BashTool,
}

// Persistent per-worker explicit ToolDeps (e.g. shared readFileState across calls)
const explicitDeps = createExplicitToolDeps({
  session: {
    root: {},
    host: { launchOptions: { diskless: () => false } },
  },
  isNonInteractiveSession: true,
  loopModel: () => 'cross-process-worker-model',
  permissions: () => ({
    mode: 'bypassPermissions',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: true,
  }),
})

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', async line => {
  if (!line.trim()) return
  const req = JSON.parse(line)
  try {
    if (req.corruptResponse) {
      process.stdout.write(JSON.stringify({ id: req.id, ok: true, pid: process.pid, output: { badWirePayload: true } }) + '\\n')
      return
    }
    const tool = toolMap[req.toolName]
    if (!tool) {
      throw new Error('Unknown tool: ' + req.toolName)
    }
    const instance = tool.create(explicitDeps)
    const callCtx = createToolCallContext({ toolUseId: req.toolUseId })
    const result = await instance.call(req.input, callCtx)
    process.stdout.write(JSON.stringify({ id: req.id, ok: true, pid: process.pid, output: result.data }) + '\\n')
  } catch (err) {
    process.stdout.write(JSON.stringify({
      id: req.id,
      ok: false,
      pid: process.pid,
      error: err instanceof Error ? err.message : String(err),
    }) + '\\n')
  }
})
`

type RpcResponse = {
  id: number
  ok: boolean
  pid: number
  output?: unknown
  error?: string
}

function makeAssistantMessage(model = 'claude-sonnet-4-6'): AssistantMessage {
  return {
    type: 'assistant',
    uuid: '00000000-0000-0000-0000-000000000099',
    message: {
      id: 'msg_cross_proc',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  } as unknown as AssistantMessage
}

describe('Cross-Process OS Subprocess E2E: Diskless Host -> Tool.create(explicitDeps) Worker (Zero ALS)', () => {
  let tmpDir: string
  let workerScriptPath: string
  let workerProc: ReturnType<typeof Bun.spawn>
  let workerPid = 0
  let nextRpcId = 1
  const pending = new Map<number, (res: RpcResponse) => void>()

  let workerStderr = ''

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tool-create-xproc-e2e-'))
    workerScriptPath = join(tmpDir, 'worker.ts')
    writeFileSync(workerScriptPath, WORKER_SCRIPT_SOURCE, 'utf8')

    const defineArgs = Object.entries(getMacroDefines()).flatMap(([k, v]) => [
      '-d',
      `${k}:${v}`,
    ])
    workerProc = Bun.spawn(
      [process.execPath, ...defineArgs, workerScriptPath],
      {
        cwd: REPO_ROOT,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    workerPid = workerProc.pid

    // Capture stderr for diagnostics
    const stderr = workerProc.stderr
    if (stderr && typeof stderr !== 'number') {
      const reader = stderr.getReader()
      const decoder = new TextDecoder()
      ;(async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          workerStderr += decoder.decode(value, { stream: true })
        }
      })()
    }

    // Start async NDJSON stdout reader
    const stdout = workerProc.stdout
    if (stdout && typeof stdout !== 'number') {
      const reader = stdout.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      ;(async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let nl = buffer.indexOf('\n')
          while (nl !== -1) {
            const line = buffer.slice(0, nl).trim()
            buffer = buffer.slice(nl + 1)
            if (line.startsWith('{')) {
              try {
                const msg = JSON.parse(line) as RpcResponse
                const resolvePending = pending.get(msg.id)
                if (resolvePending) {
                  pending.delete(msg.id)
                  resolvePending(msg)
                }
              } catch {
                // ignore non-JSON debug lines
              }
            }
            nl = buffer.indexOf('\n')
          }
        }
      })()
    }
  })

  afterAll(async () => {
    try {
      const stdin = workerProc?.stdin
      if (stdin && typeof stdin !== 'number') {
        stdin.end()
      }
      await workerProc?.exited
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  function sendRpc(
    toolName: string,
    input: unknown,
    toolUseId: string,
    corruptResponse = false,
  ): Promise<RpcResponse> {
    const id = nextRpcId++
    const stdin = workerProc.stdin
    if (!stdin || typeof stdin === 'number') {
      throw new Error('Worker stdin unavailable')
    }
    return new Promise<RpcResponse>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        rejectPromise(
          new Error(
            `Cross-process RPC timeout for ${toolName}. workerStderr=${workerStderr}`,
          ),
        )
      }, 20_000)
      pending.set(id, res => {
        clearTimeout(timer)
        resolvePromise(res)
      })
      stdin.write(
        `${JSON.stringify({ id, toolName, input, toolUseId, corruptResponse })}\n`,
      )
    })
  }

  test('executes Write -> Read -> Edit -> Glob -> Grep -> Bash across real OS processes with zero ALS in worker + enforces diskless, ANSWER_LOST, NOT_RUN, and session isolation', async () => {
    expect(workerPid).toBeGreaterThan(0)
    expect(workerPid).not.toBe(process.pid)

    const disklessSessionA = {
      root: {},
      host: { launchOptions: { diskless: () => true } },
    }
    const disklessSessionB = {
      root: {},
      host: { launchOptions: { diskless: () => true } },
    }

    // 1. Without a remote runner, diskless Session A refuses local execution fail-closed
    const disklessDepsA = createExplicitToolDeps({ session: disklessSessionA })
    expect(() => FileWriteTool.create(disklessDepsA)).toThrow(
      NeverRunsInThisProcessError,
    )
    expect(() => FileReadTool.create(disklessDepsA)).toThrow(
      NeverRunsInThisProcessError,
    )
    expect(() => FileEditTool.create(disklessDepsA)).toThrow(
      NeverRunsInThisProcessError,
    )
    expect(() => GlobTool.create(disklessDepsA)).toThrow(
      NeverRunsInThisProcessError,
    )
    expect(() => GrepTool.create(disklessDepsA)).toThrow(
      NeverRunsInThisProcessError,
    )
    expect(() => BashTool.create(disklessDepsA)).toThrow(
      NeverRunsInThisProcessError,
    )
    expect(() => MonitorTool.create(disklessDepsA)).toThrow(
      NeverRunsInThisProcessError,
    )
    expect(() => SendUserFileTool.create(disklessDepsA)).toThrow(
      NeverRunsInThisProcessError,
    )

    // 2. Wire real cross-process runner on diskless Session A
    const remotePids = new Set<number>()
    let injectCorruptNext = false
    const rpcRunner: RemoteNativeToolRunner = async (
      toolName,
      input,
      _signal,
      ctx,
    ) => {
      const corrupt = injectCorruptNext
      injectCorruptNext = false
      const res = await sendRpc(
        toolName,
        input,
        ctx.toolUseId ?? `rpc_${toolName}`,
        corrupt,
      )
      remotePids.add(res.pid)
      if (!res.ok) {
        throw new Error(res.error ?? 'Remote worker error')
      }
      return { output: res.output }
    }

    for (const name of ['Write', 'Read', 'Edit', 'Glob', 'Grep', 'Bash']) {
      registerRemoteNativeToolRunner(disklessSessionA, name, rpcRunner)
    }

    const parentCtxA = resolveToolUseContext(
      disklessDepsA,
      createToolCallContext({ toolUseId: 'toolu_xproc_1' }),
    )
    const targetFile = join(tmpDir, 'cross-process-sample.txt')

    try {
      // 3. Write across OS processes + verify fromAnotherProcess hydrates filePath & userModified
      const writeRes = await FileWriteTool.call(
        {
          file_path: targetFile,
          content: 'line-1: INITIAL_MARKER\nline-2: hello\n',
        },
        parentCtxA,
        undefined,
        makeAssistantMessage(),
        undefined,
        { userModified: true, permissionCheckedFor: rpcRunner },
      )
      expect(writeRes.data.type).toBe('create')
      expect(writeRes.data.filePath).toBe(targetFile)
      expect(writeRes.data.userModified).toBe(true)
      expect(readFileSync(targetFile, 'utf8')).toContain('INITIAL_MARKER')

      // 4. Read across OS processes (also populates worker's explicit readFileState!)
      const readRes = await FileReadTool.call(
        { file_path: targetFile },
        parentCtxA,
        undefined,
        makeAssistantMessage(),
        undefined,
        { permissionCheckedFor: rpcRunner },
      )
      expect(readRes.data.type).toBe('text')
      if (readRes.data.type === 'text') {
        expect(readRes.data.file.content).toContain('INITIAL_MARKER')
      }

      // 5. Edit across OS processes (succeeds using worker's explicit readFileState!)
      const editRes = await FileEditTool.call(
        {
          file_path: targetFile,
          old_string: 'INITIAL_MARKER',
          new_string: 'CROSS_PROCESS_EDITED_MARKER',
          replace_all: false,
        },
        parentCtxA,
        undefined,
        makeAssistantMessage(),
        undefined,
        { userModified: false, permissionCheckedFor: rpcRunner },
      )
      expect(editRes.data.filePath).toBe(targetFile)
      expect(editRes.data.userModified).toBe(false)
      expect(readFileSync(targetFile, 'utf8')).toContain(
        'CROSS_PROCESS_EDITED_MARKER',
      )

      // 6. Glob across OS processes
      const globRes = await GlobTool.call(
        { pattern: '*.txt', path: tmpDir },
        parentCtxA,
      )
      expect(globRes.data.numFiles).toBeGreaterThanOrEqual(1)
      expect(
        globRes.data.filenames.some(f =>
          f.endsWith('cross-process-sample.txt'),
        ),
      ).toBe(true)

      // 7. Grep across OS processes
      const grepRes = await GrepTool.call(
        {
          pattern: 'CROSS_PROCESS_EDITED_MARKER',
          path: tmpDir,
          output_mode: 'content',
        },
        parentCtxA,
      )
      expect(grepRes.data.mode).toBe('content')
      if (grepRes.data.mode === 'content') {
        expect(grepRes.data.content).toContain('CROSS_PROCESS_EDITED_MARKER')
      }

      // 8. Bash across OS processes
      const bashRes = await BashTool.call(
        { command: 'printf "worker-bash-ok"' },
        parentCtxA,
      )
      expect(bashRes.data.stdout).toContain('worker-bash-ok')

      // Verify ALL 6 tools truly ran in the separate child OS process!
      expect([...remotePids]).toEqual([workerPid])

      // 9. Malformed wire payload from child -> NativeToolElsewhereError('ANSWER_LOST')
      injectCorruptNext = true
      await expect(
        FileReadTool.call({ file_path: targetFile }, parentCtxA),
      ).rejects.toMatchObject({
        name: 'NativeToolElsewhereError',
        code: 'ANSWER_LOST',
        message:
          'Read ran, but its result could not be read. It changes nothing, so it is safe to run again.',
      })

      injectCorruptNext = true
      await expect(
        FileWriteTool.call({ file_path: targetFile, content: 'x' }, parentCtxA),
      ).rejects.toMatchObject({
        name: 'NativeToolElsewhereError',
        code: 'ANSWER_LOST',
        message:
          'Write ran, but its result could not be read. Check its effect before running it again.',
      })

      // 10. TOCTOU: permissionCheckedFor mismatches current runner -> NOT_RUN
      const staleRunner: RemoteNativeToolRunner = async () => ({ output: {} })
      await expect(
        FileReadTool.call(
          { file_path: targetFile },
          parentCtxA,
          undefined,
          undefined,
          undefined,
          { permissionCheckedFor: staleRunner },
        ),
      ).rejects.toMatchObject({
        name: 'NativeToolElsewhereError',
        code: 'NOT_RUN',
      })

      // 11. Session isolation: diskless Session B has NO runner -> NeverRunsInThisProcessError
      const parentCtxB = resolveToolUseContext(
        createExplicitToolDeps({ session: disklessSessionB }),
      )
      await expect(
        FileReadTool.call({ file_path: targetFile }, parentCtxB),
      ).rejects.toThrow(NeverRunsInThisProcessError)
    } finally {
      clearRemoteNativeToolRunners(disklessSessionA)
      clearRemoteNativeToolRunners(disklessSessionB)
    }
  }, 30_000)
})
