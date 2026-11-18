import { afterEach, describe, expect, mock, test } from 'bun:test'
import { open, writeFile, rm, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

mock.module('src/utils/ShellCommand.js', () => ({
  ShellCommand: class {},
  killProcessTree: () => {},
  wrapSpawn: (fn: unknown) => fn,
  createAbortedCommand: () => ({}),
  createFailedCommand: (err: string) => ({ preSpawnError: err }),
  createAdoptedShellCommand: () => ({}),
}))

const { parsePDFPageRange } = await import('../pdfUtils.js')
const { readNotebook } = await import('../notebook.js')
const {
  getToolSearchUnsupportedModels,
  modelSupportsToolSearch,
  shouldDeferToolForSearch,
} = await import('../searchExtraTools.js')
const { setDynamicTeamContext, clearDynamicTeamContext } = await import(
  '../teammate.js'
)

describe('2.1.292-2.1.295 builtin tool utils alignment', () => {
  afterEach(() => {
    clearDynamicTeamContext()
  })

  test('#416 DEFAULT_TOOL_SEARCH_UNSUPPORTED_MODELS includes Claude 3 Opus and 3.x Sonnet', () => {
    const models = getToolSearchUnsupportedModels()
    expect(models).toEqual(
      expect.arrayContaining([
        'claude-3-opus',
        'claude-3-sonnet',
        'claude-3-haiku',
        'claude-3-5-sonnet',
        'claude-3-5-haiku',
        'claude-3-7-sonnet',
      ]),
    )
    expect(modelSupportsToolSearch('claude-3-opus-20240229')).toBe(false)
    expect(modelSupportsToolSearch('claude-3-sonnet-20240229')).toBe(false)
    expect(modelSupportsToolSearch('claude-3-5-sonnet-20241022')).toBe(false)
    expect(modelSupportsToolSearch('claude-3-7-sonnet-20250219')).toBe(false)
    expect(modelSupportsToolSearch('claude-sonnet-4-6')).toBe(true)
  })

  test('#215 parsePDFPageRange rejects comma-separated lists and invalid ranges', () => {
    expect(parsePDFPageRange('6,9,15')).toBeNull()
    expect(parsePDFPageRange('1, 2')).toBeNull()
    expect(parsePDFPageRange('abc')).toBeNull()
    expect(parsePDFPageRange('5-2')).toBeNull()
    expect(parsePDFPageRange('0')).toBeNull()
    expect(parsePDFPageRange('3')).toEqual({ firstPage: 3, lastPage: 3 })
    expect(parsePDFPageRange('1-5')).toEqual({ firstPage: 1, lastPage: 5 })
    expect(parsePDFPageRange('10-')).toEqual({
      firstPage: 10,
      lastPage: Infinity,
    })
  })

  test('#202 readNotebook reads from an already-opened FileHandle', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nb-202-'))
    try {
      const nbPath = join(dir, 'test.ipynb')
      await writeFile(
        nbPath,
        JSON.stringify({
          cells: [
            {
              cell_type: 'code',
              id: 'c1',
              source: ['print(1)'],
              metadata: {},
              outputs: [],
            },
          ],
          metadata: { language_info: { name: 'python' } },
          nbformat: 4,
          nbformat_minor: 5,
        }),
      )
      const handle = await open(nbPath, 'r')
      try {
        const cells = await readNotebook(handle)
        expect(cells).toHaveLength(1)
        expect(cells[0]!.source).toBe('print(1)')
      } finally {
        await handle.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('#388 shouldDeferToolForSearch does not defer SendMessage for teammates', () => {
    const fakeSendMessage = { name: 'SendMessage', shouldDefer: true } as any
    expect(shouldDeferToolForSearch(fakeSendMessage)).toBe(true)

    setDynamicTeamContext({
      agentId: 'a1',
      agentName: 'worker',
      teamName: 'team1',
      planModeRequired: false,
    })
    expect(shouldDeferToolForSearch(fakeSendMessage)).toBe(false)
  })
})
