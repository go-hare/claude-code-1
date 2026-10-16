import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..')

describe('gold ePt away summary', () => {
  test('prompt is 40-word recap; tools denied; no AutoMem', async () => {
    const src = await Bun.file(join(ROOT, 'src/services/awaySummary.ts')).text()
    expect(src).toContain('Recap in under 40 words')
    expect(src).toContain("reason: 'away_summary'")
    expect(src).toContain("behavior: 'deny'")
    expect(src).not.toContain('createAutoMemCanUseTool')
    expect(src).not.toContain('getSessionMemoryContent')
    expect(src).toContain('AWAY_SUMMARY_RECAP_MAX_CHARS = 400')
  })
})
