import { getInitialSettings } from './settings/settings.js'

/** densable 2.1.238 SEA `Drh` — default when settings omit keybindingFlavor. */
export const DEFAULT_KEYBINDING_FLAVOR = 'classic' as const

export type KeybindingFlavor = 'classic' | 'readline'

/**
 * densable 2.1.238 SEA `xKi` — read prompt editing key conventions.
 * `"readline"` makes Ctrl+W delete back to previous whitespace (Bash WORD);
 * `"classic"` (default) keeps Segmenter word delete.
 */
export function getKeybindingFlavor(): KeybindingFlavor {
  return getInitialSettings().keybindingFlavor ?? DEFAULT_KEYBINDING_FLAVOR
}
