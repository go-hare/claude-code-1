/**
 * densable Zpf zip / Aff / Tff + J1h R9a helpers.
 * Official Zpf: QAi → e2t → W9n → JAi → Aff → Tff; return warnings[].
 */

import { createWriteStream } from 'fs'
import { readdir, readFile, rename, rm, stat } from 'fs/promises'
import { basename, join, resolve, sep } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type {
  LoadedPlugin,
  PluginError,
  PluginManifest,
  PluginWarning,
} from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { pathExists } from '../file.js'
import { hasPluginShapedRoot } from './pluginArchive.js'
import { foldPluginName, SYNCED_MARKETPLACE_NAME } from './pluginIdentifier.js'
import { extractZipToDirectory, getSessionPluginCachePath } from './zipCache.js'

/** densable J8u + jNr — invisible / control / default-ignorable. */
const JNR =
  '\\p{Cc}\\p{Cf}\\p{Cs}\\p{Co}\\p{Cn}\\u2028\\u2029\\p{Default_Ignorable_Code_Point}\\u2800'

/** densable z9u — invalid plugin name. */
const INVALID_PLUGIN_NAME = new RegExp(`[@:\\s/\\\\${JNR}]`, 'u')

/** densable W9u — unprintable version. */
const UNPRINTABLE_VERSION = new RegExp(`[${JNR}]`, 'u')

/** densable dpr — do not W9n-unwrap into a lone component folder. */
const ZIP_COMPONENT_LEAFS = new Set([
  'commands',
  'skills',
  'agents',
  'hooks',
  'themes',
  'output-styles',
  'monitors',
  'workflows',
])

export function isZpfZipPath(path: string): boolean {
  return path.toLowerCase().endsWith('.zip')
}

/** densable `IyS` — `--plugin-url` fetch timeout. */
export const ZPF_URL_FETCH_TIMEOUT_MS = 30_000

/** densable `Vtt` — max `--plugin-url` archive bytes. */
export const ZPF_URL_MAX_BYTES = 268_435_456

/**
 * densable `irt` — resolve a manifest-relative path; null when it escapes
 * the plugin root.
 */
export function resolvePluginRelPath(
  pluginPath: string,
  rel: string,
): string | null {
  const root = resolve(pluginPath)
  const resolved = resolve(pluginPath, rel)
  if (resolved !== root && !resolved.startsWith(root + sep)) return null
  return resolved
}

/**
 * densable `Kpf` — true when a manifest field already covers `folderPath`
 * (so the default folder is not shadowed).
 */
export function manifestPathsCoverFolder(
  field: unknown,
  pluginPath: string,
  folderPath: string,
): boolean {
  const rels: string[] = []
  if (typeof field === 'string') {
    rels.push(field)
  } else if (Array.isArray(field)) {
    for (const item of field) {
      if (typeof item === 'string') rels.push(item)
    }
  } else if (field && typeof field === 'object') {
    for (const item of Object.values(field)) {
      if (
        item &&
        typeof item === 'object' &&
        'source' in item &&
        typeof (item as { source: unknown }).source === 'string'
      ) {
        rels.push((item as { source: string }).source)
      }
    }
  }
  const prefix = folderPath + sep
  return rels.some(rel => {
    const resolved = resolvePluginRelPath(pluginPath, rel)
    return resolved !== null && (resolved + sep).startsWith(prefix)
  })
}

type ShadowRow = {
  fieldKey: 'commands' | 'agents' | 'outputStyles' | 'themes' | 'workflows'
  folderExists: boolean
  folderName: string
  component: string
}

/**
 * densable JAi folder-shadowed-by-manifest rows.
 * Official: folder exists + manifest sets the field + Kpf is false.
 */
