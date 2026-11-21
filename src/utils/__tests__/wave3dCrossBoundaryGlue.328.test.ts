import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { GlobalConfig } from '../config.js'
import {
  loadConversationForResume,
  loadMessagesFromJsonlPath,
} from '../conversationRecovery.js'
import { createUserMessage } from '../messages.js'
import type { LogOption } from '../../types/logs.js'

describe('Wave 3D: conversationRecovery metadata forwarding & GlobalConfig declined upgrades', () => {
  test('loadConversationForResume forwards sessionModel and permissionMode from LogOption', async () => {
    const sid = randomUUID()
    const userMsg = {
      ...createUserMessage({ content: 'hello' }),
      sessionId: sid,
      cwd: '/tmp',
      userType: 'external',
      timestamp: new Date().toISOString(),
      version: '2.1.328',
    }
    const log: LogOption = {
      date: new Date().toISOString(),
      messages: [userMsg],
      fullPath: '/tmp/nonexistent-wave3d-transcript.jsonl',
      value: 0,
      created: new Date(),
      modified: new Date(),
      firstPrompt: 'hello',
      messageCount: 1,
      isSidechain: false,
      sessionModel: 'claude-opus-4-7',
      permissionMode: 'plan',
    }

    const result = await loadConversationForResume(log, undefined, {
      replyOnResume: true,
    })

    expect(result).not.toBeNull()
    expect(result?.sessionModel).toBe('claude-opus-4-7')
    expect(result?.permissionMode).toBe('plan')
  })

  test('loadMessagesFromJsonlPath & loadConversationForResume forward sessionModel and permissionMode from JSONL file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wave3d-resume-'))
    const filePath = join(dir, 'session.jsonl')
    try {
      const sid = randomUUID()
      const msgUuid = randomUUID()
      const now = new Date().toISOString()
      const lines = [
        JSON.stringify({
          type: 'user',
          uuid: msgUuid,
          parentUuid: null,
          isSidechain: false,
          userType: 'external',
          cwd: '/tmp',
          sessionId: sid,
          version: '2.1.328',
          timestamp: now,
          message: { role: 'user', content: 'resume me' },
        }),
        JSON.stringify({
          type: 'permission-mode',
          permissionMode: 'acceptEdits',
          sessionId: sid,
        }),
        JSON.stringify({
          type: 'session-model',
          model: 'claude-sonnet-4-6',
          sessionId: sid,
        }),
      ]
      writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8')

      const fromPath = await loadMessagesFromJsonlPath(filePath)
      expect(fromPath.permissionMode).toBe('acceptEdits')
      expect(fromPath.sessionModel).toBe('claude-sonnet-4-6')

      const resumed = await loadConversationForResume(filePath, filePath, {
        replyOnResume: true,
      })
      expect(resumed).not.toBeNull()
      expect(resumed?.permissionMode).toBe('acceptEdits')
      expect(resumed?.sessionModel).toBe('claude-sonnet-4-6')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('GlobalConfig directly types bedrockDeclinedUpgrades and vertexDeclinedUpgrades', () => {
    const partial: Partial<GlobalConfig> = {
      bedrockDeclinedUpgrades: { opus: 'opus45->opus47' },
      vertexDeclinedUpgrades: { sonnet: 'sonnet45->sonnet46' },
    }
    expect(partial.bedrockDeclinedUpgrades?.opus).toBe('opus45->opus47')
    expect(partial.vertexDeclinedUpgrades?.sonnet).toBe('sonnet45->sonnet46')
  })
})
