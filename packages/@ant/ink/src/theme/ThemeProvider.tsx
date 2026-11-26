import { feature } from 'bun:bundle';
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { hasInkActiveSessionAls, InkHostSlot, inkSessionHost, runWithInkSessionHost } from '../core/instances.js';
import useStdin from '../hooks/use-stdin.js';
import { getSystemThemeName, subscribeSystemTheme, type SystemTheme } from './systemTheme.js';
import {
  getTheme,
  isBuiltinThemeName,
  setCustomThemeOverrides,
  type Theme,
  type ThemeName,
  type ThemeSetting,
} from './theme-types.js';

// -- Config persistence injection --
// Business layer provides these via setThemeConfigCallbacks().
// Boot-time wiring outside ALS sets the process default inherited by all hosts;
// calls inside ALS isolate overrides per host.

type CustomThemeResolver = (setting: string) => {
  base: ThemeName;
  overrides?: Record<string, unknown>;
};

let moduleDefaultLoadTheme: () => ThemeSetting = () => 'dark';
let moduleDefaultSaveTheme: (setting: ThemeSetting) => void = () => {};
/** densable d$e / vKn — resolve custom:slug → base + overrides. */
let moduleDefaultResolveCustomTheme: CustomThemeResolver = setting => ({
  base: setting === 'auto' ? 'dark' : isBuiltinThemeName(setting) ? setting : 'dark',
});

type ThemeCallbacksHostOverride = {
  loadTheme?: () => ThemeSetting;
  saveTheme?: (setting: ThemeSetting) => void;
  resolveCustomTheme?: CustomThemeResolver;
};

const themeCallbacksHostSlot = new InkHostSlot<ThemeCallbacksHostOverride>(() => ({}));

function getLoadThemeCallback(): () => ThemeSetting {
  return themeCallbacksHostSlot.peek()?.loadTheme ?? moduleDefaultLoadTheme;
}

function getSaveThemeCallback(): (setting: ThemeSetting) => void {
  return themeCallbacksHostSlot.peek()?.saveTheme ?? moduleDefaultSaveTheme;
}

function getResolveCustomThemeCallback(): CustomThemeResolver {
  return themeCallbacksHostSlot.peek()?.resolveCustomTheme ?? moduleDefaultResolveCustomTheme;
}

/** Inject config persistence from the business layer. Call once at startup. */
export function setThemeConfigCallbacks(opts: {
  loadTheme: () => ThemeSetting;
  saveTheme: (setting: ThemeSetting) => void;
  resolveCustomTheme?: CustomThemeResolver;
}): void {
  if (hasInkActiveSessionAls()) {
    const slot = themeCallbacksHostSlot.of();
    slot.loadTheme = opts.loadTheme;
    slot.saveTheme = opts.saveTheme;
    if (opts.resolveCustomTheme) {
      slot.resolveCustomTheme = opts.resolveCustomTheme;
    }
  } else {
    moduleDefaultLoadTheme = opts.loadTheme;
    moduleDefaultSaveTheme = opts.saveTheme;
    if (opts.resolveCustomTheme) {
      moduleDefaultResolveCustomTheme = opts.resolveCustomTheme;
    }
    themeCallbacksHostSlot.delete();
  }
}

type ThemeContextValue = {
  /** The saved user preference. May be 'auto'. */
  themeSetting: ThemeSetting;
  setThemeSetting: (setting: ThemeSetting) => void;
  setPreviewTheme: (setting: ThemeSetting) => void;
  savePreview: () => void;
  cancelPreview: () => void;
  /** The resolved theme to render with. Never 'auto'. */
  currentTheme: ThemeName;
  resolvedTheme: Theme;
  activeThemeOverrides: Record<string, unknown> | undefined;
  customThemes?: unknown[];
  activeCustomTheme?: unknown;
  reloadCustomThemes?: () => Promise<void>;
  setPreviewOverrides: (overrides: Record<string, unknown> | null) => void;
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
  activeThemeOverrides: undefined,
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
  return getLoadThemeCallback()();
}

function defaultSaveTheme(setting: ThemeSetting): void {
  getSaveThemeCallback()(setting);
}