export function folderShadowedByManifestWarnings(
  pluginPath: string,
  source: string,
  pluginName: string,
  manifest: PluginManifest,
  folders: {
    commands: boolean
    agents: boolean
    outputStyles: boolean
    themes: boolean
    workflows: boolean
  },
): PluginWarning[] {
  const experimental = (
    manifest as PluginManifest & {
      experimental?: Record<string, unknown>
      themes?: unknown
      workflows?: unknown
    }
  ).experimental
  const ext = manifest as PluginManifest & {
    themes?: unknown
    workflows?: unknown
  }
  const rows: ShadowRow[] = [
    {
      fieldKey: 'commands',
      folderExists: folders.commands,
      folderName: 'commands',
      component: 'commands',
    },
    {
      fieldKey: 'agents',
      folderExists: folders.agents,
      folderName: 'agents',
      component: 'agents',
    },
    {
      fieldKey: 'outputStyles',
      folderExists: folders.outputStyles,
      folderName: 'output-styles',
      component: 'output-styles',
    },
    {
      fieldKey: 'themes',
      folderExists: folders.themes,
      folderName: 'themes',
      component: 'themes',
    },
  ]
  const warnings: PluginWarning[] = []
  for (const row of rows) {
    const experimentalField = experimental?.[row.fieldKey]
    const topLevel =
      row.fieldKey === 'themes'
        ? ext.themes
        : row.fieldKey === 'outputStyles'
          ? manifest.outputStyles
          : row.fieldKey === 'commands'
            ? manifest.commands
            : manifest.agents
    const field: unknown =
      row.fieldKey === 'themes'
        ? (experimental?.themes ?? ext.themes)
        : row.fieldKey === 'outputStyles'
          ? manifest.outputStyles
          : row.fieldKey === 'commands'
            ? manifest.commands
            : manifest.agents
    const fields: string[] = []
    if (experimentalField !== undefined) {
      fields.push(`experimental.${row.fieldKey}`)
    }
    if (topLevel !== undefined) fields.push(row.fieldKey)
    if (!field || !row.folderExists) continue
    const folderPath = join(pluginPath, row.folderName)
    if (manifestPathsCoverFolder(field, pluginPath, folderPath)) continue
    logForDebugging(
      `Plugin ${pluginName}: ${row.folderName}/ folder exists but is not auto-loaded because the manifest sets ${fields.map(f => `"${f}"`).join(' and ')}`,
    )
    warnings.push({
      type: 'folder-shadowed-by-manifest',
      source,
      plugin: pluginName,
      component: row.component,
      folderPath,
      manifestFields: fields,
    })
  }
  if (ext.workflows && folders.workflows) {
    const folderPath = join(pluginPath, 'workflows')
    if (!manifestPathsCoverFolder(ext.workflows, pluginPath, folderPath)) {
      warnings.push({
        type: 'folder-shadowed-by-manifest',
        source,
        plugin: pluginName,
        component: 'workflows',
        folderPath,
        manifestFields: [
          experimental?.workflows !== undefined
            ? 'experimental.workflows'
            : 'workflows',
        ],
      })
    }
  }
  return warnings
}

