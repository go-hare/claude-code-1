import {
  hasUsedBackslashReturn,
  isShiftEnterKeyBindingInstalled,
} from '../../commands/terminalSetup/terminalSetup.js'
import type { Key } from '@anthropic/ink'
import { getGlobalConfig } from '../../utils/config.js'
import { env } from '../../utils/env.js'
/**
 * Helper function to check if vim mode is currently enabled
 * @returns boolean indicating if vim mode is active
 */
export function isVimModeEnabled(): boolean {
  const config = getGlobalConfig()
  return config.editorMode === 'vim'
}

export function getNewlineInstructions(): string {
  // Apple Terminal on macOS uses native modifier key detection for Shift+Enter
  if (env.terminal === 'Apple_Terminal' && process.platform === 'darwin') {
    return 'shift + ⏎ for newline'
  }

  // For iTerm2 and VSCode, show Shift+Enter instructions if installed
  if (isShiftEnterKeyBindingInstalled()) {
    return 'shift + ⏎ for newline'
  }

  // Otherwise show backslash+return instructions
  return hasUsedBackslashReturn()
    ? '\\⏎ for newline'
    : 'backslash (\\) + return (⏎) for newline'
}

/**
 * True when the keystroke is a printable character that does not begin
 * with whitespace — i.e., a normal letter/digit/symbol the user typed.
 * Used to gate the lazy space inserted after an image pill.
 */
export function isNonSpacePrintable(input: string, key: Key): boolean {
  if (
    key.ctrl ||
    key.meta ||
    key.escape ||
    key.return ||
    key.tab ||
    key.backspace ||
    key.delete ||
    key.upArrow ||
    key.downArrow ||
    key.leftArrow ||
    key.rightArrow ||
    key.pageUp ||
    key.pageDown ||
    key.home ||
    key.end
  ) {
    return false
  }
  return input.length > 0 && !/^\s/.test(input) && !input.startsWith('\x1b')
}

/**
 * Compute NFC-normalized text and cursor offset after inserting `text` at
 * `cursorOffset` in `currentInput`. Prevents macOS NFD accented text (e.g.
 * filenames) from advancing the cursor one character too far after NFC folding.
 */
export function computeNfcInsertResult(
  currentInput: string,
  cursorOffset: number,
  text: string,
): { newInput: string; newOffset: number } {
  const before = currentInput.slice(0, cursorOffset).normalize('NFC')
  const inserted = text.normalize('NFC')
  const after = currentInput.slice(cursorOffset).normalize('NFC')
  const newInput = (before + inserted + after).normalize('NFC')
  const newOffset = Math.max(0, newInput.length - after.length)
  return { newInput, newOffset }
}

/** densable `Koe` — order toasts so managed mods' toasts show ahead of others. */
export function orderToastsForStack<
  T extends {
    id: string
    plugin?: string
    owner?: string
    isManaged?: boolean
  },
>(toasts: readonly T[]): T[] {
  const placeById = new Map(toasts.map((toast, idx) => [toast.id, idx]))
  return [...Map.groupBy(toasts, toast => toast.owner ?? toast.plugin).values()]
    .flatMap(group =>
      group.map((toast, idx) => ({
        toast,
        turn: group.length - idx,
        place: placeById.get(toast.id) ?? 0,
      })),
    )
    .toSorted(
      (a, b) =>
        Number(Boolean(a.toast.isManaged)) -
          Number(Boolean(b.toast.isManaged)) ||
        b.turn - a.turn ||
        a.place - b.place,
    )
    .map(entry => entry.toast)
}
