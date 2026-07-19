/**
 * densable custom themes (ywe / tiu) — load/save JSON under ~/.claude/themes,
 * validate color overrides, merge onto builtin base palettes.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { homedir } from 'os'
import {
  CUSTOM_THEME_PREFIX,
  getTheme,
  isThemeName,
  type Theme,
  type ThemeName,
} from './theme-types.js'

const MAX_THEME_BYTES = 262_144

export type CustomThemeSource = 'user' | { plugin: string }

export type CustomTheme = {
  slug: string
  name: string
  base: ThemeName
  overrides: Partial<Record<keyof Theme, string>>
  source: CustomThemeSource
}

// ANSI named colors accepted by densable JOe (ansi:name)
const ANSI_COLOR_NAMES = new Set([
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'gray',
  'grey',
  'blackBright',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright',
])

/** densable JOe — valid override color string. */
export function isValidThemeColor(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (/^rgb\(\s?\d{1,3},\s?\d{1,3},\s?\d{1,3}\s?\)$/.test(value)) return true
  if (/^#[0-9a-fA-F]{6}$/.test(value) || /^#[0-9a-fA-F]{3}$/.test(value)) {
    return true
  }
  if (/^ansi256\(\d{1,3}\)$/.test(value)) return true
  if (value.startsWith('ansi:')) return ANSI_COLOR_NAMES.has(value.slice(5))
  return false
}

/** densable Zqi — merge validated overrides onto a base palette. */
export function applyThemeOverrides(
  base: Theme,
  overrides: Partial<Record<keyof Theme, string>> | null | undefined,
): Theme {
  if (!overrides) return base
  const next = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    if (Object.hasOwn(base, key) && isValidThemeColor(value)) {
      ;(next as Record<string, string>)[key] = value
    }
  }
  return next
}

/** densable l8i — slugify theme display name. */
export function slugifyThemeName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'theme'
  )
}

/** densable J7p — unique slug among existing themes. */
export function uniqueThemeSlug(
  name: string,
  existing: readonly { slug: string }[],
): string {
  const base = slugifyThemeName(name)
  if (!existing.some(t => t.slug === base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!existing.some(t => t.slug === candidate)) return candidate
  }
}

export function customThemeRef(
  slug: string,
): `${typeof CUSTOM_THEME_PREFIX}${string}` {
  return `${CUSTOM_THEME_PREFIX}${slug}`
}

export function parseCustomThemeRef(setting: string): string | null {
  return setting.startsWith(CUSTOM_THEME_PREFIX)
    ? setting.slice(CUSTOM_THEME_PREFIX.length)
    : null
}

let _getConfigDir: () => string = () =>
  (process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')).normalize('NFC')

/** Inject config home from the business layer (src getClaudeConfigHomeDir). */
export function setCustomThemesConfigDir(getDir: () => string): void {
  _getConfigDir = getDir
}

/** densable g0t */
export function getThemesDir(): string {
  return join(_getConfigDir(), 'themes')
}

// Base cache by slug (densable o9r) — used when resolving custom: refs before full list reload
let baseCache: Map<string, ThemeName> | undefined
let cachedThemes: CustomTheme[] | undefined

export function getCustomThemeBase(slug: string): ThemeName | undefined {
  return baseCache?.get(slug)
}

export function addToBaseCache(themes: readonly CustomTheme[]): void {
  baseCache ??= new Map()
  for (const t of themes) baseCache.set(t.slug, t.base)
}

export function getCachedCustomThemes(): CustomTheme[] {
  return cachedThemes ?? []
}

export function _resetCustomThemesCacheForTesting(): void {
  baseCache = undefined
  cachedThemes = undefined
}

function parseThemeJson(
  slug: string,
  raw: string,
  source: CustomThemeSource,
): CustomTheme | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined
  }
  const obj = parsed as Record<string, unknown>
  const base = isThemeName(String(obj.base ?? ''))
    ? (obj.base as ThemeName)
    : 'dark'
  const name = typeof obj.name === 'string' ? obj.name : slug
  const overrides: Partial<Record<keyof Theme, string>> = {}
  if (typeof obj.overrides === 'object' && obj.overrides !== null) {
    const basePalette = getTheme(base)
    for (const [key, value] of Object.entries(
      obj.overrides as Record<string, unknown>,
    )) {
      if (Object.hasOwn(basePalette, key) && isValidThemeColor(value)) {
        overrides[key as keyof Theme] = value
      }
    }
  }
  return { slug, name, base, overrides, source }
}

