/**
 * densable 2.1.216 #6 — statusline must not double-run on mount/resume.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../..')

describe('StatusLine skip-first deps effect', () => {
  test('source has skipFirstStatusDepsEffect before scheduleUpdate path', () => {
    const src = readFileSync(join(ROOT, 'components/StatusLine.tsx'), 'utf8')
    expect(src).toContain('skipFirstStatusDepsEffect')
    expect(src).toContain('skipFirstStatusDepsEffect.current = false')
    // settings command change still skips first render (existing)
    expect(src).toContain('isFirstSettingsRender')
    // mount still calls doUpdate once
    expect(src).toMatch(/useEffect\(\(\) => \{\s*void doUpdate\(\)/)
  })
})
