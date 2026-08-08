/**
 * densable 2.1.218 Batch B:
 * - xol parseCodeReviewArgs
 * - FBT formatCodeReviewUltraFallbackNote
 * - sdr resolveSlashSubcommand
 */
import { describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../tests/mocks/debug.js'
import { logMock } from '../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

const { parseCodeReviewArgs, formatCodeReviewUltraFallbackNote, codeReview } =
  await import('../codeReview.js')

const { resolveSlashSubcommand } = await import(
  '../../utils/processUserInput/processSlashCommand.js'
)

describe('parseCodeReviewArgs (densable xol)', () => {
  test('default medium when empty', () => {
    expect(parseCodeReviewArgs('')).toMatchObject({
      level: 'medium',
      target: '',
      comment: false,
      fix: false,
      ultraFallback: false,
    })
  })

  test('exact effort level + target', () => {
    expect(parseCodeReviewArgs('high src/foo.ts')).toMatchObject({
      level: 'high',
      explicit: 'high',
      target: 'src/foo.ts',
      ultraFallback: false,
    })
  })

  test('flags anywhere via AJf', () => {
    expect(parseCodeReviewArgs('--fix medium --comment 42')).toMatchObject({
      level: 'medium',
      explicit: 'medium',
      target: '42',
      comment: true,
      fix: true,
    })
  })

  test('ultra first token → ultraFallback max', () => {
    expect(parseCodeReviewArgs('ultra --fix auth')).toMatchObject({
      level: 'max',
      target: 'auth',
      fix: true,
      ultraFallback: true,
    })
  })

  test('effort-like unrecognized token keeps full rest as target', () => {
    // densable DBT: "highest" matches high prefix pattern but is not exact
    const r = parseCodeReviewArgs('highest src/a.ts')
    expect(r.unrecognizedLevel).toBe('highest')
    expect(r.level).toBe('medium')
    expect(r.target).toBe('highest src/a.ts')
  })

  test('xhigh / max accepted', () => {
    expect(parseCodeReviewArgs('xhigh').level).toBe('xhigh')
    expect(parseCodeReviewArgs('max').level).toBe('max')
  })
})

describe('formatCodeReviewUltraFallbackNote (densable FBT)', () => {
  test('disabled + fix → silent local apply note', () => {
    const n = formatCodeReviewUltraFallbackNote({
      ultraEnabled: false,
      fix: true,
      level: 'medium',
    })
    expect(n).toContain('Running a local medium-effort review and applying')
    expect(n).not.toContain('/code-review ultra')
  })

  test('disabled non-interactive account-access copy', () => {
    const n = formatCodeReviewUltraFallbackNote({
      ultraEnabled: false,
      fix: false,
      level: 'high',
      isNonInteractive: true,
    })
    expect(n).toContain("claude.ai account access this session doesn't have")
    expect(n).toContain('local high-effort review')
  })

  test('enabled + command available → type /code-review ultra', () => {
    const n = formatCodeReviewUltraFallbackNote({
      ultraEnabled: true,
      fix: false,
      level: 'max',
      ultraCommandAvailable: true,
    })
    expect(n).toContain('type `/code-review ultra`')
  })

  test('enabled + command unavailable → terminal claude ultrareview', () => {
    const n = formatCodeReviewUltraFallbackNote({
      ultraEnabled: true,
      fix: false,
      level: 'max',
      ultraCommandAvailable: false,
    })
    expect(n).toContain('claude ultrareview')
  })

  test('enabled + fix + available → /code-review ultra --fix', () => {
    const n = formatCodeReviewUltraFallbackNote({
      ultraEnabled: true,
      fix: true,
      level: 'medium',
      ultraCommandAvailable: true,
    })
    expect(n).toContain('/code-review ultra --fix')
  })
})

describe('code-review command (densable WJf)', () => {
  test('fork + background + subcommands.ultra', () => {
    expect(codeReview.context).toBe('fork')
    expect(codeReview.background).toBe(true)
    expect(codeReview.subcommands).toEqual({ ultra: 'ultrareview' })
    expect(codeReview.disableModelInvocation).toBe(true)
  })
})

describe('resolveSlashSubcommand (densable sdr)', () => {
  const cmd = {
    name: 'code-review',
    subcommands: { ultra: 'ultrareview' },
  } as unknown as Parameters<typeof resolveSlashSubcommand>[0]

  test('redirects ultra with remaining args', () => {
    expect(resolveSlashSubcommand(cmd, 'ultra --fix 42')).toEqual({
      targetName: 'ultrareview',
      consumedToken: 'ultra',
      remainingArgs: '--fix 42',
    })
  })

  test('case-insensitive token match', () => {
    expect(resolveSlashSubcommand(cmd, 'ULTRA')).toEqual({
      targetName: 'ultrareview',
      consumedToken: 'ULTRA',
      remainingArgs: '',
    })
  })

  test('no match returns null', () => {
    expect(resolveSlashSubcommand(cmd, 'high src/a')).toBeNull()
    expect(resolveSlashSubcommand({ name: 'x' } as never, 'ultra')).toBeNull()
  })
})
