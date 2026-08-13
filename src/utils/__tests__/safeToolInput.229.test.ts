/**
 * densable 2.1.229 #7 — nst/CIr: non-string tool input fields must not crash
 * resume / collapse / memory classification paths.
 */
import { describe, expect, test } from 'bun:test'
import {
  extractSafeToolInputFields,
  getSafeToolFilePath,
  getSafeToolFilePathFromRaw,
  isSafeToolInputString,
} from '../safeToolInput.js'
import {
  getSearchExtraToolsOrReadInfo,
  collapseReadSearchGroups,
} from '../collapseReadSearch.js'
import {
  isTeamMemorySearch,
  isTeamMemoryWriteOrEdit,
} from '../teamMemoryOps.js'
import type { RenderableMessage } from '../../types/message.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import { GREP_TOOL_NAME } from '@claude-code/builtin-tools/tools/GrepTool/prompt.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'

describe('densable 2.1.229 #7 nst/CIr extractSafeToolInputFields', () => {
  test('drops non-string path-like fields (glob/file_path/command/path/pattern/query)', () => {
    const out = extractSafeToolInputFields({
      file_path: { nested: true },
      path: 12,
      pattern: true,
      glob: ['**/*'],
      command: null,
      query: { q: 1 },
      content: 99,
      other: 'kept-out-by-design',
    })
    expect(out).toEqual({})
  })

  test('keeps clean strings; content only requires typeof string (no CIr null-byte)', () => {
    const out = extractSafeToolInputFields({
      file_path: '/tmp/a.ts',
      path: '/tmp',
      pattern: 'foo',
      glob: '**/*.ts',
      command: 'rg foo',
      query: 'search me',
      content: 'hello',
    })
    expect(out).toEqual({
      file_path: '/tmp/a.ts',
      path: '/tmp',
      pattern: 'foo',
      glob: '**/*.ts',
      command: 'rg foo',
      query: 'search me',
      content: 'hello',
    })
  })

  test('CIr rejects embedded NUL in path-like fields; content may still include NUL', () => {
    expect(isSafeToolInputString('a\0b')).toBe(false)
    const out = extractSafeToolInputFields({
      file_path: 'a\0b',
      path: 'ok',
      content: 'has\0nul',
    })
    expect(out).toEqual({ path: 'ok', content: 'has\0nul' })
  })

  test('null / non-object input → {}', () => {
    expect(extractSafeToolInputFields(null)).toEqual({})
    expect(extractSafeToolInputFields(undefined)).toEqual({})
    expect(extractSafeToolInputFields('x')).toEqual({})
    expect(extractSafeToolInputFields(1)).toEqual({})
  })

  test('AIr prefers file_path over path', () => {
    expect(getSafeToolFilePath({ file_path: '/a', path: '/b' })).toBe('/a')
    expect(getSafeToolFilePath({ path: '/b' })).toBe('/b')
    expect(getSafeToolFilePathFromRaw({ file_path: 1, path: '/b' })).toBe('/b')
    expect(getSafeToolFilePathFromRaw({ file_path: { x: 1 } })).toBeUndefined()
  })
})

describe('densable 2.1.229 #7 collapse / team memory no-crash', () => {
  test('isMemoryWriteOrEdit with non-string file_path does not throw', () => {
    expect(() =>
      getSearchExtraToolsOrReadInfo(
        FILE_EDIT_TOOL_NAME,
        { file_path: { bad: true }, old_string: 'a', new_string: 'b' },
        [],
      ),
    ).not.toThrow()
    const info = getSearchExtraToolsOrReadInfo(
      FILE_EDIT_TOOL_NAME,
      { file_path: { bad: true } },
      [],
    )
    expect(info.isMemoryWrite).toBe(false)
  })

  test('isMemorySearch with non-string path/glob/command does not throw', () => {
    expect(() =>
      getSearchExtraToolsOrReadInfo(
        GREP_TOOL_NAME,
        { path: { x: 1 }, glob: 2, command: 3, pattern: 4 },
        [],
      ),
    ).not.toThrow()
  })

  test('team memory helpers drop non-string paths', () => {
    expect(isTeamMemorySearch({ path: { x: 1 } })).toBe(false)
    expect(
      isTeamMemoryWriteOrEdit(FILE_EDIT_TOOL_NAME, { file_path: 99 }),
    ).toBe(false)
  })

  test('collapseReadSearchGroups with non-string Read/Grep/Bash inputs does not throw', () => {
    const messages = [
      {
        type: 'assistant',
        uuid: '00000000-0000-4000-8000-000000000001',
        timestamp: new Date().toISOString(),
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu1',
              name: FILE_READ_TOOL_NAME,
              input: { file_path: { not: 'a string' } },
            },
          ],
        },
      },
      {
        type: 'assistant',
        uuid: '00000000-0000-4000-8000-000000000002',
        timestamp: new Date().toISOString(),
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu2',
              name: GREP_TOOL_NAME,
              input: {
                pattern: { p: 1 },
                path: 2,
                glob: 3,
              },
            },
          ],
        },
      },
      {
        type: 'assistant',
        uuid: '00000000-0000-4000-8000-000000000003',
        timestamp: new Date().toISOString(),
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu3',
              name: BASH_TOOL_NAME,
              input: { command: { cmd: true } },
            },
          ],
        },
      },
    ] as unknown as RenderableMessage[]

    // Tools list empty → isSearchOrReadCommand absent; still must not crash on
    // memory/path extractors when classification runs.
    expect(() => collapseReadSearchGroups(messages, [])).not.toThrow()
  })
})
