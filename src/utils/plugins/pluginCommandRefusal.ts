/**
 * densable `i0` / `cwe` / `w0i` / `q6a` (`WXl`) / `jfS` / `v0i`.
 *
 * Entry-helper gates throw `cwe` with `failureCode`. Marketplace helper
 * policy throws bare `i0` (no failureCode). Classifier:
 *   cwe → {code: failureCode, kind: q6a[code]==="sad" ? "sad" : "bad"}
 *   else → {code: "command_source_refused", kind: "sad"}
 */

export const COMMAND_SOURCE_REFUSED = 'command_source_refused' as const

/** densable `q6a` keys — official table order. */
export type EntryHelperFailureCode =
  | 'entry_helper_unshown'
  | 'entry_helper_changed'
  | 'entry_archive_url_changed'
  | 'entry_helper_deferred'
  | 'entry_helper_disabled_by_policy'
  | 'entry_helper_unconfirmed'
  | 'entry_helper_remote_policy_unconsented'
  | 'entry_helper_not_inlined'

export type PluginCommandFailureCode =
  | typeof COMMAND_SOURCE_REFUSED
  | EntryHelperFailureCode

export type PluginCommandFailureKind = 'sad' | 'bad'

/**
 * densable `q6a` / `WXl`. Official `w0i` does not look up
 * `command_source_refused` here — it hardcodes `{kind:"sad"}`.
 * `zfS(e){return q6a[e]==="sad"}` — missing key is bad.
 */
export const PLUGIN_COMMAND_FAILURE_KIND = {
  entry_helper_unshown: 'sad',
  entry_helper_changed: 'sad',
  entry_archive_url_changed: 'sad',
  entry_helper_deferred: 'sad',
  entry_helper_disabled_by_policy: 'sad',
  entry_helper_unconfirmed: 'sad',
  entry_helper_remote_policy_unconsented: 'sad',
  entry_helper_not_inlined: 'bad',
} as const satisfies Record<EntryHelperFailureCode, PluginCommandFailureKind>

/**
 * densable `jfS` — `cwe` passes `jfS[failureCode]` to `i0` as kindDetail.
 */
export const ENTRY_HELPER_FAILURE_DETAIL = {
  entry_helper_unshown:
    'plugin entry helper consent mismatch at install: entry_helper_unshown',
  entry_helper_changed:
    'plugin entry helper consent mismatch at install: entry_helper_changed',
  entry_archive_url_changed:
    'plugin entry helper consent mismatch at install: entry_archive_url_changed',
  entry_helper_deferred: 'plugin headers helper deferred to explicit install',
  entry_helper_disabled_by_policy:
    'plugin entry helper disabled by managed policy',
  entry_helper_unconfirmed:
    'plugin entry helper unconfirmed at install (nothing was announced)',
  entry_helper_not_inlined:
    'plugin entry headersHelper requires strict:false (catalog authoring error)',
  entry_helper_remote_policy_unconsented:
    'plugin entry helper declared by remote managed settings not yet verified and consented',
} as const satisfies Record<EntryHelperFailureCode, string>

/** densable `v0i` — qhi pane-mismatch code → cwe failureCode. */
export const ENTRY_HELPER_PANE_MISMATCH_FAILURE_CODE = {
  unshown: 'entry_helper_unshown',
  command: 'entry_helper_changed',
  archive_url: 'entry_archive_url_changed',
} as const

/** densable `i0` — refused command/helper; second ctor arg is a kind string. */
export class PluginCommandRefusedError extends Error {
  readonly kindDetail?: string

  constructor(message: string, kindDetail?: string) {
    super(message)
    this.name = 'PluginCommandRefusedError'
    this.kindDetail = kindDetail
  }
}

/** densable `cwe` extends `i0` — typed entry-helper failureCode. */
export class EntryHelperPolicyError extends PluginCommandRefusedError {
  readonly failureCode: EntryHelperFailureCode

  constructor(message: string, failureCode: EntryHelperFailureCode) {
    super(message, ENTRY_HELPER_FAILURE_DETAIL[failureCode])
    this.name = 'EntryHelperPolicyError'
    this.failureCode = failureCode
  }
}

export function isEntryHelperFailureCode(
  code: string,
): code is EntryHelperFailureCode {
  return Object.hasOwn(ENTRY_HELPER_FAILURE_DETAIL, code)
}

export function entryHelperPaneMismatchFailureCode(
  code: keyof typeof ENTRY_HELPER_PANE_MISMATCH_FAILURE_CODE,
): (typeof ENTRY_HELPER_PANE_MISMATCH_FAILURE_CODE)[keyof typeof ENTRY_HELPER_PANE_MISMATCH_FAILURE_CODE] {
  return ENTRY_HELPER_PANE_MISMATCH_FAILURE_CODE[code]
}

/** densable Dcf / ggw policy → cwe failureCode. */
export function entryHelperPolicyFailureCode(
  refusal: 'lockdown' | 'remote_policy_unconsented',
): Extract<
  EntryHelperFailureCode,
  'entry_helper_remote_policy_unconsented' | 'entry_helper_disabled_by_policy'
> {
  return refusal === 'remote_policy_unconsented'
    ? 'entry_helper_remote_policy_unconsented'
    : 'entry_helper_disabled_by_policy'
}

/**
 * densable `w0i`. Callers that already know `e instanceof i0` (vun) still
 * get `command_source_refused` when it is not `cwe`.
 */
export function classifyPluginCommandRefusal(error: unknown): {
  code: string
  kind: PluginCommandFailureKind
} {
  if (error instanceof EntryHelperPolicyError) {
    return {
      code: error.failureCode,
      kind:
        PLUGIN_COMMAND_FAILURE_KIND[error.failureCode] === 'sad'
          ? 'sad'
          : 'bad',
    }
  }
  return { code: COMMAND_SOURCE_REFUSED, kind: 'sad' }
}

/** Rebuild a typed throw from an op result so CLI `w0i` still sees `cwe`. */
export function errorFromPluginFailureCode(
  message: string,
  failureCode: string | undefined,
): Error {
  if (failureCode && isEntryHelperFailureCode(failureCode)) {
    return new EntryHelperPolicyError(message, failureCode)
  }
  if (failureCode === COMMAND_SOURCE_REFUSED) {
    return new PluginCommandRefusedError(message)
  }
  return new Error(message)
}
