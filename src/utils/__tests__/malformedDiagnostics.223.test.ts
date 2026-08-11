/**
 * densable 2.1.223 #14 — malformed diagnostics attachment must not crash resume
 * and sanitizeDiagnosticFiles must match SEA depth (range.start number gate,
 * severity map, end default, dual gold drop strings).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  clearDiagnosticSanitizeLatchesForTests,
  DiagnosticTrackingService,
  mapDiagnosticSeverity,
} from '../../services/diagnosticTracking.js'
import {
  dropMalformedAttachments,
  isValidAttachmentPayload,
} from '../conversationRecovery.js'
import type { Message } from '../../types/message.js'

function attachmentMsg(attachment: unknown): Message {
  return {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-000000000099',
    timestamp: new Date().toISOString(),
    attachment,
  } as Message
}

afterEach(() => {
  clearDiagnosticSanitizeLatchesForTests()
})

describe('malformed diagnostics densable 2.1.223 #14', () => {
  test('nXu accepts diagnostics with array files / missing files', () => {
    expect(isValidAttachmentPayload({ type: 'diagnostics' })).toBe(true)
    expect(isValidAttachmentPayload({ type: 'diagnostics', files: [] })).toBe(
      true,
    )
    expect(
      isValidAttachmentPayload({
        type: 'diagnostics',
        files: [{ uri: 'file:///a.ts', diagnostics: [] }],
      }),
    ).toBe(true)
  })

  test('nXu rejects diagnostics when files is not an array', () => {
    expect(isValidAttachmentPayload({ type: 'diagnostics', files: null })).toBe(
      false,
    )
    expect(
      isValidAttachmentPayload({ type: 'diagnostics', files: 'nope' }),
    ).toBe(false)
    expect(isValidAttachmentPayload({ type: 'diagnostics', files: {} })).toBe(
      false,
    )
  })

  test('dQr drops diagnostics with non-array files on resume', () => {
    const good = attachmentMsg({ type: 'new_file', filename: 'ok.ts' })
    const bad = attachmentMsg({ type: 'diagnostics', files: null })
    const out = dropMalformedAttachments([good, bad])
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(good)
  })
})

describe('densable sanitizeDiagnosticFiles 2.1.223 #14', () => {
  test('mapDiagnosticSeverity matches densable fvd', () => {
    expect(mapDiagnosticSeverity('error')).toBe('Error')
    expect(mapDiagnosticSeverity('WARNING')).toBe('Warning')
    expect(mapDiagnosticSeverity('information')).toBe('Info')
    expect(mapDiagnosticSeverity('info')).toBe('Info')
    expect(mapDiagnosticSeverity('hint')).toBe('Hint')
    expect(mapDiagnosticSeverity('nope')).toBeUndefined()
    expect(mapDiagnosticSeverity(1)).toBeUndefined()
  })

  test('non-array payload returns []', () => {
    expect(
      DiagnosticTrackingService.sanitizeDiagnosticFiles(undefined),
    ).toEqual([])
    expect(DiagnosticTrackingService.sanitizeDiagnosticFiles(null)).toEqual([])
    expect(DiagnosticTrackingService.sanitizeDiagnosticFiles({})).toEqual([])
    expect(DiagnosticTrackingService.sanitizeDiagnosticFiles('x')).toEqual([])
  })

  test('drops file without uri / non-array diagnostics', () => {
    const out = DiagnosticTrackingService.sanitizeDiagnosticFiles([
      null,
      { diagnostics: [] },
      { uri: 'file:///a.ts', diagnostics: 'nope' },
      {
        uri: 'file:///ok.ts',
        diagnostics: [
          {
            message: 'e',
            severity: 'Error',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
          },
        ],
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.uri).toBe('file:///ok.ts')
  })

  test('requires range.start.line/character number (not just range object)', () => {
    const out = DiagnosticTrackingService.sanitizeDiagnosticFiles([
      {
        uri: 'file:///a.ts',
        diagnostics: [
          { message: 'no range', severity: 'Error', range: {} },
          {
            message: 'string line',
            severity: 'Error',
            range: { start: { line: '0', character: 0 } },
          },
          {
            message: 'ok',
            severity: 'Error',
            range: {
              start: { line: 1, character: 2 },
              end: { line: 1, character: 5 },
            },
          },
        ],
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.diagnostics).toHaveLength(1)
    expect(out[0]!.diagnostics[0]!.message).toBe('ok')
    expect(out[0]!.diagnostics[0]!.range.start).toEqual({
      line: 1,
      character: 2,
    })
  })

  test('end defaults to start when end missing or non-number', () => {
    const out = DiagnosticTrackingService.sanitizeDiagnosticFiles([
      {
        uri: 'file:///a.ts',
        diagnostics: [
          {
            message: 'no end',
            severity: 'warning',
            range: { start: { line: 3, character: 4 } },
          },
        ],
      },
    ])
    expect(out[0]!.diagnostics[0]!.range.end).toEqual({ line: 3, character: 4 })
    expect(out[0]!.diagnostics[0]!.severity).toBe('Warning')
  })

  test('omits unmapped severity; keeps only string code/source', () => {
    const out = DiagnosticTrackingService.sanitizeDiagnosticFiles([
      {
        uri: 'file:///a.ts',
        diagnostics: [
          {
            message: 'weird sev',
            severity: 'critical',
            range: { start: { line: 0, character: 0 } },
            code: 42,
            source: { x: 1 },
          },
          {
            message: 'mapped',
            severity: 'information',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
            code: 'TS2345',
            source: 'ts',
          },
        ],
      },
    ])
    expect(out[0]!.diagnostics).toHaveLength(2)
    expect(out[0]!.diagnostics[0]!.severity).toBeUndefined()
    expect(out[0]!.diagnostics[0]!.code).toBeUndefined()
    expect(out[0]!.diagnostics[0]!.source).toBeUndefined()
    expect(out[0]!.diagnostics[1]!.severity).toBe('Info')
    expect(out[0]!.diagnostics[1]!.code).toBe('TS2345')
    expect(out[0]!.diagnostics[1]!.source).toBe('ts')
  })

  test('file with only bad diagnostics counts as dropped file and is omitted', () => {
    const out = DiagnosticTrackingService.sanitizeDiagnosticFiles([
      {
        uri: 'file:///empty.ts',
        diagnostics: [null, { message: 1 }],
      },
    ])
    expect(out).toEqual([])
  })

  test('gold drop string fragments exist on service module', () => {
    // Source-level lock so refactors keep densable copy.
    const src = readFileSync(
      join(import.meta.dir, '../../services/diagnosticTracking.ts'),
      'utf8',
    )
    expect(src).toContain(
      'diagnostics files payload from a replayed attachment',
    )
    expect(src).toContain(
      'malformed diagnostic(s) from a replayed diagnostics attachment',
    )
    expect(src).toContain('static sanitizeDiagnosticFiles')
  })

  test('formatDiagnosticsSummary tolerates omitted severity', () => {
    const summary = DiagnosticTrackingService.formatDiagnosticsSummary([
      {
        uri: 'file:///a.ts',
        diagnostics: [
          {
            message: 'x',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
          },
        ],
      },
    ])
    expect(summary).toContain('x')
    expect(summary).toContain('Line 1:1')
  })
})
