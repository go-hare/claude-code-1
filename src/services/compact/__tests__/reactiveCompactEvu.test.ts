import { describe, expect, test } from 'bun:test'
import { AUTO_COMPACT_CIRCUIT_BREAKER_THRESHOLD } from '../../../utils/autoCompactCircuitBreaker.js'
import { recordReactiveAutoCompactFailure } from '../reactiveCompact.js'

describe('reactiveCompact densable Evu reactive path', () => {
  test('records failure with routedThroughReactive true', () => {
    const r = recordReactiveAutoCompactFailure({ previous: null })
    expect(r.consecutiveFailures).toBe(1)
    expect(r.routedThroughReactive).toBe(true)
    expect(r.tripped).toBe(false)
  })

  test('trips at densable vvu=3', () => {
    let prev: { consecutiveFailures?: number } | null = null
    let last = recordReactiveAutoCompactFailure({ previous: prev })
    prev = last
    last = recordReactiveAutoCompactFailure({ previous: prev })
    prev = last
    last = recordReactiveAutoCompactFailure({
      previous: prev,
      thresholdSource: 'experiment',
    })
    expect(last.consecutiveFailures).toBe(
      AUTO_COMPACT_CIRCUIT_BREAKER_THRESHOLD,
    )
    expect(last.tripped).toBe(true)
    expect(last.thresholdSource).toBe('experiment')
  })
})
