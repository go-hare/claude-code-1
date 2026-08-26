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

export type CustomTheme = {
  slug: string
  name: string
  base: ThemeName
  overrides: Record<string, string>
  source: 'user'
}

let cachedUserThemes: CustomTheme[] = []

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
  source: 'user' = 'user',
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
    return parseCustomThemeJson(slug, raw, 'user')
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
  const dir = getThemesDir()
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      logForDebugging(`[theme] readdir ${dir} failed`, { level: 'warn' })
    }
    cachedUserThemes = []
    return cachedUserThemes
  }
  const loaded: CustomTheme[] = []
  for (const name of names) {
    if (extname(name) !== '.json') continue
    const slug = basename(name, '.json')
    const theme = await readThemeFile(join(dir, name), slug)
    if (theme) loaded.push(theme)
  }
  loaded.sort((a, b) => a.name.localeCompare(b.name))
  cachedUserThemes = loaded
  return cachedUserThemes
}

/** densable BTi */
export function getCachedCustomThemes(): CustomTheme[] {
  return cachedUserThemes
}

/** densable DKa */
export function findCustomTheme(slug: string): CustomTheme | undefined {
  return cachedUserThemes.find(t => t.slug === slug)
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