export function ThemeProvider({ children, initialState, onThemeSave = defaultSaveTheme }: Props) {
  const [mountedHost] = useState(() => inkSessionHost());
  const [themeSetting, setThemeSetting] = useState(initialState ?? defaultInitialTheme);
  const [previewTheme, setPreviewTheme] = useState<ThemeSetting | null>(null);
  const [previewOverrides, setPreviewOverrides] = useState<Record<string, unknown> | null>(null);

  // densable C7t: `[ht,V]=g(()=>(i??T)==="auto"?Zle():"dark")` then
  // `Re=()=>{if(m!=="auto")return; return V(Zle()),jat(()=>V(Zle()))}`.
  // Seed from Zle (COLORFGBG / OSC cache) on the first render so warning
  // RGB is already the resolved palette — useLayoutEffect still paints once
  // before running.
  const [systemTheme, setSystemTheme] = useState<SystemTheme>(() =>
    (initialState ?? themeSetting) === 'auto' ? getSystemThemeName() : 'dark',
  );

  // The setting currently in effect (preview wins while picker is open)
  const activeSetting = previewTheme ?? themeSetting;

  const { internal_querier } = useStdin();

  // densable C7t Re: if(m!=="auto") return; V(Zle()); return jat(()=>V(Zle())).
  useLayoutEffect(() => {
    if (activeSetting !== 'auto') return;
    return runWithInkSessionHost(mountedHost, () => {
      setSystemTheme(getSystemThemeName());
      return subscribeSystemTheme(setSystemTheme);
    });
  }, [activeSetting, mountedHost]);

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

  const resolveCustomTheme = runWithInkSessionHost(mountedHost, getResolveCustomThemeCallback);
  const resolvedCustom = useMemo(() => resolveCustomTheme(activeSetting), [activeSetting, resolveCustomTheme]);
  const currentTheme: ThemeName = activeSetting === 'auto' ? systemTheme : resolvedCustom.base;
  const activeThemeOverrides = previewOverrides ?? resolvedCustom.overrides;

  // Official src writes overrides during render so preview is not a frame late.
  runWithInkSessionHost(mountedHost, () => setCustomThemeOverrides(activeThemeOverrides));
  useEffect(() => () => runWithInkSessionHost(mountedHost, () => setCustomThemeOverrides(undefined)), [mountedHost]);

  const resolvedTheme = useMemo(
    () => runWithInkSessionHost(mountedHost, () => getTheme(currentTheme)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mountedHost, currentTheme, activeThemeOverrides],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeSetting,
      setThemeSetting: (newSetting: ThemeSetting) => {
        setThemeSetting(newSetting);
        setPreviewTheme(null);
        // Switching to 'auto' restarts the watcher (activeSetting dep), whose
        // first poll fires immediately. Seed from the cache so the OSC
        // round-trip doesn't flash the wrong palette.
        if (newSetting === 'auto') {
          setSystemTheme(runWithInkSessionHost(mountedHost, getSystemThemeName));
        }
        onThemeSave?.(newSetting);
      },
      setPreviewTheme: (newSetting: ThemeSetting) => {
        setPreviewTheme(newSetting);
        if (newSetting === 'auto') {
          setSystemTheme(runWithInkSessionHost(mountedHost, getSystemThemeName));
        }
      },
      savePreview: () => {
        if (previewTheme !== null) {
          setThemeSetting(previewTheme);
          setPreviewTheme(null);
          onThemeSave?.(previewTheme);
        }
      },
      cancelPreview: () => {
        setPreviewTheme(null);
      },
      currentTheme,
      resolvedTheme,
      activeThemeOverrides,
      customThemes: [],
      activeCustomTheme: undefined,
      reloadCustomThemes: () => Promise.resolve(),
      setPreviewOverrides,
    }),
    [mountedHost, themeSetting, previewTheme, currentTheme, resolvedTheme, activeThemeOverrides, onThemeSave],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Returns the resolved theme for rendering (never 'auto') and a setter that
 * accepts any ThemeSetting (including 'auto').
 */
export function useTheme(): [ThemeName, (setting: ThemeSetting) => void] {
  const { currentTheme, setThemeSetting } = useContext(ThemeContext);
  return [currentTheme, setThemeSetting];
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

export function useResolvedTheme(): Theme {
  return useContext(ThemeContext).resolvedTheme;
}

export function useActiveThemeOverrides(): Record<string, unknown> | undefined {
  return useContext(ThemeContext).activeThemeOverrides;
}
