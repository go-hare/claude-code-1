/**
 * densable 2.1.239 Write tool chain locks.
 * Gold: official SEA validateInput / Yo0 / mapToolResult / inputsEquivalent.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { FileWriteTool } from '../FileWriteTool.js'
import { isResultTruncated, wrapCount, wrapVisibleLines } from '../UI.js'

const src = readFileSync(join(import.meta.dir, '../FileWriteTool.ts'), 'utf8')
const ui = readFileSync(join(import.meta.dir, '../UI.tsx'), 'utf8')

describe('densable 2.1.239 FileWriteTool', () => {
  test('validateInput source: subagent report gate is errorCode 5', () => {
    expect(src).toContain('REPORT|SUMMARY|FINDINGS|ANALYSIS')
    expect(src).toContain('tengu_subagent_md_report_blocked')
    expect(src).toContain('Subagents should return findings as text')
    expect(src).toMatch(/agentId[\s\S]*errorCode:\s*5/)
    expect(src).not.toMatch(/existing directory[\s\S]{0,200}errorCode:\s*5/)
  })

  test('validateInput source: hNr is Perforce-only errorCode 6', () => {
    expect(src).toContain('isPerforceModeEnabled()')
    expect(src).toContain('mode & 128')
    expect(src).toContain('p4 edit <file>')
    expect(src).toMatch(/errorCode:\s*6/)
    expect(src).not.toContain('isFIFO()')
    expect(src).not.toContain('SPECIAL_FILE_CANNOT_WRITE')
  })

  test('local safety: directory/FIFO uses errorCode 10, not 5 or 6', () => {
    expect(src).toContain('isExistingDirectoryOrFifo')
    expect(src).toContain('Specify a path that includes a filename')
    expect(src).toMatch(/isExistingDirectoryOrFifo[\s\S]{0,400}errorCode:\s*10/)
    expect(src).not.toMatch(/existing directory[\s\S]{0,200}errorCode:\s*5/)
  })

  test('inputsEquivalent ignores trailing newlines only', () => {
    expect(FileWriteTool.inputsEquivalent).toBeDefined()
    const eq = FileWriteTool.inputsEquivalent!
    expect(
      eq(
        { file_path: '/a.ts', content: 'hi\n' },
        { file_path: '/a.ts', content: 'hi\n\n' },
      ),
    ).toBe(true)
    expect(
      eq(
        { file_path: '/a.ts', content: 'hi' },
        { file_path: '/b.ts', content: 'hi' },
      ),
    ).toBe(false)
    expect(
      eq(
        { file_path: '/a.ts', content: 'hi' },
        { file_path: '/a.ts', content: 'ho' },
      ),
    ).toBe(false)
  })

  test('mapToolResult appends official userModified note', () => {
    const clean = FileWriteTool.mapToolResultToToolResultBlockParam(
      {
        type: 'create',
        filePath: '/a.ts',
        content: 'x',
        structuredPatch: [],
        originalFile: null,
      },
      'tu-1',
    )
    expect(clean.content).toBe('File created successfully at: /a.ts')

    const edited = FileWriteTool.mapToolResultToToolResultBlockParam(
      {
        type: 'update',
        filePath: '/a.ts',
        content: 'x',
        structuredPatch: [],
        originalFile: 'y',
        userModified: true,
      },
      'tu-2',
    )
    expect(String(edited.content)).toContain(
      'The user modified your proposed content before accepting it.',
    )
    expect(String(edited.content)).toContain(
      'The file /a.ts has been updated successfully.',
    )
  })

  test('stripForStorage clears update body', () => {
    expect(FileWriteTool.stripForStorage).toBeDefined()
    const stripped = FileWriteTool.stripForStorage!({
      type: 'update',
      filePath: '/a.ts',
      content: 'big',
      structuredPatch: [],
      originalFile: 'old',
    })
    expect(stripped.content).toBe('')
    expect(stripped.originalFile).toBeNull()
    const create = FileWriteTool.stripForStorage!({
      type: 'create',
      filePath: '/a.ts',
      content: 'keep',
      structuredPatch: [],
      originalFile: null,
    })
    expect(create.content).toBe('keep')
  })

  test('Yo0 wrap-aware isResultTruncated', () => {
    const ten = 'a\n'.repeat(10)
    expect(isResultTruncated({ type: 'create', content: ten } as never)).toBe(
      false,
    )
    expect(
      isResultTruncated({ type: 'update', content: ten } as never, {
        columns: 40,
      }),
    ).toBe(false)
    expect(
      isResultTruncated(
        { type: 'create', content: 'a\n'.repeat(11) } as never,
        {
          columns: 40,
        },
      ),
    ).toBe(true)
    const wide = 'x'.repeat(100)
    expect(
      isResultTruncated({ type: 'create', content: wide } as never, {
        columns: 20,
      }),
    ).toBe(true)
    expect(typeof wrapCount(wide, 8)).toBe('number')
    expect(wrapVisibleLines('a\n', 80)).toBe(1)
  })

  test('UI source: collapse is scratchpad or auto-mem', () => {
    expect(ui).toContain('isScratchpadFile')
    expect(ui).toContain('isAutoMemPath')
    expect(ui).toContain('isCollapsedWritePath')
    expect(ui).toContain('wrapCount')
  })
})
