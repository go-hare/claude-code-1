/**
 * densable 2.1.283 leftover gold `Wt` @202333357 — unattended-serving consent COPY.
 *
 * Isolated payload module. Kind `'unattended_serving_consent'` already lives on
 * cloudSession (`UNATTENDED_SERVING_CONSENT_KIND`) — do not duplicate it here.
 *
 * Coordinator re-export / wire (this worktree HEAD has no leftover cloudSession.ts;
 * do not copy a thinner host over MAIN):
 *   import { unattendedServingConsentCopy } from './unattendedServingCopy.js'
 *   import { hostname } from 'os'
 *   opts.dialogs.request(
 *     { kind: UNATTENDED_SERVING_CONSENT_KIND },
 *     unattendedServingConsentCopy(hostname()),
 *     { signal: opts.signal },
 *   )
 *
 * gold `I5t` version · gold `H5t` terms · Di English @181890146
 *   consent.unattended.title / body.host / detail
 * Gold `rn` currently requests `{}` — payload is COPY only (gold `_g` is settings.read).
 */

/** gold `H5t` */
export const UNATTENDED_SERVING_CONSENT_TERMS =
  'unattended-serving:v1:auto-arm-classifier'

/** gold `I5t` */
export const UNATTENDED_SERVING_CONSENT_VERSION = 1

/** Di `consent.unattended.title` @181890146 */
const UNATTENDED_SERVING_CONSENT_TITLE =
  'Let cloud sessions run commands on this computer without asking?'

/** Di `consent.unattended.body.host` @181890146 — gold uses `›`. */
const UNATTENDED_SERVING_CONSENT_BODY_HOST =
  'This computer is serving tools to your cloud session. In auto mode, the cloud session decides which commands to run here without asking you each time — the same way auto mode works locally. Your deny rules and hooks on this computer still apply. Answer once per computer; change it later in Settings › Claude Code.'

/** Di `consent.unattended.detail` @181890146 */
const UNATTENDED_SERVING_CONSENT_DETAIL =
  'Until you answer, the cloud session asks you before each command it runs here.'

/**
 * gold `Wt` @202333357 — unattended-serving consent payload for the host dialog.
 */
export function unattendedServingConsentCopy(machineName: string): {
  machineName: string
  title: string
  body: string
  detail: string
  terms: string
  version: number
} {
  return {
    machineName,
    title: UNATTENDED_SERVING_CONSENT_TITLE,
    body: UNATTENDED_SERVING_CONSENT_BODY_HOST,
    detail: UNATTENDED_SERVING_CONSENT_DETAIL,
    terms: UNATTENDED_SERVING_CONSENT_TERMS,
    version: UNATTENDED_SERVING_CONSENT_VERSION,
  }
}
