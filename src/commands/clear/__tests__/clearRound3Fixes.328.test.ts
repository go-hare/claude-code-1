import { afterEach, describe, expect, test } from 'bun:test'
import type { UUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { moveOwnTaskListOnClear } from '../conversation.js'
import {
  clearInternalEventWriter,
  getTranscriptPathForSession,
  loadTranscriptFile,
  saveExplicitClearCheckpoint,
  setInternalEventWriter,
} from '../../../utils/sessionStorage.js'

const tempDirs: string[] = []
const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
const prevTestPersist = process.env.TEST_ENABLE_SESSION_PERSISTENCE

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function makeUuid(n: number): UUID {
  return `11111111-1111-4111-8111-${String(n).padStart(12, '0')}` as UUID
}

afterEach(async () => {
  clearInternalEventWriter()
  if (prevConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = prevConfigDir
  }
  if (prevTestPersist === undefined) {
    delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
  } else {
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = prevTestPersist
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

describe('Round 3 Fix 4: Clear Checkpoint & Task List Move', () => {
  test('BH3-P0-1: local saveExplicitClearCheckpoint does not corrupt pre-clear local transcript', async () => {
    const cfgDir = makeTempDir('bh3-p0-1-local-')
    process.env.CLAUDE_CONFIG_DIR = cfgDir
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'

    const sid = makeUuid(101)
    const u1 = makeUuid(1)
    const transcriptPath = getTranscriptPathForSession(sid)
    mkdirSync(join(transcriptPath, '..'), { recursive: true })
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: 'user',
        uuid: u1,
        parentUuid: null,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'hello before clear' },
      })}\n`,
      'utf8',
    )

    // No internalEventWriter registered -> local session
    await saveExplicitClearCheckpoint(sid)

    const loaded = await loadTranscriptFile(transcriptPath)
    expect(loaded.leafUuids.has(u1)).toBe(true)
    expect(loaded.leafUuids.size).toBe(1)
  })

  test('BH3-P0-1: remote CCR internalEventWriter only withdraws when prior leaf checkpoint exists', async () => {
    const cfgDir = makeTempDir('bh3-p0-1-remote-')
    process.env.CLAUDE_CONFIG_DIR = cfgDir
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'

    const mirrored: Array<{
      eventType: string
      payload: Record<string, unknown>
    }> = []
    setInternalEventWriter(async (eventType, payload) => {
      mirrored.push({ eventType, payload })
    })

    // Case A: transcript without any prior last-prompt leafUuid -> no tombstone written
    const sidNoCp = makeUuid(102)
    const u1 = makeUuid(2)
    const pathNoCp = getTranscriptPathForSession(sidNoCp)
    mkdirSync(join(pathNoCp, '..'), { recursive: true })
    writeFileSync(
      pathNoCp,
      `${JSON.stringify({
        type: 'user',
        uuid: u1,
        parentUuid: null,
        sessionId: sidNoCp,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'no rewind checkpoint' },
      })}\n`,
      'utf8',
    )
    await saveExplicitClearCheckpoint(sidNoCp)
    expect(mirrored.length).toBe(0)
    expect((await loadTranscriptFile(pathNoCp)).leafUuids.has(u1)).toBe(true)

    // Case B: transcript WITH a prior last-prompt leafUuid -> withdraws checkpoint & mirrors
    const sidWithCp = makeUuid(103)
    const u2 = makeUuid(3)
    const pathWithCp = getTranscriptPathForSession(sidWithCp)
    mkdirSync(join(pathWithCp, '..'), { recursive: true })
    writeFileSync(
      pathWithCp,
      [
        JSON.stringify({
          type: 'user',
          uuid: u2,
          parentUuid: null,
          sessionId: sidWithCp,
          timestamp: '2026-01-01T00:00:01.000Z',
          message: { role: 'user', content: 'rewound turn' },
        }),
        JSON.stringify({
          type: 'last-prompt',
          lastPrompt: 'rewound turn',
          sessionId: sidWithCp,
          leafUuid: u2,
          explicit: true,
          rewound: true,
        }),
      ].join('\n') + '\n',
      'utf8',
    )
    await saveExplicitClearCheckpoint(sidWithCp)
    expect(mirrored.length).toBe(1)
    expect(mirrored[0]?.eventType).toBe('last-prompt')
    expect(mirrored[0]?.payload.leafUuid).toBeNull()
    expect(mirrored[0]?.payload.explicit).toBe(true)
    expect((await loadTranscriptFile(pathWithCp)).leafUuids.size).toBe(0)
  })

  test('BH3-P0-1: clearConversation gates saveExplicitClearCheckpoint on remote CCR writer', () => {
    const src = readFileSync(
      join(import.meta.dir, '../conversation.ts'),
      'utf8',
    )
    expect(src).toContain('getIsRemoteMode()')
    expect(src).toContain('hasInternalEventWriter()')
    expect(src).toContain('!isTranscriptPersistenceDisabled()')
  })

  test('BH3-P1-7: moveOwnTaskListOnClear sanitizes IDs and blocks path traversal', async () => {
    const root = makeTempDir('bh3-p1-7-tasks-')
    const tasksRoot = join(root, 'tasks')
    const escapedTarget = join(root, 'outside-dir')
    mkdirSync(escapedTarget, { recursive: true })
    writeFileSync(join(escapedTarget, 'secret.txt'), 'keep')

    // Non-alphanumeric IDs get sanitized identically to getTasksDir()
    const sanitizedSource = join(tasksRoot, 'org-team-1')
    mkdirSync(sanitizedSource, { recursive: true })
    writeFileSync(join(sanitizedSource, '1.json'), '{"id":"1"}')

    const res = await moveOwnTaskListOnClear('org/team:1', 'new/sess:2', {
      tasksRootDir: tasksRoot,
      ownTaskListId: 'org/team:1',
    })
    expect(res).toEqual({ moved: true })
    expect(existsSync(join(tasksRoot, 'new-sess-2', '1.json'))).toBe(true)

    // Path traversal attempt (`../outside-dir`) stays sanitized inside tasksRoot
    const traversal = await moveOwnTaskListOnClear(
      '../outside-dir',
      'safe-dest',
      {
        tasksRootDir: tasksRoot,
        ownTaskListId: '../outside-dir',
      },
    )
    expect(traversal.moved).toBe(false)
    expect(existsSync(join(escapedTarget, 'secret.txt'))).toBe(true)
  })
})
