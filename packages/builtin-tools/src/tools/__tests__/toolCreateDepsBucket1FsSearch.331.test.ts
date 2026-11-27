import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearRemoteNativeToolRunners,
  createExplicitToolDeps,
  createToolCallContext,
  LOCAL_ONLY_NATIVE_TOOL_NAMES,
  NativeToolElsewhereError,
  NeverRunsInThisProcessError,
  registerRemoteNativeToolRunner,
  resolveToolUseContext,
  type RemoteNativeToolRunner,
  type ToolDeps,
} from 'src/Tool.js'
import { runWithNewHostSession } from 'src/utils/sessionHost.js'
import { FileEditTool } from '../FileEditTool/FileEditTool.js'
import { FileReadTool } from '../FileReadTool/FileReadTool.js'
import { FileWriteTool } from '../FileWriteTool/FileWriteTool.js'
import { GlobTool } from '../GlobTool/GlobTool.js'
import { GrepTool } from '../GrepTool/GrepTool.js'
import { LSPTool } from '../LSPTool/LSPTool.js'
import { NotebookEditTool } from '../NotebookEditTool/NotebookEditTool.js'

function makeSession(diskless = false) {
  return {
    root: {},
    host: {
      launchOptions: {
        diskless: () => diskless,
      },
    },
  }
}

