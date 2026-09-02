/**
 * Local FileWrite safety: refuse an existing directory / FIFO before call()
 * can throw raw EISDIR (which models then try to "fix" by deleting contents).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import { FileWriteTool } from '../FileWriteTool.js'

function writeCtx() {
  return {
    getAppState: () => ({
      toolPermissionContext: getEmptyToolPermissionContext(),
    }),
    readFileState: new Map(),
  } as never
}

describe('FileWrite directory/FIFO precheck', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('validateInput rejects an existing directory with errorCode 10', async () => {
    const root = mkdtempSync(join(tmpdir(), 'write-dir-gate-'))
    roots.push(root)
    const dir = join(root, 'outdir')
    mkdirSync(dir)

    const result = await FileWriteTool.validateInput!(
      { file_path: dir, content: 'x' },
      writeCtx(),
    )
    expect(result.result).toBe(false)
    if (result.result === false) {
      expect(result.errorCode).toBe(10)
      expect(result.message).toContain('existing directory')
      expect(result.message).toContain('filename')
    }
  })

  test('validateInput rejects a FIFO with errorCode 10', async () => {
    if (process.platform === 'win32') return
    const root = mkdtempSync(join(tmpdir(), 'write-fifo-gate-'))
    roots.push(root)
    const fifo = join(root, 'pipe')
    const { spawnSync } = await import('child_process')
    const made = spawnSync('mkfifo', [fifo], { encoding: 'utf8' })
    if (made.status !== 0) return

    const result = await FileWriteTool.validateInput!(
      { file_path: fifo, content: 'x' },
      writeCtx(),
    )
    expect(result.result).toBe(false)
    if (result.result === false) {
      expect(result.errorCode).toBe(10)
      expect(result.message).toContain('FIFO')
      expect(result.message).toContain('filename')
    }
  })
})
