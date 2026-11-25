import { afterEach, describe, expect, test } from 'bun:test'
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileReadTool } from '@claude-code/builtin-tools/tools/FileReadTool/FileReadTool.js'
import { GetTaskTool } from '@claude-code/builtin-tools/tools/GetTaskTool/GetTaskTool.js'
import { GrepTool } from '@claude-code/builtin-tools/tools/GrepTool/GrepTool.js'
import {
  isMonitorPlatformEnabled,
  MonitorTool,
} from '@claude-code/builtin-tools/tools/MonitorTool/MonitorTool.js'
import {
  _resetSandboxCheckRecordsForTesting,
  KEPT_IN_SANDBOX_SINCE_CHECK_NOTE,
} from '@claude-code/builtin-tools/tools/BashTool/shouldUseSandbox.js'
import { TaskStopTool } from '@claude-code/builtin-tools/tools/TaskStopTool/TaskStopTool.js'
import {
  formatUnavailableBuiltInToolHint,
  GET_TASK_UNAVAILABLE_HINT,
} from '../../../services/tools/toolExecution.js'
import type { AppState } from '../../../state/AppState.js'
import { getTaskByType } from '../../../tasks.js'
import { stopTask } from '../../../tasks/stopTask.js'
import type { ToolUseContext } from '../../../Tool.js'
import {
  registerAgentKillLoop,
  resetAgentStopBagForTests,
} from '../../agentStopBag.js'
import {
  getCommandQueue,
  resetCommandQueue,
} from '../../messageQueueManager.js'
import { createMonitorStreamPump } from '../../monitorStreamNotify.js'
import {
  MonitorWsPreconditionError,
  spawnMonitorWebSocket,
} from '../../monitorWsSpawn.js'
import {
  checkPathSafetyForAutoEdit,
  checkReadableInternalPath,
  checkReadPermissionForTool,
  getProjectTempDir,
} from '../../permissions/filesystem.js'
import { updateSettingsForSource } from '../../settings/settings.js'
import { resetSettingsCache } from '../../settings/settingsCache.js'
import { createTaskRegistry } from '../../taskRegistry.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import {
  _clearOutputsForTest,
  _resetTaskOutputDirForTest,
  _setLinksInheritedBeforeForTest,
  bindTaskOutputForRead,
  DiskTaskOutput,
  getTaskOutputDir,
  getTaskOutputPath,
  initTaskOutput,
  initTaskOutputAsSymlink,
  isTaskOutputFilePath,
  isTaskOutputSwapRefusal,
  MAX_PERSISTED_OUTPUT_BYTES,
  MAX_TASK_OUTPUT_BYTES,
  MAX_TASK_OUTPUT_BYTES_DISPLAY,
  openTaskOutputForAppend,
  openTaskOutputRead,
  pinWriteTarget,
  repointTaskOutputSymlinks,
  resolveTaskOutputReadPath,
  TASK_OUTPUT_TAIL_BYTES,
} from '../diskOutput.js'
import { TaskOutput } from '../TaskOutput.js'

const tempDirs: string[] = []
const createdFiles: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function makeFakeReadContext(): ToolUseContext {
  const appState = {
    tasks: {},
    toolPermissionContext: getEmptyToolPermissionContext(),
  } as unknown as AppState
  return {
    abortController: new AbortController(),
    options: { mainLoopModel: 'claude-sonnet-4-6', tools: [], mcpClients: [] },
    getAppState: () => appState,
    setAppState: () => {},
    readFileState: new Map(),
    fileReadingLimits: undefined,
  } as unknown as ToolUseContext
}

afterEach(async () => {
  await _clearOutputsForTest()
  _resetTaskOutputDirForTest()
  _setLinksInheritedBeforeForTest(undefined)
  _resetSandboxCheckRecordsForTesting()
  resetAgentStopBagForTests()
  resetCommandQueue()
  for (const f of createdFiles.splice(0)) {
    await rm(f, { force: true }).catch(() => {})
  }
  await Promise.all(
    tempDirs
      .splice(0)
      .map(d => rm(d, { recursive: true, force: true }).catch(() => {})),
  )
})

