import { describe, expect, test } from 'bun:test'
import {
  AUTO_MODE_CLASSIFIER_RULE_SLUGS,
  extractClassifierRuleSlug,
  normalizeClassifierRuleSlug,
  sanitizeClassifierRuleSlug,
} from '../yoloClassifier.js'

describe('yoloClassifier rule slugs (#524, SEA Eii/Gwn/wii/cN)', () => {
  test('AUTO_MODE_CLASSIFIER_RULE_SLUGS includes live_shared_artifact_sensitive_delta and matches SEA Eii count (73)', () => {
    expect(AUTO_MODE_CLASSIFIER_RULE_SLUGS).toContain(
      'live_shared_artifact_sensitive_delta',
    )
    expect(AUTO_MODE_CLASSIFIER_RULE_SLUGS).toHaveLength(73)
  })

  test('normalizeClassifierRuleSlug (Gwn) normalizes labels to snake_case', () => {
    expect(
      normalizeClassifierRuleSlug('Live Shared Artifact: Sensitive Delta'),
    ).toBe('live_shared_artifact_sensitive_delta')
    expect(normalizeClassifierRuleSlug('  --Foo Bar--  ')).toBe('foo_bar')
  })

  test('extractClassifierRuleSlug (wii) extracts bracketed prefix within 80 chars', () => {
    expect(
      extractClassifierRuleSlug(
        '[Live Shared Artifact: Sensitive Delta] Updating shared doc',
      ),
    ).toBe('live_shared_artifact_sensitive_delta')
    expect(extractClassifierRuleSlug('No bracket prefix')).toBeUndefined()
    expect(
      extractClassifierRuleSlug(`[${'a'.repeat(81)}] too long`),
    ).toBeUndefined()
  })

  test('sanitizeClassifierRuleSlug (cN) admits known slugs and rejects unknown ones', () => {
    expect(
      sanitizeClassifierRuleSlug('live_shared_artifact_sensitive_delta'),
    ).toBe('live_shared_artifact_sensitive_delta')
    expect(sanitizeClassifierRuleSlug('cowork_folder_access')).toBe(
      'cowork_folder_access',
    )
    expect(sanitizeClassifierRuleSlug('destructive_or_unwanted_actions')).toBe(
      'destructive_or_unwanted_actions',
    )
    expect(sanitizeClassifierRuleSlug('not_a_real_slug')).toBeUndefined()
    expect(sanitizeClassifierRuleSlug(undefined)).toBeUndefined()
  })
})
