import * as React from 'react';
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import figures from 'figures';
import {
  Box,
  StatusIcon,
  Text,
  stringWidth,
  useApp,
  useInput,
  usePreviewTheme,
  useTheme,
  useThemeSetting,
  type DOMElement,
} from '@anthropic/ink';
import { useOptionalKeybindingContext, useRegisterKeybindingContext } from '../keybindings/KeybindingContext.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import { gracefulShutdown } from '../utils/gracefulShutdown.js';
import { updateSettingsForSource } from '../utils/settings/settings.js';
import { getCachedCustomThemes, parseCustomThemeRef, type CustomTheme } from '../utils/customThemes.js';
import type { ThemeSetting } from '../utils/theme.js';
import { CUSTOM_THEME_PREFIX } from '../utils/theme.js';
import { ItemList } from './ItemList.js';
import {
  KVeReserveContext,
  LeftoverModalHostContext,
  RowsHostContext,
  LEFTOVER_LIST_RESERVE,
  leftoverChromeQ,
} from './FullscreenLayout.js';
import { Byline, KeyboardShortcutHint } from '@anthropic/ink';
import { PermissionOverflowBox } from './permissions/PermissionOverflowBox.js';
import { getColorModuleUnavailableReason, getSyntaxTheme } from './StructuredDiff/colorDiff.js';
import { StructuredDiff } from './StructuredDiff.js';

export type ThemePickerProps = {
  onThemeSelect: (setting: ThemeSetting) => void;
  showIntroText?: boolean;
  helpText?: string;
  showHelpTextBelow?: boolean;
  hideEscToCancel?: boolean;
  /** Skip exit handling when running in a context that already has it (e.g., onboarding) */
  skipExitHandling?: boolean;
  /** Called when the user cancels (presses Escape). If skipExitHandling is true and this is provided, it will be called instead of just saving the preview. */
  onCancel?: () => void;
  /**
   * densable 2.1.289 onCustomTheme: when set, appends `New custom theme…`.
   * /theme passes a handler so the extra item is listed (create UI may no-op).
   */
  onCustomTheme?: (theme?: CustomTheme) => void;
};

