/**
 * densable 2.1.233 #16 — print-mode stderr signal for unrecognized models (FRi / xLS).
 *
 * Gold:
 *   xLS = "[claude-code:unrecognized_model]"
 *   FRi(model, querySource):
 *     skip application-inference-profile without resolved backing
 *     once-per-stripped-id claim
 *     skip if est(catalog-known)
 *     log tengu_api_unrecognized_model
 *     print: stderr line; else debug warn
 */

import { writeSync } from 'fs'
import { getIsNonInteractiveSession } from 'src/bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { recognizePrintModel } from './printSetModel.js'

/** densable xLS */
export const UNRECOGNIZED_MODEL_SIGNAL_TAG =
  '[claude-code:unrecognized_model]' as const

/** densable ZE.claim keys for this signal */
const claimedStrippedIds = new Set<string>()

/** densable kd — strip [1m]/[2m] context suffixes for claim key */
export function stripModelContextSuffixes(model: string): string {
  return model.replace(/\[(1|2)m\]/gi, '')
}

/**
 * densable mAr — bedrock application-inference-profile without resolved backing
 * model is incomplete; do not signal yet.
 */
function isIncompleteInferenceProfile(model: string): boolean {
  return (
    model.includes('application-inference-profile') &&
    // Without a resolved backing model id we cannot classify — densable mAr.
    !/claude-[a-z0-9._-]+/i.test(model)
  )
}

/**
 * densable est / x4u approximation — known-enough that we should not warn.
 * Uses first-party print recognition (aliases, picker, claude-* form).
 */
function isCatalogKnownModel(model: string): boolean {
  return recognizePrintModel(model).recognized
}

/** densable Od — analytics-safe model id */
function analyticsModelId(model: string): string {
  if (/^[A-Za-z0-9._:[\]-]{1,100}$/.test(model)) return model
  if (/^[A-Za-z0-9._:[\]-]{1,91}@\d{8}(\[\d{1,3}[mM]\])?$/.test(model)) {
    return model
  }
  return 'nonconforming'
}

// densable _ot — strip residual C0 controls (keep \t \n)
// Built without raw control chars so biome noControlCharactersInRegex stays clean.
const C0_EXCEPT_TAB_NL = new RegExp(
  '[' +
    String.fromCharCode(0) +
    '-' +
    String.fromCharCode(8) +
    String.fromCharCode(11) +
    String.fromCharCode(12) +
    String.fromCharCode(14) +
    '-' +
    String.fromCharCode(31) +
    ']',
  'g',
)

/**
 * densable FRi — emit once-per-session unrecognized-model diagnostic.
 */
export function signalUnrecognizedModel(
  model: string,
  querySource: string | undefined,
): void {
  try {
    if (!model || isIncompleteInferenceProfile(model)) return
    const stripped = stripModelContextSuffixes(model)
    const claimKey = `unrecognized-model-signal:${stripped}`
    if (claimedStrippedIds.has(claimKey)) return
    claimedStrippedIds.add(claimKey)

    if (isCatalogKnownModel(model) || isCatalogKnownModel(stripped)) {
      return
    }

    logEvent('tengu_api_unrecognized_model', {
      model: analyticsModelId(
        model,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      query_source: (querySource ??
        'unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    const line = `${UNRECOGNIZED_MODEL_SIGNAL_TAG} ${JSON.stringify({
      model,
      query_source: querySource,
    })}`.replace(C0_EXCEPT_TAB_NL, '')

    // densable: Rn() && SESSION_KIND!=="bg" → GSt(stderr); else w(warn)
    const isBg = process.env.CLAUDE_CODE_SESSION_KIND === 'bg'
    if (getIsNonInteractiveSession() && !isBg) {
      try {
        writeSync(process.stderr.fd, `${line}\n`)
      } catch {
        // fallback
        // eslint-disable-next-line no-console
        console.error(line)
      }
    } else {
      logForDebugging(line, { level: 'warn' })
    }
  } catch (err) {
    logForDebugging(
      `unrecognized-model signal failed: ${errorMessage(err) ?? String(err)}`,
    )
  }
}

/** Test helper */
export function resetUnrecognizedModelSignalClaimsForTests(): void {
  claimedStrippedIds.clear()
}
