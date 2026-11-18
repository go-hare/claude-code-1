import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadTranscriptFile } from '../sessionStorage.js'

describe('#139: non-blocking transcript load', () => {
  test('loadTranscriptFile yields to event loop on >256KB transcript and loads all messages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'transcript-290-'))
    try {
      const filePath = join(dir, 'large.jsonl')
      const lines: string[] = []
      const pad = 'x'.repeat(300)
      let prevUuid: string | null = null
      const count = 1200 // > 360KB
      for (let i = 0; i < count; i++) {
        const uuid = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
        lines.push(
          JSON.stringify({
            type: 'user',
            uuid,
            parentUuid: prevUuid,
            timestamp: new Date(1700000000000 + i).toISOString(),
            sessionId: '11111111-1111-4111-8111-111111111111',
            message: { role: 'user', content: `${i}:${pad}` },
          }),
        )
        prevUuid = uuid
      }
      writeFileSync(filePath, lines.join('\n') + '\n', 'utf8')

      let timerTicks = 0
      const interval = setInterval(() => {
        timerTicks++
      }, 0)

      const loaded = await loadTranscriptFile(filePath)
      clearInterval(interval)

      expect(loaded.messages.size).toBe(count)
      expect(timerTicks).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