export function ThemePicker({
  onThemeSelect,
  showIntroText = false,
  helpText = '',
  showHelpTextBelow = false,
  hideEscToCancel = false,
  skipExitHandling = false,
  onCancel: onCancelProp,
  onCustomTheme,
}: ThemePickerProps): React.ReactNode {
  const [theme] = useTheme();
  const themeSetting = useThemeSetting();
  const { columns, rows } = useTerminalSize();
  const colorModuleUnavailableReason = getColorModuleUnavailableReason();
  const syntaxTheme = colorModuleUnavailableReason === null ? getSyntaxTheme(theme) : null;
  const { setPreviewTheme, savePreview, cancelPreview } = usePreviewTheme();
  React.useEffect(() => () => cancelPreview(), [cancelPreview]);
  const syntaxHighlightingDisabled = useAppState(s => s.settings.syntaxHighlightingDisabled) ?? false;
  const setAppState = useSetAppState();
  const keybindingContext = useOptionalKeybindingContext();

  // Register ThemePicker context so its keybindings take precedence over Global
  useRegisterKeybindingContext('ThemePicker');

  const syntaxToggleShortcut = useShortcutDisplay('theme:toggleSyntaxHighlighting', 'ThemePicker', 'ctrl+t');
  const editCustomShortcut = useShortcutDisplay('theme:editCustom', 'ThemePicker', 'ctrl+e');
  const cancelTheme = skipExitHandling
    ? () => {
        cancelPreview();
        onCancelProp?.();
      }
    : () => {
        cancelPreview();
        void gracefulShutdown(0);
      };
  useKeybinding('select:cancel', cancelTheme, { context: 'Select' });

  useKeybinding(
    'theme:toggleSyntaxHighlighting',
    () => {
      if (colorModuleUnavailableReason === null) {
        const newValue = !syntaxHighlightingDisabled;
        updateSettingsForSource('userSettings', {
          syntaxHighlightingDisabled: newValue,
        });
        setAppState(prev => ({
          ...prev,
          settings: { ...prev.settings, syntaxHighlightingDisabled: newValue },
        }));
      }
    },
    { context: 'ThemePicker' },
  );
  // Always call the hook to follow React rules, but conditionally assign the exit handler
  const exitState = useExitOnCtrlCDWithKeybindings(skipExitHandling ? () => {} : undefined);

  const NEW_CUSTOM_THEME = '__new_custom_theme__';
  const customThemes = getCachedCustomThemes();
  const themeChoices: {
    label: string;
    origin?: string;
    value: ThemeSetting | typeof NEW_CUSTOM_THEME;
  }[] = [
    { label: 'Auto (match terminal)', value: 'auto' },
    { label: 'Dark mode', value: 'dark' },
    { label: 'Light mode', value: 'light' },
    {
      label: 'Dark mode (colorblind-friendly)',
      value: 'dark-daltonized',
    },
    {
      label: 'Light mode (colorblind-friendly)',
      value: 'light-daltonized',
    },
    {
      label: 'Dark mode (ANSI colors only)',
      value: 'dark-ansi',
    },
    {
      label: 'Light mode (ANSI colors only)',
      value: 'light-ansi',
    },
    ...customThemes.map(t => ({
      label: t.name,
      origin: t.source === 'user' ? 'custom' : `from ${t.source.plugin}`,
      value: `${CUSTOM_THEME_PREFIX}${t.slug}` as ThemeSetting,
    })),
    ...(onCustomTheme
      ? [{ label: 'New custom theme…', value: NEW_CUSTOM_THEME as ThemeSetting | typeof NEW_CUSTOM_THEME }]
      : []),
  ];
  const savedIndex = themeChoices.findIndex(opt => opt.value === themeSetting);
  const [focusedValue, setFocusedValue] = React.useState<string | undefined>(
    themeChoices[Math.max(0, savedIndex)]?.value ?? themeSetting,
  );
  const [userMovedFocus, setUserMovedFocus] = React.useState(false);
  const [onSavedTheme, setOnSavedTheme] = React.useState(savedIndex !== -1);
  if (!onSavedTheme && !userMovedFocus && savedIndex !== -1) {
    setOnSavedTheme(true);
    setFocusedValue(themeSetting);
  }
  // densable XR + C.find(slug): ctrl+e only when custom:<slug> is a saved theme.
  const focusedSlug = typeof focusedValue === 'string' ? parseCustomThemeRef(focusedValue) : null;
  const focusedCustomTheme = focusedSlug !== null ? customThemes.find(theme => theme.slug === focusedSlug) : undefined;
  const editingCustom = focusedCustomTheme !== undefined;
  const editCustomTheme = () => {
    if (focusedCustomTheme && onCustomTheme) {
      savePreview();
      onCustomTheme(focusedCustomTheme);
    }
  };
  useKeybinding('theme:editCustom', editCustomTheme, { context: 'ThemePicker' });
  useInput(
    (input, key, event) => {
      if (
        key.ctrl &&
        input === 'e' &&
        keybindingContext?.getDisplayText('theme:editCustom', 'ThemePicker') === undefined
      ) {
        editCustomTheme();
        event.stopImmediatePropagation();
      }
    },
    { isActive: editingCustom && Boolean(onCustomTheme) },
  );
  // densable `sst()` — blank icon is as wide as the widest status glyph.
  const blankIcon = ' '.repeat(Math.max(1, stringWidth(figures.tick), stringWidth(figures.cross)));
  const themeOptions = themeChoices.map(opt => ({
    label: opt.label,
    value: opt.value,
    icon:
      opt.value === themeSetting ? (
        <StatusIcon status="success" aria-label="current:" />
      ) : (
        <Text aria-hidden>{blankIcon}</Text>
      ),
    facts: opt.origin === undefined ? undefined : [opt.origin],
  }));
  const listKey = onSavedTheme ? 'on-saved-theme' : 'on-first-theme';
  const defaultFocusIndex = Math.max(0, savedIndex);

  // densable NCe `ZV` — list box vs KVe/root. Added to reserve, not a shrink.
  const measureRef = React.useRef<DOMElement | null>(null);
  const leftoverHost = React.useContext(LeftoverModalHostContext);
  const leftoverHostRef = React.useRef(leftoverHost);
  leftoverHostRef.current = leftoverHost;
  const { subscribeLayout } = useApp();
  const readChrome = React.useCallback(() => {
    const host = leftoverHostRef.current;
    return Math.max(0, leftoverChromeQ(measureRef.current, host?.box.current ?? null, host === null) ?? 0);
  }, []);
  const measuredChrome = React.useSyncExternalStore(subscribeLayout, readChrome, () => 0);
  const content = (
    <Box ref={measureRef} flexDirection="column" gap={1}>
      <Box flexDirection="column" gap={1}>
        {showIntroText ? (
          <Text>Let&apos;s get started.</Text>
        ) : (
          <Text bold color="permission">
            Theme
          </Text>
        )}
        <Box flexDirection="column">
          <Text bold>Choose the text style that looks best with your terminal</Text>
          {helpText && !showHelpTextBelow && <Text dimColor>{helpText}</Text>}
        </Box>
        {/* hideIndexes: nn.Item has no index column. Gold nn does not pass visibleCount. */}
        <ItemList
          key={listKey}
          options={themeOptions}
          defaultFocusIndex={defaultFocusIndex}
          onFocus={index => {
            const setting = themeOptions[index]?.value;
            if (setting === undefined || setting === focusedValue) return;
            setFocusedValue(setting);
            setUserMovedFocus(true);
            if (setting === NEW_CUSTOM_THEME) {
              cancelPreview();
              return;
            }
            setPreviewTheme(setting as ThemeSetting);
          }}
          onSelect={index => {
            const setting = themeOptions[index]?.value;
            if (setting === undefined) return;
            if (setting === NEW_CUSTOM_THEME) {
              cancelPreview();
              onCustomTheme?.(undefined);
              return;
            }
            savePreview();
            onThemeSelect(setting as ThemeSetting);
          }}
        />
      </Box>
      <Box flexDirection="column" width="100%">
        <PermissionOverflowBox paddingX={0}>
          <StructuredDiff
            patch={{
              oldStart: 1,
              newStart: 1,
              oldLines: 3,
              newLines: 3,
              lines: [
                ' function greet() {',
                '-  console.log("Hello, World!");',
                '+  console.log("Hello, Claude!");',
                ' }',
              ],
            }}
            dim={false}
            filePath="demo.js"
            firstLine={null}
            width={Math.max(0, columns - 6)}
          />
        </PermissionOverflowBox>
        <Text dimColor>
          {' '}
          {colorModuleUnavailableReason === 'env'
            ? `Syntax highlighting disabled (via CLAUDE_CODE_SYNTAX_HIGHLIGHT=${process.env.CLAUDE_CODE_SYNTAX_HIGHLIGHT})`
            : syntaxHighlightingDisabled
              ? `Syntax highlighting disabled (${syntaxToggleShortcut} to enable)`
              : syntaxTheme
                ? `Syntax theme: ${syntaxTheme.theme}${syntaxTheme.source ? ` (from ${syntaxTheme.source})` : ''} (${syntaxToggleShortcut} to disable)`
                : `Syntax highlighting enabled (${syntaxToggleShortcut} to disable)`}
        </Text>
      </Box>
    </Box>
  );

  // densable NCe: footer is outside the measured box. `ee` is that chrome
  // when not intro; hideEsc adds one more row. Both go into KVe reserve.
  const footerChrome = showIntroText ? 0 : measuredChrome + (hideEscToCancel ? 1 : 0);
  const hostRows = leftoverHost === null ? undefined : Math.max(0, (leftoverHost.rows ?? rows) - footerChrome);
  const reserve = LEFTOVER_LIST_RESERVE + footerChrome;
  const footer = !showIntroText && (
    <Box marginTop={1}>
      {showHelpTextBelow && helpText && (
        <Box marginLeft={3}>
          <Text dimColor>{helpText}</Text>
        </Box>
      )}
      {!hideEscToCancel && (
        <Box>
          <Text dimColor italic>
            {exitState.pending ? (
              <>
                Press {exitState.keyName} again to {skipExitHandling ? 'cancel' : 'exit'}
              </>
            ) : (
              <Byline>
                <KeyboardShortcutHint shortcut="Enter" action="select" />
                {editingCustom && onCustomTheme ? (
                  <KeyboardShortcutHint shortcut={editCustomShortcut} action="edit" />
                ) : null}
                <KeyboardShortcutHint shortcut="Esc" action="cancel" />
              </Byline>
            )}
          </Text>
        </Box>
      )}
    </Box>
  );
  return (
    <RowsHost rows={hostRows}>
      <KVeHost reserve={reserve}>
        {content}
        {footer}
      </KVeHost>
    </RowsHost>
  );
}

