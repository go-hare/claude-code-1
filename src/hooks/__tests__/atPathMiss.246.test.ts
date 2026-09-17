/**
 * densable 2.1.246 #30 — official `updateSuggestions` at-path miss.
 *
 * `@` + path-like → `DQ(...,{maxResults:10})`; hits pin `at-path`.
 * Empty hits do **not** `Te()`; they fall through to fuzzy `ze(Ue,!0)`.
 * `bash-path` empty is the only `Te()` / `clearSuggestions()` path.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const typeaheadSrc = readFileSync(
  join(import.meta.dir, '../useTypeahead.tsx'),
  'utf8',
)

function sliceAtPathMiss(): string {
  const start = typeaheadSrc.indexOf(
    'const pathSuggestions = await getPathCompletions(searchToken, {',
  )
  const fuzzy = typeaheadSrc.indexOf(
    'void debouncedFetchFileSuggestions(searchToken, true);',
    start,
  )
  expect(start).toBeGreaterThan(-1)
  expect(fuzzy).toBeGreaterThan(start)
  return typeaheadSrc.slice(start, fuzzy)
}

describe('densable 2.1.246 #30 at-path miss falls through to fuzzy', () => {
  test('path-like @ token uses maxResults 10 and pins at-path only on hits', () => {
    expect(typeaheadSrc).toContain(
      'const pathSuggestions = await getPathCompletions(searchToken, {',
    )
    expect(typeaheadSrc).toContain('maxResults: 10,')
    expect(typeaheadSrc).toContain("directorySourceRef.current = 'at-path'")
    expect(typeaheadSrc).toContain('if (pathSuggestions.length > 0)')
  })

  test('at-path miss calls fuzzy ze, not Te()/clearSuggestions', () => {
    const miss = sliceAtPathMiss()
    expect(miss).not.toContain('clearSuggestions()')
    expect(miss).toContain('latestSearchTokenRef.current = null')
    expect(typeaheadSrc).toContain(
      'void debouncedFetchFileSuggestions(searchToken, true);',
    )
    expect(typeaheadSrc).toContain('Do NOT Te() here — that is bash-path only.')
  })

  test('bash-path empty still Te()s', () => {
    expect(typeaheadSrc).toContain(
      "if (suggestionType === 'directory' && directorySourceRef.current === 'bash-path') {\n          clearSuggestions();",
    )
  })
})
