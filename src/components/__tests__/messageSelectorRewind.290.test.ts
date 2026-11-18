import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(import.meta.dir, '../MessageSelector.tsx'),
  'utf8',
)

describe('v2.1.290 #18: MessageSelector /rewind queued prompts props', () => {
  test('supports extraEntry, confirmDescription(msg), restoreWait, and pickListNote', () => {
    expect(SRC).toContain(
      'extraEntry?: { label: string; onSelect: () => void }',
    )
    expect(SRC).toContain(
      'confirmDescription?: (message: UserMessage) => string | undefined',
    )
    expect(SRC).toContain(
      'restoreWait?: { message: string; onStopWaiting: () => void }',
    )
    expect(SRC).toContain('pickListNote?: string')
    expect(SRC).toContain('extraEntryUUID')
    expect(SRC).toContain('extraEntry?.onSelect()')
    expect(SRC).toContain('extraEntry.label')
    expect(SRC).toContain('restoreWait.message')
    expect(SRC).toContain(
      '{pickListNote !== undefined && <Text dimColor>{pickListNote}</Text>}',
    )
  })
})
