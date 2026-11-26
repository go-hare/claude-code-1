import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getSessionId,
  setSessionPersistenceDisabled,
  switchSession,
} from '../../bootstrap/state.js'
import { asAgentId, asSessionId } from '../../types/ids.js'
import type { Message } from '../../types/message.js'
import { createUserMessage } from '../messages.js'
import { getSessionAlsStore, runWithSession } from '../sessionContextAls.js'
import { createSessionHost } from '../sessionHost.js'
import {
  createRootSession,
  registerSessionContextReader,
  type Session,
} from '../sessionRoot.js'
import {
  clearNotChainParentForTests,
  clearSessionMessagesCache,
  flushSessionStorage,
  flushSessionStorageAtExit,
  getAgentTranscript,
  getAgentTranscriptPath,
  getForeignSessionBinding,
  getProject,
  getSessionMessagesCache,
  getToolResultCopiesOnDisk,
  getTranscriptPath,
  isLiveBridgeSuppressed,
  isLocalGcEnabled,
  isNotChainParent,
  loadTranscriptFile,
  markNotChainParent,
  recordSidechainTranscript,
  recordTranscript,
  registerForeignSessionBindingProbe,
  registerLiveSuppressionProbe,
  registerSessionExitDrain,
  relocateSessionTranscript,
  resetProjectForTesting,
  resetSessionFilePointer,
  setLocalGcEnabled,
  setToolResultCopiesOnDisk,
} from '../sessionStorage.js'
import {
  _clearOutputsForTest,
  _resetTaskOutputDirForTest,
  appendTaskOutput,
  appendTaskOutputTrailer,
  bindTaskOutputForRead,
  cleanupTaskOutput,
  DiskTaskOutput,
  evictTaskOutput,
  flushTaskOutput,
  getTaskOutput,
  getTaskOutputDelta,
  getTaskOutputDir,
  getTaskOutputPath,
  initTaskOutput,
  initTaskOutputAsSymlink,
  isTaskOutputSwapRefusal,
} from '../task/diskOutput.js'

const ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'TEST_ENABLE_SESSION_PERSISTENCE',
  'CLAUDE_CODE_FORCE_SESSION_PERSISTENCE',
  'CLAUDE_CODE_SKIP_PROMPT_HISTORY',
] as const

