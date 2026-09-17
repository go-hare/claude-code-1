/**
 * densable 2.1.246 #36 — Write overwrite large file: omit old from result.
 * SEA `TB=10485760`: full-read still; when oldContent.length > TB →
 * structuredPatch=[] / originalFile=null (write already succeeded).
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { analyticsMock } from '../../../../../../tests/mocks/analytics.js'
import { debugMock } from '../../../../../../tests/mocks/debug.js'
import { logMock } from '../../../../../../tests/mocks/log.js'
import { snapshotModuleExports } from '../../../../../../tests/mocks/settings.js'
import * as realGrowthbook from 'src/services/analytics/growthbook.js'
import * as realDiag from 'src/services/diagnosticTracking.js'
import * as realLspDiag from 'src/services/lsp/LSPDiagnosticRegistry.js'
import * as realLsp from 'src/services/lsp/manager.js'
import * as realVscode from 'src/services/mcp/vscodeSdkMcp.js'

const growthbookSnap = snapshotModuleExports(realGrowthbook)
const vscodeSnap = snapshotModuleExports(realVscode)
const lspSnap = snapshotModuleExports(realLsp)
const lspDiagSnap = snapshotModuleExports(realLspDiag)
const diagSnap = snapshotModuleExports(realDiag)

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/log.js', logMock)
mock.module('src/services/analytics/index.js', analyticsMock)
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: () => false,
}))
mock.module('src/services/mcp/vscodeSdkMcp.js', () => ({
  ...vscodeSnap,
  notifyVscodeFileUpdated: () => {},
}))
mock.module('src/services/lsp/manager.js', () => ({
  ...lspSnap,
  getLspServerManager: () => null,
}))
mock.module('src/services/lsp/LSPDiagnosticRegistry.js', () => ({
  ...lspDiagSnap,
  clearDeliveredDiagnosticsForFile: () => {},
}))
mock.module('src/services/diagnosticTracking.js', () => ({
  ...diagSnap,
  diagnosticTracker: { beforeFileEdited: async () => {} },
}))

afterAll(() => {
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
  mock.module('src/services/mcp/vscodeSdkMcp.js', () => ({ ...vscodeSnap }))
  mock.module('src/services/lsp/manager.js', () => ({ ...lspSnap }))
  mock.module('src/services/lsp/LSPDiagnosticRegistry.js', () => ({
    ...lspDiagSnap,
  }))
  mock.module('src/services/diagnosticTracking.js', () => ({ ...diagSnap }))
})

import { FileWriteTool } from '../FileWriteTool.js'

const WRITE_OMIT = 10_485_760

describe('densable 2.1.246 Write omit-large oldContent', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  function ctx(path: string, prior: string) {
    const readFileState = new Map([
      [
        path,
        {
          content: prior,
          timestamp: Date.now() - 1000,
          offset: undefined,
          limit: undefined,
        },
      ],
    ])
    return {
      readFileState,
      getAppState: () => ({
        toolPermissionContext: {
          mode: 'acceptEdits' as const,
          additionalWorkingDirectories: new Map(),
          alwaysAllowRules: {},
          alwaysDenyRules: {},
          alwaysAskRules: {},
          isBypassPermissionsModeAvailable: false,
        },
      }),
      messages: [],
      abortController: new AbortController(),
      options: {},
      setAppState: () => {},
      nestedMemoryAttachmentTriggers: new Set(),
    } as any
  }

  test('update with oldContent.length > TB omits patch and originalFile', async () => {
    dir = mkdtempSync(join(tmpdir(), 'write-omit-246-'))
    const filePath = join(dir, 'huge.txt')
    // length strictly above SEA TB
    const oldContent = 'a'.repeat(WRITE_OMIT + 1)
    writeFileSync(filePath, oldContent, 'utf8')

    const result = await FileWriteTool.call(
      { file_path: filePath, content: 'new\n' },
      ctx(filePath, oldContent),
      {} as any,
      { uuid: 't', type: 'assistant', message: { model: 'test' } } as any,
    )

    expect(result.data.type).toBe('update')
    expect(result.data.structuredPatch).toEqual([])
    expect(result.data.originalFile).toBeNull()
    expect(result.data.content).toBe('new\n')
  })

  test('update with oldContent.length <= TB keeps originalFile', async () => {
    dir = mkdtempSync(join(tmpdir(), 'write-omit-246-'))
    const filePath = join(dir, 'small.txt')
    const oldContent = 'hello\n'
    writeFileSync(filePath, oldContent, 'utf8')

    const result = await FileWriteTool.call(
      { file_path: filePath, content: 'world\n' },
      ctx(filePath, oldContent),
      {} as any,
      { uuid: 't', type: 'assistant', message: { model: 'test' } } as any,
    )

    expect(result.data.type).toBe('update')
    expect(result.data.originalFile).toBe(oldContent)
    expect(result.data.structuredPatch.length).toBeGreaterThan(0)
  })

  test('stripForStorage keeps already-omitted large update', () => {
    const kept = FileWriteTool.stripForStorage!({
      type: 'update',
      filePath: '/a.ts',
      content: 'new',
      structuredPatch: [],
      originalFile: null,
    })
    expect(kept.content).toBe('new')
    expect(kept.originalFile).toBeNull()
  })

  test('source locks SEA TB and omit shape', () => {
    const src = require('fs').readFileSync(
      join(import.meta.dir, '../FileWriteTool.ts'),
      'utf8',
    )
    expect(src).toContain('10_485_760')
    expect(src).toContain('WRITE_OMIT_OLD_CONTENT_CHARS')
    expect(src).toContain('omitLargeOld')
    expect(src).toContain('too large to include')
    expect(src).toContain('too large to diff')
  })
})
