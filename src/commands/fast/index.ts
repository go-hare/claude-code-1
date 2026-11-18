import type { Command } from '../../commands.js'
import {
  FAST_MODE_MODEL_DISPLAY,
  isFastModeEnabled,
} from '../../utils/fastMode.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import { runFunctionHookChain } from '../../utils/plugins/functionHooksModules.js'

export type SaveFastModeHookResult =
  | { kind: 'saved'; saved: boolean }
  | { kind: 'refused'; reason?: string }

/**
 * Official 2.1.295 (#407): ask plugin `config.set` hooks before persisting
 * fast mode changes via `/fast`.
 */
export async function saveFastModeWithConfigSetHook(
  nextEnabled: boolean,
  previousEnabled: boolean,
  persistFn: (finalEnabled: boolean) => void,
  signal?: AbortSignal,
): Promise<SaveFastModeHookResult> {
  let saved: boolean | undefined
  try {
    const res = await runFunctionHookChain(
      'config.set',
      {
        key: 'fastMode',
        value: nextEnabled,
        previous: previousEnabled,
        origin: { kind: 'composer' },
      },
      async arg => {
        const finalEnabled =
          typeof arg?.value === 'boolean' ? arg.value : nextEnabled
        saved = finalEnabled
        persistFn(finalEnabled)
        return { value: finalEnabled }
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

const fast = {
  type: 'local-jsx',
  name: 'fast',
  get description() {
    return `Toggle fast mode (${FAST_MODE_MODEL_DISPLAY} only)`
  },
  availability: ['claude-ai', 'console'],
  isEnabled: () => isFastModeEnabled(),
  get isHidden() {
    return !isFastModeEnabled()
  },
  argumentHint: '[on|off]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./fast.js'),
} satisfies Command

export default fast
