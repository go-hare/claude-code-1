/**
 * densable 2.1.289 N9e host — restoreSessionStateFromLog.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(join(import.meta.dir, '../sessionRestore.ts'), 'utf8')

describe('densable 2.1.289 N9e session restore host', () => {
  test('restoreSessionStateFromLog calls N9e with continuesConversation', () => {
    expect(SRC).toContain('restoreResumedArtifactFrameState')
    expect(SRC).toContain('extractResumedArtifactFrameSeed')
    expect(SRC).toContain('isArtifactResumeSeedEligible')
    expect(SRC).toContain('continuesConversation: true')
    expect(SRC).toContain('conversationBoundary')
  })
})
