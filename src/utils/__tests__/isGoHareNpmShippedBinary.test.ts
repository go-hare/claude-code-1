import { describe, expect, test } from 'bun:test'

import { isGoHareNpmShippedBinary } from '../doctorDiagnostic.js'

describe('isGoHareNpmShippedBinary', () => {
  test('detects scoped main package under node_modules', () => {
    expect(
      isGoHareNpmShippedBinary(
        '/Users/x/.npm-global/lib/node_modules/@go-hare/claude-code/bin/claude',
        '/Users/x/.npm-global/lib/node_modules/@go-hare/claude-code/bin/claude',
      ),
    ).toBe(true)
  })

  test('detects platform optionalDep package', () => {
    expect(
      isGoHareNpmShippedBinary(
        '/Users/x/.npm-global/lib/node_modules/@go-hare/claude-code-darwin-arm64/claude',
        '/Users/x/.npm-global/lib/node_modules/@go-hare/claude-code-darwin-arm64/claude',
      ),
    ).toBe(true)
  })

  test('does not treat Anthropic native path as go-hare npm', () => {
    expect(
      isGoHareNpmShippedBinary(
        '/Users/x/.local/bin/claude',
        '/Users/x/.local/share/claude/versions/2.1.211',
      ),
    ).toBe(false)
  })

  test('does not treat plain bun binary as go-hare', () => {
    expect(
      isGoHareNpmShippedBinary(
        '/Users/x/.bun/bin/bun',
        '/Users/x/.bun/bin/bun',
      ),
    ).toBe(false)
  })
})