describe('2.1.331 alignment: P0-6 symlink escape + bindTaskOutputForRead', () => {
  test('checkReadableInternalPath rejects symlink inside getProjectTempDir() pointing to external secret', async () => {
    if (process.platform === 'win32') return
    const externalDir = await makeTempDir('p0-6-ext-')
    const secretFile = join(externalDir, 'id_rsa')
    await writeFile(secretFile, 'SUPER-SECRET-KEY')

    const tempProjectDir = getProjectTempDir()
    await mkdir(tempProjectDir, { recursive: true })
    const goodFile = join(tempProjectDir, `legit-${Date.now()}.txt`)
    const evilLink = join(tempProjectDir, `evil-link-${Date.now()}.txt`)
    await writeFile(goodFile, 'safe-internal')
    await symlink(secretFile, evilLink)
    createdFiles.push(goodFile, evilLink)

    // Plain file inside project temp dir is auto-allowed
    expect(
      checkReadableInternalPath(goodFile, { file_path: goodFile }).behavior,
    ).toBe('allow')

    // Symlink inside project temp dir pointing outside MUST NOT be auto-allowed
    expect(
      checkReadableInternalPath(evilLink, { file_path: evilLink }).behavior,
    ).toBe('passthrough')

    // End-to-end checkReadPermissionForTool must NOT allow reading the escaped symlink
    const readDecision = checkReadPermissionForTool(
      FileReadTool,
      { file_path: evilLink },
      getEmptyToolPermissionContext(),
    )
    expect(readDecision.behavior).not.toBe('allow')
  })

  test('FileReadTool.call and GrepTool.call refuse unregistered task output symlink via bindTaskOutputForRead', async () => {
    if (process.platform === 'win32') return
    const externalDir = await makeTempDir('p0-6-task-ext-')
    const secretFile = join(externalDir, 'secret.txt')
    await writeFile(secretFile, 'TOP_SECRET_NEEDLE\n')

    const tasksDir = getTaskOutputDir()
    await mkdir(tasksDir, { recursive: true })
    const evilOutput = join(tasksDir, `evil-${Date.now()}.output`)
    await symlink(secretFile, evilOutput)
    createdFiles.push(evilOutput)

    expect(isTaskOutputFilePath(evilOutput)).toBe(true)
    await expect(bindTaskOutputForRead(evilOutput)).rejects.toThrow(
      /task output swap refused/,
    )

    // FileReadTool.call refuses unregistered symlink and never leaks target content
    await expect(
      FileReadTool.call({ file_path: evilOutput }, makeFakeReadContext()),
    ).rejects.toThrow(/task output swap refused/)

    // GrepTool.call refuses unregistered symlink AND refuses grepping tasks/ dir directly
    await expect(
      GrepTool.call(
        { pattern: 'TOP_SECRET_NEEDLE', path: evilOutput },
        makeFakeReadContext(),
      ),
    ).rejects.toThrow(/task output swap refused/)

    await expect(
      GrepTool.call(
        { pattern: 'TOP_SECRET_NEEDLE', path: tasksDir },
        makeFakeReadContext(),
      ),
    ).rejects.toThrow(/Task output files are read individually/)

    // Registered task output file reads cleanly through FileReadTool via bindTaskOutputForRead
    const taskId = `p0-6-legit-${Date.now()}`
    const legitPath = await initTaskOutput(taskId)
    createdFiles.push(legitPath)
    await writeFile(legitPath, 'hello-task-output\n')
    const bound = await bindTaskOutputForRead(legitPath)
    try {
      if (process.platform === 'darwin') {
        expect(bound.ioPath).toMatch(/^\/dev\/fd\/\d+$/)
      }
      expect(bound.canonicalPath).toBe(legitPath)
    } finally {
      await bound.close()
    }
    const readRes = await FileReadTool.call(
      { file_path: legitPath },
      makeFakeReadContext(),
    )
    expect(readRes.data.type).toBe('text')
    if (readRes.data.type === 'text') {
      expect(readRes.data.file.content).toContain('hello-task-output')
    }
  })
})