/** densable `W_` — parent sees `rows` minus measured chrome. */
function RowsHost({ rows, children }: { rows: number | undefined; children: React.ReactNode }): React.ReactNode {
  const parent = React.useContext(LeftoverModalHostContext);
  const box = React.useRef<DOMElement | null>(null);
  const { rows: terminalRows } = useTerminalSize();
  const published = rows ?? terminalRows;
  const host = parent === null ? { box, rows: published } : { ...parent, box, rows: published };
  return (
    <RowsHostContext value={host}>
      <Box ref={box} flexDirection="column">
        {children}
      </Box>
    </RowsHostContext>
  );
}

/** densable `KVe` — `{box, rows, reserve}`. Rows come from the surrounding host (`Bo`), not a fresh terminal read. */
function KVeHost({ reserve, children }: { reserve: number; children: React.ReactNode }): React.ReactNode {
  const box = React.useRef<DOMElement | null>(null);
  const parent = React.useContext(LeftoverModalHostContext);
  const reduced = React.useContext(RowsHostContext);
  const { rows: terminalRows } = useTerminalSize();
  const rows = reduced?.rows ?? parent?.rows ?? terminalRows;
  const reserveHost = React.useMemo(() => ({ box, rows, reserve }), [rows, reserve]);
  // densable `Ue` never writes the rows host. Rows stay on `W_` / the
  // surrounding LeftoverModalHostContext.
  return (
    <KVeReserveContext value={reserveHost}>
      <Box ref={box} flexDirection="column">
        {children}
      </Box>
    </KVeReserveContext>
  );
}
