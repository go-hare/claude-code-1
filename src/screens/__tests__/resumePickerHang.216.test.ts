/**
 * densable 2.1.216 #6 — resume picker hang on failure → sticky IQf UI.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../..')

describe('ResumeConversation densable pe/IQf', () => {
  test('pre-load / onSelect failures set sticky resumeFailed (no rethrow)', () => {
    const src = readFileSync(
      join(ROOT, 'screens/ResumeConversation.tsx'),
      'utf8',
    )
    expect(src).toContain('resume picker: pre-load failed')
    expect(src).toContain('setResumeFailed')
    expect(src).toContain('Failed to resume the conversation.')
    expect(src).toContain('selectingRef')
    expect(src).toContain('not_found_picker')
    expect(src).toContain('load_error')
    expect(src).toContain('processing_error')
    // densable: catch must not rethrow (hang)
    expect(src).not.toMatch(/catch \(e\) \{[\s\S]*throw e/)
  })
})