describe('2.1.331 alignment: P0-7 DiskTaskOutput triple symlink/hardlink security', () => {
  test('pinWriteTarget rejects leaf symlinks and ancestor symlinks, accepts real canonical dirs', async () => {
    if (process.platform === 'win32') return
    const root = await realpath(await makeTempDir('p0-7-pin-'))
    const realDir = join(root, 'real-dir')
    const nested = join(realDir, 'sub')
    await mkdir(nested, { recursive: true })
    const leafSym = join(root, 'leaf-sym')
    await symlink(realDir, leafSym)

    // Real canonical directory passes
    await expect(pinWriteTarget(realDir)).resolves.toBeUndefined()
    // Leaf symlink is refused
    await expect(pinWriteTarget(leafSym)).rejects.toThrow(
      /task output swap refused \(tasks dir moved or linked\)/,
    )
    // Ancestor symlink is refused
    await expect(pinWriteTarget(join(leafSym, 'sub'))).rejects.toThrow(
      /task output swap refused \(tasks dir moved or linked\)/,
    )
  })

  test('resolveTaskOutputReadPath enforces linkedOutputs allowlist & pre-session inheritance bound', async () => {
    if (process.platform === 'win32') return
    const prevConfig = process.env.CLAUDE_CONFIG_DIR
    const fakeConfig = await realpath(await makeTempDir('p0-7-cfg-'))
    const externalDir = await realpath(await makeTempDir('p0-7-out-'))
    process.env.CLAUDE_CONFIG_DIR = fakeConfig
    try {
      const transcript = join(fakeConfig, 'transcript.jsonl')
      const outside = join(externalDir, 'outside.txt')
      await writeFile(transcript, '{"ok":true}\n')
      await writeFile(outside, 'forbidden')

      const tasksDir = getTaskOutputDir()
      await mkdir(tasksDir, { recursive: true })

      // 1. Registered symlink via initTaskOutputAsSymlink is allowed
      const regId = `p0-7-reg-${Date.now()}`
      const regPath = await initTaskOutputAsSymlink(regId, transcript)
      createdFiles.push(regPath)
      await expect(resolveTaskOutputReadPath(regPath)).resolves.toBe(transcript)

      // 2. If a registered symlink is externally re-pointed, read refuses it
      await rm(regPath, { force: true })
      await symlink(outside, regPath)
      await expect(resolveTaskOutputReadPath(regPath)).rejects.toThrow(
        /output symlink was re-pointed/,
      )

      // 3. Unregistered session-created symlink inside tasks/ is refused
      const sessionLink = join(tasksDir, `unreg-sess-${Date.now()}.output`)
      await symlink(transcript, sessionLink)
      createdFiles.push(sessionLink)
      await expect(resolveTaskOutputReadPath(sessionLink)).rejects.toThrow(
        /unregistered symlink made during this session/,
      )

      // 4. Pre-session inherited symlink pointing inside CLAUDE_CONFIG_DIR is allowed
      //    when ctimeMs < linksInheritedBeforeFor(dir), while outside target is STILL refused!
      _setLinksInheritedBeforeForTest(Date.now() + 60_000)
      await expect(resolveTaskOutputReadPath(sessionLink)).resolves.toBe(
        transcript,
      )

      const outsideLink = join(tasksDir, `unreg-out-${Date.now()}.output`)
      await symlink(outside, outsideLink)
      createdFiles.push(outsideLink)
      await expect(resolveTaskOutputReadPath(outsideLink)).rejects.toThrow(
        /unregistered symlink of a shape this session does not create/,
      )

      // 5. repointTaskOutputSymlinks updates allowlist so reading the new sidecar works
      const oldSide = join(fakeConfig, 'side-old')
      const newSide = join(fakeConfig, 'side-new')
      await mkdir(oldSide, { recursive: true })
      await mkdir(newSide, { recursive: true })
      const oldFile = join(oldSide, 'sub.jsonl')
      const newFile = join(newSide, 'sub.jsonl')
      await writeFile(oldFile, 'old')
      await writeFile(newFile, 'new')
      const repId = `p0-7-repoint-${Date.now()}`
      const repPath = await initTaskOutputAsSymlink(repId, oldFile)
      createdFiles.push(repPath)
      await repointTaskOutputSymlinks(oldSide, newSide)
      await expect(resolveTaskOutputReadPath(repPath)).resolves.toBe(newFile)
    } finally {
      if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfig
    }
  })

  test('DiskTaskOutput and openTaskOutputForAppend refuse nlink > 1 hardlinks', async () => {
    if (process.platform === 'win32') return
    const dir = await realpath(await makeTempDir('p0-7-hardlink-'))
    const victim = join(dir, 'victim.txt')
    const hardlink = join(dir, 'task.output')
    await writeFile(victim, 'DO-NOT-MODIFY')
    try {
      await link(victim, hardlink)
    } catch {
      return
    }

    await expect(openTaskOutputForAppend(hardlink)).rejects.toThrow(
      /existing output is not a plain file/,
    )

    const writer = new DiskTaskOutput('hl-task', hardlink)
    writer.append('attacker-payload\n')
    await writer.flush()
    expect(writer.failing).toBe(true)
    expect(await readFile(victim, 'utf8')).toBe('DO-NOT-MODIFY')
    expect(
      isTaskOutputSwapRefusal(
        await openTaskOutputRead(hardlink).catch(err => err),
      ),
    ).toBe(true)
  })
})

