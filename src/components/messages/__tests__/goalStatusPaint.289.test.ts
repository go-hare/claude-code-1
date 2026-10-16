import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..')

/**
 * densable 2.1.289 AttachmentMessage Ul `case"goal_status"`:
 * StatusIcon + duration/turns/tokens suffix; Goal:/Reason: only when verbose.
 */
describe('gold goal_status paint', () => {
  test('source uses StatusIcon, tokens, verbose Goal: gate, CtrlOToExpand', async () => {
    const src = await Bun.file(
      join(ROOT, 'src/components/messages/AttachmentMessage.tsx'),
    ).text()
    const idx = src.indexOf("case 'goal_status'")
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, src.indexOf('default:', idx))
    expect(slice).toContain('StatusIcon')
    expect(slice).toContain('formatDuration')
    expect(slice).toContain('formatNumber')
    expect(slice).toContain('tokens')
    expect(slice).toContain('CtrlOToExpand')
    expect(slice).toContain('verbose || Boolean(isTranscriptMode)')
    expect(slice).toContain('Goal: {attachment.condition}')
    expect(slice).toContain('Reason: {attachment.reason}')
    expect(slice).not.toContain('Math.floor(attachment.durationMs')
    expect(slice).not.toContain('attachment.met && attachment.condition')
  })
})
