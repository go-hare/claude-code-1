/**
 * Official 2.1.207: tengu_harbor_willow silent auto fallback densable.
 */
import { describe, expect, test } from 'bun:test'
import { planHarborWillowAutoFallback } from '../autoModeHarborWillow.js'

const base = {
  hasResolvedMode: false,
  circuitBroken: false,
  disableAutoMode: false,
  harborWillow: true,
  isNonInteractiveSession: false,
  mossAnchor: false,
} as const

describe('planHarborWillowAutoFallback', () => {
  test('interactive + harbor_willow → auto + fromAutoFallback', () => {
    expect(planHarborWillowAutoFallback({ ...base })).toEqual({
      mode: 'auto',
      fromAutoFallback: true,
    })
  })

  test('harbor_willow off → default', () => {
    expect(
      planHarborWillowAutoFallback({ ...base, harborWillow: false }),
    ).toEqual({ mode: 'default', fromAutoFallback: false })
  })

  test('circuit broken blocks fallback', () => {
    expect(
      planHarborWillowAutoFallback({ ...base, circuitBroken: true }),
    ).toEqual({ mode: 'default', fromAutoFallback: false })
  })

  test('disableAutoMode settings block fallback', () => {
    expect(
      planHarborWillowAutoFallback({ ...base, disableAutoMode: true }),
    ).toEqual({ mode: 'default', fromAutoFallback: false })
  })

  test('non-interactive requires moss_anchor', () => {
    expect(
      planHarborWillowAutoFallback({
        ...base,
        isNonInteractiveSession: true,
        mossAnchor: false,
      }),
    ).toEqual({ mode: 'default', fromAutoFallback: false })

    expect(
      planHarborWillowAutoFallback({
        ...base,
        isNonInteractiveSession: true,
        mossAnchor: true,
      }),
    ).toEqual({ mode: 'auto', fromAutoFallback: true })
  })

  test('already-resolved mode does not plan fallback', () => {
    expect(
      planHarborWillowAutoFallback({ ...base, hasResolvedMode: true }),
    ).toEqual({ mode: 'default', fromAutoFallback: false })
  })
})

describe('kgn Uht wiring (251 #12)', () => {
  test('no-mode fallback uses isAutoDefaultLaunchEnabled (harbor || meadow_lantern)', () => {
    const { readFileSync } = require('fs') as typeof import('fs')
    const { join } = require('path') as typeof import('path')
    const src = readFileSync(
      join(import.meta.dir, '../permissionSetup.ts'),
      'utf8',
    )
    expect(src).toContain(
      "import { isAutoDefaultLaunchEnabled } from '../../services/mcp/vscodeIdeBridgeCallbacks.js'",
    )
    const start = src.indexOf('export function initialPermissionModeFromCLI')
    const end = src.indexOf('export function parseToolListFromCLI')
    const body = src.slice(start, end)
    expect(body).toContain('harborWillow: isAutoDefaultLaunchEnabled()')
  })
})