describe('2.1.331 alignment: P0-8 InProcessTeammateTask & post_turn_memory registration', () => {
  test('getTaskByType resolves in_process_teammate and post_turn_memory, and stopTask stops both', async () => {
    expect(getTaskByType('in_process_teammate')?.type).toBe(
      'in_process_teammate',
    )
    expect(getTaskByType('post_turn_memory')?.type).toBe('post_turn_memory')

    const teammateAbort = new AbortController()
    const memAbort = new AbortController()
    let state = {
      tasks: {
        tm1: {
          id: 'tm1',
          type: 'in_process_teammate',
          status: 'running',
          description: 'researcher@team',
          startTime: Date.now(),
          outputFile: '',
          outputOffset: 0,
          notified: false,
          abortController: teammateAbort,
          identity: {
            agentId: 'researcher@team',
            agentName: 'researcher',
            teamName: 'team',
          },
          isIdle: false,
          shutdownRequested: false,
          messages: [],
          pendingUserMessages: [],
        },
        pm1: {
          id: 'pm1',
          type: 'post_turn_memory',
          status: 'running',
          description: 'saving memories',
          startTime: Date.now(),
          outputFile: '',
          outputOffset: 0,
          notified: false,
          abortController: memAbort,
        },
      },
    } as unknown as AppState
    const getAppState = () => state
    const setAppState = (fn: (prev: AppState) => AppState) => {
      state = fn(state)
    }

    const res1 = await stopTask('tm1', { getAppState, setAppState })
    expect(res1.taskId).toBe('tm1')
    expect(res1.taskType).toBe('in_process_teammate')
    expect(teammateAbort.signal.aborted).toBe(true)

    const res2 = await stopTask('pm1', { getAppState, setAppState })
    expect(res2.taskId).toBe('pm1')
    expect(res2.taskType).toBe('post_turn_memory')
    expect(memAbort.signal.aborted).toBe(true)
    expect(state.tasks.pm1?.status).toBe('killed')
  })
})

describe('2.1.331 alignment: P0-9 TaskOutput ENOENT diagnostic', () => {
  test('TaskOutput.getStdout returns unavailable diagnostic on ENOENT without marking redundant', async () => {
    const id = `p0-9-missing-${Date.now()}`
    const out = new TaskOutput(id, null, true)
    const stdout = await out.getStdout()
    expect(stdout).toContain('<bash output unavailable:')
    expect(stdout).toContain('(ENOENT)')
    expect(stdout).toContain(out.path)
    expect(out.outputFileRedundant).toBe(false)
  })

  test('TaskOutput.getStdout still returns empty string and marks redundant for existing empty file', async () => {
    const id = `p0-9-empty-${Date.now()}`
    const filePath = await initTaskOutput(id)
    createdFiles.push(filePath)
    const out = new TaskOutput(id, null, true)
    const stdout = await out.getStdout()
    expect(stdout).toBe('')
    expect(out.outputFileRedundant).toBe(true)
  })
})

