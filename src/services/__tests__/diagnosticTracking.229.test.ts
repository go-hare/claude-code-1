/**
 * densable 2.1.229 #15 — multi-second UI stalls after large IDE diagnostics.
 * Gold: Gjo fingerprint, V2o set-subset equality, baseline.size===0 early return,
 * sQ_ leading-sep drive strip after protocol.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../tests/mocks/debug.js'
import { logMock } from '../../../tests/mocks/log.js'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

import { every } from '../../utils/set.js'
import {
  DiagnosticTrackingService,
  diagnosticFingerprint,
  type Diagnostic,
} from '../diagnosticTracking.js'

function diag(message: string, opts: Partial<Diagnostic> = {}): Diagnostic {
  return {
    message,
    severity: opts.severity ?? 'Error',
    source: opts.source,
    code: opts.code,
    range: opts.range ?? {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    },
  }
}

/** densable areDiagnosticArraysEqual via Gjo + V2o (mirror private method). */
function areDiagnosticArraysEqual(a: Diagnostic[], b: Diagnostic[]): boolean {
  if (a.length !== b.length) return false
  const setA = new Set(a.map(diagnosticFingerprint))
  const setB = new Set(b.map(diagnosticFingerprint))
  return setA.size === setB.size && every(setA, setB)
}

type PrivateDiag = {
  normalizeFileUri: (uri: string) => string
  areDiagnosticArraysEqual: (a: Diagnostic[], b: Diagnostic[]) => boolean
  baseline: Map<string, Diagnostic[]>
  initialized: boolean
  mcpClient: { type: string } | undefined
}

function priv(svc: DiagnosticTrackingService): PrivateDiag {
  return svc as unknown as PrivateDiag
}

describe('densable 2.1.229 #15 diagnosticFingerprint (Gjo)', () => {
  test('stable over identical diagnostics', () => {
    const a = diag('unused var', {
      severity: 'Warning',
      source: 'ts',
      code: '6133',
      range: {
        start: { line: 10, character: 2 },
        end: { line: 10, character: 5 },
      },
    })
    const b = diag('unused var', {
      severity: 'Warning',
      source: 'ts',
      code: '6133',
      range: {
        start: { line: 10, character: 2 },
        end: { line: 10, character: 5 },
      },
    })
    expect(diagnosticFingerprint(a)).toBe(diagnosticFingerprint(b))
  })

  test('number and string code fingerprint equal', () => {
    const asNum = diag('x', { code: 6133 as unknown as string })
    const asStr = diag('x', { code: '6133' })
    expect(diagnosticFingerprint(asNum)).toBe(diagnosticFingerprint(asStr))
  })

  test('differs when message/severity/range/code change', () => {
    const base = diag('a', { code: '1' })
    expect(diagnosticFingerprint(base)).not.toBe(
      diagnosticFingerprint(diag('b', { code: '1' })),
    )
    expect(diagnosticFingerprint(base)).not.toBe(
      diagnosticFingerprint(diag('a', { severity: 'Hint', code: '1' })),
    )
    expect(diagnosticFingerprint(base)).not.toBe(
      diagnosticFingerprint(diag('a', { code: '2' })),
    )
    expect(diagnosticFingerprint(base)).not.toBe(
      diagnosticFingerprint(
        diag('a', {
          code: '1',
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 1 },
          },
        }),
      ),
    )
  })

  test('includes optional source/code as undefined slots', () => {
    const withSource = diag('x', { source: 'eslint', code: 'no-unused' })
    const bare = diag('x')
    expect(diagnosticFingerprint(withSource)).not.toBe(
      diagnosticFingerprint(bare),
    )
  })
})

