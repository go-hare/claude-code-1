import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveSpinnerTipLabel } from '../../Spinner.js'

const spinnerSrc = readFileSync(
  join(import.meta.dir, '../../Spinner.tsx'),
  'utf8',
)

describe('densable 2.1.247 #2 sr Et label', () => {
  test('Et=V===F&&C?C:"Tip"', () => {
    expect(resolveSpinnerTipLabel('cache more', 'cache more', 'Org')).toBe(
      'Org',
    )
    expect(resolveSpinnerTipLabel('cache more', 'cache more', undefined)).toBe(
      'Tip',
    )
    expect(resolveSpinnerTipLabel('cache more', 'cache more', '')).toBe('Tip')
    expect(
      resolveSpinnerTipLabel(
        'Use /clear to start fresh when switching topics and free up context',
        'cache more',
        'Org',
      ),
    ).toBe('Tip')
  })

  test('spinner line uses Et: V, not a hardcoded Tip: prefix', () => {
    expect(spinnerSrc).toContain(
      'resolveSpinnerTipLabel(effectiveTip, spinnerTip, spinnerTipLabel)',
    )
    expect(spinnerSrc).toContain('spinnerTipLabel')
    expect(spinnerSrc).not.toContain('`Tip: ${effectiveTip}`')
  })

  test('pickNewSpinnerTip passes session.host + storageV5 and uses Ghe', () => {
    const repl = readFileSync(
      join(import.meta.dir, '../../../screens/REPL.tsx'),
      'utf8',
    )
    expect(repl).toContain('const { storageV5 } = useSessionServices()')
    const pick = repl.slice(repl.indexOf('const pickNewSpinnerTip'))
    expect(pick).toContain('session: { host: getReplDiffHost() }')
    expect(pick).toContain('storageV5,')
    expect(pick).not.toContain('getPinnedStorageV5()')
    expect(pick).toContain('evaluateTipContent(tip, tipContext)')
    expect(pick).not.toContain('tip.content({ theme })')
  })
})
