import { describe, expect, test } from 'bun:test'
import {
  bindHighlightBudget,
  HIGHLIGHT_LANG_MAX_LENGTH,
  HIGHLIGHT_LINE_WORK_LIMIT,
  HIGHLIGHT_MAX_LENGTH,
  HighlightLimitError,
  type HljsBoundApi,
} from '../highlightBound.js'

function makeMockHljs(langs: Record<string, object> = {}): {
  api: HljsBoundApi
  runBefore: (code: string, language?: string) => void
} {
  let plugin:
    | {
        'before:highlight': (event: { language?: string; code: string }) => void
        'after:highlight': () => void
      }
    | undefined
  class MockEmitter {
    openNode() {}
    addText() {}
    __addSublanguage() {}
    toHTML() {
      return ''
    }
  }
  const api: HljsBoundApi = {
    highlightAuto: () => ({ _emitter: { constructor: MockEmitter } }),
    configure: () => {},
    addPlugin: p => {
      if (!plugin) plugin = p
    },
    getLanguage: name => (name ? langs[name] : undefined),
    listLanguages: () => Object.keys(langs),
  }
  bindHighlightBudget(api)
  return {
    api,
    runBefore: (code: string, language?: string) =>
      plugin?.['before:highlight']({ code, language }),
  }
}

describe('highlightBound #433 per-language length caps & long-line guards', () => {
  test('exports expected per-language caps and work limit', () => {
    expect(HIGHLIGHT_MAX_LENGTH).toBe(50000)
    expect(HIGHLIGHT_LANG_MAX_LENGTH.get('http')).toBe(8000)
    expect(HIGHLIGHT_LANG_MAX_LENGTH.get('nestedtext')).toBe(8000)
    expect(HIGHLIGHT_LANG_MAX_LENGTH.get('asciidoc')).toBe(16000)
    expect(HIGHLIGHT_LINE_WORK_LIMIT).toBe(16000000)
  })

  test('throws HighlightLimitError when code exceeds per-language cap', () => {
    const { runBefore } = makeMockHljs({ http: {}, javascript: {} })
    const multiLine9k = ('a'.repeat(100) + '\n').repeat(85)
    expect(() => runBefore(multiLine9k, 'http')).toThrow(HighlightLimitError)
    expect(() => runBefore(multiLine9k, 'javascript')).not.toThrow()
    // Long single line > 4000 chars triggers quadratic long-line guard (4001^2 > 16M)
    expect(() => runBefore('a'.repeat(4001), 'javascript')).toThrow(
      HighlightLimitError,
    )
  })

  test('throws HighlightLimitError on >50000 chars for default language', () => {
    const { runBefore } = makeMockHljs({ javascript: {} })
    const multiLine51k = ('a'.repeat(100) + '\n').repeat(510)
    expect(() => runBefore(multiLine51k, 'javascript')).toThrow(
      HighlightLimitError,
    )
  })
})
