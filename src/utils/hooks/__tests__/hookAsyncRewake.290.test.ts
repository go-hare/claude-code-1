import { afterEach, describe, expect, test } from 'bun:test'
import {
  extractCommandScriptCandidates,
  extractCommandScriptPaths,
  resetBrokenAsyncRewakeForTests,
} from '../hookAsyncRewake.js'

describe('v2.1.290 hookAsyncRewake cutFrom alignment (#114)', () => {
  afterEach(() => {
    resetBrokenAsyncRewakeForTests()
  })

  test('extractCommandScriptCandidates emits cutFrom when unquoted path has space', () => {
    const candidates = extractCommandScriptCandidates(
      'bash /tmp/my\\ dir/hook.sh',
    )
    expect(candidates).toEqual([
      { path: '/tmp/my dir/hook.sh', cutFrom: undefined },
      { path: '/tmp/my', cutFrom: '/tmp/my dir/hook.sh' },
    ])
  })

  test('quoted path with space does not emit cutFrom', () => {
    const candidates = extractCommandScriptCandidates(
      'bash "/tmp/my dir/hook.sh"',
    )
    expect(candidates).toEqual([
      { path: '/tmp/my dir/hook.sh', cutFrom: undefined },
    ])
    expect(extractCommandScriptPaths('bash "/tmp/my dir/hook.sh"')).toEqual([
      '/tmp/my dir/hook.sh',
    ])
  })
})
