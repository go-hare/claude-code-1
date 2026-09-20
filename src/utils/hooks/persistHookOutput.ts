/**
 * densable leftover `lre` (247 @218251306) ≡ 246 `Rne` (@216793606) — spill
 * oversized hook output to the session tool-results dir instead of attaching
 * it to the conversation in full.
 *
 * Reuses the tool-result persist path (`persistToolResult` /
 * `buildLargeToolResultMessage`), matching the official body, which calls the
 * same 4-arg persist helper with a `hook-<id>-<source>` basename.
 */
import { HOOK_OUTPUT_PERSIST_THRESHOLD_CHARS } from '../../constants/toolLimits.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  buildLargeToolResultMessage,
  isPersistError,
  persistToolResult,
} from '../toolResultStorage.js'

/**
 * The hook outputs that reach the conversation. densable calls `lre` with
 * exactly these four kinds — stderr and blockingError are deliberately not
 * among them (they stay full-text).
 */
export type HookOutputSource =
  | 'stdout'
  | 'additionalContext'
  | 'systemMessage'
  | 'initialUserMessage'

/**
 * Return `output` unchanged when it fits, otherwise persist it and return the
 * `<persisted-output>` reference message. When persisting fails, fall back to a
 * hard slice with a marker naming the failure — the model still gets the head
 * of the output plus an explanation of why the rest is missing.
 */
export async function persistHookOutput(
  output: string,
  id: string,
  source: HookOutputSource,
  {
    threshold = HOOK_OUTPUT_PERSIST_THRESHOLD_CHARS,
  }: { threshold?: number } = {},
): Promise<string> {
  if (output.length <= threshold) return output

  const persisted = await persistToolResult(output, `hook-${id}-${source}`)
  if (isPersistError(persisted)) {
    logEvent('tengu_hook_output_persisted', {
      source:
        source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      originalSizeBytes: output.length,
      persistedSizeBytes: 0,
      truncatedFallback: true,
    })
    return `${output.slice(0, threshold)}\n\n[Hook ${source} truncated at ${threshold} chars — persist-to-disk failed: ${persisted.error}]`
  }

  const message = buildLargeToolResultMessage(persisted)
  logEvent('tengu_hook_output_persisted', {
    source:
      source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    originalSizeBytes: persisted.originalSize,
    persistedSizeBytes: message.length,
    truncatedFallback: false,
  })
  return message
}
