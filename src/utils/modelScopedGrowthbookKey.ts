/**
 * densable g8t / Jwi — model-scoped GrowthBook flag keys.
 *
 * densable:
 *   g8t(model) strips trailing `[1m]`, leading `claude-`, maps `-` → `_`;
 *     if not `/^[a-z0-9_]{1,40}$/` → `"nonconforming"`
 *   Jwi(flag, model) = `${flag}_${g8t(model)}`
 *
 * Always returns `${flag}_${slug}` — never falls back to the bare flag.
 */

export function modelSlugForGrowthbookKey(model: string): string {
  const stripped = model
    .replace(/\[1m\]$/i, '')
    .replace(/^claude-/, '')
    .replaceAll('-', '_')
  return /^[a-z0-9_]{1,40}$/.test(stripped) ? stripped : 'nonconforming'
}

/** densable Jwi(flag, model) */
export function modelScopedGrowthbookKey(flag: string, model: string): string {
  return `${flag}_${modelSlugForGrowthbookKey(model)}`
}