function makeAssistantMessage(uuid: UUID, text: string): Message {
  return {
    type: 'assistant',
    uuid,
    message: {
      id: `msg_${uuid}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 8 },
    },
    requestId: `req_${uuid}`,
  } as unknown as Message
}

describe('Official 2.1.331 (@305046105): per-SessionHost isolation for sessionStorage and diskOutput', () => {
  const tempDirs: string[] = []
  const createdSessions: Session[] = []
  const envBackup: Partial<
    Record<(typeof ENV_KEYS)[number], string | undefined>
  > = {}

  async function makeTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  async function makeHostSession(
    id: UUID,
    projectName: string,
  ): Promise<Session> {
    const projectDir = await makeTempDir(`cc-331-${projectName}-`)
    const session = createRootSession({
      host: createSessionHost(),
      id,
      project: {
        originalCwd: projectDir,
        projectRoot: projectDir,
        cwd: projectDir,
      },
    })
    createdSessions.push(session)
    return session
  }

  beforeEach(async () => {
    registerSessionContextReader(getSessionAlsStore)
    for (const key of ENV_KEYS) {
      envBackup[key] = process.env[key]
    }
    const configDir = await makeTempDir('cc-331-cfg-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
    process.env.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE = '1'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY

    resetProjectForTesting()
    clearSessionMessagesCache()
    clearNotChainParentForTests()
    await _clearOutputsForTest()
    _resetTaskOutputDirForTest()
  })

  afterEach(async () => {
    registerSessionContextReader(getSessionAlsStore)
    for (const session of createdSessions.splice(0)) {
      await runWithSession(session, async () => {
        await _clearOutputsForTest()
        const outDir = getTaskOutputDir()
        _resetTaskOutputDirForTest()
        resetProjectForTesting()
        clearSessionMessagesCache()
        clearNotChainParentForTests()
        await rm(outDir, { recursive: true, force: true }).catch(() => {})
      })
    }
    await _clearOutputsForTest()
    _resetTaskOutputDirForTest()
    resetProjectForTesting()
    clearSessionMessagesCache()
    clearNotChainParentForTests()

    for (const key of ENV_KEYS) {
      const prev = envBackup[key]
      if (prev === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = prev
      }
    }

    await Promise.all(
      tempDirs
        .splice(0)
        .map(dir => rm(dir, { recursive: true, force: true }).catch(() => {})),
    )
  })

  test('concurrent recordTranscript and flushSessionStorage isolate Project singletons, queues, and JSONL files per host', async () => {
    const sidA = '11111111-1111-4111-8111-111111111111' as UUID
    const sidB = '22222222-2222-4222-8222-222222222222' as UUID
    const sessionA = await makeHostSession(sidA, 'hostA')
    const sessionB = await makeHostSession(sidB, 'hostB')

    const defaultProject = getProject()
    const projectA = runWithSession(sessionA, () => getProject())
    const projectB = runWithSession(sessionB, () => getProject())

    expect(projectA).not.toBe(projectB)
    expect(projectA).not.toBe(defaultProject)
    expect(projectB).not.toBe(defaultProject)

    const userA1 = createUserMessage({
      content: 'Host A prompt turn 1',
      uuid: 'aaaaaaaa-0000-4000-8000-000000000001' as UUID,
    })
    const asstA1 = makeAssistantMessage(
      'aaaaaaaa-0000-4000-8000-000000000002' as UUID,
      'Host A reply turn 1',
    )
    const userA2 = createUserMessage({
      content: 'Host A prompt turn 2',
      uuid: 'aaaaaaaa-0000-4000-8000-000000000003' as UUID,
    })

    const userB1 = createUserMessage({
      content: 'Host B prompt turn 1',
      uuid: 'bbbbbbbb-0000-4000-8000-000000000001' as UUID,
    })
    const asstB1 = makeAssistantMessage(
      'bbbbbbbb-0000-4000-8000-000000000002' as UUID,
      'Host B reply turn 1',
    )
    const userB2 = createUserMessage({
      content: 'Host B prompt turn 2',
      uuid: 'bbbbbbbb-0000-4000-8000-000000000003' as UUID,
    })

    const [pathA, pathB] = await Promise.all([
      runWithSession(sessionA, async () => {
        const p1 = await recordTranscript([userA1, asstA1])
        expect(p1).toBe(asstA1.uuid)
        await Promise.resolve()
        const p2 = await recordTranscript([userA1, asstA1, userA2])
        expect(p2).toBe(userA2.uuid)
        await flushSessionStorage()
        return getTranscriptPath()
      }),
      runWithSession(sessionB, async () => {
        const p1 = await recordTranscript([userB1, asstB1])
        expect(p1).toBe(asstB1.uuid)
        await Promise.resolve()
        const p2 = await recordTranscript([userB1, asstB1, userB2])
        expect(p2).toBe(userB2.uuid)
        await flushSessionStorage()
        return getTranscriptPath()
      }),
    ])

    expect(pathA).not.toBe(pathB)
    expect(projectA.sessionFile).toBe(pathA)
    expect(projectB.sessionFile).toBe(pathB)
    expect(defaultProject.sessionFile).toBeNull()

    const loadedA = await loadTranscriptFile(pathA)
    const loadedB = await loadTranscriptFile(pathB)

    const uuidsA = [...loadedA.messages.keys()]
    const uuidsB = [...loadedB.messages.keys()]
    expect(uuidsA).toEqual([userA1.uuid, asstA1.uuid, userA2.uuid])
    expect(uuidsB).toEqual([userB1.uuid, asstB1.uuid, userB2.uuid])

    for (const msg of loadedA.messages.values()) {
      expect(msg.sessionId).toBe(sidA)
    }
    for (const msg of loadedB.messages.values()) {
      expect(msg.sessionId).toBe(sidB)
    }
    expect(loadedA.messages.get(userA2.uuid)?.parentUuid).toBe(asstA1.uuid)
    expect(loadedB.messages.get(userB2.uuid)?.parentUuid).toBe(asstB1.uuid)
  })

  test('concurrent recordSidechainTranscript and getAgentTranscript isolate identical agentIds across hosts', async () => {
    const sidA = '33333333-3333-4333-8333-333333333333' as UUID
    const sidB = '44444444-4444-4444-8444-444444444444' as UUID
    const sessionA = await makeHostSession(sidA, 'sideA')
    const sessionB = await makeHostSession(sidB, 'sideB')
    const sharedAgentId = asAgentId('shared-subagent-777')

    const msgA1 = createUserMessage({
      content: 'Subagent task on Host A',
      uuid: 'aaaaaaaa-1111-4111-8111-000000000001' as UUID,
    })
    const msgA2 = makeAssistantMessage(
      'aaaaaaaa-1111-4111-8111-000000000002' as UUID,
      'Subagent answer from Host A',
    )

    const msgB1 = createUserMessage({
      content: 'Subagent task on Host B',
      uuid: 'bbbbbbbb-1111-4111-8111-000000000001' as UUID,
    })
    const msgB2 = makeAssistantMessage(
      'bbbbbbbb-1111-4111-8111-000000000002' as UUID,
      'Subagent answer from Host B',
    )

    const [readA, readB] = await Promise.all([
      runWithSession(sessionA, async () => {
        await recordSidechainTranscript([msgA1, msgA2], sharedAgentId)
        // Immediately read without manual flushSessionStorage() — exercises
        // per-host `inFlightSidechainWrites` + `project.hasPendingWritesForFile`.
        return getAgentTranscript(sharedAgentId)
      }),
      runWithSession(sessionB, async () => {
        await recordSidechainTranscript([msgB1, msgB2], sharedAgentId)
        return getAgentTranscript(sharedAgentId)
      }),
    ])

    expect(readA).not.toBeNull()
    expect(readB).not.toBeNull()
    expect(readA!.messages.map(m => m.uuid)).toEqual([msgA1.uuid, msgA2.uuid])
    expect(readB!.messages.map(m => m.uuid)).toEqual([msgB1.uuid, msgB2.uuid])

    const agentPathA = runWithSession(sessionA, () =>
      getAgentTranscriptPath(sharedAgentId),
    )
    const agentPathB = runWithSession(sessionB, () =>
      getAgentTranscriptPath(sharedAgentId),
    )
    expect(agentPathA).not.toBe(agentPathB)
    expect(existsSync(agentPathA)).toBe(true)
    expect(existsSync(agentPathB)).toBe(true)
  })

  test('switchSession, resetSessionFilePointer, caches, GC flags, probes, and exit drains stay isolated per host', async () => {
    const sidA = '55555555-5555-4555-8555-555555555555' as UUID
    const sidB1 = '66666666-6666-4666-8666-666666666661' as UUID
    const sidB2 = '66666666-6666-4666-8666-666666666662' as UUID
    const sessionA = await makeHostSession(sidA, 'isoA')
    const sessionB = await makeHostSession(sidB1, 'isoB')

    const msgA = createUserMessage({
      content: 'Host A stays anchored',
      uuid: 'aaaaaaaa-2222-4222-8222-000000000001' as UUID,
    })
    const msgB = createUserMessage({
      content: 'Host B before switch',
      uuid: 'bbbbbbbb-2222-4222-8222-000000000001' as UUID,
    })

    const pathA = await runWithSession(sessionA, async () => {
      await recordTranscript([msgA])
      await flushSessionStorage()
      markNotChainParent('dead-parent-a')
      setToolResultCopiesOnDisk('slim')
      setLocalGcEnabled(true)
      registerLiveSuppressionProbe(() => true)
      registerForeignSessionBindingProbe(() => ({
        foreign: true,
        boundSid: sidA,
      }))
      return getProject().sessionFile
    })

    await runWithSession(sessionB, async () => {
      await recordTranscript([msgB])
      await flushSessionStorage()
      expect(getProject().sessionFile).not.toBeNull()

      // Switch session & clear state on Host B
      switchSession(asSessionId(sidB2), null)
      await resetSessionFilePointer()
      clearSessionMessagesCache()

      expect(getSessionId()).toBe(asSessionId(sidB2))
      expect(getProject().sessionFile).toBeNull()
      expect(isNotChainParent('dead-parent-a')).toBe(false)
      expect(getToolResultCopiesOnDisk()).toBe('whole')
      expect(isLocalGcEnabled()).toBe(false)
      expect(isLiveBridgeSuppressed()).toBe(false)
      expect(getForeignSessionBinding()).toBeUndefined()
    })

    // Host A must be 100% unaffected by Host B's session switch & resets
    runWithSession(sessionA, () => {
      expect(getSessionId()).toBe(asSessionId(sidA))
      expect(getProject().sessionFile).toBe(pathA)
      expect(getSessionMessagesCache().has(sidA)).toBe(true)
      expect(isNotChainParent('dead-parent-a')).toBe(true)
      expect(getToolResultCopiesOnDisk()).toBe('slim')
      expect(isLocalGcEnabled()).toBe(true)
      expect(isLiveBridgeSuppressed()).toBe(true)
      expect(getForeignSessionBinding()).toEqual({
        foreign: true,
        boundSid: sidA,
      })
    })

    // Per-host sessionPersistenceDisabled & exit drains
    const sidC = '77777777-7777-4777-8777-777777777777' as UUID
    const sessionC = await makeHostSession(sidC, 'disabledC')
    let drainACount = 0
    let drainCCount = 0
    runWithSession(sessionA, () => {
      registerSessionExitDrain(() => {
        drainACount++
      })
    })
    await runWithSession(sessionC, async () => {
      setSessionPersistenceDisabled(true)
      registerSessionExitDrain(() => {
        drainCCount++
      })
      await recordTranscript([
        createUserMessage({
          content: 'suppressed on Host C',
          uuid: 'cccccccc-0000-4000-8000-000000000001' as UUID,
        }),
      ])
      await flushSessionStorage()
      expect(existsSync(getTranscriptPath())).toBe(false)
    })

    await runWithSession(sessionA, () => flushSessionStorageAtExit())
    expect(drainACount).toBe(1)
    expect(drainCCount).toBe(0)

    await runWithSession(sessionC, () => flushSessionStorageAtExit())
    expect(drainCCount).toBe(1)
  })

  test('concurrent diskOutput operations isolate same taskId across hosts (init, append, flush, read, delta, evict, cleanup)', async () => {
    const sidA = '88888888-8888-4888-8888-888888888888' as UUID
    const sidB = '99999999-9999-4999-8999-999999999999' as UUID
    const sessionA = await makeHostSession(sidA, 'taskA')
    const sessionB = await makeHostSession(sidB, 'taskB')
    const sharedTaskId = 'shared-task-42'

    const [pathA, pathB] = await Promise.all([
      runWithSession(sessionA, () => initTaskOutput(sharedTaskId)),
      runWithSession(sessionB, () => initTaskOutput(sharedTaskId)),
    ])

    expect(pathA).not.toBe(pathB)
    expect(pathA).toContain(sidA)
    expect(pathB).toContain(sidB)

    await Promise.all([
      runWithSession(sessionA, async () => {
        appendTaskOutput(sharedTaskId, 'hostA:line1\n')
        await new Promise(resolve => setTimeout(resolve, 5))
        appendTaskOutput(sharedTaskId, 'hostA:line2\n')
        appendTaskOutputTrailer(sharedTaskId, { exitCode: 0 })
        await flushTaskOutput(sharedTaskId)
      }),
      runWithSession(sessionB, async () => {
        appendTaskOutput(sharedTaskId, 'hostB:alpha\n')
        await new Promise(resolve => setTimeout(resolve, 5))
        appendTaskOutput(sharedTaskId, 'hostB:beta\n')
        appendTaskOutputTrailer(sharedTaskId, 'killed')
        await flushTaskOutput(sharedTaskId)
      }),
    ])

    const [outA, outB, deltaA, deltaB] = await Promise.all([
      runWithSession(sessionA, () => getTaskOutput(sharedTaskId)),
      runWithSession(sessionB, () => getTaskOutput(sharedTaskId)),
      runWithSession(sessionA, () => getTaskOutputDelta(sharedTaskId, 0)),
      runWithSession(sessionB, () => getTaskOutputDelta(sharedTaskId, 0)),
    ])

    expect(outA).toBe('hostA:line1\nhostA:line2\n\n[exited with code 0]\n')
    expect(outB).toBe('hostB:alpha\nhostB:beta\n\n[killed]\n')
    expect(deltaA.content).toBe(outA)
    expect(deltaB.content).toBe(outB)

    // Evicting & cleaning up sharedTaskId in Host A must NOT affect Host B
    await runWithSession(sessionA, async () => {
      await evictTaskOutput(sharedTaskId)
      await cleanupTaskOutput(sharedTaskId)
    })
    expect(existsSync(pathA)).toBe(false)
    expect(existsSync(pathB)).toBe(true)
    expect(
      await runWithSession(sessionB, () => getTaskOutput(sharedTaskId)),
    ).toBe('hostB:alpha\nhostB:beta\n\n[killed]\n')
  })

  test('linkedOutputs symlink allowlist and DiskTaskOutput host binding are isolated across hosts', async () => {
    const sidA = 'abababab-abab-4bab-8bab-abababababab' as UUID
    const sidB = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd' as UUID
    const sessionA = await makeHostSession(sidA, 'linkA')
    const sessionB = await makeHostSession(sidB, 'linkB')

    // 1. DiskTaskOutput constructed inside Host A remains bound to Host A even
    // when append()/flush() is invoked from an unbound callback outside ALS.
    const writerA = runWithSession(
      sessionA,
      () => new DiskTaskOutput('bound-1'),
    )
    const expectedBoundPathA = runWithSession(sessionA, () =>
      getTaskOutputPath('bound-1'),
    )
    writerA.append('emitted-outside-als\n')
    await writerA.flush()
    expect(await readFile(expectedBoundPathA, 'utf8')).toBe(
      'emitted-outside-als\n',
    )

    if (process.platform === 'win32') return

    // 2. Symlink allowlist (`linkedOutputs`) is strictly per-SessionHost:
    // Host A's registered symlink cannot be read through Host B's allowlist.
    const extDir = await makeTempDir('cc-331-ext-')
    await mkdir(extDir, { recursive: true })
    const targetA = join(extDir, 'agent-a.jsonl')
    const targetB = join(extDir, 'agent-b.jsonl')
    await writeFile(targetA, '{"host":"A"}\n')
    await writeFile(targetB, '{"host":"B"}\n')

    const [linkPathA, linkPathB] = await Promise.all([
      runWithSession(sessionA, () =>
        initTaskOutputAsSymlink('subagent-link', targetA),
      ),
      runWithSession(sessionB, () =>
        initTaskOutputAsSymlink('subagent-link', targetB),
      ),
    ])

    expect(linkPathA).not.toBe(linkPathB)

    // Each host can bind & read its own authorized symlink
    await runWithSession(sessionA, async () => {
      const bound = await bindTaskOutputForRead(linkPathA)
      try {
        expect(await readFile(bound.ioPath, 'utf8')).toBe('{"host":"A"}\n')
      } finally {
        await bound.close()
      }
    })

    await runWithSession(sessionB, async () => {
      const bound = await bindTaskOutputForRead(linkPathB)
      try {
        expect(await readFile(bound.ioPath, 'utf8')).toBe('{"host":"B"}\n')
      } finally {
        await bound.close()
      }
    })

    // Cross-host read of Host A's session-created symlink from Host B is refused!
    let crossHostErr: unknown
    try {
      await runWithSession(sessionB, () => bindTaskOutputForRead(linkPathA))
    } catch (err) {
      crossHostErr = err
    }
    expect(isTaskOutputSwapRefusal(crossHostErr)).toBe(true)
  })

  test('relocateSessionTranscript moves and repoints symlinks on Host A without disturbing Host B', async () => {
    const sidA = 'dededede-dede-4ede-8ede-dededededede' as UUID
    const sidB = 'efefefef-efef-4fef-8fef-efefefefefef' as UUID
    const sessionA = await makeHostSession(sidA, 'relocA-from')
    const sessionB = await makeHostSession(sidB, 'relocB-stay')
    const newDirA = await makeTempDir('cc-331-relocA-to-')

    const origPathB = await runWithSession(sessionB, async () => {
      await recordTranscript([
        createUserMessage({
          content: 'Host B stays put',
          uuid: 'bbbbbbbb-9999-4999-8999-000000000001' as UUID,
        }),
      ])
      await flushSessionStorage()
      return getTranscriptPath()
    })

    const { origPathA, relocatedPathA } = await runWithSession(
      sessionA,
      async () => {
        await recordTranscript([
          createUserMessage({
            content: 'Host A before relocate',
            uuid: 'aaaaaaaa-9999-4999-8999-000000000001' as UUID,
          }),
        ])
        await flushSessionStorage()
        const before = getTranscriptPath()
        expect(existsSync(before)).toBe(true)

        sessionA.update({
          project: { originalCwd: newDirA, cwd: newDirA },
        })
        await relocateSessionTranscript()
        const after = getProject().sessionFile!
        return { origPathA: before, relocatedPathA: after }
      },
    )

    expect(relocatedPathA).not.toBe(origPathA)
    expect(existsSync(relocatedPathA)).toBe(true)
    expect(existsSync(origPathB)).toBe(true)
    expect(runWithSession(sessionB, () => getProject().sessionFile)).toBe(
      origPathB,
    )
  })

  test('4-host stress test: interleaved transcript turns, subagent sidechains, and task outputs have zero cross-host collision', async () => {
    const hostCount = 4
    const turnsPerHost = 5
    const sharedAgentId = asAgentId('stress-worker')
    const sharedTaskId = 'stress-bash-job'

    const sessions = await Promise.all(
      Array.from({ length: hostCount }, (_, idx) =>
        makeHostSession(
          `f000000${idx}-0000-4000-8000-00000000000${idx}` as UUID,
          `stress-${idx}`,
        ),
      ),
    )

    await Promise.all(
      sessions.map((session, hostIdx) =>
        runWithSession(session, async () => {
          await initTaskOutput(sharedTaskId)
          const history: Message[] = []
          for (let turn = 0; turn < turnsPerHost; turn++) {
            const uMsg = createUserMessage({
              content: `host-${hostIdx}-turn-${turn}`,
              uuid: `f${hostIdx}000000-0000-4000-8000-0000000000${turn}1` as UUID,
            })
            const aMsg = makeAssistantMessage(
              `f${hostIdx}000000-0000-4000-8000-0000000000${turn}2` as UUID,
              `reply-${hostIdx}-${turn}`,
            )
            history.push(uMsg, aMsg)
            await recordTranscript(history)
            await recordSidechainTranscript(
              [
                createUserMessage({
                  content: `side-${hostIdx}-${turn}`,
                  uuid: `f${hostIdx}111111-0000-4000-8000-0000000000${turn}1` as UUID,
                }),
              ],
              sharedAgentId,
              turn === 0
                ? null
                : (`f${hostIdx}111111-0000-4000-8000-0000000000${turn - 1}1` as UUID),
            )
            appendTaskOutput(sharedTaskId, `h${hostIdx}:t${turn}\n`)
            await new Promise(resolve =>
              setTimeout(resolve, (hostIdx + turn) % 3),
            )
          }
          await flushSessionStorage()
          await flushTaskOutput(sharedTaskId)
        }),
      ),
    )

    for (let hostIdx = 0; hostIdx < hostCount; hostIdx++) {
      const session = sessions[hostIdx]!
      await runWithSession(session, async () => {
        const mainLoaded = await loadTranscriptFile(getTranscriptPath())
        expect(mainLoaded.messages.size).toBe(turnsPerHost * 2)
        for (const msg of mainLoaded.messages.values()) {
          expect(msg.sessionId).toBe(session.id)
          expect(msg.uuid.startsWith(`f${hostIdx}000000-`)).toBe(true)
        }

        const sideLoaded = await getAgentTranscript(sharedAgentId)
        expect(sideLoaded).not.toBeNull()
        expect(sideLoaded!.messages).toHaveLength(turnsPerHost)
        for (const msg of sideLoaded!.messages) {
          expect(msg.uuid.startsWith(`f${hostIdx}111111-`)).toBe(true)
        }

        const expectedOutput = Array.from(
          { length: turnsPerHost },
          (_, t) => `h${hostIdx}:t${t}\n`,
        ).join('')
        expect(await getTaskOutput(sharedTaskId)).toBe(expectedOutput)
      })
    }
  })
})
