/**
 * Official DAb densable (2.1.208) — GrowthBook callout injected into
 * artifact-design / use-artifacts skill body at the <!-- dataviz-callout -->
 * placeholder.
 *
 * Gate: tengu_cobalt_plinth_dataviz (default false).
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { DATAVIZ_SKILL_NAME } from './datavizContent.js'

/** Official IAb placeholder token. */
export const DATAVIZ_CALLOUT_PLACEHOLDER = '<!-- dataviz-callout -->'

/** Official GrowthBook flag for the dataviz callout. */
export const DATAVIZ_CALLOUT_GB_FLAG = 'tengu_cobalt_plinth_dataviz'

/**
 * Official DAb — returns the callout markdown when GB is on, else "".
 * `getFlag` is injectable for unit tests (avoid process-global mock.module).
 */
export function getDatavizCallout(
  getFlag: (
    key: string,
    fallback: boolean,
  ) => boolean = getFeatureValue_CACHED_MAY_BE_STALE,
): string {
  if (!getFlag(DATAVIZ_CALLOUT_GB_FLAG, false)) return ''
  return (
    `**When adding charts or diagrams** The craft shifts from identity to honesty — ` +
    `pick the form the data's shape calls for, keep encodings from exaggerating, ` +
    `title the finding rather than the axes. Load the \`${DATAVIZ_SKILL_NAME}\` skill ` +
    `for the specifics; this skill continues to govern the page the chart sits in.`
  )
}

/** Replace the placeholder (or append if missing) with the GB-gated callout. */
export function applyDatavizCallout(
  skillBody: string,
  getFlag?: (key: string, fallback: boolean) => boolean,
): string {
  const callout = getDatavizCallout(getFlag)
  if (skillBody.includes(DATAVIZ_CALLOUT_PLACEHOLDER)) {
    return skillBody.replace(DATAVIZ_CALLOUT_PLACEHOLDER, callout)
  }
  if (!callout) return skillBody
  return `${skillBody.trimEnd()}\n\n${callout}\n`
}
