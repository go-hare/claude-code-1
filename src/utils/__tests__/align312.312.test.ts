import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { cleanupOldSessionFiles } from '../cleanup.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import {
  didLoadFromLastCompaction,
  generateTitleAndBranch,
  LOADED_FROM_LAST_COMPACTION_WARNING,
  processMessagesForTeleportResume,
  truncateFirstSessionMessageForTitle,
} from '../teleport.js'
import type { Message } from '../../types/message.js'

describe('v2.1.311-312 teleport & cleanup', () => {
  let tempDir: string
  let prevConfigDir: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cleanup-312-'))
    prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tempDir
    resetSettingsCache()
  })

  afterEach(() => {
    if (prevConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    }
    resetSettingsCache()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('#1322 cleanupOldSessionFiles keeps fresh empty pdf-* dirs in tool-results', async () => {
    writeFileSync(
      join(tempDir, 'settings.json'),
      JSON.stringify({ cleanupPeriodDays: 1 }),
    )
    resetSettingsCache()
    const sessionId = '11111111-1111-4111-8111-111111111111'
    const toolResultsDir = join(
      tempDir,
      'projects',
      'proj-a',
      sessionId,
      'tool-results',
    )
    const freshPdfDir = join(toolResultsDir, 'pdf-fresh')
    const oldPdfDir = join(toolResultsDir, 'pdf-old')
    mkdirSync(freshPdfDir, { recursive: true })
    mkdirSync(oldPdfDir, { recursive: true })

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    utimesSync(oldPdfDir, threeDaysAgo, threeDaysAgo)

    await cleanupOldSessionFiles()
    expect(existsSync(freshPdfDir)).toBe(true)
    expect(existsSync(oldPdfDir)).toBe(false)
  })

  test('#1275 didLoadFromLastCompaction & processMessagesForTeleportResume warn when compacted', () => {
    const keptUuid = '00000000-0000-4000-8000-000000000001'
    const boundaryMsg = {
      type: 'system',
      subtype: 'compact_boundary',
      uuid: '00000000-0000-4000-8000-000000000002',
      content: 'Compacted',
      compactMetadata: {
        trigger: 'auto',
        preTokens: 1000,
        preservedMessages: { uuids: [keptUuid] },
      },
    } as unknown as Message
    const keptMsg = {
      type: 'user',
      uuid: keptUuid,
      message: { role: 'user', content: 'hi' },
    } as unknown as Message
    const unpreservedMsg = {
      type: 'user',
      uuid: '00000000-0000-4000-8000-000000000003',
      message: { role: 'user', content: 'old' },
    } as unknown as Message

    expect(didLoadFromLastCompaction([keptMsg, boundaryMsg])).toBe(true)
    expect(didLoadFromLastCompaction([unpreservedMsg, boundaryMsg])).toBe(false)

    const processed = processMessagesForTeleportResume(
      [keptMsg, boundaryMsg],
      null,
    )
    const hasWarning = processed.some(
      m =>
        m.type === 'system' &&
        'content' in m &&
        m.content === LOADED_FROM_LAST_COMPACTION_WARNING,
    )
    expect(hasWarning).toBe(true)
  })

  test('#1335 truncateFirstSessionMessageForTitle & generateTitleAndBranch fallback', async () => {
    const longMsg = 'a'.repeat(2500)
    const truncated = truncateFirstSessionMessageForTitle(longMsg)
    expect(truncated.length).toBeLessThanOrEqual(2000)
    expect(truncated).toContain('characters omitted')

    const ac = new AbortController()
    const res = await generateTitleAndBranch('Fix login flow', ac.signal, {
      accessToken: '',
      orgUUID: '',
    })
    expect(res.branchName).toBe('claude/task')
    expect(res.title).toContain('Fix login flow')
  })
})