async function readThemeFile(
  path: string,
  slug: string,
  source: CustomThemeSource,
): Promise<CustomTheme | undefined> {
  try {
    const st = await stat(path)
    if (st.size > MAX_THEME_BYTES) return undefined
    const raw = await readFile(path, 'utf8')
    return parseThemeJson(slug, raw, source)
  } catch {
    return undefined
  }
}

/** densable i9r — read all .json themes from a directory. */
export async function readThemesFromPathAsync(
  dir: string,
  source: CustomThemeSource,
  slugPrefix = '',
): Promise<CustomTheme[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (e: unknown) {
    const code =
      e && typeof e === 'object' && 'code' in e
        ? String((e as { code: unknown }).code)
        : undefined
    if (code === 'ENOTDIR') {
      const one = await readThemeFile(
        dir,
        slugPrefix + basename(dir, '.json'),
        source,
      )
      return one ? [one] : []
    }
    return []
  }
  const out: CustomTheme[] = []
  for (const entry of entries) {
    if (extname(entry) !== '.json') continue
    const theme = await readThemeFile(
      join(dir, entry),
      slugPrefix + basename(entry, '.json'),
      source,
    )
    if (theme) out.push(theme)
  }
  return out
}

/** densable HYt — write user theme JSON. */
export async function saveCustomTheme(
  theme: Pick<CustomTheme, 'slug' | 'name' | 'base' | 'overrides'>,
): Promise<void> {
  // Reject path separators / traversal — editor uses slugifyThemeName, but
  // callers must not write outside themes/.
  if (
    !theme.slug ||
    theme.slug.includes('/') ||
    theme.slug.includes('\\') ||
    theme.slug.includes('..') ||
    theme.slug !== basename(theme.slug)
  ) {
    throw new Error(`Invalid theme slug: ${theme.slug}`)
  }
  const dir = getThemesDir()
  await mkdir(dir, { recursive: true })
  const body = {
    name: theme.name,
    base: theme.base,
    overrides: theme.overrides,
  }
  await writeFile(
    join(dir, `${theme.slug}.json`),
    `${JSON.stringify(body, null, 2)}\n`,
    'utf8',
  )
  // Keep in-memory cache coherent for resolveThemeBaseName / getCachedCustomThemes
  // even before the next full loadCustomThemes() completes.
  baseCache ??= new Map()
  baseCache.set(theme.slug, theme.base)
  if (cachedThemes) {
    const idx = cachedThemes.findIndex(t => t.slug === theme.slug)
    const entry: CustomTheme = {
      slug: theme.slug,
      name: theme.name,
      base: theme.base,
      overrides: theme.overrides,
      source: 'user',
    }
    if (idx >= 0) cachedThemes[idx] = entry
    else {
      cachedThemes = [...cachedThemes, entry].sort((a, b) =>
        a.name.localeCompare(b.name),
      )
    }
  }
}

/** densable IYt — load user themes from disk (plugin store empty until wired). */
export async function loadCustomThemes(): Promise<CustomTheme[]> {
  const user = await readThemesFromPathAsync(getThemesDir(), 'user')
  baseCache = new Map(user.map(t => [t.slug, t.base]))
  user.sort((a, b) => a.name.localeCompare(b.name))
  cachedThemes = user
  return user
}

/** densable resolve base name for a ThemeSetting (Jj without auto system). */
export function resolveThemeBaseName(
  setting: string,
  systemTheme: ThemeName = 'dark',
): ThemeName {
  if (setting === 'auto') return systemTheme
  if (isThemeName(setting)) return setting
  const slug = parseCustomThemeRef(setting)
  if (slug) {
    const base = getCustomThemeBase(slug)
    if (base) return base
  }
  return 'dark'
}
