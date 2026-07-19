import { feature } from 'bun:bundle';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import useStdin from '../hooks/use-stdin.js';
import {
  applyThemeOverrides,
  getCachedCustomThemes,
  loadCustomThemes,
  parseCustomThemeRef,
  type CustomTheme,
} from './customThemes.js';
import { getSystemThemeName, type SystemTheme } from './systemTheme.js';
import { getTheme, isThemeName, type Theme, type ThemeName, type ThemeSetting } from './theme-types.js';

// -- Config persistence injection --
// Business layer provides these via setThemeConfigCallbacks().
// Defaults read/write from a simple module-level store.

let _loadTheme: () => ThemeSetting = () => 'dark';
let _saveTheme: (setting: ThemeSetting) => void = () => {};

/** Inject config persistence from the business layer. Call once at startup. */
export function setThemeConfigCallbacks(opts: {
  loadTheme: () => ThemeSetting;
  saveTheme: (setting: ThemeSetting) => void;
}): void {
  _loadTheme = opts.loadTheme;
  _saveTheme = opts.saveTheme;
}

type ThemeContextValue = {
  /** The saved user preference. May be 'auto' or custom:<slug>. */
  themeSetting: ThemeSetting;
  setThemeSetting: (setting: ThemeSetting) => void;
  setPreviewTheme: (setting: ThemeSetting) => void;
  savePreview: () => void;
  cancelPreview: () => void;
  /**
   * densable currentTheme / u9r — base ThemeName used for non-override paths.
   * For custom themes this is the theme's `base` preset, never `custom:…`.
   */
  currentTheme: ThemeName;
  /** densable resolvedTheme / Aiu — palette with custom overrides applied. */
  resolvedTheme: Theme;
  /** densable customThemes — user (+ plugin) loaded themes. */
  customThemes: CustomTheme[];
  /** densable activeCustomTheme when setting is custom:<slug>. */
  activeCustomTheme: CustomTheme | undefined;
  reloadCustomThemes: () => Promise<void>;
  /** densable setPreviewOverrides — live color edits in the custom theme editor. */
  setPreviewOverrides: (overrides: Partial<Record<keyof Theme, string>> | null) => void;
};

// Non-'auto' default so useTheme() works without a provider (tests, tooling).
const DEFAULT_THEME: ThemeName = 'dark';

const ThemeContext = createContext<ThemeContextValue>({
  themeSetting: DEFAULT_THEME,
  setThemeSetting: () => {},
  setPreviewTheme: () => {},
  savePreview: () => {},
  cancelPreview: () => {},
  currentTheme: DEFAULT_THEME,
  resolvedTheme: getTheme(DEFAULT_THEME),
  customThemes: [],
  activeCustomTheme: undefined,
  reloadCustomThemes: () => Promise.resolve(),
  setPreviewOverrides: () => {},
});

type Props = {
  children: React.ReactNode;
  initialState?: ThemeSetting;
  onThemeSave?: (setting: ThemeSetting) => void;
};

function defaultInitialTheme(): ThemeSetting {
  return _loadTheme();
}

function defaultSaveTheme(setting: ThemeSetting): void {
  _saveTheme(setting);
}

