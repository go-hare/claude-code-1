import { describe, expect, mock, test } from 'bun:test'

mock.module('src/utils/ShellCommand.js', () => ({
  ShellCommand: class {},
  killProcessTree: () => {},
  wrapSpawn: (fn: unknown) => fn,
  createAbortedCommand: () => ({}),
  createFailedCommand: (err: string) => ({ preSpawnError: err }),
  createAdoptedShellCommand: () => ({}),
}))

mock.module('./UI.js', () => ({
  getToolUseSummary: () => '',
  renderToolResultMessage: () => null,
  renderToolUseErrorMessage: () => null,
  renderToolUseMessage: () => null,
  renderToolUseTag: () => null,
  userFacingName: () => 'Read',
}))

const { coerceFileReadInput, FileReadTool } = await import('./FileReadTool.js')

describe('2.1.292-2.1.296 FileReadTool alignment', () => {
  test('#421 empty or whitespace-only pages parameter is treated as omitted', () => {
    const parsedEmpty = FileReadTool.inputSchema.safeParse({
      file_path: '/tmp/doc.pdf',
      pages: '',
    })
    expect(parsedEmpty.success).toBe(true)
    if (parsedEmpty.success) {
      expect(parsedEmpty.data.pages).toBeUndefined()
    }

    const parsedSpaces = FileReadTool.inputSchema.safeParse({
      file_path: '/tmp/doc.pdf',
      pages: '   ',
    })
    expect(parsedSpaces.success).toBe(true)
    if (parsedSpaces.success) {
      expect(parsedSpaces.data.pages).toBeUndefined()
    }
  })

  test('#215 validateInput rejects list pages like "6,9,15" with guidance', async () => {
    const res = await FileReadTool.validateInput(
      { file_path: '/tmp/doc.pdf', pages: '6,9,15' },
      {
        getAppState: () => ({
          toolPermissionContext: {
            mode: 'default',
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            additionalWorkingDirectories: new Map(),
          },
        }),
      } as any,
    )
    expect(res.result).toBe(false)
    if (!res.result) {
      expect(res.errorCode).toBe(7)
      expect(res.message).toContain('not a list')
      expect(res.message).toContain('read each one separately')
    }
  })

  test('#256 coerceFileReadInput normalizes stray/array parameters', () => {
    expect(
      coerceFileReadInput({
        file_path: '/tmp/a.txt',
        offset: [10],
        limit: [20],
        description: 'ignored',
      }),
    ).toEqual({
      input: { file_path: '/tmp/a.txt', offset: 10, limit: 20 },
      shapeClass: 'offset_array,limit_array,drop_description',
    })

    expect(
      coerceFileReadInput({
        file_path: '/tmp/a.txt',
        offset: -1,
        limit: 0,
        length: 50,
      }),
    ).toEqual({
      input: { file_path: '/tmp/a.txt', limit: 50 },
      shapeClass: 'offset_neg,limit_dropped,length',
    })
  })

  test('#491 allow_large parameter is accepted in FileReadTool inputSchema', () => {
    const parsed = FileReadTool.inputSchema.safeParse({
      file_path: '/tmp/large.txt',
      allow_large: true,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.allow_large).toBe(true)
    }
  })
})