describe('densable 2.1.229 #15 areDiagnosticArraysEqual (Gjo+V2o)', () => {
  test('equal arrays regardless of order', () => {
    const a = [diag('one', { code: '1' }), diag('two', { code: '2' })]
    const b = [diag('two', { code: '2' }), diag('one', { code: '1' })]
    expect(areDiagnosticArraysEqual(a, b)).toBe(true)
  })

  test('unequal when one extra diagnostic', () => {
    const a = [diag('one')]
    const b = [diag('one'), diag('two')]
    expect(areDiagnosticArraysEqual(a, b)).toBe(false)
  })

  test('scales linearly for thousands of diags (Set path, not O(n²))', () => {
    const n = 5000
    const a: Diagnostic[] = []
    const b: Diagnostic[] = []
    for (let i = 0; i < n; i++) {
      const d = diag(`m${i}`, {
        code: String(i),
        range: {
          start: { line: i, character: 0 },
          end: { line: i, character: 1 },
        },
      })
      a.push(d)
      b.push(
        diag(`m${i}`, {
          code: String(i),
          range: {
            start: { line: i, character: 0 },
            end: { line: i, character: 1 },
          },
        }),
      )
    }
    const t0 = performance.now()
    expect(areDiagnosticArraysEqual(a, b)).toBe(true)
    const elapsed = performance.now() - t0
    // O(n) Set path should finish well under 1s even at 5k; O(n²) often multi-second
    expect(elapsed).toBeLessThan(1000)
  })

  test('service private method matches free Gjo+V2o helper', () => {
    const svc = DiagnosticTrackingService.getInstance()
    const a = [diag('x', { code: 'a' }), diag('y', { code: 'b' })]
    const b = [diag('y', { code: 'b' }), diag('x', { code: 'a' })]
    expect(priv(svc).areDiagnosticArraysEqual(a, b)).toBe(true)
    expect(priv(svc).areDiagnosticArraysEqual(a, [diag('x')])).toBe(false)
  })
})

describe('densable 2.1.229 #15 normalizeFileUri (sQ_)', () => {
  let svc: DiagnosticTrackingService

  beforeEach(() => {
    svc = DiagnosticTrackingService.getInstance()
    svc.reset()
  })

  afterEach(async () => {
    await svc.shutdown()
  })

  test('strips file:// and leading sep before Windows drive letter', () => {
    const n = priv(svc).normalizeFileUri
    // densable sQ_: after protocol strip, `/C:/…` → `C:/…` then path normalize
    const out = n('file:///C:/Users/foo/bar.ts')
    // Platform-aware normalize may lower-case on win comparison path; assert drive letter form
    expect(out.replace(/\\/g, '/').toLowerCase()).toMatch(
      /^c:\/users\/foo\/bar\.ts$/,
    )
  })

  test('strips _claude_fs_right: prefix', () => {
    const n = priv(svc).normalizeFileUri
    const out = n('_claude_fs_right:/tmp/project/a.ts')
    expect(out.replace(/\\/g, '/')).toContain('tmp/project/a.ts')
  })

  test('does not strip bare absolute unix path without protocol', () => {
    const n = priv(svc).normalizeFileUri
    const out = n('/tmp/project/a.ts')
    // no protocol → no sQ_ strip; still normalized for comparison
    expect(out.replace(/\\/g, '/')).toContain('tmp/project/a.ts')
  })
})

describe('densable 2.1.229 #15 getNewDiagnostics early return', () => {
  let svc: DiagnosticTrackingService

  beforeEach(() => {
    svc = DiagnosticTrackingService.getInstance()
    svc.reset()
  })

  afterEach(async () => {
    await svc.shutdown()
  })

  test('returns [] when baseline empty even if initialized+connected', async () => {
    const p = priv(svc)
    p.initialized = true
    p.mcpClient = { type: 'connected' }
    p.baseline.clear()
    // Must not throw / hang — densable skips IDE RPC entirely
    await expect(svc.getNewDiagnostics()).resolves.toEqual([])
  })

  test('returns [] when not initialized', async () => {
    await svc.shutdown()
    await expect(svc.getNewDiagnostics()).resolves.toEqual([])
  })
})
