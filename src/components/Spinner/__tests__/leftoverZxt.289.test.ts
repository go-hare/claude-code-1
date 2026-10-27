import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { remainingRetryMs } from '../../../utils/advisorNetworkStall.js'
import { formatDuration } from '../../../utils/format.js'
import {
  leftoverBhrConnLabel,
  leftoverBhrIdleBudget,
  leftoverZxtRateLimitLabel,
  leftoverZxtResetsAtSuffix,
  leftoverZxtRetryTitle,
  LEFTOVER_ZXT_API_ERROR,
} from '../leftoverZxt.js'

describe('densable 2.1.289 zXt / bhr leftover', () => {
  test('zXt retry title is API error until min(3,max) or rate/network', () => {
    expect(
      leftoverZxtRetryTitle({
        attempt: 1,
        maxRetries: 5,
        formatted: 'Connection error',
        rateLimits: null,
        isNetworkDown: false,
        isSSLError: false,
      }),
    ).toBe(LEFTOVER_ZXT_API_ERROR)
    expect(
      leftoverZxtRetryTitle({
        attempt: 3,
        maxRetries: 5,
        formatted: 'Connection error',
        rateLimits: null,
        isNetworkDown: false,
        isSSLError: false,
      }),
    ).toBe('Connection error')
    expect(
      leftoverZxtRetryTitle({
        attempt: 1,
        maxRetries: 5,
        formatted: 'Connection error',
        rateLimits: { rateLimitType: 'weekly_limit' },
        isNetworkDown: false,
        isSSLError: false,
      }),
    ).toBe('Weekly_limit reached')
    expect(leftoverZxtRateLimitLabel(undefined)).toBe('usage limit')
  })

  test('zXt resetsAt suffix is duration until unix-seconds reset', () => {
    const now = 1_700_000_000_000
    expect(leftoverZxtResetsAtSuffix(undefined, now)).toBe('')
    expect(leftoverZxtResetsAtSuffix(now / 1000 + 90, now)).toBe(
      ` (${formatDuration(90_000, { mostSignificantOnly: true })})`,
    )
  })

  test('bhr Zt drops the right chip when the left budget is too tight', () => {
    expect(leftoverBhrIdleBudget(80, 0, false)).toEqual({
      labelBudget: 75,
      rightText: '',
    })
    expect(leftoverBhrIdleBudget(80, 2, false).rightText).toBe(
      '2 in background',
    )
    const tight = leftoverBhrIdleBudget(20, 9, true)
    expect(tight.rightText).toBe('')
    expect(tight.labelBudget).toBe(15)
  })

  test('bhr reconnecting appends ellipsis unless truncate already did', () => {
    expect(leftoverBhrConnLabel('connected', 20)).toBe('')
    expect(leftoverBhrConnLabel('disconnected', 20)).toBe('Disconnected')
    expect(leftoverBhrConnLabel('reconnecting', 20)).toBe('Reconnecting…')
    expect(leftoverBhrConnLabel('reconnecting', 4).endsWith('…')).toBe(true)
  })

  test('dJ / Msn / bhr hosts leftoverZxt leftoverBhr', () => {
    const dJ = readFileSync(
      join(import.meta.dir, '../../../state/leftoverIhrStore.tsx'),
      'utf8',
    )
    const msn = readFileSync(
      join(import.meta.dir, '../SpinnerAnimationRow.tsx'),
      'utf8',
    )
    const spinner = readFileSync(
      join(import.meta.dir, '../../Spinner.tsx'),
      'utf8',
    )
    const repl = readFileSync(
      join(import.meta.dir, '../../../screens/REPL.tsx'),
      'utf8',
    )
    expect(dJ).toContain('leftoverZxt({ status: retry, columns })')
    expect(dJ).toContain('width="100%"')
    expect(msn).toContain('leftoverZxt({ status: retryStatus, columns })')
    expect(msn).toContain('if (retryStatus)')
    expect(spinner).toContain('leftoverBhrIdleBudget')
    expect(spinner).toContain('leftoverBhrConnLabel')
    const scrollable = repl.lastIndexOf('scrollable={')
    const above = repl.lastIndexOf('abovePrompt={')
    const chunk = repl.slice(scrollable, above)
    expect(chunk).toContain('isBriefOnly')
    expect(chunk).not.toContain('!hasRunningTeammates &&')
    expect(remainingRetryMs(Date.now() + 1500, Date.now())).toBe(2000)
  })
})
