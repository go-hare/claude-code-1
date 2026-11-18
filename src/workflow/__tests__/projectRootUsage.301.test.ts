import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('workflow getProjectRoot alignment #874', () => {
  test('saveDynamicWorkflow.ts and claudeCodeBackend.ts do not call getCwd()', () => {
    const saveSrc = readFileSync(
      join(import.meta.dir, '..', 'saveDynamicWorkflow.ts'),
      'utf8',
    )
    const backendSrc = readFileSync(
      join(import.meta.dir, '..', 'backends', 'claudeCodeBackend.ts'),
      'utf8',
    )

    expect(saveSrc).not.toContain('getCwd(')
    expect(backendSrc).not.toContain('getCwd(')
    expect(backendSrc).toContain('getProjectRoot()')
  })
})
