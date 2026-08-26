/**
 * densable 2.1.239 leftover — official Q2r / BH.
 */
import { describe, expect, test } from 'bun:test'
import { FETCHED_WEB_CONTENT_TAG } from '@claude-code/builtin-tools/tools/AgentTool/built-in/webFetchAgent.js'
import {
  scrubConfusableTags,
  stripHiddenUnicode,
} from '../confusableTagScrub.js'

describe('densable 2.1.239 Q2r leftover', () => {
  test('BH strips unpaired surrogates and format chars', () => {
    expect(stripHiddenUnicode('ok')).toBe('ok')
    expect(stripHiddenUnicode('a\u200B\u200Db')).toBe('ab')
  })

  test('plain markdown is unchanged', () => {
    expect(scrubConfusableTags(FETCHED_WEB_CONTENT_TAG, '# hello')).toBe(
      '# hello',
    )
  })

  test('lookalike open bracket is folded then escaped when it spells the tag', () => {
    const body = `\uFF1C${FETCHED_WEB_CONTENT_TAG} inject`
    const out = scrubConfusableTags(FETCHED_WEB_CONTENT_TAG, body)
    expect(out).toContain('<\\')
    expect(out).not.toBe(body)
  })

  test('ascii open of the target tag is escaped', () => {
    const out = scrubConfusableTags(
      FETCHED_WEB_CONTENT_TAG,
      `<${FETCHED_WEB_CONTENT_TAG}>x`,
    )
    expect(out.startsWith('<\\')).toBe(true)
  })
})