function stripUrlQuery(text: string): string {
  return text.replace(/\?[^\s"']*/g, '')
}

/**
 * densable Zpf url-kind: fetch a user-supplied `--plugin-url` zip into the
 * session cache. Reuses a previous download if the re-fetch fails.
 */
/** densable `--plugin-url`: https, or http on loopback only. */
export function isAllowedPluginUrl(parsed: URL): boolean {
  if (parsed.protocol === 'https:') return true
  if (parsed.protocol !== 'http:') return false
  const host = parsed.hostname.toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

export async function downloadZpfUrlZip(
  url: string,
  index: number,
): Promise<string> {
  const parsed = new URL(url)
  if (parsed.username || parsed.password) {
    throw new Error(
      `--plugin-url rejects URLs with userinfo (${parsed.protocol}//${parsed.hostname}${parsed.pathname})`,
    )
  }
  if (!isAllowedPluginUrl(parsed)) {
    throw new Error(
      `--plugin-url only accepts https URLs (or http on localhost); got ${parsed.protocol}//${parsed.hostname}${parsed.pathname}`,
    )
  }
  const sessionDir = await getSessionPluginCachePath()
  const originPath = parsed.origin + parsed.pathname
  const leaf = basename(parsed.pathname).replace(/\.zip$/i, '') || 'download'
  const dest = join(
    sessionDir,
    `url-${index}-${leaf.replace(/[^a-zA-Z0-9\-_]/g, '-')}.zip`,
  )
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(ZPF_URL_FETCH_TIMEOUT_MS),
    })
    if (!response.ok || !response.body) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText} from ${originPath}`,
      )
    }
    const contentLength = Number(response.headers.get('content-length'))
    if (contentLength > ZPF_URL_MAX_BYTES) {
      throw new Error(
        `Plugin archive too large (${contentLength} bytes, max ${ZPF_URL_MAX_BYTES}) from ${originPath}`,
      )
    }
    let bytes = 0
    const part = `${dest}.part`
    const nodeBody = Readable.fromWeb(
      response.body as unknown as import('stream/web').ReadableStream,
    )
    nodeBody.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength
      if (bytes > ZPF_URL_MAX_BYTES) {
        nodeBody.destroy(
          new Error(
            `Plugin archive exceeded ${ZPF_URL_MAX_BYTES} bytes from ${originPath}`,
          ),
        )
      }
    })
    await pipeline(nodeBody, createWriteStream(part))
    await rename(part, dest)
    logForDebugging(`Downloaded inline plugin from ${originPath}`)
  } catch (error) {
    if (!(await pathExists(dest))) {
      throw new Error(stripUrlQuery(errorMessage(error)))
    }
    logForDebugging(
      `Re-fetch of inline plugin from ${originPath} failed; reusing cached ${dest}`,
      { level: 'warn' },
    )
  }
  return dest
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * densable Eff — true when the name is invalid.
 * `namedFromSkill && !strictSynced` → treat as valid (inline SKILL.md).
 */
export function isInvalidZpfPluginName(
  name: string,
  namedFromSkill: boolean,
  strictSynced: boolean,
): boolean {
  if (namedFromSkill && !strictSynced) return false
  return name.length === 0 || INVALID_PLUGIN_NAME.test(name)
}

/** densable Aff — drop plugin when name is invalid. */
export function zpfAffNameError(
  plugin: LoadedPlugin,
  source: string,
  manifestPath: string | null,
  strictSynced: boolean,
): PluginError | null {
  const namedFromSkill =
    manifestPath === null || basename(manifestPath) === 'SKILL.md'
  if (!isInvalidZpfPluginName(plugin.name, namedFromSkill, strictSynced)) {
    return null
  }
  const skillHint = namedFromSkill
    ? ' — this plugin is named after its directory; rename the directory'
    : ''
  return {
    type: 'manifest-validation-error',
    source,
    manifestPath: manifestPath ?? plugin.path,
    validationErrors: [
      `name: "${plugin.name}" is not a valid plugin name (must be non-empty and must not contain "@", ":", whitespace, path separators, or invisible/control characters)${skillHint}`,
    ],
  }
}

/** densable Tff — strip unprintable manifest.version. */
export function stripUnprintablePluginVersion(plugin: LoadedPlugin): void {
  const version = plugin.manifest.version
  if (version !== undefined && UNPRINTABLE_VERSION.test(version)) {
    logForDebugging(
      `Plugin ${plugin.name}: manifest version contains unprintable characters; treating as absent`,
      { level: 'warn' },
    )
    plugin.manifest.version = undefined
  }
}

/** densable W9n — unwrap a single wrapper directory after zip extract. */
export async function unwrapZpfZipRoot(extractDir: string): Promise<string> {
  const entries = (await readdir(extractDir, { withFileTypes: true })).filter(
    e => e.name !== '__MACOSX' && e.name !== '.DS_Store',
  )
  if (entries.some(e => e.name === '.claude-plugin')) return extractDir
  if (entries.length === 1 && entries[0]!.isDirectory()) {
    const child = join(extractDir, entries[0]!.name)
    if (await pathExists(join(child, '.claude-plugin'))) return child
    if (
      !ZIP_COMPONENT_LEAFS.has(entries[0]!.name) &&
      (await hasPluginShapedRoot(child))
    ) {
      return child
    }
  }
  return extractDir
}

/** densable QAi + e2t + W9n for a Zpf path zip. */
export async function extractZpfInlineZip(
  zipPath: string,
  index: number,
): Promise<string> {
  const sessionDir = await getSessionPluginCachePath()
  const leaf = basename(zipPath).replace(/\.zip$/i, '')
  const extractDir = join(
    sessionDir,
    `inline-${index}-${leaf.replace(/[^a-zA-Z0-9\-_]/g, '-')}`,
  )
  await rm(extractDir, { recursive: true, force: true })
  await extractZipToDirectory(zipPath, extractDir)
  logForDebugging(`Extracted inline plugin zip to ${extractDir}`)
  const unwrapped = await unwrapZpfZipRoot(extractDir)
  if (unwrapped !== extractDir) {
    logForDebugging(
      `Inline plugin zip had wrapper directory; using ${unwrapped}`,
    )
  }
  return unwrapped
}

/**
 * densable R9a name pick — official Eff(..., true); empty/invalid → skip.
 * Do not fall back to basename (would invent a J1h disable id).
 */
export function nameFromSyncedManifest(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined
  const name = (parsed as { name?: unknown }).name
  if (typeof name !== 'string') return undefined
  if (isInvalidZpfPluginName(name, false, true)) return undefined
  return name
}

/**
 * Official srt default when plugin.json is absent — basename, then Eff(..., true).
 * Do not use this when a manifest exists with an empty/invalid name.
 */
export function nameFromMissingSyncedManifest(
  dirName: string,
): string | undefined {
  if (isInvalidZpfPluginName(dirName, true, true)) return undefined
  return dirName
}

/**
 * densable R9a — manifest name for a synced dir, or undefined.
 * Official srt + Eff(..., true): missing plugin.json → basename; empty name → skip.
 */
export async function readSyncedPluginName(
  dir: string,
): Promise<string | undefined> {
  try {
    const st = await stat(dir)
    if (!st.isDirectory()) return undefined
  } catch {
    return undefined
  }
  const manifestPath = join(dir, '.claude-plugin', 'plugin.json')
  if (!(await pathExists(manifestPath))) {
    return nameFromMissingSyncedManifest(basename(dir))
  }
  try {
    const raw = await readFile(manifestPath, 'utf8')
    return nameFromSyncedManifest(JSON.parse(raw) as unknown)
  } catch {
    return undefined
  }
}

/** densable J1h `Gn` + `i` — name@synced not already in any settings record. */
export function syncedIdsMissingFromSettings(
  names: ReadonlyArray<string | undefined>,
  settingKeys: Iterable<string>,
): string[] {
  const folded = new Set([...settingKeys].map(key => foldPluginName(key)))
  const ids = [
    ...new Set(
      names
        .filter((n): n is string => typeof n === 'string' && n.length > 0)
        .map(n => `${n}@${SYNCED_MARKETPLACE_NAME}`),
    ),
  ]
  return ids.filter(id => !folded.has(foldPluginName(id)))
}
