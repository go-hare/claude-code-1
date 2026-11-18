import type { Command } from '../../commands.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { runFunctionHookChain } from '../../utils/plugins/functionHooksModules.js'

export type SaveOutputStyleHookResult =
  | { kind: 'saved'; saved: string }
  | { kind: 'refused'; reason?: string }

/**
 * Official 2.1.295 (#407): ask plugin `config.set` hooks before persisting
 * outputStyle changes via `/output-style`.
 */
export async function saveOutputStyleWithConfigSetHook(
  nextStyle: string,
  previousStyle: string,
  persistFn: (finalStyle: string) => void,
  signal?: AbortSignal,
): Promise<SaveOutputStyleHookResult> {
  let saved: string | undefined
  try {
    const res = await runFunctionHookChain(
      'config.set',
      {
        key: 'outputStyle',
        value: nextStyle,
        previous: previousStyle,
        origin: { kind: 'composer' },
      },
      async arg => {
        const finalStyle =
          typeof arg?.value === 'string' ? arg.value : nextStyle
        saved = finalStyle
        persistFn(finalStyle)
        return { value: finalStyle }
      },
      undefined,
      undefined,
      signal ? { signal } : undefined,
    )
    if (saved !== undefined) {
      return { kind: 'saved', saved }
    }
    const deny =
      res &&
      typeof res === 'object' &&
      'deny' in res &&
      typeof (res as { deny?: unknown }).deny === 'string'
        ? (res as { deny: string }).deny
        : undefined
    return { kind: 'refused', reason: deny }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { kind: 'refused', reason: message }
  }
}

function mapleSundial(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_maple_sundial', false)
}

const outputStyle = {
  type: 'local',
  name: 'output-style',
  supportsNonInteractive: true,
  description: 'List output styles or switch to one',
  argumentHint: '[style]',
  isEnabled: () => getIsNonInteractiveSession() || !mapleSundial(),
  get isHidden() {
    return !getIsNonInteractiveSession() && mapleSundial()
  },
  load: () => import('./output-style.js'),
} satisfies Command

/** densable vjt maple_sundial alias — hidden "moved to /config". */
export const outputStyleMapleAlias = {
  type: 'local-jsx',
  name: 'output-style',
  description: 'Output style moved to /config',
  isHidden: true,
  isEnabled: () => mapleSundial(),
  load: () => import('./output-style-alias.js'),
} satisfies Command

export default outputStyle
