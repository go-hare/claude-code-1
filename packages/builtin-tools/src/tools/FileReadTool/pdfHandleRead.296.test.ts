import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('FileReadTool PDF handle-bound read (#202)', () => {
  test('#202: FileReadTool.ts uses openedHandle with readPDFFromHandle, getPDFPageCount, and extractPDFPages', () => {
    const src = readFileSync(join(import.meta.dir, 'FileReadTool.ts'), 'utf8')
    expect(src).toContain('readPDFFromHandle')
    expect(src).toContain('openedHandle\n      ? await readPDFFromHandle(')
    expect(src).toContain('held: openedHandle')
    expect(src).toContain('handle: openedHandle')
  })
})
