/**
 * densable 2.1.223 #15 — git push output parse must not hang on unusual lines.
 * SEA: `/^\s*[+\-*!= ]?\s*(?:\[new branch\]|[0-9a-f]+\.\.+[0-9a-f]+)\s+\S+\s*->\s*(\S+)/m`
 */
import { describe, expect, test } from 'bun:test'
import {
  detectGitOperation,
  parseGitPushBranch,
} from '../gitOperationTracking.js'

describe('densable 2.1.223 #15 parseGitPushBranch', () => {
  test('parses normal range update', () => {
    expect(parseGitPushBranch('   abc1234..def5678  main -> main')).toBe('main')
  })

  test('parses new branch', () => {
    expect(
      parseGitPushBranch(' * [new branch]      feature/x -> feature/x'),
    ).toBe('feature/x')
  })

  test('parses forced update (three dots + status +)', () => {
    expect(
      parseGitPushBranch(' + abc1234...def5678  main -> main (forced update)'),
    ).toBe('main')
  })

  test('detectGitOperation still surfaces push branch', () => {
    const r = detectGitOperation(
      'git push origin main',
      '   abc1234..def5678  main -> main',
    )
    expect(r.push?.branch).toBe('main')
  })

  test('pathological non-hex S+..S+ does not hang and returns undefined', () => {
    // Former `\S+\.\.+\S+` could catastrophic-backtrack on long dotted runs.
    const evil =
      ' ' + 'x'.repeat(40_000) + '..' + 'y'.repeat(40_000) + '  a -> b'
    const t0 = performance.now()
    const branch = parseGitPushBranch(evil)
    const ms = performance.now() - t0
    expect(branch).toBeUndefined()
    expect(ms).toBeLessThan(50)
  })

  test('ignores progress lines without ref update', () => {
    expect(
      parseGitPushBranch(
        'Enumerating objects: 3, done.\nWriting objects: 100% (3/3), done.\n',
      ),
    ).toBeUndefined()
  })
})
