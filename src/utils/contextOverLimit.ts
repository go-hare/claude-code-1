/**
 * densable 2.1.216 Ftn — explicit /context over-window warning copy.
 *
 * When totalTokens > rawMaxTokens, /context shows a red error line (UI) or
 * `**Over limit:** …` (markdown). Branching on autocompactSource mirrors densable:
 * - "auto" → hard model limit language + `/compact or /clear`
 * - anything else (env/settings/…) → compaction-window language + `/compact`
 * DISABLE_COMPACT drops /compact from the suggested commands.
 */

import { formatTokens } from './format.js'
import { isEnvTruthy } from './envUtils.js'

export type ContextAutocompactSource =
  | 'auto'
  | 'env'
  | 'settings'
  | 'clientdata'
  | 'experiment'
  | 'model-default'

export type ContextOverLimitInput = {
  totalTokens: number
  rawMaxTokens: number
  /**
   * densable p7().source — only `"auto"` uses the hard-limit sentence.
   * Undefined treated as `"auto"` for older ContextData without the field.
   */
  autocompactSource?: ContextAutocompactSource | string
  /** Test seam; defaults to process.env.DISABLE_COMPACT. */
  disableCompact?: boolean
}

/**
 * densable Ftn(e). Returns null when under the displayed window.
 */
export function formatContextOverLimitWarning(
  input: ContextOverLimitInput,
): string | null {
  if (input.totalTokens <= input.rawMaxTokens) return null

  const over = formatTokens(input.totalTokens - input.rawMaxTokens)
  const limit = formatTokens(input.rawMaxTokens)
  const disableCompact =
    input.disableCompact ?? isEnvTruthy(process.env.DISABLE_COMPACT)
  const source = input.autocompactSource ?? 'auto'

  if (source === 'auto') {
    const cmd = disableCompact ? '/clear' : '/compact or /clear'
    return `Context exceeds the ${limit}-token limit by ${over} tokens — run ${cmd} to continue.`
  }

  const cmd = disableCompact ? '/clear' : '/compact'
  return `Context is ${over} tokens past the ${limit}-token compaction window — run ${cmd} to reduce usage.`
}
