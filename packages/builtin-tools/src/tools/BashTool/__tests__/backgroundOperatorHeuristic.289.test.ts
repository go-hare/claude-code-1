import { describe, expect, test } from 'bun:test'
import { hasBareBackgroundOperatorHeuristic } from '../bashPermissions.js'

describe('hasBareBackgroundOperatorHeuristic (Lon when AST unavailable)', () => {
  test('quoted URL query & is not a background operator', () => {
    const cmd =
      'node cli.js detect "https://www.tiktok.com/@x/video/1?is_from_webapp=1&sender_device=pc"'
    expect(hasBareBackgroundOperatorHeuristic(cmd)).toBe(false)
  })

  test('single-quoted URL query & is not a background operator', () => {
    expect(
      hasBareBackgroundOperatorHeuristic(
        "node cli.js detect 'https://example.com/a?b=1&c=2'",
      ),
    ).toBe(false)
  })

  test('&& digraph is not a background operator', () => {
    expect(
      hasBareBackgroundOperatorHeuristic(
        'node --test test/cli.test.js && echo ok',
      ),
    ).toBe(false)
  })

  test('trailing bare & is a background operator', () => {
    expect(hasBareBackgroundOperatorHeuristic('sleep 10 &')).toBe(true)
  })

  test('unquoted query & still flags (no AST)', () => {
    expect(
      hasBareBackgroundOperatorHeuristic('curl https://example.com/a?b=1&c=2'),
    ).toBe(true)
  })
})
