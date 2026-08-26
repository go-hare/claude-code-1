/**
 * densable 2.1.239 #25 — Lta / MVo / Nta / $ta
 *
 * Bare marketplace plugin `source` names (`formatter`) resolve under
 * `metadata.pluginRoot` as `./pluginRoot/formatter`. Sources that already
 * start with `./` are unchanged. Invalid pluginRoot is ignored (no rewrite).
 */

const BARE_PLUGIN_SOURCE_RE = /^[A-Za-z0-9][-A-Za-z0-9._]*$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** densable MVo — bare source name (not `./…`, not `..`). */
export function isBareMarketplacePluginSource(
  source: unknown,
): source is string {
  return (
    typeof source === 'string' &&
    BARE_PLUGIN_SOURCE_RE.test(source) &&
    !source.includes('..')
  )
}

/**
 * densable Lta — sanitize metadata.pluginRoot.
 * Rejects empty, absolute, backslash, drive `:` , `.`/`..` segments.
 * `.` / `./` / `./`+slashes → `"."`.
 */
export function sanitizeMarketplacePluginRoot(
  pluginRoot: unknown,
): string | undefined {
  if (
    typeof pluginRoot !== 'string' ||
    pluginRoot === '' ||
    pluginRoot.startsWith('/') ||
    pluginRoot.includes('\\') ||
    pluginRoot.includes(':')
  ) {
    return undefined
  }
  const trimmed = pluginRoot.replace(/^\.\//, '').replace(/\/+$/, '')
  if (trimmed === '' || trimmed === '.') return '.'
  if (
    trimmed.split('/').some(seg => seg === '' || seg === '.' || seg === '..')
  ) {
    return undefined
  }
  return trimmed
}

function rewriteBarePluginSource(entry: unknown, pluginRoot: string): unknown {
  if (!isPlainObject(entry) || !isBareMarketplacePluginSource(entry.source)) {
    return entry
  }
  const source =
    pluginRoot === '.' ? `./${entry.source}` : `./${pluginRoot}/${entry.source}`
  return { ...entry, source }
}

/**
 * densable $ta — rewrite marketplace.plugins[].source under metadata.pluginRoot.
 * Returns the input unchanged when pluginRoot is missing or invalid.
 */
export function applyMarketplacePluginRoot(raw: unknown): unknown {
  if (!isPlainObject(raw) || !Array.isArray(raw.plugins)) return raw
  const pluginRoot = isPlainObject(raw.metadata)
    ? sanitizeMarketplacePluginRoot(raw.metadata.pluginRoot)
    : undefined
  if (pluginRoot === undefined) return raw
  return {
    ...raw,
    plugins: raw.plugins.map(entry =>
      rewriteBarePluginSource(entry, pluginRoot),
    ),
  }
}