export function ThemeProvider({ children, initialState, onThemeSave = defaultSaveTheme }: Props) {
  const [themeSetting, setThemeSettingState] = useState(initialState ?? defaultInitialTheme);
  const [previewTheme, setPreviewThemeState] = useState<ThemeSetting | null>(null);
  const [previewOverrides, setPreviewOverridesState] = useState<Partial<Record<keyof Theme, string>> | null>(null);
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>(() => getCachedCustomThemes());

  // Track terminal theme for 'auto' resolution. Seeds from $COLORFGBG (or
  // 'dark' if unset); the OSC 11 watcher corrects it on first poll.
  const [systemTheme, setSystemTheme] = useState<SystemTheme>(() =>
    (initialState ?? themeSetting) === 'auto' ? getSystemThemeName() : 'dark',
  );

  // The setting currently in effect (preview wins while picker is open)
  const activeSetting = previewTheme ?? themeSetting;

  const { internal_querier } = useStdin();

  const reloadCustomThemes = useCallback(async () => {
    const loaded = await loadCustomThemes();
    setCustomThemes(loaded);
  }, []);

  // densable: load + shallow watch of themes dir on mount
  useEffect(() => {
    void reloadCustomThemes();
    // Lightweight poll instead of chokidar (densable uses chokidar) — enough
    // for editor save → picker list refresh in-process; reloadCustomThemes is
    // also called explicitly after save.
  }, [reloadCustomThemes]);

  // Watch for live terminal theme changes while 'auto' is active.
  // Positive feature() pattern so the watcher import is dead-code-eliminated
  // in external builds.
  useEffect(() => {
    if (feature('AUTO_THEME')) {
      if (activeSetting !== 'auto' || !internal_querier) return;
      let cleanup: (() => void) | undefined;
      let cancelled = false;
      void import('../../utils/systemThemeWatcher.js').then(({ watchSystemTheme }) => {
        if (cancelled) return;
        cleanup = watchSystemTheme(internal_querier, setSystemTheme);
      });
      return () => {
        cancelled = true;
        cleanup?.();
      };
    }
  }, [activeSetting, internal_querier]);

  const customSlug = parseCustomThemeRef(String(activeSetting));
  // Prefer React state; fall back to module cache so editor save → finish
  // (reload + clear preview in one tick) never flashes the base palette when
  // setCustomThemes has not yet re-rendered but saveCustomTheme already
  // updated getCachedCustomThemes().
  const activeCustomTheme = customSlug
    ? (customThemes.find(t => t.slug === customSlug) ?? getCachedCustomThemes().find(t => t.slug === customSlug))
    : undefined;

  // densable u9r: base name for palette lookup
  let currentTheme: ThemeName = 'dark';
  if (activeCustomTheme) {
    currentTheme = activeCustomTheme.base;
  } else if (activeSetting === 'auto') {
    currentTheme = systemTheme;
  } else if (isThemeName(String(activeSetting))) {
    currentTheme = String(activeSetting) as ThemeName;
  }

  const resolvedTheme = useMemo(
    () => applyThemeOverrides(getTheme(currentTheme), previewOverrides ?? activeCustomTheme?.overrides),
    [currentTheme, previewOverrides, activeCustomTheme?.overrides],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeSetting,
      setThemeSetting: (newSetting: ThemeSetting) => {
        setThemeSettingState(newSetting);
        setPreviewThemeState(null);
        setPreviewOverridesState(null);
        if (newSetting === 'auto') {
          setSystemTheme(getSystemThemeName());
        }
        onThemeSave?.(newSetting);
      },
      setPreviewTheme: (newSetting: ThemeSetting) => {
        setPreviewThemeState(newSetting);
        setPreviewOverridesState(null);
        if (newSetting === 'auto') {
          setSystemTheme(getSystemThemeName());
        }
      },
      savePreview: () => {
        if (previewTheme !== null) {
          setThemeSettingState(previewTheme);
          setPreviewThemeState(null);
          onThemeSave?.(previewTheme);
        }
      },
      cancelPreview: () => {
        if (previewTheme !== null) {
          setPreviewThemeState(null);
        }
        setPreviewOverridesState(null);
      },
      currentTheme,
      resolvedTheme,
      customThemes,
      activeCustomTheme,
      reloadCustomThemes,
      setPreviewOverrides: overrides => {
        setPreviewOverridesState(overrides);
      },
    }),
    [
      themeSetting,
      previewTheme,
      currentTheme,
      resolvedTheme,
      customThemes,
      activeCustomTheme,
      reloadCustomThemes,
      onThemeSave,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Returns the resolved base theme name for rendering (never 'auto'/custom:)
 * and a setter that accepts any ThemeSetting (including 'auto' / custom:).
 */
export function useTheme(): [ThemeName, (setting: ThemeSetting) => void] {
  const { currentTheme, setThemeSetting } = useContext(ThemeContext);
  return [currentTheme, setThemeSetting];
}

/**
 * densable HL — full palette with custom overrides. Prefer this for color
 * resolution when custom themes are active.
 */
export function useResolvedTheme(): Theme {
  return useContext(ThemeContext).resolvedTheme;
}

/**
 * Returns the raw theme setting as stored in config. Use this in UI that
 * needs to show 'auto' as a distinct choice (e.g., ThemePicker).
 */
export function useThemeSetting(): ThemeSetting {
  return useContext(ThemeContext).themeSetting;
}

export function usePreviewTheme() {
  const { setPreviewTheme, savePreview, cancelPreview } = useContext(ThemeContext);
  return { setPreviewTheme, savePreview, cancelPreview };
}

/** densable dge — custom theme list + editor hooks. */
export function useCustomThemes(): {
  customThemes: CustomTheme[];
  activeCustomTheme: CustomTheme | undefined;
  reloadCustomThemes: () => Promise<void>;
  setPreviewOverrides: (overrides: Partial<Record<keyof Theme, string>> | null) => void;
} {
  const { customThemes, activeCustomTheme, reloadCustomThemes, setPreviewOverrides } = useContext(ThemeContext);
  return {
    customThemes,
    activeCustomTheme,
    reloadCustomThemes,
    setPreviewOverrides,
  };
}
