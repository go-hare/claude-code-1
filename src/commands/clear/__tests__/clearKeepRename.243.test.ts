import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'

describe('clear 243 keep /rename', () => {
  test('session_clear keeps standalone name when title is set', () => {
    const src = readFileSync(
      join(import.meta.dir, '../conversation.ts'),
      'utf8',
    )
    expect(src).toContain('getCurrentSessionTitle(getSessionId())')
    expect(src).toContain('keepRename')
    expect(src).toContain('clearSessionMetadata({ keepTitle: true })')
    expect(src).not.toContain(
      'standaloneAgentContext: prev.standaloneAgentContext?.prideGradient\n          ? { prideGradient: prev.standaloneAgentContext.prideGradient }',
    )
  })

  test('clearSessionMetadata can keep the title', () => {
    const utilsDir = join(import.meta.dir, '../../../utils')
    const subDir = join(utilsDir, 'sessionStorage')
    const src = [
      readFileSync(join(utilsDir, 'sessionStorage.ts'), 'utf8'),
      ...readdirSync(subDir)
        .filter(f => f.endsWith('.ts'))
        .sort()
        .map(f => readFileSync(join(subDir, f), 'utf8')),
    ].join('\n')
    expect(src).toContain('keepTitle?: boolean')
    expect(src).toContain('if (!options.keepTitle)')
  })
})
