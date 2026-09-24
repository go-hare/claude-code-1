import { describe, expect, test } from 'bun:test'
import hljs from 'highlight.js'
import {
  DENSABLE_REMOVED_HLJS_LANGUAGES,
  getCliHighlightPromise,
  stripDensableRemovedHljsLanguages,
} from '../cliHighlight.js'

describe('densable 2.1.251 #69 hljs six-lang strip', () => {
  test('SEA Ec/Pwe six ids are the locked removal set', () => {
    expect([...DENSABLE_REMOVED_HLJS_LANGUAGES]).toEqual([
      '1c',
      'gml',
      'isbl',
      'mathematica',
      'maxima',
      'sqf',
    ])
  })

  test('module import strips the six from the shared hljs instance', () => {
    for (const id of DENSABLE_REMOVED_HLJS_LANGUAGES) {
      expect(hljs.getLanguage(id)).toBeUndefined()
    }
    // still has common languages SEA keeps
    expect(hljs.getLanguage('javascript')).toBeTruthy()
    expect(hljs.getLanguage('python')).toBeTruthy()
    expect(hljs.getLanguage('bash')).toBeTruthy()
  })

  test('stripDensableRemovedHljsLanguages is idempotent', () => {
    stripDensableRemovedHljsLanguages(hljs as never)
    for (const id of DENSABLE_REMOVED_HLJS_LANGUAGES) {
      expect(hljs.getLanguage(id)).toBeUndefined()
    }
  })

  test('cli-highlight supportsLanguage denies the six', async () => {
    const api = await getCliHighlightPromise()
    expect(api).not.toBeNull()
    for (const id of DENSABLE_REMOVED_HLJS_LANGUAGES) {
      expect(api!.supportsLanguage(id)).toBe(false)
    }
    expect(api!.supportsLanguage('javascript')).toBe(true)
  })
})
