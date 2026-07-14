/**
 * Official x_h — CLAUDE_CODE_GZIP_REQUEST_BODIES / tengu_gzip_request_bodies.
 *
 * When enabled, Bun/Node fetch compresses eligible first-party API request
 * bodies (`compress: "gzip"`) and pads the JSON body with random whitespace
 * so compressed lengths are less fingerprintable.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

const GZIP_ELIGIBLE_HOSTS = new Set(['api.anthropic.com'])

export function isGzipRequestBodiesEnabled(input?: {
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
}): boolean {
  const env = input?.env ?? process.env
  const raw = env.CLAUDE_CODE_GZIP_REQUEST_BODIES
  if (raw !== undefined) {
    if (isEnvTruthy(raw)) return true
    if (isEnvDefinedFalsy(raw)) return false
    // empty / other → fall through to GB
  }
  if (input?.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_gzip_request_bodies', false)
}

/** Official _Ie — only first-party Anthropic API host is eligible. */
export function isGzipRequestBodyUrlEligible(url: string): boolean {
  try {
    const host = new URL(url).host
    return GZIP_ELIGIBLE_HOSTS.has(host)
  } catch {
    return false
  }
}

/**
 * Official body pad: append 0–256 random space/tab chars so compressed
 * ciphertext length is less fingerprintable.
 */
export function padGzipRequestBody(body: string): string {
  const n = Math.floor(Math.random() * 257)
  let pad = ''
  for (let i = 0; i < n; i++) {
    pad += Math.random() < 0.5 ? ' ' : '\t'
  }
  return body + ' ' + pad
}

/**
 * Apply official gzip request-body transform to a fetch init when the gate
 * is on and the URL is eligible. Returns a new init object when modified.
 */
export function applyGzipRequestBodyInit(
  url: string,
  init: RequestInit | undefined,
  input?: {
    env?: NodeJS.ProcessEnv
    gbValue?: boolean
  },
): RequestInit | undefined {
  if (!isGzipRequestBodiesEnabled(input)) return init
  if (!isGzipRequestBodyUrlEligible(url)) return init
  const next: RequestInit & { compress?: string } = { ...(init ?? {}) }
  next.compress = 'gzip'
  if (typeof next.body === 'string') {
    next.body = padGzipRequestBody(next.body)
  }
  return next
}
