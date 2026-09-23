import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('task output read path (251 #64 XX)', () => {
  test('getTaskOutput and getTaskOutputSize go through XX', () => {
    const src = readFileSync(join(import.meta.dir, '../diskOutput.ts'), 'utf8')
    expect(src).toContain(
      'const readable = await resolveTaskOutputReadPath(getTaskOutputPath(taskId))',
    )
    expect(src).toContain('await tailFile(\n      readable,')
    expect(src).toContain('return (await stat(readable)).size')
  })

  test('TaskOutput.getStdout read also uses XX', () => {
    const src = readFileSync(join(import.meta.dir, '../TaskOutput.ts'), 'utf8')
    expect(src).toContain(
      'const readable = await resolveTaskOutputReadPath(this.path)',
    )
    expect(src).toContain('readFileRange(readable, 0, maxBytes)')
  })
})
