import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, test } from 'bun:test'
import { validateCoordinatorWriteAccess } from '../writeGuard.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('densable 2.1.289 writeGuard file-lock unique English cut', () => {
  test('source has no locked-by-worker unique English', () => {
    const src = readFileSync(join(__dirname, '../writeGuard.ts'), 'utf-8')
    expect(src).not.toContain('currently locked by worker')
    expect(src).not.toContain(
      'Concurrent writes to the same file are not allowed',
    )
    expect(src).not.toContain('acquireFileLock')
  })

  test('validateCoordinatorWriteAccess is allow-no-op', () => {
    expect(
      validateCoordinatorWriteAccess({
        filePath: '/tmp/a.ts',
        sourceTool: 'FileEditTool',
      }),
    ).toEqual({ result: true })
  })
})
