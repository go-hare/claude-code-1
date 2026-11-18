import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { NotebookEditTool } from './NotebookEditTool.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeMinimalContext(filePath: string) {
  const mtime = Date.now() + 10_000
  const map = new Map<
    string,
    { content: string; timestamp: number; offset?: number; limit?: number }
  >([[filePath, { content: '{}', timestamp: mtime }]])
  return {
    readFileState: map,
    agentId: undefined,
    agentWorktree: undefined,
  } as never
}

describe('#517 NotebookEditTool non-UTF8 / binary refusal', () => {
  test('validateInput refuses Windows-1252 / invalid UTF-8 notebook with errorCode 15', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nb-nonutf8-'))
    tempDirs.push(dir)
    const nbPath = join(dir, 'legacy.ipynb')
    // Invalid UTF-8 byte 0x93 / 0xe9
    writeFileSync(nbPath, Buffer.from([0x7b, 0x22, 0x93, 0xe9, 0x22, 0x7d]))

    const res = await NotebookEditTool.validateInput!(
      {
        notebook_path: nbPath,
        new_source: 'print(1)',
        cell_id: 'cell-0',
        edit_mode: 'replace',
      },
      makeMinimalContext(nbPath),
    )
    expect(res.result).toBe(false)
    if (!res.result) {
      expect(res.errorCode).toBe(15)
      expect(res.message).toContain('Windows-1252, Shift-JIS or GBK')
    }
  })

  test('validateInput refuses NUL-containing binary notebook with errorCode 15', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nb-nul-'))
    tempDirs.push(dir)
    const nbPath = join(dir, 'binary.ipynb')
    writeFileSync(nbPath, Buffer.from([0x7b, 0x00, 0x7d]))

    const res = await NotebookEditTool.validateInput!(
      {
        notebook_path: nbPath,
        new_source: 'print(1)',
        cell_id: 'cell-0',
        edit_mode: 'replace',
      },
      makeMinimalContext(nbPath),
    )
    expect(res.result).toBe(false)
    if (!res.result) {
      expect(res.errorCode).toBe(15)
      expect(res.message).toContain('NUL bytes')
    }
  })
})
