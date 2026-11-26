import * as React from 'react';
import { useEffect, useState } from 'react';
import { Box, Byline, KeyboardShortcutHint, Text, useInput } from '@anthropic/ink';
import figures from 'figures';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { getBootstrapSessionHost, HostSlot } from '../../utils/sessionHost.js';

export const CLICK_TO_ENTER_GUARD_MS = 350;
export const POST_TRANSITION_ENTER_GUARD_MS = 300;
export const ENTER_REPEAT_COOLDOWN_MS = 350;

const pluginListHelpersHostSlot = new HostSlot<{ lastPluginUiClickAt: number }>(() => ({
  lastPluginUiClickAt: 0,
}));

/**
 * Official 2.1.327 #382: Record a mouse click in `/plugin` (row click, tab click,
 * or pane click) so an immediate Enter doesn't accidentally install or disable
 * a plugin.
 */
export function recordPluginUiClick(now = Date.now()): void {
  pluginListHelpersHostSlot.of(getBootstrapSessionHost()).lastPluginUiClickAt = now;
}

export function getLastPluginUiClickAt(): number {
  return pluginListHelpersHostSlot.of(getBootstrapSessionHost()).lastPluginUiClickAt;
}

export function resetPluginUiClickForTests(): void {
  pluginListHelpersHostSlot.of(getBootstrapSessionHost()).lastPluginUiClickAt = 0;
}

/**
 * Official 2.1.327 #382 & 2.1.328 #617: Guard `/plugin` Enter actions against
 * (a) a click followed immediately by Enter,
 * (b) a held/repeated Enter right after transitioning into a details view,
 * (c) rapid key-repeat Enter bursts turning off several plugins in a row, and
 * (d) duplicate triggers while an async operation is already running.
 */
export function shouldIgnorePluginEnterAction(params: {
  now?: number;
  lastClickAt?: number;
  lastTransitionAt?: number;
  lastAcceptAt?: number;
  isBusy?: boolean;
  isRepeat?: boolean;
  clickGuardMs?: number;
  transitionGuardMs?: number;
  repeatCooldownMs?: number;
}): boolean {
  const now = params.now ?? Date.now();
  if (params.isBusy) return true;
  if (params.isRepeat) return true;
  const clickGuard = params.clickGuardMs ?? CLICK_TO_ENTER_GUARD_MS;
  const lastClick = params.lastClickAt ?? getLastPluginUiClickAt();
  if (lastClick > 0 && now - lastClick >= 0 && now - lastClick < clickGuard) {
    return true;
  }
  const transitionGuard = params.transitionGuardMs ?? POST_TRANSITION_ENTER_GUARD_MS;
  if (
    params.lastTransitionAt &&
    params.lastTransitionAt > 0 &&
    now - params.lastTransitionAt >= 0 &&
    now - params.lastTransitionAt < transitionGuard
  ) {
    return true;
  }
  const repeatCooldown = params.repeatCooldownMs ?? ENTER_REPEAT_COOLDOWN_MS;
  if (
    params.lastAcceptAt &&
    params.lastAcceptAt > 0 &&
    now - params.lastAcceptAt >= 0 &&
    now - params.lastAcceptAt < repeatCooldown
  ) {
    return true;
  }
  return false;
}

/**
 * Official 2.1.327 #410: Strip raw control characters from keystroke bursts
 * entering `/plugin` search boxes so escape/control bursts cannot crash or
 * corrupt cursor slicing.
 */
export function sanitizeSearchBurstInput(raw: string): string {
  // Remove C0 control chars and DEL while preserving printable Unicode characters.
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) {
      out += raw[i]!;
    }
  }
  return out;
}

/**
 * Official 2.1.327 #410 & #603: Safely apply a burst of characters into the
 * search query with cursor clamping.
 */
export function applySearchBurstInput(
  currentQuery: string,
  cursorOffset: number,
  rawInput: string,
): { query: string; cursorOffset: number } {
  const safeOffset = Math.max(
    0,
    Math.min(currentQuery.length, Number.isFinite(cursorOffset) ? Math.trunc(cursorOffset) : currentQuery.length),
  );
  const clean = sanitizeSearchBurstInput(rawInput);
  if (!clean) {
    return { query: currentQuery, cursorOffset: safeOffset };
  }
  const nextQuery = currentQuery.slice(0, safeOffset) + clean + currentQuery.slice(safeOffset);
  return { query: nextQuery, cursorOffset: safeOffset + clean.length };
}

/**
 * Official 2.1.328 #614 & #615: Verify that an async plugin save/removal/update
 * still belongs to the currently active view generation and plugin target before
 * mutating view state, opening a confirmation dialog, or closing the open page.
 */
export function isPluginViewOpCurrent(
  currentGen: number,
  opGen: number,
  currentTargetId: string | null,
  opTargetId: string | null,
): boolean {
  if (currentGen !== opGen) return false;
  if (opTargetId !== null && currentTargetId !== opTargetId) return false;
  return true;
}

/**
 * Official 2.1.326 #270 / #272: compute how many list rows fit in the current
 * terminal height so the cursor, scroll cues, and key hints stay on screen even
 * in short windows.
 */
export function computePluginListMaxVisible(
  terminalRows: number,
  chromeRows: number,
  rowsPerItem: number,
  defaultMaxVisible: number,
  minVisible = 1,
): number {
  const safeRows = Number.isFinite(terminalRows) && terminalRows > 0 ? terminalRows : 24;
  const available = Math.max(rowsPerItem, safeRows - chromeRows);
  const fits = Math.floor(available / Math.max(1, rowsPerItem));
  return Math.max(minVisible, Math.min(defaultMaxVisible, fits));
}

/**
 * Official 2.1.326 #271 / #273: clamp long multi-line error strings so they
 * never fill the entire terminal screen.
 */
