/**
 * densable leftover 2.1.283 — headless feature attach (`ge` @202300924,
 * `qe` @202301058, `Me` keys). Isolated from cloudSession.
 */
import { logForDebugging } from '../utils/debug.js'
import { errorMessage, isAbortError } from '../utils/errors.js'
import { logError } from '../utils/log.js'

/** gold `Me` — attach-pack keys a headless feature may contribute. */
export const HEADLESS_FEATURE_KEYS = [
  'settings',
  'hooks',
  'plugins',
  'tools',
] as const

export type HeadlessFeatureKey = (typeof HEADLESS_FEATURE_KEYS)[number]

export type HeadlessFeatureAttachContext = {
  trigger: string
}

export type HeadlessFeatureAttachFn<T> = (
  context: HeadlessFeatureAttachContext,
) => T | undefined | Promise<T | undefined>

/**
 * gold `ge` — abort is expected (log + return); anything else is logged
 * without crashing the attach loop.
 */
export function noteHeadlessFeatureHookError(error: unknown): void {
  if (isAbortError(error)) {
    logForDebugging('[headlessFeatures] a feature hook was aborted')
    return
  }
  logError(error)
}

/**
 * gold `qe` — run attach fns in parallel; drop undefined packs; never throw
 * for a single feature failure.
 */
export async function attachHeadlessFeatures<T>(
  features: ReadonlyArray<HeadlessFeatureAttachFn<T>>,
  context: HeadlessFeatureAttachContext,
): Promise<T[]> {
  return (
    await Promise.all(
      features.map(feature =>
        Promise.resolve()
          .then(() => feature(context))
          .catch((error: unknown) => {
            logForDebugging(
              `[headlessFeatures] a feature did not attach (${context.trigger}): ${errorMessage(error)}`,
            )
            noteHeadlessFeatureHookError(error)
            return
          }),
      ),
    )
  ).flatMap(pack => (pack === undefined ? [] : [pack]))
}