describe('2.1.331 alignment: P1-7 GetTaskTool.isEnabled & unavailable hint', () => {
  test('GetTaskTool.isEnabled returns false and toolExecution hint matches official E_l', () => {
    expect(GetTaskTool.isEnabled()).toBe(false)
    expect(formatUnavailableBuiltInToolHint('GetTask')).toBe(
      GET_TASK_UNAVAILABLE_HINT,
    )
    expect(GET_TASK_UNAVAILABLE_HINT).toBe(
      ". GetTask is not a tool you can call. A background command's or task's result reaches you by itself when it finishes, unless the message that started it said otherwise, so you don't need to check on it.",
    )
    expect(formatUnavailableBuiltInToolHint('Bash')).toBe('')
  })
})

describe('2.1.331 alignment: P1-8, P1-9, P1-10 MonitorTool & StreamPump hardening', () => {
  test('P1-8: wildcard Bash(*) deny/ask rules match Monitor({ ws }) while ignoring toolsNarrowing', async () => {
    const makeCtx = (
      deny: Record<string, string[]>,
      ask: Record<string, string[]> = {},
      bashCommandClamps?: string[],
    ): ToolUseContext => {
      const base = getEmptyToolPermissionContext()
      const appState = {
        tasks: {},
        toolPermissionContext: {
          ...base,
          alwaysDenyRules: { ...base.alwaysDenyRules, ...deny },
          alwaysAskRules: { ...base.alwaysAskRules, ...ask },
          ...(bashCommandClamps ? { bashCommandClamps } : {}),
        },
      } as unknown as AppState
      return {
        abortController: new AbortController(),
        getAppState: () => appState,
        setAppState: () => {},
        options: { tools: [], mcpClients: [] },
      } as unknown as ToolUseContext
    }

    // Wildcard Bash(*) deny blocks Monitor({ ws })
    const denied = await MonitorTool.checkPermissions(
      {
        ws: { url: 'wss://example.com/events' },
        description: 'ws',
        timeout_ms: 5000,
      },
      makeCtx({ userSettings: ['Bash(*)'] }),
    )
    expect(denied.behavior).toBe('deny')
    if (denied.behavior === 'deny') {
      expect(denied.message).toContain('a rule denies Bash')
    }

    // Wildcard Bash( * ) ask attaches matchedAskRule on Monitor({ ws })
    const asked = await MonitorTool.checkPermissions(
      {
        ws: { url: 'wss://example.com/events' },
        description: 'ws',
        timeout_ms: 5000,
      },
      makeCtx({}, { userSettings: ['Bash( * )'] }),
    )
    expect(asked.behavior).toBe('ask')
    expect(
      (asked as { matchedAskRule?: { ruleValue?: { ruleContent?: string } } })
        .matchedAskRule?.ruleValue?.ruleContent,
    ).toBe(' * ')

    // toolsNarrowing deny rule is ignored by checkBashRuleForCodeExec
    const narrowed = await MonitorTool.checkPermissions(
      {
        ws: { url: 'wss://example.com/events' },
        description: 'ws',
        timeout_ms: 5000,
      },
      makeCtx({ toolsNarrowing: ['Bash(*)'] }),
    )
    expect(narrowed.behavior).toBe('ask')

    // permissionCheckFailureDecision fails closed under active bashCommandClamps
    const failClosed = MonitorTool.permissionCheckFailureDecision(
      { command: 'echo hi', description: 'test', timeout_ms: 5000 },
      makeCtx({}, {}, ['echo *']),
    )
    expect(failClosed?.behavior).toBe('deny')
    if (failClosed?.behavior === 'deny') {
      expect(failClosed.message).toContain('bashCommandClamp')
    }

    const noClampFail = MonitorTool.permissionCheckFailureDecision(
      { command: 'echo hi', description: 'test', timeout_ms: 5000 },
      makeCtx({}),
    )
    expect(noClampFail).toBeUndefined()
  })

  test('P1-8: spawnMonitorWebSocket and MonitorTool.call re-enforce sandbox.network.deniedDomains', async () => {
    const prevCfg = process.env.CLAUDE_CONFIG_DIR
    const isolatedCfg = await realpath(await makeTempDir('p1-8-cfg-'))
    process.env.CLAUDE_CONFIG_DIR = isolatedCfg
    resetSettingsCache()
    const prevSettings = updateSettingsForSource('userSettings', {
      sandbox: { network: { deniedDomains: ['blocked.example.com'] } },
    })
    expect(prevSettings.error).toBeNull()
    try {
      const dummyRegistry = createTaskRegistry(
        () => ({ tasks: {} }) as unknown as AppState,
        () => {},
      )
      await expect(
        spawnMonitorWebSocket({
          url: 'wss://blocked.example.com/feed',
          description: 'blocked-ws',
          timeoutMs: 5000,
          persistent: false,
          setAppState: () => {},
          taskRegistry: dummyRegistry,
        }),
      ).rejects.toBeInstanceOf(MonitorWsPreconditionError)

      await expect(
        MonitorTool.call(
          {
            ws: { url: 'wss://blocked.example.com/feed' },
            description: 'blocked-ws',
            timeout_ms: 5000,
          },
          makeFakeReadContext(),
        ),
      ).rejects.toThrow(/sandbox\.network\.deniedDomains/)
    } finally {
      if (prevCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevCfg
      resetSettingsCache()
    }
  })

  test('P1-8: mapToolResultToToolResultBlockParam appends KEPT_IN_SANDBOX_SINCE_CHECK_NOTE when keptInSandboxByCheck is true', () => {
    const rendered = MonitorTool.mapToolResultToToolResultBlockParam(
      {
        taskId: 'mon-1',
        timeoutMs: 60_000,
        persistent: false,
        keptInSandboxByCheck: true,
      },
      'tu-1',
    )
    expect(String(rendered.content)).toContain(KEPT_IN_SANDBOX_SINCE_CHECK_NOTE)
  })

  test('P1-9: createMonitorStreamPump resets firstSuppressedAt after recovery and includes suppressed tail sample', () => {
    let nowMs = 0
    let killed = false
    const pump = createMonitorStreamPump({
      description: 'long-lived',
      taskRef: { id: 'm-recover' },
      killTask: () => {
        killed = true
        return true
      },
      now: () => nowMs,
      bucket: { capacity: 2, refillMs: 2_000 },
      schedule: flush => {
        flush()
        return () => {}
      },
    })

    // Initial burst at t=0: 2 admitted, 2 suppressed
    pump.onData('line-1\n')
    pump.onData('line-2\n')
    pump.onData('suppressed-a\n')
    pump.onData('suppressed-b\n')
    expect(killed).toBe(false)

    // Partial recovery at t=2_000 (<= 3 * refillMs): recovery notice includes suppressed tail sample
    nowMs = 2_000
    pump.onData('line-3\n')
    expect(killed).toBe(false)
    const recovery = getCommandQueue().find(
      item =>
        typeof item.value === 'string' &&
        item.value.includes('2 events suppressed'),
    )
    expect(recovery).toBeTruthy()
    expect(String(recovery?.value)).toContain('suppressed-a')
    expect(String(recovery?.value)).toContain('suppressed-b')

    // 1 hour later: a brief burst MUST reset firstSuppressedAt BEFORE tryConsume()
    // and MUST NOT kill the healthy long-running monitor!
    nowMs = 3_600_000
    pump.onData('hour-1\n')
    pump.onData('hour-2\n')
    pump.onData('hour-burst-suppressed\n')
    expect(killed).toBe(false)
    expect(pump.isClosed()).toBe(false)
  })

  test('P1-10: MonitorTool.isEnabled gates on Windows Git Bash / MXC backend, not CLAUDE_CODE_DISABLE_BACKGROUND_TASKS', () => {
    expect(isMonitorPlatformEnabled('macos', null, false)).toBe(true)
    expect(isMonitorPlatformEnabled('linux', null, false)).toBe(true)
    expect(isMonitorPlatformEnabled('windows', null, false)).toBe(false)
    expect(
      isMonitorPlatformEnabled(
        'windows',
        'C:\\Program Files\\Git\\bin\\bash.exe',
        true,
      ),
    ).toBe(false)
    expect(
      isMonitorPlatformEnabled(
        'windows',
        'C:\\Program Files\\Git\\bin\\bash.exe',
        false,
      ),
    ).toBe(true)

    if (process.platform !== 'win32') {
      const prev = process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS
      process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = '1'
      try {
        expect(MonitorTool.isEnabled()).toBe(true)
      } finally {
        if (prev === undefined)
          delete process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS
        else process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = prev
      }
    }
  })
})

describe('2.1.331 alignment: P1-11 TaskStopTool & stopTask source=client / paused workflow / unsettled loop', () => {
  test('TaskStopTool.validateInput allows paused local_workflow, non-running observer, and unsettled terminal agent loop', async () => {
    const unsettledAbort = new AbortController()
    registerAgentKillLoop('ag-unsettled')

    let state = {
      tasks: {
        wf1: {
          id: 'wf1',
          type: 'local_workflow',
          status: 'paused',
          description: 'paused wf',
          startTime: Date.now(),
          outputFile: '',
          outputOffset: 0,
          notified: false,
        },
        obs1: {
          id: 'obs1',
          type: 'local_agent',
          status: 'completed',
          isObserver: true,
          description: 'observer',
          startTime: Date.now(),
          outputFile: '',
          outputOffset: 0,
          notified: false,
          agentId: 'obs1',
          agentType: 'observer',
        },
        'ag-unsettled': {
          id: 'ag-unsettled',
          type: 'local_agent',
          status: 'killed',
          description: 'unsettled agent',
          startTime: Date.now(),
          outputFile: '',
          outputOffset: 0,
          notified: false,
          agentId: 'ag-unsettled',
          abortController: unsettledAbort,
        },
        ws1: {
          id: 'ws1',
          type: 'monitor_ws',
          status: 'killed',
          description: 'ws ended',
          startTime: Date.now(),
          outputFile: '',
          outputOffset: 0,
          notified: false,
          url: 'wss://example.com',
        },
        ag2: {
          id: 'ag2',
          type: 'local_agent',
          status: 'running',
          description: 'client-stopped agent',
          startTime: Date.now(),
          outputFile: '',
          outputOffset: 0,
          notified: false,
          agentId: 'ag2',
          abortController: new AbortController(),
        },
      },
    } as unknown as AppState
    const getAppState = () => state
    const setAppState = (fn: (prev: AppState) => AppState) => {
      state = fn(state)
    }
    const ctx = { getAppState, setAppState } as unknown as ToolUseContext

    await expect(
      TaskStopTool.validateInput({ task_id: 'wf1' }, ctx),
    ).resolves.toMatchObject({ result: true })
    await expect(
      TaskStopTool.validateInput({ task_id: 'obs1' }, ctx),
    ).resolves.toMatchObject({ result: true })
    await expect(
      TaskStopTool.validateInput({ task_id: 'ag-unsettled' }, ctx),
    ).resolves.toMatchObject({ result: true })

    // stopTask on unsettled terminal kill-loop re-aborts and returns unsettled note
    const unsettledRes = await stopTask('ag-unsettled', {
      getAppState,
      setAppState,
    })
    expect(unsettledAbort.signal.aborted).toBe(true)
    expect(unsettledRes.note).toContain('had already ended (killed)')

    // source: 'client' stops non-running monitor_ws and stamps stoppedByUser on agent
    const wsRes = await stopTask('ws1', {
      getAppState,
      setAppState,
      source: 'client',
    })
    expect(wsRes.taskId).toBe('ws1')
    expect(wsRes.taskType).toBe('monitor_ws')

    await stopTask('ag2', {
      getAppState,
      setAppState,
      source: 'client',
    })
    expect(
      (state.tasks.ag2 as { stoppedByUser?: boolean } | undefined)
        ?.stoppedByUser,
    ).toBe(true)
  })
})

describe('2.1.331 alignment: P1-12 DiskTaskOutput constants & P1-16 claudeSettingsFile circuitBreaker', () => {
  test('P1-12 exports official 5GB / 64MB / 8192 limits', () => {
    expect(MAX_TASK_OUTPUT_BYTES).toBe(5_368_709_120)
    expect(MAX_TASK_OUTPUT_BYTES_DISPLAY).toBe('5GB')
    expect(MAX_PERSISTED_OUTPUT_BYTES).toBe(67_108_864)
    expect(TASK_OUTPUT_TAIL_BYTES).toBe(8192)
    expect(getTaskOutputPath('x')).toContain('x.output')
  })

  test('P1-16 checkPathSafetyForAutoEdit returns claudeSettingsFile circuitBreaker & hardens symlinked settings targets while preserving .claude/commands', async () => {
    // 1. Settings file carries circuitBreaker: 'claudeSettingsFile'
    const settingsRes = checkPathSafetyForAutoEdit(
      '/tmp/repo/.claude/settings.json',
    )
    expect(settingsRes.safe).toBe(false)
    if (!settingsRes.safe) {
      expect(settingsRes.circuitBreaker).toBe('claudeSettingsFile')
      expect(settingsRes.classifierApprovable).toBe(true)
    }

    // 2. Suspicious Windows path (8.3 short name) on a settings file carries also: ['claudeSettingsFile']
    const winSettingsRes = checkPathSafetyForAutoEdit(
      '/tmp/REPO~1/.claude/settings.json',
    )
    expect(winSettingsRes.safe).toBe(false)
    if (!winSettingsRes.safe) {
      expect(winSettingsRes.circuitBreaker).toBe('suspiciousWindowsPath')
      expect(winSettingsRes.classifierApprovable).toBe(false)
      expect(winSettingsRes.also).toEqual(['claudeSettingsFile'])
    }

    // 3. Non-settings .claude/commands file preserves existing behavior (no claudeSettingsFile circuitBreaker)
    const cmdPath = join(process.cwd(), '.claude', 'commands', 'hello.md')
    const cmdRes = checkPathSafetyForAutoEdit(cmdPath)
    expect(cmdRes.safe).toBe(false)
    if (!cmdRes.safe) {
      expect(cmdRes.classifierApprovable).toBe(true)
      expect(cmdRes.circuitBreaker).toBeUndefined()
    }

    // 4. Symlinked settings file pointing to an external JSON target marks target as
    //    circuitBreaker: 'claudeSettingsFile', classifierApprovable: false, with link note!
    if (process.platform !== 'win32') {
      const prevCfg = process.env.CLAUDE_CONFIG_DIR
      const cfgDir = await realpath(await makeTempDir('p1-16-cfg-'))
      const extDir = await realpath(await makeTempDir('p1-16-ext-'))
      const targetJson = join(extDir, 'real-config.json')
      await writeFile(targetJson, '{}')
      const symlinkedSettings = join(cfgDir, 'settings.json')
      await symlink(targetJson, symlinkedSettings)
      process.env.CLAUDE_CONFIG_DIR = cfgDir
      try {
        const targetRes = checkPathSafetyForAutoEdit(targetJson)
        expect(targetRes.safe).toBe(false)
        if (!targetRes.safe) {
          expect(targetRes.circuitBreaker).toBe('claudeSettingsFile')
          expect(targetRes.classifierApprovable).toBe(false)
          expect(targetRes.message).toContain('leads here through a link.')
        }
      } finally {
        if (prevCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR
        else process.env.CLAUDE_CONFIG_DIR = prevCfg
      }
    }
  })
})
