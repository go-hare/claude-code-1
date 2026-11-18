import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import {
  isContentPrintedInStdout,
  parseSingleFileReadCommands,
  trackBashSingleFileReads,
} from './BashTool.js'

describe('BashTool single-file read tracking (#313 & #403)', () => {
  let tempDir: string
  let sampleFile: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bash-single-read-'))
    sampleFile = join(tempDir, 'sample.txt')
    writeFileSync(sampleFile, 'alpha\nbeta\ngamma\ndelta\nepsilon\n', 'utf8')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('#313: parseSingleFileReadCommands parses cat, head, tail, sed -n, and grep/rg', () => {
    expect(parseSingleFileReadCommands(`cat ${sampleFile}`)).toEqual([
      { filePath: sampleFile, startLine: undefined, endLine: undefined },
    ])
    expect(parseSingleFileReadCommands(`cat -n ${sampleFile}`)).toEqual([
      {
        filePath: sampleFile,
        startLine: undefined,
        endLine: undefined,
        numbered: true,
      },
    ])
    expect(parseSingleFileReadCommands(`head -n 3 ${sampleFile}`)).toEqual([
      { filePath: sampleFile, startLine: 1, endLine: 3 },
    ])
    expect(parseSingleFileReadCommands(`tail -n 2 ${sampleFile}`)).toEqual([
      {
        filePath: sampleFile,
        startLine: undefined,
        endLine: undefined,
        tailLines: 2,
      },
    ])
    expect(parseSingleFileReadCommands(`sed -n '2,4p' ${sampleFile}`)).toEqual([
      { filePath: sampleFile, startLine: 2, endLine: 4 },
    ])
    expect(parseSingleFileReadCommands(`grep -n beta ${sampleFile}`)).toEqual([
      {
        filePath: sampleFile,
        startLine: undefined,
        endLine: undefined,
        requiresExitZero: true,
        contentNotInModelContext: true,
      },
    ])

    // Rejects pipes, redirections, sed -i, and multi-file cat
    expect(
      parseSingleFileReadCommands(`cat ${sampleFile} | grep alpha`),
    ).toEqual([])
    expect(
      parseSingleFileReadCommands(`sed -i 's/a/b/' ${sampleFile}`),
    ).toEqual([])
    expect(parseSingleFileReadCommands(`cat ${sampleFile} /etc/hosts`)).toEqual(
      [],
    )
  })

  test('#313 & #403: trackBashSingleFileReads records readFileState and nestedMemoryAttachmentTriggers only when stdout printed the content', async () => {
    const readFileState = new Map() as unknown as Parameters<
      typeof trackBashSingleFileReads
    >[1]
    const triggers = new Set<string>()
    const controller = new AbortController()
    const permissions = () => getEmptyToolPermissionContext()

    // #403: stdout did NOT print the file content -> do NOT record
    await trackBashSingleFileReads(
      `cat ${sampleFile}`,
      readFileState,
      controller.signal,
      0,
      'some unrelated output',
      { triggers, permissions },
    )
    expect(readFileState.get(sampleFile)).toBeUndefined()
    expect(triggers.size).toBe(0)

    // #313 + #403: stdout printed the file content -> record readFileState and trigger nested memory
    await trackBashSingleFileReads(
      `sed -n '2,3p' ${sampleFile}`,
      readFileState,
      controller.signal,
      0,
      'beta\ngamma\n',
      { triggers, permissions },
    )
    const entry = readFileState.get(sampleFile)
    expect(entry).toBeDefined()
    expect(entry?.content).toBe('beta\ngamma')
    expect(entry?.offset).toBe(2)
    expect(entry?.limit).toBe(2)
    expect(triggers.has(sampleFile)).toBe(true)
  })

  test('#403: isContentPrintedInStdout handles cat -n numbered lines', () => {
    expect(
      isContentPrintedInStdout(
        '     1\talpha\n     2\tbeta\n',
        'alpha\nbeta',
        true,
      ),
    ).toBe(true)
    expect(
      isContentPrintedInStdout('completely different', 'alpha\nbeta', false),
    ).toBe(false)
  })
})
