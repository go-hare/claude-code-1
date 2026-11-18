import { afterEach, describe, expect, test } from 'bun:test'
import { lexMemoryMarkdown, stripHtmlComments } from '../claudemd.js'
import { isProjectScopeBlockedEnvVar } from '../managedEnvConstants.js'
import {
  DEFAULT_SYNC_REUSE_WITHIN_MS,
  resolveSyncReuseWithinMs,
} from '../residualFinalEnvGates.js'
import { filterInvalidPermissionRules } from '../settings/validation.js'
import { jsonStringify } from '../slowOperations.js'
import {
  getOwnTaskListId,
  getTaskListId,
  resetTaskListState,
  setOwnTaskListId,
  setSessionTaskListId,
} from '../tasks.js'

describe('v2.1.311 alignments', () => {
  afterEach(() => {
    resetTaskListState()
    delete process.env.CLAUDE_CODE_TASK_LIST_ID
  })

  test('#1225 lexMemoryMarkdown & stripHtmlComments handle very long list items without freezing', () => {
    const longLine = '- ' + 'word '.repeat(20_000)
    const doc = `${longLine}\n\n<!-- hidden -->\nVisible\n`
    const start = performance.now()
    const tokens = lexMemoryMarkdown(doc)
    const stripped = stripHtmlComments(doc)
    const elapsed = performance.now() - start
    expect(tokens.length).toBeGreaterThan(0)
    expect(stripped.stripped).toBe(true)
    expect(stripped.content).toContain('Visible')
    expect(stripped.content).not.toContain('hidden')
    expect(elapsed).toBeLessThan(1000)

    // Valid setext headings still tokenize as headings
    const headingTokens = lexMemoryMarkdown('Heading\n===\n')
    expect(headingTokens[0]?.type).toBe('heading')
  })

  test('#1252 getTaskListId resolves sessionListId and ownTaskListId', () => {
    setOwnTaskListId('own-list-1')
    expect(getOwnTaskListId('fallback-id')).toBe('own-list-1')
    expect(getTaskListId()).toBe('own-list-1')

    setSessionTaskListId('session-list-2')
    expect(getTaskListId()).toBe('session-list-2')

    process.env.CLAUDE_CODE_TASK_LIST_ID = 'env-list-3'
    expect(getTaskListId()).toBe('env-list-3')
  })

  test('#1290 jsonStringify escapes DEL, C1 controls, U+2028/U+2029, and \\p{Cf} as \\uXXXX', () => {
    const input = {
      del: 'a\u007fb',
      c1: 'a\u0080\u0085\u009fb',
      sep: 'a\u2028\u2029b',
      cf: 'a\u200b\ufeffb',
    }
    const serialized = jsonStringify(input)
    expect(serialized).toContain('\\u007f')
    expect(serialized).toContain('\\u0080')
    expect(serialized).toContain('\\u0085')
    expect(serialized).toContain('\\u009f')
    expect(serialized).toContain('\\u2028')
    expect(serialized).toContain('\\u2029')
    expect(serialized).toContain('\\u200b')
    expect(serialized).toContain('\\ufeff')
    expect(JSON.parse(serialized)).toEqual(input)
  })

  test('#1292 invalid permission rules in settings emit severity warning', () => {
    const data = {
      permissions: {
        allow: ['Bash(unclosed'],
      },
    }
    const warnings = filterInvalidPermissionRules(data, '/tmp/settings.json')
    expect(warnings.length).toBe(1)
    expect(warnings[0]?.severity).toBe('warning')
    expect(warnings[0]?.message).toContain('Invalid permission rule')
  })

  test('#1294 isProjectScopeBlockedEnvVar allows DISABLE_COMPACT=1 and blocks DISABLE_COMPACT=0', () => {
    expect(isProjectScopeBlockedEnvVar('DISABLE_COMPACT', '1')).toBe(false)
    expect(isProjectScopeBlockedEnvVar('DISABLE_COMPACT', 'true')).toBe(false)
    expect(isProjectScopeBlockedEnvVar('DISABLE_COMPACT', '0')).toBe(true)
    expect(isProjectScopeBlockedEnvVar('DISABLE_COMPACT', 'false')).toBe(true)
    expect(isProjectScopeBlockedEnvVar('DISABLE_COMPACT', '')).toBe(true)
  })

  test('#1296 DEFAULT_SYNC_REUSE_WITHIN_MS and resolveSyncReuseWithinMs', () => {
    expect(DEFAULT_SYNC_REUSE_WITHIN_MS).toBe(600_000)
    expect(resolveSyncReuseWithinMs({})).toBeUndefined()
    expect(
      resolveSyncReuseWithinMs({ CLAUDE_CODE_SYNC_REUSE_WITHIN_MS: '0' }),
    ).toBeUndefined()
    expect(
      resolveSyncReuseWithinMs({ CLAUDE_CODE_SYNC_REUSE_WITHIN_MS: '120000' }),
    ).toBe(120_000)
  })
})
