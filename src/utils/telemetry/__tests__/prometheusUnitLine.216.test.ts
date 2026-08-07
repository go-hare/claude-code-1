/**
 * densable 2.1.216 #26 — Prometheus `# UNIT` only when descriptor.unit is truthy.
 */
import { describe, expect, test } from 'bun:test'
import {
  escapePrometheusCommentText,
  formatPrometheusUnitLine,
} from '../prometheusUnitLine.js'

describe('formatPrometheusUnitLine (densable PrometheusSerializer unit gate)', () => {
  test('empty string unit → no UNIT line', () => {
    expect(formatPrometheusUnitLine('demo_metric', '')).toBe('')
  })

  test('null / undefined unit → no UNIT line', () => {
    expect(formatPrometheusUnitLine('demo_metric', null)).toBe('')
    expect(formatPrometheusUnitLine('demo_metric', undefined)).toBe('')
  })

  test('truthy unit emits densable-shaped line with leading newline', () => {
    expect(formatPrometheusUnitLine('demo_metric', 'ms')).toBe(
      '\n# UNIT demo_metric ms',
    )
    expect(formatPrometheusUnitLine('demo_metric', '1')).toBe(
      '\n# UNIT demo_metric 1',
    )
  })

  test('escapes backslash and newline in unit text (Dko)', () => {
    expect(escapePrometheusCommentText('a\\b\nc')).toBe('a\\\\b\\nc')
    expect(formatPrometheusUnitLine('m', 'a\\b')).toBe('\n# UNIT m a\\\\b')
  })

  test('assembled HELP+UNIT+TYPE never has bare empty UNIT', () => {
    const name = 'tokens_total'
    const help = `# HELP ${name} description missing`
    const unit = formatPrometheusUnitLine(name, '')
    const type = `# TYPE ${name} counter`
    const block = `${help}${unit}\n${type}`
    expect(block).not.toContain('# UNIT')
    expect(block).toBe(
      `# HELP tokens_total description missing\n# TYPE tokens_total counter`,
    )
  })
})
