/**
 * densable 2.1.239 dtn / CRw / kRw / BWi / n2r(SU) 1:1 locks.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  hasOpenAssistantWithoutStop,
  isLeftArrowBetweenCalls,
  isLeftArrowStreamOpen,
  pickLeftArrowVia,
  resolveLeftArrowViaCRw,
  rewriteLeftArrowViaForAbortController,
} from '../leftArrowVia.js'
import {
  blocksQuotaAutoArmForFamilyWindow,
  resolveQuotaAutoArmAliasFamily,
} from '../../services/quotaAutoResume.js'

const root = join(import.meta.dir, '../../..')

describe('leftArrowVia densable dtn/CRw/kRw (239)', () => {
  test('kRw: idle / abort / defer from isLoading×betweenCalls', () => {
    expect(pickLeftArrowVia(false, false)).toBe('idle-fork')
    expect(pickLeftArrowVia(false, true)).toBe('idle-fork')
    expect(pickLeftArrowVia(true, false)).toBe('abort-then-fork')
    expect(pickLeftArrowVia(true, true)).toBe('defer-then-fork')
  })

  test('BWi/xRw: betweenCalls when no stream and no open assistant', () => {
    const closed = [{ type: 'assistant', message: { stop_reason: 'end_turn' } }]
    const open = [{ type: 'assistant', message: { stop_reason: null } }]
    expect(hasOpenAssistantWithoutStop(open)).toBe(true)
    expect(hasOpenAssistantWithoutStop(closed)).toBe(false)
    expect(isLeftArrowBetweenCalls(closed, false)).toBe(true)
    expect(isLeftArrowBetweenCalls(closed, true)).toBe(false)
    expect(isLeftArrowBetweenCalls(open, false)).toBe(false)
  })

  test('peek !== null: empty raw is in-stream (not between-calls)', () => {
    expect(isLeftArrowStreamOpen('')).toBe(true)
    expect(isLeftArrowStreamOpen('hi')).toBe(true)
    expect(isLeftArrowStreamOpen(null)).toBe(false)
    expect(isLeftArrowStreamOpen(undefined)).toBe(false)
    const closed = [{ type: 'assistant', message: { stop_reason: 'end_turn' } }]
    expect(isLeftArrowBetweenCalls(closed, isLeftArrowStreamOpen(''))).toBe(
      false,
    )
    expect(isLeftArrowBetweenCalls(closed, isLeftArrowStreamOpen(null))).toBe(
      true,
    )
  })

  test('CRw gates: fleet/remote/persistence/externalLoading', () => {
    const inFlight = { count: 0, kinds: [] as string[] }
    expect(
      resolveLeftArrowViaCRw({
        isBg: false,
        isLoading: false,
        isExternalLoading: false,
        betweenCalls: true,
        inFlight,
        fleetEnabled: false,
      }).ok,
    ).toBe(false)
    expect(
      resolveLeftArrowViaCRw({
        isBg: false,
        isLoading: false,
        isExternalLoading: false,
        betweenCalls: true,
        inFlight,
        fleetEnabled: true,
        isRemote: true,
      }),
    ).toMatchObject({ ok: false, reason: 'remote' })
    expect(
      resolveLeftArrowViaCRw({
        isBg: false,
        isLoading: false,
        isExternalLoading: false,
        betweenCalls: true,
        inFlight,
        fleetEnabled: true,
        persistenceDisabled: true,
      }),
    ).toMatchObject({ ok: false, reason: 'persistence' })
    expect(
      resolveLeftArrowViaCRw({
        isBg: false,
        isLoading: true,
        isExternalLoading: true,
        betweenCalls: false,
        inFlight,
        fleetEnabled: true,
      }),
    ).toMatchObject({ ok: false, reason: 'loading' })
    expect(
      resolveLeftArrowViaCRw({
        isBg: true,
        isLoading: true,
        isExternalLoading: false,
        betweenCalls: false,
        inFlight,
        fleetEnabled: false,
      }),
    ).toMatchObject({ ok: true, via: 'detach' })
  })

  test('YA rewrite: abort-then-fork without AC → defer-then-fork', () => {
    expect(rewriteLeftArrowViaForAbortController('abort-then-fork', null)).toBe(
      'defer-then-fork',
    )
    expect(
      rewriteLeftArrowViaForAbortController('abort-then-fork', undefined),
    ).toBe('defer-then-fork')
    const ac = new AbortController()
    expect(rewriteLeftArrowViaForAbortController('abort-then-fork', ac)).toBe(
      'abort-then-fork',
    )
    // densable !Ig is nullish only — aborted-but-retained AC stays abort-then-fork
    ac.abort()
    expect(rewriteLeftArrowViaForAbortController('abort-then-fork', ac)).toBe(
      'abort-then-fork',
    )
    expect(rewriteLeftArrowViaForAbortController('idle-fork', null)).toBe(
      'idle-fork',
    )
  })

  test('REPL wires dtn + Ki.proceed via defer-then-fork', () => {
    const repl = readFileSync(join(root, 'src/screens/REPL.tsx'), 'utf8')
    expect(repl).toContain('resolveLeftArrowVia')
    expect(repl).toContain('rewriteLeftArrowViaForAbortController')
    expect(repl).toContain("forceVia: 'defer-then-fork'")
    expect(repl).toContain('LEFT_ARROW_VIA_BLOCKED_TOAST')
    expect(repl).toContain('isLeftArrowStreamOpen')
    expect(repl).not.toContain('streamPeek && streamPeek.length > 0')
    expect(repl).toContain('leftArrowToAgentsFired')
    expect(repl).toContain('const $e = await arm.proceed()')
    expect(repl).toContain('markIdleForkMidTurn')
    // iHt four gates (OA / endedByModel / WWi / Kb) before Ki
    const ihtIdx = repl.indexOf('densable iHt four gates before Ki')
    const kiIdx = repl.indexOf('if Ki.current → second-press while defer-armed')
    expect(ihtIdx).toBeGreaterThan(-1)
    expect(kiIdx).toBeGreaterThan(ihtIdx)
    expect(repl).toContain('evaluateLeftArrowIhtGates')
  })
})

describe('X5w n2r(SU) escape (239)', () => {
  test('n2r alias family', () => {
    expect(resolveQuotaAutoArmAliasFamily('opusplan')).toBe('opus')
    expect(resolveQuotaAutoArmAliasFamily('opusplan[1m]')).toBe('opus')
    expect(resolveQuotaAutoArmAliasFamily('haiku')).toBe('sonnet')
    expect(resolveQuotaAutoArmAliasFamily('claude-sonnet-4')).toBe(null)
  })

  test('X5w: same-family model or matching alias unblocks', () => {
    expect(
      blocksQuotaAutoArmForFamilyWindow('seven_day_opus', 'claude-opus-4-6'),
    ).toBe(false)
    expect(
      blocksQuotaAutoArmForFamilyWindow('seven_day_opus', 'claude-sonnet-4'),
    ).toBe(true)
  })

  test('X5w: n2r(SU) opusplan/haiku escapes cross-family model block', async () => {
    const { setMainLoopModelOverride, setInitialMainLoopModel } = await import(
      '../../bootstrap/state.js'
    )
    // Default/null JA must fall through to mae/env (gold ??), not truncate
    setMainLoopModelOverride(null)
    setInitialMainLoopModel(null as never)
    setMainLoopModelOverride('opusplan')
    try {
      expect(
        blocksQuotaAutoArmForFamilyWindow('seven_day_opus', 'claude-sonnet-4'),
      ).toBe(false)
    } finally {
      setMainLoopModelOverride(undefined)
    }
    setMainLoopModelOverride('haiku')
    try {
      expect(
        blocksQuotaAutoArmForFamilyWindow(
          'seven_day_sonnet',
          'claude-opus-4-6',
        ),
      ).toBe(false)
    } finally {
      setMainLoopModelOverride(undefined)
    }
  })

  test('SU nullish: null JA falls through to opusplan override via ??', async () => {
    const { setMainLoopModelOverride, setInitialMainLoopModel } = await import(
      '../../bootstrap/state.js'
    )
    const { getQuotaAutoArmAliasSetting } = await import(
      '../../services/quotaAutoResume.js'
    )
    setInitialMainLoopModel(null as never)
    setMainLoopModelOverride(null)
    // With both null, SU may be env/settings or undefined — must not throw
    expect(() => getQuotaAutoArmAliasSetting()).not.toThrow()
    setMainLoopModelOverride('opusplan')
    expect(getQuotaAutoArmAliasSetting()).toBe('opusplan')
    setMainLoopModelOverride(undefined)
  })
})

test('bZo: Gu pass-through for n2r short names', async () => {
  const { applyQuotaAutoArmAliasAllowlist } = await import(
    '../../services/quotaAutoResume.js'
  )
  expect(applyQuotaAutoArmAliasAllowlist('opusplan')).toBe('opusplan')
  expect(applyQuotaAutoArmAliasAllowlist('haiku')).toBe('haiku')
  expect(applyQuotaAutoArmAliasAllowlist(null)).toBe(null)
  expect(applyQuotaAutoArmAliasAllowlist(undefined)).toBe(undefined)
})
