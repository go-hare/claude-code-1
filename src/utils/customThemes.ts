/**
 * densable 2.1.239 #27 — custom themes under ~/.claude/themes/*.json.
 *
 * Official: k2t / e5 / HKa / Ghf / I8r / d$e / ZGn / wNe.
 * v5 userConfigDir path is omitted (tip has no $t() storage host).
 */
import { readdir, readFile, stat } from 'fs/promises'
import { basename, extname, join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { toError } from './errors.js'
import { logForDebugging } from './debug.js'
import { getBootstrapSessionHost, HostSlot } from './sessionHost.js'
import { jsonParse } from './slowOperations.js'
import {
  CUSTOM_THEME_PREFIX,
  getTheme,
  isBuiltinThemeName,
  isValidThemeColor,
  type ThemeName,
  type ThemeSetting,
} from './theme.js'

/** densable Whf */
const MAX_THEME_JSON_BYTES = 262144

export type CustomThemeSource = 'user' | { plugin: string }

export type CustomTheme = {
  slug: string
  name: string
  base: ThemeName
  overrides: Record<string, string>
  source: CustomThemeSource
}

type CustomThemesHostState = {
  cachedUserThemes: CustomTheme[]
  cachedPluginThemes: CustomTheme[]
}

const customThemesHostSlot = new HostSlot<CustomThemesHostState>(() => ({
  cachedUserThemes: [],
  cachedPluginThemes: [],
}))

function getCustomThemesHostState(): CustomThemesHostState {
  return customThemesHostSlot.of(getBootstrapSessionHost())
}

/** densable k2t */
export function getThemesDir(): string {
  return join(getClaudeConfigHomeDir(), 'themes')
}

/** densable e5 */
export function parseCustomThemeRef(setting: string): string | null {
  return setting.startsWith(CUSTOM_THEME_PREFIX)
    ? setting.slice(CUSTOM_THEME_PREFIX.length)
    : null
}

export function customThemeSetting(slug: string): ThemeSetting {
  return `${CUSTOM_THEME_PREFIX}${slug}`
}

/** densable HKa */
export function parseCustomThemeJson(
  slug: string,
  raw: string,
  source: CustomThemeSource = 'user',
): CustomTheme | undefined {
  let parsed: unknown
  try {
    parsed = jsonParse(raw)
  } catch {
    logForDebugging(`[theme] ${slug}.json: invalid JSON`, { level: 'warn' })
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined
  }
  const obj = parsed as Record<string, unknown>
  const baseName = String(obj.base)
  const base: ThemeName = isBuiltinThemeName(baseName) ? baseName : 'dark'
  const name = typeof obj.name === 'string' ? obj.name : slug
  const overrides: Record<string, string> = {}
  if (typeof obj.overrides === 'object' && obj.overrides !== null) {
    const baseTheme = getTheme(base)
    for (const [key, value] of Object.entries(
      obj.overrides as Record<string, unknown>,
    )) {
      if (Object.hasOwn(baseTheme, key) && isValidThemeColor(value)) {
        overrides[key] = value
      }
    }
  }
  return { slug, name, base, overrides, source }
}

async function readThemeFile(
  path: string,
  slug: string,
  source: CustomThemeSource = 'user',
): Promise<CustomTheme | undefined> {
  try {
    const st = await stat(path)
    if (st.size > MAX_THEME_JSON_BYTES) {
      logForDebugging(`[theme] ${path} exceeds 256KB; skipping`, {
        level: 'warn',
      })
      return undefined
    }
    const raw = await readFile(path, 'utf8')
    return parseCustomThemeJson(slug, raw, source)
  } catch (e) {
    const err = toError(e)
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logForDebugging(`[theme] failed to read ${path}: ${err.message}`, {
        level: 'warn',
      })
    }
    return undefined
  }
}

