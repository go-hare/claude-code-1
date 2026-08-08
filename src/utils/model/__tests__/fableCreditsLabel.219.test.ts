/**
 * densable 2.1.219 #9 — hug/BUc/P5i Fable credits stale-cache fix.
 */
import { describe, expect, test } from 'bun:test'
import {
  applyFableCreditsLabel,
  getFableCreditsSuffix,
  isOverageConsentRequiredGate,
  REQUIRES_USAGE_CREDITS_SUFFIX,
} from '../fableCreditsLabel.js'

describe('densable 2.1.219 Y1e isOverageConsentRequiredGate', () => {
  test('false when lattice null/disabled', () => {
    expect(isOverageConsentRequiredGate(null)).toBe(false)
    expect(isOverageConsentRequiredGate({ enabled: false })).toBe(false)
  })

  test('true when overageConsentRequired', () => {
    expect(isOverageConsentRequiredGate({ overageConsentRequired: true })).toBe(
      true,
    )
  })

  test('true when planLimitsEndDate elapsed', () => {
    expect(
      isOverageConsentRequiredGate(
        { planLimitsEndDate: '2020-01-01T00:00:00Z' },
        Date.parse('2021-01-01T00:00:00Z'),
      ),
    ).toBe(true)
  })

  test('false when planLimitsEndDate in future', () => {
    expect(
      isOverageConsentRequiredGate(
        { planLimitsEndDate: '2099-01-01T00:00:00Z' },
        Date.parse('2021-01-01T00:00:00Z'),
      ),
    ).toBe(false)
  })
})

describe('densable 2.1.219 BUc getFableCreditsSuffix', () => {
  test('empty when exempt', () => {
    expect(
      getFableCreditsSuffix({ overageConsentRequired: true }, undefined, {
        exempt: true,
      }),
    ).toBe('')
  })

  test('appends P5i when not exempt and gate on', () => {
    expect(
      getFableCreditsSuffix({ overageConsentRequired: true }, undefined, {
        exempt: false,
      }),
    ).toBe(REQUIRES_USAGE_CREDITS_SUFFIX)
  })

  test('empty when not exempt but gate off', () => {
    expect(
      getFableCreditsSuffix({ enabled: false }, undefined, { exempt: false }),
    ).toBe('')
  })
})

describe('densable 2.1.219 hug applyFableCreditsLabel', () => {
  const fableBase = {
    value: 'fable' as const,
    label: 'Fable',
    description: 'Fable 5 · Most capable',
  }

  test('strips stale P5i and does not re-append when gate off', () => {
    const stale = {
      ...fableBase,
      description: `Fable 5 · Most capable${REQUIRES_USAGE_CREDITS_SUFFIX}`,
    }
    const out = applyFableCreditsLabel(stale, {
      lattice: { enabled: false },
      env: { exempt: false },
    })
    expect(out.description).toBe('Fable 5 · Most capable')
    expect(out.description.endsWith(REQUIRES_USAGE_CREDITS_SUFFIX)).toBe(false)
  })

  test('strips stale then re-appends single BUc when gate requires credits', () => {
    const stale = {
      ...fableBase,
      description: `Fable 5 · Most capable${REQUIRES_USAGE_CREDITS_SUFFIX}`,
    }
    const out = applyFableCreditsLabel(stale, {
      lattice: { overageConsentRequired: true },
      env: { exempt: false },
    })
    expect(out.description).toBe(
      `Fable 5 · Most capable${REQUIRES_USAGE_CREDITS_SUFFIX}`,
    )
    // no double suffix
    const count =
      out.description.split(REQUIRES_USAGE_CREDITS_SUFFIX).length - 1
    expect(count).toBe(1)
  })

  test('appends when description had no suffix but gate on', () => {
    const out = applyFableCreditsLabel(fableBase, {
      lattice: { overageConsentRequired: true },
      env: { exempt: false },
    })
    expect(out.description).toBe(
      `Fable 5 · Most capable${REQUIRES_USAGE_CREDITS_SUFFIX}`,
    )
  })

  test('ignores non-fable options', () => {
    const opus = {
      value: 'opus',
      label: 'Opus',
      description: `Opus 5${REQUIRES_USAGE_CREDITS_SUFFIX}`,
    }
    expect(
      applyFableCreditsLabel(opus, {
        lattice: { overageConsentRequired: true },
        env: { exempt: false },
      }).description,
    ).toBe(opus.description)
  })

  test('ignores disabled fable rows', () => {
    const disabled = {
      ...fableBase,
      disabled: true,
      description: `Fable${REQUIRES_USAGE_CREDITS_SUFFIX}`,
    }
    expect(
      applyFableCreditsLabel(disabled, {
        lattice: { overageConsentRequired: true },
        env: { exempt: false },
      }).description,
    ).toBe(disabled.description)
  })

  test('handles fable[1m] alias', () => {
    const opt = {
      value: 'fable[1m]',
      label: 'Fable',
      description: `Fable 5 1M${REQUIRES_USAGE_CREDITS_SUFFIX}`,
    }
    const out = applyFableCreditsLabel(opt, {
      lattice: { enabled: false },
      env: { exempt: false },
    })
    expect(out.description).toBe('Fable 5 1M')
  })

  test('exempt env strips without re-append even if gate on', () => {
    const stale = {
      ...fableBase,
      description: `Fable 5${REQUIRES_USAGE_CREDITS_SUFFIX}`,
    }
    const out = applyFableCreditsLabel(stale, {
      lattice: { overageConsentRequired: true },
      env: { exempt: true },
    })
    expect(out.description).toBe('Fable 5')
  })
})
