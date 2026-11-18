import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getEmptyToolPermissionContext, type ToolUseContext } from 'src/Tool.js'
import { FileEditTool } from '../../FileEditTool/FileEditTool.js'
import { NotebookEditTool } from '../../NotebookEditTool/NotebookEditTool.js'
import { FileWriteTool } from '../FileWriteTool.js'

function makeContext(
  workingDir: string,
  blockWritesOutsideWorkingDirectories: boolean,
): ToolUseContext {
  const permContext = {
    ...getEmptyToolPermissionContext(),
    workingDirectories: new Map([
      [workingDir, { path: workingDir, source: 'session' as const }],
    ]),
    additionalWorkingDirectories: new Map([
      [workingDir, { path: workingDir, source: 'session' as const }],
    ]),
    blockWritesOutsideWorkingDirectories,
  }
  return {
    getAppState: () =>
      ({
        toolPermissionContext: permContext,
      }) as unknown as ReturnType<ToolUseContext['getAppState']>,
    readFileState: new Map() as unknown as ToolUseContext['readFileState'],
    updateFileHistoryState: () => {},
  } as unknown as ToolUseContext
}

describe('blockWritesOutsideWorkingDirectories wiring in FileWrite/FileEdit/NotebookEdit (#1354)', () => {
  let workDir = ''
  let outsideDir = ''

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'bwowd-work-'))
    outsideDir = mkdtempSync(join(tmpdir(), 'bwowd-out-'))
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
    rmSync(outsideDir, { recursive: true, force: true })
  })

  test('FileWriteTool.call rejects writes outside working directories when enabled', async () => {
    const outsideFile = join(outsideDir, 'outside.txt')
    const ctx = makeContext(workDir, true)
    await expect(
      FileWriteTool.call(
        { file_path: outsideFile, content: 'hello' },
        ctx,
        async () => ({ behavior: 'allow', updatedInput: {} }),
        { uuid: 'msg-1' } as never,
      ),
    ).rejects.toThrow('Writes outside the working directories are blocked')
  })

  test('FileEditTool.call rejects edits outside working directories when enabled', async () => {
    const outsideFile = join(outsideDir, 'outside.txt')
    writeFileSync(outsideFile, 'old\n', 'utf8')
    const ctx = makeContext(workDir, true)
    await expect(
      FileEditTool.call(
        { file_path: outsideFile, old_string: 'old', new_string: 'new' },
        ctx,
        async () => ({ behavior: 'allow', updatedInput: {} }),
        { uuid: 'msg-2' } as never,
      ),
    ).rejects.toThrow('Writes outside the working directories are blocked')
  })

  test('NotebookEditTool.call rejects edits outside working directories when enabled', async () => {
    const outsideNb = join(outsideDir, 'outside.ipynb')
    writeFileSync(
      outsideNb,
      '{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}',
      'utf8',
    )
    const ctx = makeContext(workDir, true)
    await expect(
      NotebookEditTool.call(
        { notebook_path: outsideNb, new_source: 'print(1)' },
        ctx,
        async () => ({ behavior: 'allow', updatedInput: {} }),
        { uuid: 'msg-3' } as never,
      ),
    ).rejects.toThrow('Writes outside the working directories are blocked')
  })
})