/** densable Ghf user-dir fs path (no v5 listEntries). */
export async function loadCustomThemes(): Promise<CustomTheme[]> {
  const state = getCustomThemesHostState()
  const dir = getThemesDir()
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      logForDebugging(`[theme] readdir ${dir} failed`, { level: 'warn' })
    }
    state.cachedUserThemes = []
    return state.cachedUserThemes
  }
  const loaded: CustomTheme[] = []
  for (const name of names) {
    if (extname(name) !== '.json') continue
    const slug = basename(name, '.json')
    const theme = await readThemeFile(join(dir, name), slug)
    if (theme) loaded.push(theme)
  }
  loaded.sort((a, b) => a.name.localeCompare(b.name))
  state.cachedUserThemes = loaded
  return state.cachedUserThemes
}

/** densable nUn — read themes from a directory (or single .json file). */
async function loadThemesFromPath(
  targetPath: string,
  source: CustomThemeSource,
  slugPrefix = '',
): Promise<CustomTheme[]> {
  let names: string[]
  try {
    names = await readdir(targetPath)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOTDIR') {
      if (extname(targetPath) !== '.json') return []
      const single = await readThemeFile(
        targetPath,
        slugPrefix + basename(targetPath, '.json'),
        source,
      )
      return single ? [single] : []
    }
    if (code !== 'ENOENT') {
      logForDebugging(`[theme] readdir ${targetPath} failed`, { level: 'warn' })
    }
    return []
  }
  const loaded: CustomTheme[] = []
  for (const name of names) {
    if (extname(name) !== '.json') continue
    const slug = slugPrefix + basename(name, '.json')
    const theme = await readThemeFile(join(targetPath, name), slug, source)
    if (theme) loaded.push(theme)
  }
  return loaded
}

/** densable xRe / Mpt — load custom themes from enabled plugins. */
export async function loadPluginCustomThemes(
  plugins: ReadonlyArray<{
    name: string
    themesPath?: string
    themesPaths?: readonly string[]
  }>,
): Promise<CustomTheme[]> {
  const state = getCustomThemesHostState()
  const loaded: CustomTheme[] = []
  for (const plugin of plugins) {
    const source: CustomThemeSource = { plugin: plugin.name }
    const prefix = `${plugin.name}:`
    if (plugin.themesPath) {
      loaded.push(
        ...(await loadThemesFromPath(plugin.themesPath, source, prefix)),
      )
    }
    for (const path of plugin.themesPaths ?? []) {
      loaded.push(...(await loadThemesFromPath(path, source, prefix)))
    }
  }
  loaded.sort((a, b) => a.name.localeCompare(b.name))
  state.cachedPluginThemes = loaded
  return state.cachedPluginThemes
}

export function setCachedPluginThemes(themes: readonly CustomTheme[]): void {
  getCustomThemesHostState().cachedPluginThemes = [...themes]
}

export function getCachedPluginThemes(): CustomTheme[] {
  return (
    customThemesHostSlot.peek(getBootstrapSessionHost())?.cachedPluginThemes ??
    []
  )
}

/** densable BTi / ele().customThemes — user themes followed by plugin themes. */
export function getCachedCustomThemes(): CustomTheme[] {
  const state = customThemesHostSlot.peek(getBootstrapSessionHost())
  if (!state) return []
  return state.cachedPluginThemes.length === 0
    ? state.cachedUserThemes
    : [...state.cachedUserThemes, ...state.cachedPluginThemes]
}

/** densable DKa / skr */
export function findCustomTheme(slug: string): CustomTheme | undefined {
  const state = customThemesHostSlot.peek(getBootstrapSessionHost())
  if (!state) return undefined
  return (
    state.cachedUserThemes.find(t => t.slug === slug) ??
    state.cachedPluginThemes.find(t => t.slug === slug)
  )
}

/**
 * densable vKn + d$e inputs — base palette + overrides for a setting.
 * `auto` is resolved by ThemeProvider (system theme), not here.
 */
export function resolveCustomThemeSetting(setting: string): {
  base: ThemeName
  overrides?: Record<string, string>
} {
  if (setting === 'auto') {
    return { base: 'dark' }
  }
  if (isBuiltinThemeName(setting)) {
    return { base: setting }
  }
  const slug = parseCustomThemeRef(setting)
  if (!slug) return { base: 'dark' }
  const custom = findCustomTheme(slug)
  if (!custom) return { base: 'dark' }
  return { base: custom.base, overrides: custom.overrides }
}
