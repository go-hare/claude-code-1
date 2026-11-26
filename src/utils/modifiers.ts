import { getBootstrapSessionHost, HostSlot } from './sessionHost.js'

export type ModifierKey = 'shift' | 'command' | 'control' | 'option'

const modifiersPrewarmHostSlot = new HostSlot<{ prewarmed: boolean }>(() => ({
  prewarmed: false,
}))

/**
 * Pre-warm the native module by loading it in advance.
 * Call this early to avoid delay on first use.
 */
export function prewarmModifiers(): void {
  const hostState = modifiersPrewarmHostSlot.of(getBootstrapSessionHost())
  if (hostState.prewarmed || process.platform !== 'darwin') {
    return
  }
  hostState.prewarmed = true
  void import('modifiers-napi').then(({ prewarm }) => prewarm()).catch(() => {})
}

/**
 * Check if a specific modifier key is currently pressed (synchronous).
 */
export function isModifierPressed(modifier: ModifierKey): boolean {
  if (process.platform !== 'darwin') {
    return false
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isModifierPressed: nativeIsModifierPressed } =
      require('modifiers-napi') as { isModifierPressed: (m: string) => boolean }
    return nativeIsModifierPressed(modifier)
  } catch {
    return false
  }
}
