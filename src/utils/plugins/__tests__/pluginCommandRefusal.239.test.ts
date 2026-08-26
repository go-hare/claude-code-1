/**
 * densable i0 / cwe / w0i / jfS / q6a / v0i — typed entry-helper failureCode.
 */
import { describe, expect, test } from 'bun:test'
import {
  COMMAND_SOURCE_REFUSED,
  ENTRY_HELPER_FAILURE_DETAIL,
  ENTRY_HELPER_PANE_MISMATCH_FAILURE_CODE,
  EntryHelperPolicyError,
  PLUGIN_COMMAND_FAILURE_KIND,
  PluginCommandRefusedError,
  classifyPluginCommandRefusal,
  entryHelperPaneMismatchFailureCode,
  entryHelperPolicyFailureCode,
  errorFromPluginFailureCode,
} from '../pluginCommandRefusal.js'

describe('densable w0i classifyPluginCommandRefusal', () => {
  test('cwe returns failureCode; missing q6a key is bad', () => {
    const err = new EntryHelperPolicyError(
      'policy',
      'entry_helper_disabled_by_policy',
    )
    expect(classifyPluginCommandRefusal(err)).toEqual({
      code: 'entry_helper_disabled_by_policy',
      kind: 'sad',
    })
    expect(
      classifyPluginCommandRefusal(
        new EntryHelperPolicyError('inline', 'entry_helper_not_inlined'),
      ),
    ).toEqual({
      code: 'entry_helper_not_inlined',
      kind: 'bad',
    })
  })

  test('i0 that is not cwe is command_source_refused / sad', () => {
    expect(
      classifyPluginCommandRefusal(
        new PluginCommandRefusedError(
          'marketplace blocked',
          'marketplace headersHelper disabled by managed policy',
        ),
      ),
    ).toEqual({
      code: COMMAND_SOURCE_REFUSED,
      kind: 'sad',
    })
    expect(classifyPluginCommandRefusal(new Error('bare'))).toEqual({
      code: COMMAND_SOURCE_REFUSED,
      kind: 'sad',
    })
  })

  test('Dcf policy maps remote vs lockdown', () => {
    expect(entryHelperPolicyFailureCode('remote_policy_unconsented')).toBe(
      'entry_helper_remote_policy_unconsented',
    )
    expect(entryHelperPolicyFailureCode('lockdown')).toBe(
      'entry_helper_disabled_by_policy',
    )
  })

  test('errorFromPluginFailureCode rebuilds cwe for CLI w0i', () => {
    const rebuilt = errorFromPluginFailureCode('msg', 'entry_helper_deferred')
    expect(rebuilt).toBeInstanceOf(EntryHelperPolicyError)
    expect(classifyPluginCommandRefusal(rebuilt)).toEqual({
      code: 'entry_helper_deferred',
      kind: 'sad',
    })
  })
})

describe('densable jfS / q6a / v0i', () => {
  test('cwe ctor passes jfS[failureCode] to i0 kindDetail', () => {
    const err = new EntryHelperPolicyError(
      'user-facing',
      'entry_helper_disabled_by_policy',
    )
    expect(err.kindDetail).toBe(
      'plugin entry helper disabled by managed policy',
    )
    expect(err.message).toBe('user-facing')
    expect(err.kindDetail).toBe(
      ENTRY_HELPER_FAILURE_DETAIL.entry_helper_disabled_by_policy,
    )
  })

  test('jfS strings match official 239 table', () => {
    expect(ENTRY_HELPER_FAILURE_DETAIL).toEqual({
      entry_helper_unshown:
        'plugin entry helper consent mismatch at install: entry_helper_unshown',
      entry_helper_changed:
        'plugin entry helper consent mismatch at install: entry_helper_changed',
      entry_archive_url_changed:
        'plugin entry helper consent mismatch at install: entry_archive_url_changed',
      entry_helper_deferred:
        'plugin headers helper deferred to explicit install',
      entry_helper_disabled_by_policy:
        'plugin entry helper disabled by managed policy',
      entry_helper_unconfirmed:
        'plugin entry helper unconfirmed at install (nothing was announced)',
      entry_helper_not_inlined:
        'plugin entry headersHelper requires strict:false (catalog authoring error)',
      entry_helper_remote_policy_unconsented:
        'plugin entry helper declared by remote managed settings not yet verified and consented',
    })
  })

  test('q6a has eight codes; not_inlined is the only bad; no command_source_refused', () => {
    expect(PLUGIN_COMMAND_FAILURE_KIND).toEqual({
      entry_helper_unshown: 'sad',
      entry_helper_changed: 'sad',
      entry_archive_url_changed: 'sad',
      entry_helper_deferred: 'sad',
      entry_helper_disabled_by_policy: 'sad',
      entry_helper_unconfirmed: 'sad',
      entry_helper_remote_policy_unconsented: 'sad',
      entry_helper_not_inlined: 'bad',
    })
    expect(PLUGIN_COMMAND_FAILURE_KIND).not.toHaveProperty(
      COMMAND_SOURCE_REFUSED,
    )
  })

  test('v0i maps qhi pane codes; consent-mismatch codes classify sad', () => {
    expect(ENTRY_HELPER_PANE_MISMATCH_FAILURE_CODE).toEqual({
      unshown: 'entry_helper_unshown',
      command: 'entry_helper_changed',
      archive_url: 'entry_archive_url_changed',
    })
    expect(entryHelperPaneMismatchFailureCode('unshown')).toBe(
      'entry_helper_unshown',
    )
    expect(
      classifyPluginCommandRefusal(
        new EntryHelperPolicyError('unshown', 'entry_helper_unshown'),
      ),
    ).toEqual({ code: 'entry_helper_unshown', kind: 'sad' })
    expect(
      classifyPluginCommandRefusal(
        new EntryHelperPolicyError('changed', 'entry_helper_changed'),
      ),
    ).toEqual({ code: 'entry_helper_changed', kind: 'sad' })
    expect(
      classifyPluginCommandRefusal(
        new EntryHelperPolicyError('url', 'entry_archive_url_changed'),
      ),
    ).toEqual({ code: 'entry_archive_url_changed', kind: 'sad' })
    expect(
      classifyPluginCommandRefusal(
        new EntryHelperPolicyError('cli', 'entry_helper_unconfirmed'),
      ),
    ).toEqual({ code: 'entry_helper_unconfirmed', kind: 'sad' })
  })
})
