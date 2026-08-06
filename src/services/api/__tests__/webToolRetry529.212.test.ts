/**
 * densable 2.1.212 #35 (+ #34 surface):
 * WebSearch/WebFetch side-queries are FOREGROUND_529 sources (swh) so 529/429
 * get bounded backoff; API error assistant messages throw TelemetrySafeError
 * instead of becoming tool result body text.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { shouldRetry529 } from '../withRetry.js'

describe('densable #35 FOREGROUND_529 / O6t for web tools', () => {
  test('O6t: undefined retries', () => {
    expect(shouldRetry529(undefined)).toBe(true)
  })

  test('O6t: agent:* prefix retries (not only exact agent:custom)', () => {
    expect(shouldRetry529('agent:custom')).toBe(true)
    expect(shouldRetry529('agent:custom:my-agent')).toBe(true)
    expect(shouldRetry529('agent:default')).toBe(true)
    expect(shouldRetry529('agent:builtin')).toBe(true)
  })

  test('O6t: densable swh includes web_search_tool and web_fetch_apply', () => {
    expect(shouldRetry529('web_search_tool')).toBe(true)
    expect(shouldRetry529('web_fetch_apply')).toBe(true)
  })

  test('O6t: densable swh extras present', () => {
    expect(shouldRetry529('repl_main_thread:outputStyle:Proactive')).toBe(true)
    expect(shouldRetry529('repl_sampling')).toBe(true)
    expect(shouldRetry529('chrome_mcp')).toBe(true)
    expect(shouldRetry529('compact_fab_check')).toBe(true)
    expect(shouldRetry529('auto_mode_critique')).toBe(true)
    expect(shouldRetry529('auto_mode_setup_propose')).toBe(true)
  })

  test('O6t: background sources do not retry', () => {
    expect(shouldRetry529('prompt_suggestion')).toBe(false)
    expect(shouldRetry529('session_memory')).toBe(false)
    expect(shouldRetry529('title_generation')).toBe(false)
  })

  test('withRetry source embeds densable swh web entries', () => {
    const src = readFileSync(join(import.meta.dir, '../withRetry.ts'), 'utf8')
    expect(src).toContain("'web_search_tool'")
    expect(src).toContain("'web_fetch_apply'")
    expect(src).toContain("querySource.startsWith('agent:')")
  })
})

describe('densable #34/#35 WebSearch api error throw (apiAdapter)', () => {
  test('apiAdapter tracks isApiErrorMessage and throws tagged error', () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        '../../../../packages/builtin-tools/src/tools/WebSearchTool/adapters/apiAdapter.ts',
      ),
      'utf8',
    )
    expect(src).toContain('isApiErrorMessage')
    expect(src).toContain('web-search-side-query-api-error')
    expect(src).toContain(
      'TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS',
    )
    expect(src).toContain("querySource: 'web_search_tool'")
  })
})

describe('densable #34/#35 WebFetch apply api error throw', () => {
  test('applyPromptToMarkdown throws on isApiErrorMessage', () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        '../../../../packages/builtin-tools/src/tools/WebFetchTool/utils.ts',
      ),
      'utf8',
    )
    expect(src).toContain('isApiErrorMessage')
    expect(src).toContain('web-fetch-apply-api-error')
    expect(src).toContain("querySource: 'web_fetch_apply'")
    expect(src).toContain(
      'TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS',
    )
  })
})