export function clampMultilineError(
  text: string,
  maxLines = 4,
  maxLineChars = 140,
): { preview: string; truncated: boolean; hiddenLines: number } {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { preview: '', truncated: false, hiddenLines: 0 };
  }
  const rawLines = normalized.split('\n');
  const wrapped: string[] = [];
  for (const line of rawLines) {
    if (line.length <= maxLineChars) {
      wrapped.push(line);
    } else {
      for (let i = 0; i < line.length; i += maxLineChars) {
        wrapped.push(line.slice(i, i + maxLineChars));
      }
    }
  }
  if (wrapped.length <= maxLines) {
    return { preview: wrapped.join('\n'), truncated: false, hiddenLines: 0 };
  }
  const kept = wrapped.slice(0, maxLines);
  const hiddenLines = wrapped.length - maxLines;
  const lastIdx = kept.length - 1;
  kept[lastIdx] = `${kept[lastIdx]!.replace(/\s+$/, '')}…`;
  return {
    preview: kept.join('\n'),
    truncated: true,
    hiddenLines,
  };
}

/**
 * Official 2.1.326 #273: truncate a Stats table cell (e.g. long skill name or
 * source) so rows stay aligned and never wrap/break the table.
 */
export function truncateStatsColumn(value: string, maxWidth: number): string {
  const limit = Math.max(5, maxWidth);
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

/**
 * Official 2.1.326 #270 / #272: compute the next list index for Home, End,
 * PageUp, PageDown, or wheel delta navigation.
 */
export function computeListJumpIndex(
  action: 'home' | 'end' | 'pageUp' | 'pageDown',
  currentIndex: number,
  totalItems: number,
  pageSize: number,
): number {
  if (totalItems <= 0) return 0;
  const last = totalItems - 1;
  const step = Math.max(1, pageSize);
  switch (action) {
    case 'home':
      return 0;
    case 'end':
      return last;
    case 'pageUp':
      return Math.max(0, currentIndex - step);
    case 'pageDown':
      return Math.min(last, currentIndex + step);
  }
}

/**
 * Hook that adds Home, End, PageUp, and PageDown keyboard navigation to `/plugin`
 * lists (official 2.1.326 #270 / #272).
 */
export function usePluginListExtendedKeys(opts: {
  isActive: boolean;
  totalItems: number;
  selectedIndex: number;
  pageSize: number;
  onSelectIndex: (nextIndex: number) => void;
}): void {
  const { isActive, totalItems, selectedIndex, pageSize, onSelectIndex } = opts;
  useInput(
    (_input, key) => {
      if (totalItems <= 0) return;
      if (key.home) {
        onSelectIndex(computeListJumpIndex('home', selectedIndex, totalItems, pageSize));
      } else if (key.end) {
        onSelectIndex(computeListJumpIndex('end', selectedIndex, totalItems, pageSize));
      } else if (key.pageUp) {
        onSelectIndex(computeListJumpIndex('pageUp', selectedIndex, totalItems, pageSize));
      } else if (key.pageDown) {
        onSelectIndex(computeListJumpIndex('pageDown', selectedIndex, totalItems, pageSize));
      }
    },
    { isActive },
  );
}

export type PluginConfirmOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  destructive?: boolean;
};

/**
 * Official 2.1.326 #331 / #271 / #273: arrow-key + Enter / Esc confirmation list
 * replacing `y` / `n` / `u` single-letter prompts for `/plugin` uninstall,
 * remove, and switch questions.
 */
export function PluginConfirmList<T extends string>({
  options,
  onSelect,
  onCancel,
  isDisabled = false,
  initialIndex = 0,
}: {
  options: readonly PluginConfirmOption<T>[];
  onSelect: (value: T) => void;
  onCancel: () => void;
  isDisabled?: boolean;
  initialIndex?: number;
}): React.ReactNode {
  const [cursor, setCursor] = useState(Math.max(0, Math.min(initialIndex, Math.max(0, options.length - 1))));

  useEffect(() => {
    setCursor(prev => Math.max(0, Math.min(prev, Math.max(0, options.length - 1))));
  }, [options.length]);

  useKeybindings(
    {
      'select:previous': () => {
        setCursor(prev => (prev > 0 ? prev - 1 : Math.max(0, options.length - 1)));
      },
      'select:next': () => {
        setCursor(prev => (prev < options.length - 1 ? prev + 1 : 0));
      },
      'select:accept': () => {
        const chosen = options[cursor];
        if (chosen) onSelect(chosen.value);
      },
    },
    { context: 'Select', isActive: !isDisabled && options.length > 0 },
  );

  // Esc cancels; intentionally ignore `y`, `n`, `u` (official 2.1.326 #331).
  useInput(
    (_input, key) => {
      if (key.escape) {
        onCancel();
      }
    },
    { isActive: !isDisabled },
  );

  return (
    <Box flexDirection="column">
      {options.map((opt, idx) => {
        const isSelected = idx === cursor;
        return (
          <Box
            key={opt.value}
            flexDirection="row"
            onClick={() => {
              if (isDisabled) return;
              setCursor(idx);
              onSelect(opt.value);
            }}
          >
            <Text
              color={isSelected ? (opt.destructive ? 'error' : 'suggestion') : opt.destructive ? 'error' : undefined}
              bold={isSelected}
            >
              {isSelected ? `${figures.pointer} ` : '  '}
              {opt.label}
            </Text>
            {opt.description && <Text dimColor> — {opt.description}</Text>}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor italic>
          <Byline>
            <KeyboardShortcutHint shortcut="↑/↓" action="select" />
            <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            <KeyboardShortcutHint shortcut="Esc" action="cancel" />
          </Byline>
        </Text>
      </Box>
    </Box>
  );
}
