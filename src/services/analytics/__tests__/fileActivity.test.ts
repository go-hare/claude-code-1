/**
 * densable jkc / f2r residual — tengu_file_activity helpers.
 */
import { describe, expect, test } from 'bun:test'
import {
  emitFileActivityForToolSuccess,
  fileActivityPayloadForAnalytics,
} from '../metadata'

const NAMES = {
  edit: 'Edit',
  write: 'Write',
  notebookEdit: 'NotebookEdit',
  bash: 'Bash',
  powerShell: 'PowerShell',
}

describe('fileActivityPayloadForAnalytics densable f2r', () => {
  test('casts activity/toolName; omits undefined deliverChannel', () => {
    const p = fileActivityPayloadForAnalytics({
      messageID: 'mid-1',
      activity: 'edit',
      fileExtension: 'ts' as never,
      toolName: 'Edit',
      isNewFile: true,
      deliverChannel: undefined,
    })
    expect(p.messageID as unknown as string).toBe('mid-1')
    expect(p.activity as unknown as string).toBe('edit')
    expect(p.fileExtension as unknown as string).toBe('ts')
    expect(p.toolName as unknown as string).toBe('Edit')
    expect(p.isNewFile).toBe(true)
    expect('deliverChannel' in p).toBe(false)
  })

  test('mcp toolName sanitized to mcp_tool', () => {
    const p = fileActivityPayloadForAnalytics({
      messageID: 'm',
      activity: 'write',
      fileExtension: undefined,
      toolName: 'mcp__foo__bar',
      isNewFile: undefined,
    })
    expect(p.toolName as unknown as string).toBe('mcp_tool')
    expect('fileExtension' in p).toBe(false)
  })
})

describe('emitFileActivityForToolSuccess densable jkc', () => {
  test('non-object input → 0', () => {
    const events: Array<{ n: string; m: Record<string, unknown> }> = []
    const n = emitFileActivityForToolSuccess(
      (name, meta) =>
        events.push({ n: name, m: meta as Record<string, unknown> }),
      'Edit',
      null,
      'mid',
      NAMES,
    )
    expect(n).toBe(0)
    expect(events).toEqual([])
  })

  test('Edit: isNewFile true when old_string empty', () => {
    const events: Array<{ n: string; m: Record<string, unknown> }> = []
    const n = emitFileActivityForToolSuccess(
      (name, meta) =>
        events.push({ n: name, m: meta as Record<string, unknown> }),
      'Edit',
      { file_path: 'src/a.ts', old_string: '', new_string: 'x' },
      'mid-e',
      NAMES,
    )
    expect(n).toBe(1)
    expect(events[0]?.n).toBe('tengu_file_activity')
    expect(events[0]?.m.activity as unknown as string).toBe('edit')
    expect(events[0]?.m.fileExtension as unknown as string).toBe('ts')
    expect(events[0]?.m.isNewFile).toBe(true)
    expect(events[0]?.m.toolName as unknown as string).toBe('Edit')
    expect(events[0]?.m.messageID as unknown as string).toBe('mid-e')
  })

  test('Edit: isNewFile false when old_string non-empty', () => {
    const events: Array<{ n: string; m: Record<string, unknown> }> = []
    emitFileActivityForToolSuccess(
      (name, meta) =>
        events.push({ n: name, m: meta as Record<string, unknown> }),
      'Edit',
      { file_path: 'readme.md', old_string: 'a', new_string: 'b' },
      'mid',
      NAMES,
    )
    expect(events[0]?.m.isNewFile).toBe(false)
    expect(events[0]?.m.fileExtension as unknown as string).toBe('md')
  })

  test('Write: isNewFile undefined', () => {
    const events: Array<{ n: string; m: Record<string, unknown> }> = []
    const n = emitFileActivityForToolSuccess(
      (name, meta) =>
        events.push({ n: name, m: meta as Record<string, unknown> }),
      'Write',
      { file_path: '/tmp/out.pdf', content: 'x' },
      'mid-w',
      NAMES,
    )
    expect(n).toBe(1)
    expect(events[0]?.m.activity as unknown as string).toBe('write')
    expect(events[0]?.m.fileExtension as unknown as string).toBe('pdf')
    expect(events[0]?.m.isNewFile).toBeUndefined()
  })

  test('NotebookEdit: isNewFile false', () => {
    const events: Array<{ n: string; m: Record<string, unknown> }> = []
    const n = emitFileActivityForToolSuccess(
      (name, meta) =>
        events.push({ n: name, m: meta as Record<string, unknown> }),
      'NotebookEdit',
      { notebook_path: 'nb.ipynb', cell_id: '1' },
      'mid-n',
      NAMES,
    )
    expect(n).toBe(1)
    expect(events[0]?.m.activity as unknown as string).toBe('notebook_edit')
    expect(events[0]?.m.fileExtension as unknown as string).toBe('ipynb')
    expect(events[0]?.m.isNewFile).toBe(false)
  })

  test('Bash: one bash_mention per z5n extension, sorted unique', () => {
    const events: Array<{ n: string; m: Record<string, unknown> }> = []
    const n = emitFileActivityForToolSuccess(
      (name, meta) =>
        events.push({ n: name, m: meta as Record<string, unknown> }),
      'Bash',
      { command: 'cat notes.MD && cp a.pdf b.PDF && echo x.txt' },
      'mid-b',
      NAMES,
    )
    expect(n).toBe(3)
    const exts = events.map(e => e.m.fileExtension as unknown as string).sort()
    expect(exts).toEqual(['md', 'pdf', 'txt'])
    for (const e of events) {
      expect(e.n).toBe('tengu_file_activity')
      expect(e.m.activity as unknown as string).toBe('bash_mention')
      expect(e.m.toolName as unknown as string).toBe('Bash')
      expect(e.m.isNewFile).toBeUndefined()
    }
  })

  test('Bash no doc ext → 0', () => {
    const events: Array<{ n: string; m: Record<string, unknown> }> = []
    const n = emitFileActivityForToolSuccess(
      (name, meta) =>
        events.push({ n: name, m: meta as Record<string, unknown> }),
      'Bash',
      { command: 'echo hi && rm foo.ts' },
      'mid',
      NAMES,
    )
    expect(n).toBe(0)
    expect(events).toEqual([])
  })

  test('PowerShell also harvests z5n', () => {
    const events: Array<{ n: string; m: Record<string, unknown> }> = []
    const n = emitFileActivityForToolSuccess(
      (name, meta) =>
        events.push({ n: name, m: meta as Record<string, unknown> }),
      'PowerShell',
      { command: 'Get-Content report.docx' },
      'mid-ps',
      NAMES,
    )
    expect(n).toBe(1)
    expect(events[0]?.m.activity as unknown as string).toBe('bash_mention')
    expect(events[0]?.m.fileExtension as unknown as string).toBe('docx')
    expect(events[0]?.m.toolName as unknown as string).toBe('PowerShell')
  })

  test('Read / unknown tool → 0 (local skip)', () => {
    const events: Array<{ n: string; m: Record<string, unknown> }> = []
    expect(
      emitFileActivityForToolSuccess(
        (name, meta) =>
          events.push({ n: name, m: meta as Record<string, unknown> }),
        'Read',
        { file_path: 'a.ts' },
        'mid',
        NAMES,
      ),
    ).toBe(0)
    expect(
      emitFileActivityForToolSuccess(
        (name, meta) =>
          events.push({ n: name, m: meta as Record<string, unknown> }),
        'Artifact',
        { file_path: 'a.pdf' },
        'mid',
        NAMES,
      ),
    ).toBe(0)
    expect(events).toEqual([])
  })
})