describe('Official 2.1.331 Bucket 1 (Core FS & Search) — Tool.create(deps) DI & Cross-Process Parity', () => {
  let tmpDir = ''

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bucket1-create-deps-331-'))
  })

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = ''
    }
  })

  test('Direct Tool.create(createExplicitToolDeps) executes FileWrite, FileRead, FileEdit, Glob, Grep, NotebookEdit, and validates LSPTool with ZERO ALS and ZERO ToolUseContext', async () => {
    const deps = createExplicitToolDeps({
      session: makeSession(false),
      loopModel: () => 'claude-sonnet-4-6',
    })

    // 1. FileWriteTool — create a new file
    const textPath = join(tmpDir, 'hello.ts')
    const writeInst = FileWriteTool.create(deps)
    const writeCallCtx = createToolCallContext({ toolUseId: 'toolu_write_1' })
    expect(
      await writeInst.validateInput?.(
        { file_path: textPath, content: 'export const greeting = "hello"\n' },
        writeCallCtx,
      ),
    ).toEqual({ result: true })
    const writeRes = await writeInst.call(
      { file_path: textPath, content: 'export const greeting = "hello"\n' },
      writeCallCtx,
    )
    expect(writeRes.data.type).toBe('create')
    expect(writeRes.data.filePath).toBe(textPath)
    expect(readFileSync(textPath, 'utf8')).toBe(
      'export const greeting = "hello"\n',
    )

    // 2. FileReadTool — read back the written file (populates deps.readFileState)
    const readInst = FileReadTool.create(deps)
    const readCallCtx = createToolCallContext({ toolUseId: 'toolu_read_1' })
    expect(
      await readInst.validateInput?.({ file_path: textPath }, readCallCtx),
    ).toEqual({ result: true })
    const readRes = await readInst.call({ file_path: textPath }, readCallCtx)
    expect(readRes.data.type).toBe('text')
    if (readRes.data.type === 'text') {
      expect(readRes.data.file.content).toContain('greeting = "hello"')
      expect(readRes.data.file.numLines).toBeGreaterThanOrEqual(1)
    }

    // 3. FileEditTool — edit the file using deps.readFileState + callCtx.userModified
    const editInst = FileEditTool.create(deps)
    const editCallCtx = createToolCallContext({
      toolUseId: 'toolu_edit_1',
      userModified: true,
    })
    const editVal = await editInst.validateInput?.(
      {
        file_path: textPath,
        old_string: '"hello"',
        new_string: '"world"',
        replace_all: false,
      },
      editCallCtx,
    )
    expect(editVal?.result).toBe(true)
    const editRes = await editInst.call(
      {
        file_path: textPath,
        old_string: '"hello"',
        new_string: '"world"',
        replace_all: false,
      },
      editCallCtx,
    )
    expect(editRes.data.filePath).toBe(textPath)
    expect(editRes.data.userModified).toBe(true)
    expect(readFileSync(textPath, 'utf8')).toBe(
      'export const greeting = "world"\n',
    )

    // 4. GlobTool — find files in tmpDir and honor callCtx.globLimits
    const secondPath = join(tmpDir, 'second.ts')
    writeFileSync(secondPath, 'export const second = 2\n', 'utf8')
    const globInst = GlobTool.create(deps)
    const globCallCtx = createToolCallContext({
      toolUseId: 'toolu_glob_1',
      globLimits: { maxResults: 1 },
    })
    expect(
      await globInst.validateInput?.(
        { pattern: '*.ts', path: tmpDir },
        globCallCtx,
      ),
    ).toEqual({ result: true })
    const globRes = await globInst.call(
      { pattern: '*.ts', path: tmpDir },
      globCallCtx,
    )
    expect(globRes.data.numFiles).toBe(1)
    expect(globRes.data.truncated).toBe(true)

    const globAllRes = await globInst.call(
      { pattern: '*.ts', path: tmpDir },
      createToolCallContext({ toolUseId: 'toolu_glob_2' }),
    )
    expect(globAllRes.data.numFiles).toBe(2)
    expect(globAllRes.data.truncated).toBe(false)

    // 5. GrepTool — search content directly via create(deps)
    const grepInst = GrepTool.create(deps)
    const grepCallCtx = createToolCallContext({ toolUseId: 'toolu_grep_1' })
    expect(
      await grepInst.validateInput?.(
        { pattern: 'greeting', path: tmpDir, output_mode: 'content' },
        grepCallCtx,
      ),
    ).toEqual({ result: true })
    const grepRes = await grepInst.call(
      { pattern: 'greeting', path: tmpDir, output_mode: 'content' },
      grepCallCtx,
    )
    expect(grepRes.data.mode).toBe('content')
    if (grepRes.data.mode === 'content') {
      expect(grepRes.data.content).toContain('greeting = "world"')
    }

    // 6. NotebookEditTool — read notebook then replace a cell directly via create(deps)
    const nbPath = join(tmpDir, 'demo.ipynb')
    writeFileSync(
      nbPath,
      `${JSON.stringify(
        {
          cells: [
            {
              id: 'cell-1',
              cell_type: 'code',
              source: ['x = 1'],
              metadata: {},
              execution_count: null,
              outputs: [],
            },
          ],
          metadata: { language_info: { name: 'python' } },
          nbformat: 4,
          nbformat_minor: 5,
        },
        null,
        1,
      )}\n`,
      'utf8',
    )
    // Read notebook first so deps.readFileState has it
    const nbReadRes = await readInst.call(
      { file_path: nbPath },
      createToolCallContext({ toolUseId: 'toolu_read_nb' }),
    )
    expect(nbReadRes.data.type).toBe('notebook')

    const nbInst = NotebookEditTool.create(deps)
    const nbCallCtx = createToolCallContext({ toolUseId: 'toolu_nb_1' })
    expect(
      await nbInst.validateInput?.(
        {
          notebook_path: nbPath,
          cell_id: 'cell-1',
          new_source: 'x = 42',
          edit_mode: 'replace',
        },
        nbCallCtx,
      ),
    ).toEqual({ result: true })
    const nbRes = await nbInst.call(
      {
        notebook_path: nbPath,
        cell_id: 'cell-1',
        new_source: 'x = 42',
        edit_mode: 'replace',
      },
      nbCallCtx,
    )
    expect(nbRes.data.new_source).toBe('x = 42')
    expect(nbRes.data.edit_mode).toBe('replace')
    expect(JSON.parse(readFileSync(nbPath, 'utf8')).cells[0].source).toBe(
      'x = 42',
    )

    // 7. LSPTool — instantiation, validateInput (existing file & missing file), checkPermissions
    const lspInst = LSPTool.create(deps)
    const lspCallCtx = createToolCallContext({ toolUseId: 'toolu_lsp_1' })
    expect(
      await lspInst.validateInput?.(
        {
          operation: 'hover',
          filePath: textPath,
          line: 1,
          character: 1,
        },
        lspCallCtx,
      ),
    ).toEqual({ result: true })
    const missingLsp = await lspInst.validateInput?.(
      {
        operation: 'hover',
        filePath: join(tmpDir, 'does-not-exist.ts'),
        line: 1,
        character: 1,
      },
      lspCallCtx,
    )
    expect(missingLsp?.result).toBe(false)
    const lspPerm = await lspInst.checkPermissions?.(
      {
        operation: 'hover',
        filePath: textPath,
        line: 1,
        character: 1,
      },
      lspCallCtx,
    )
    expect(lspPerm).toBeDefined()
  })

  test('create(deps) does NOT eagerly touch deps before method invocation (probe Proxy safe)', () => {
    const accessed: string[] = []
    const probeDeps = new Proxy({} as ToolDeps, {
      get(_target, prop) {
        if (prop === 'session') return makeSession(false)
        accessed.push(String(prop))
        return undefined
      },
    })

    for (const tool of [
      FileReadTool,
      FileEditTool,
      FileWriteTool,
      GlobTool,
      GrepTool,
      NotebookEditTool,
      LSPTool,
    ]) {
      const instance = tool.create(probeDeps)
      expect(typeof instance.call).toBe('function')
      expect(typeof instance.validateInput).toBe('function')
      expect(typeof instance.checkPermissions).toBe('function')
    }
    expect(accessed).toEqual([])
  })

  test('Diskless host throws NeverRunsInThisProcessError for Read/Edit/Write/Glob/Grep/NotebookEdit, while LSPTool stays local-capable', async () => {
    const disklessSession = makeSession(true)
    const disklessDeps = createExplicitToolDeps({ session: disklessSession })

    const disklessBlockedTools = [
      FileReadTool,
      FileEditTool,
      FileWriteTool,
      GlobTool,
      GrepTool,
      NotebookEditTool,
    ]
    for (const tool of disklessBlockedTools) {
      expect(LOCAL_ONLY_NATIVE_TOOL_NAMES.has(tool.name)).toBe(true)
      expect(() => tool.create(disklessDeps)).toThrow(
        NeverRunsInThisProcessError,
      )
    }

    // LSPTool is NOT in the 10-tool diskless local-only set
    expect(LOCAL_ONLY_NATIVE_TOOL_NAMES.has(LSPTool.name)).toBe(false)
    const lspInst = LSPTool.create(disklessDeps)
    expect(typeof lspInst.call).toBe('function')
    const sampleFile = join(tmpDir, 'lsp-diskless.ts')
    writeFileSync(sampleFile, 'export const ok = 1\n', 'utf8')
    expect(
      await lspInst.validateInput?.(
        { operation: 'hover', filePath: sampleFile, line: 1, character: 1 },
        createToolCallContext(),
      ),
    ).toEqual({ result: true })
  })

  test('Diskless guards skip expandPath / getCwd in FileRead, FileEdit, FileWrite backfillObservableInput and FileRead getPath', async () => {
    await runWithNewHostSession(
      { id: 'bucket1-diskless-guards', diskless: true },
      () => {
        expect(FileReadTool.getPath({ file_path: '' })).toBe('')
        expect(FileReadTool.getPath({ file_path: '/remote/a.ts' })).toBe(
          '/remote/a.ts',
        )

        const readInput = { file_path: '~/relative/read.ts' }
        FileReadTool.backfillObservableInput?.(readInput)
        expect(readInput.file_path).toBe('~/relative/read.ts')

        const editInput = {
          file_path: '~/relative/edit.ts',
          old_string: 'a',
          new_string: 'b',
        }
        FileEditTool.backfillObservableInput?.(editInput)
        expect(editInput.file_path).toBe('~/relative/edit.ts')

        const writeInput = {
          file_path: '~/relative/write.ts',
          content: 'hi',
        }
        FileWriteTool.backfillObservableInput?.(writeInput)
        expect(writeInput.file_path).toBe('~/relative/write.ts')

        // GlobTool & GrepTool & NotebookEditTool diskless getPath guards
        expect(GlobTool.getPath({ pattern: '*.ts' })).toBe('')
        expect(
          GlobTool.getPath({ pattern: '*.ts', path: '~/remote-dir' }),
        ).toBe('~/remote-dir')
        expect(GrepTool.getPath({ pattern: 'hello' })).toBe('')
        expect(
          GrepTool.getPath({ pattern: 'hello', path: '~/remote-dir' }),
        ).toBe('~/remote-dir')
        expect(
          NotebookEditTool.getPath({
            notebook_path: '~/remote.ipynb',
            new_source: 'x = 1',
          }),
        ).toBe('~/remote.ipynb')
      },
    )
  })

  test('FileEditTool.inputsEquivalent compares purely in-memory without touching local disk when diskless', async () => {
    const samplePath = join(tmpDir, 'equiv.txt')
    writeFileSync(samplePath, 'hello\n', 'utf8')

    // Local: semantically equivalent edits read the file and return true;
    // reading a directory path throws EISDIR.
    expect(
      FileEditTool.inputsEquivalent?.(
        {
          file_path: samplePath,
          old_string: 'hello',
          new_string: 'world',
          replace_all: false,
        },
        {
          file_path: samplePath,
          old_string: 'hello\n',
          new_string: 'world\n',
          replace_all: false,
        },
      ),
    ).toBe(true)
    expect(() =>
      FileEditTool.inputsEquivalent?.(
        { file_path: tmpDir, old_string: 'a', new_string: 'b' },
        { file_path: tmpDir, old_string: 'c', new_string: 'd' },
      ),
    ).toThrow()

    // Diskless: purely in-memory comparison (never touches disk, never throws EISDIR)
    await runWithNewHostSession(
      { id: 'bucket1-fileedit-diskless-equiv', diskless: true },
      () => {
        expect(
          FileEditTool.inputsEquivalent?.(
            { file_path: tmpDir, old_string: 'a', new_string: 'b' },
            {
              file_path: tmpDir,
              old_string: 'a',
              new_string: 'b',
              replace_all: false,
            },
          ),
        ).toBe(true)
        expect(
          FileEditTool.inputsEquivalent?.(
            { file_path: tmpDir, old_string: 'a', new_string: 'b' },
            { file_path: tmpDir, old_string: 'c', new_string: 'd' },
          ),
        ).toBe(false)
        expect(
          FileEditTool.inputsEquivalent?.(
            {
              file_path: samplePath,
              old_string: 'hello',
              new_string: 'world',
              replace_all: false,
            },
            {
              file_path: samplePath,
              old_string: 'hello\n',
              new_string: 'world\n',
              replace_all: false,
            },
          ),
        ).toBe(false)
      },
    )
  })

  test('FileReadTool.fromAnotherProcess overwrites spoofed remote filePath, strips host-only fields, and emits image dimension meta', async () => {
    const disklessSession = makeSession(true)
    const ctx = resolveToolUseContext(
      createExplicitToolDeps({ session: disklessSession }),
      createToolCallContext({ toolUseId: 'toolu_read_sec' }),
    )

    let nextOutput: unknown
    const dispose = registerRemoteNativeToolRunner(
      disklessSession,
      FileReadTool.name,
      async () => ({ output: nextOutput }),
    )

    try {
      // text variant: spoofed filePath overwritten + extra host keys stripped
      nextOutput = {
        type: 'text',
        hostSecret: 'should-be-stripped',
        file: {
          filePath: '/etc/shadow',
          content: 'safe body',
          numLines: 1,
          startLine: 1,
          totalLines: 1,
          internalFlag: true,
        },
      }
      const textRes = await FileReadTool.call(
        { file_path: '/trusted/readme.md' },
        ctx,
      )
      expect(textRes.data.type).toBe('text')
      if (textRes.data.type === 'text') {
        expect(textRes.data.file.filePath).toBe('/trusted/readme.md')
        expect('internalFlag' in textRes.data.file).toBe(false)
      }
      expect('hostSecret' in textRes.data).toBe(false)

      // notebook variant: spoofed filePath overwritten
      nextOutput = {
        type: 'notebook',
        file: {
          filePath: '/spoofed/nb.ipynb',
          cells: [],
        },
      }
      const nbRes = await FileReadTool.call(
        { file_path: '/trusted/demo.ipynb' },
        ctx,
      )
      expect(nbRes.data.type).toBe('notebook')
      if (nbRes.data.type === 'notebook') {
        expect(nbRes.data.file.filePath).toBe('/trusted/demo.ipynb')
      }

      // pdf variant: spoofed filePath overwritten
      nextOutput = {
        type: 'pdf',
        file: {
          filePath: '/spoofed/secret.pdf',
          base64: 'JVBERi0xLjQ=',
          originalSize: 12,
        },
      }
      const pdfRes = await FileReadTool.call(
        { file_path: '/trusted/doc.pdf' },
        ctx,
      )
      expect(pdfRes.data.type).toBe('pdf')
      if (pdfRes.data.type === 'pdf') {
        expect(pdfRes.data.file.filePath).toBe('/trusted/doc.pdf')
      }

      // parts variant with host-local outputDir is rejected by wire schema
      nextOutput = {
        type: 'parts',
        file: {
          filePath: '/spoofed/doc.pdf',
          originalSize: 100,
          count: 1,
          outputDir: '/etc',
        },
      }
      await expect(
        FileReadTool.call({ file_path: '/trusted/doc.pdf' }, ctx),
      ).rejects.toMatchObject({
        name: NativeToolElsewhereError.name,
        code: 'ANSWER_LOST',
      })

      // image variant with resized dimensions emits coordinate-mapping meta message
      nextOutput = {
        type: 'image',
        file: {
          base64: 'iVBORw0KGgo=',
          type: 'image/png',
          originalSize: 2048,
          dimensions: {
            originalWidth: 2000,
            originalHeight: 1000,
            displayWidth: 1000,
            displayHeight: 500,
          },
        },
      }
      const imgRes = await FileReadTool.call(
        { file_path: '/trusted/shot.png' },
        ctx,
      )
      expect(imgRes.data.type).toBe('image')
      expect(imgRes.newMessages?.length).toBe(1)
    } finally {
      dispose()
      clearRemoteNativeToolRunners(disklessSession)
    }
  })

  test('NotebookEditTool outputSchemaAcrossProcesses + fromAnotherProcess restores trusted input, sanitizes cell_id/error, caps old_source, and clears full-file diffs', async () => {
    const disklessSession = makeSession(true)
    const ctx = resolveToolUseContext(
      createExplicitToolDeps({ session: disklessSession }),
      createToolCallContext({ toolUseId: 'toolu_nb_sec' }),
    )

    // Wire schema accepts partial payload omitting host-derived / bulky fields
    const partialParsed =
      NotebookEditTool.outputSchemaAcrossProcesses?.safeParse({
        cell_type: 'code',
        language: 'python',
        forgedExtra: 'drop-me',
      })
    expect(partialParsed?.success).toBe(true)
    if (partialParsed?.success) {
      expect('forgedExtra' in (partialParsed.data as object)).toBe(false)
    }

    const hugeOldSource = 'a'.repeat(120_000)
    const dispose = registerRemoteNativeToolRunner(
      disklessSession,
      NotebookEditTool.name,
      async () => ({
        output: {
          notebook_path: '/spoofed/other.ipynb',
          new_source: 'malicious_remote_source()',
          edit_mode: 'delete',
          cell_id: '<script>cell-1</script>\u202E\x1b[31m',
          cell_type: 'code',
          language: 'python',
          error: '<script>alert(1)</script>\u202E\x1b[31mboom\x1b[0m',
          old_source: hugeOldSource,
          original_file: '{"spoofed":"orig"}',
          updated_file: '{"spoofed":"updated"}',
          forgedExtra: true,
        },
      }),
    )

    try {
      const nbRes = await NotebookEditTool.call(
        {
          notebook_path: '/trusted/analysis.ipynb',
          cell_id: 'cell-1',
          new_source: 'x = 123',
        },
        ctx,
      )
      expect(nbRes.data.notebook_path).toBe('/trusted/analysis.ipynb')
      expect(nbRes.data.new_source).toBe('x = 123')
      expect(nbRes.data.edit_mode).toBe('replace')
      expect(nbRes.data.cell_id).toBe('&lt;script&gt;cell-1&lt;/script&gt;')
      expect(nbRes.data.error).toBe(
        '&lt;script&gt;alert(1)&lt;/script&gt; boom',
      )
      expect(nbRes.data.error).not.toContain('<script>')
      expect(nbRes.data.error).not.toContain('\u202E')
      expect(nbRes.data.error).not.toContain('\x1b')
      expect(nbRes.data.old_source?.length).toBe(100_000)
      expect(nbRes.data.original_file).toBe('')
      expect(nbRes.data.updated_file).toBe('')
      expect('forgedExtra' in nbRes.data).toBe(false)
    } finally {
      dispose()
      clearRemoteNativeToolRunners(disklessSession)
    }
  })

  test('Cross-process registerRemoteNativeToolRunner + outputSchemaAcrossProcesses + fromAnotherProcess hydrates filePath and userModified on FileWriteTool, FileEditTool, and FileReadTool', async () => {
    const disklessSession = makeSession(true)
    const ctx = resolveToolUseContext(
      createExplicitToolDeps({ session: disklessSession }),
      createToolCallContext({ toolUseId: 'toolu_remote_bucket1' }),
    )

    const writeRunner: RemoteNativeToolRunner = async (_toolName, input) => {
      const { file_path } = input as { file_path: string }
      if (file_path === '/bad-wire-write') {
        return { output: { invalid: true } }
      }
      return {
        output: {
          type: 'create',
          filePath: '/worker-local-path/ignored.ts',
          content: 'remote content',
          structuredPatch: [],
          originalFile: null,
          memdirStamped: true,
        },
      }
    }

    const editRunner: RemoteNativeToolRunner = async (_toolName, input) => {
      const { file_path } = input as { file_path: string }
      if (file_path === '/bad-wire-edit') {
        return { output: { broken: 42 } }
      }
      return {
        output: {
          filePath: '/worker-local-path/ignored.ts',
          oldString: 'before',
          newString: 'after',
          originalFile: 'before',
          structuredPatch: [],
          replaceAll: false,
          staleRecovered: true,
          contentNotInModelContext: false,
        },
      }
    }

    const readRunner: RemoteNativeToolRunner = async () => ({
      output: {
        type: 'text',
        file: {
          filePath: '/remote/notes.md',
          content: 'remote body',
          numLines: 1,
          startLine: 1,
          totalLines: 1,
        },
      },
    })

    const disposeWrite = registerRemoteNativeToolRunner(
      disklessSession,
      FileWriteTool.name,
      writeRunner,
    )
    const disposeEdit = registerRemoteNativeToolRunner(
      disklessSession,
      FileEditTool.name,
      editRunner,
    )
    const disposeRead = registerRemoteNativeToolRunner(
      disklessSession,
      FileReadTool.name,
      readRunner,
    )

    try {
      // FileWriteTool remote hydration: overrides filePath from input & userModified from opts
      const writeRes = await FileWriteTool.call(
        { file_path: '/host/target.ts', content: 'remote content' },
        ctx,
        undefined,
        undefined,
        undefined,
        { userModified: true },
      )
      expect(writeRes.data.type).toBe('create')
      expect(writeRes.data.filePath).toBe('/host/target.ts')
      expect(writeRes.data.userModified).toBe(true)
      expect(writeRes.data.memdirStamped).toBe(true)

      const writeResUnmodified = await FileWriteTool.call(
        { file_path: '/host/target2.ts', content: 'remote content' },
        ctx,
      )
      expect(writeResUnmodified.data.filePath).toBe('/host/target2.ts')
      expect(writeResUnmodified.data.userModified).toBe(false)

      // FileWriteTool corrupt wire payload -> ANSWER_LOST
      await expect(
        FileWriteTool.call({ file_path: '/bad-wire-write', content: 'x' }, ctx),
      ).rejects.toMatchObject({
        name: NativeToolElsewhereError.name,
        code: 'ANSWER_LOST',
      })

      // FileEditTool remote hydration: accepts missing userModified + extra cross-process fields and hydrates filePath & userModified
      const editRes = await FileEditTool.call(
        {
          file_path: '/host/edited.ts',
          old_string: 'before',
          new_string: 'after',
          replace_all: false,
        },
        ctx,
        undefined,
        undefined,
        undefined,
        { userModified: true },
      )
      expect(editRes.data.filePath).toBe('/host/edited.ts')
      expect(editRes.data.userModified).toBe(true)
      expect(editRes.data.oldString).toBe('before')
      expect(editRes.data.newString).toBe('after')

      const editResUnmodified = await FileEditTool.call(
        {
          file_path: '/host/edited2.ts',
          old_string: 'before',
          new_string: 'after',
          replace_all: false,
        },
        ctx,
      )
      expect(editResUnmodified.data.filePath).toBe('/host/edited2.ts')
      expect(editResUnmodified.data.userModified).toBe(false)

      // FileEditTool corrupt wire payload -> ANSWER_LOST
      await expect(
        FileEditTool.call(
          {
            file_path: '/bad-wire-edit',
            old_string: 'a',
            new_string: 'b',
            replace_all: false,
          },
          ctx,
        ),
      ).rejects.toMatchObject({
        name: NativeToolElsewhereError.name,
        code: 'ANSWER_LOST',
      })

      // FileReadTool remote round-trip via outputSchemaAcrossProcesses + fromAnotherProcess
      const readRes = await FileReadTool.call(
        { file_path: '/remote/notes.md' },
        ctx,
      )
      expect(readRes.data.type).toBe('text')
      if (readRes.data.type === 'text') {
        expect(readRes.data.file.content).toBe('remote body')
      }
    } finally {
      disposeWrite()
      disposeEdit()
      disposeRead()
      clearRemoteNativeToolRunners(disklessSession)
    }
  })
})
