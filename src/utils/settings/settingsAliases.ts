/**
 * densable 2.1.232 #8 — settings key aliases (SEA `BIy` / `sRe` / `rAs`).
 *
 * Gold:
 *   BIy=[
 *     {alias:"additionalMarketplaces",canonical:"extraKnownMarketplaces"},
 *     {alias:"allowedMarketplaces",canonical:"strictKnownMarketplaces"},
 *   ]
 *   function sRe(e,t){
 *     if(!isObject(e))return[];
 *     let r=[];
 *     for(let{alias:n,canonical:o}of BIy){
 *       if(!(n in e))continue;
 *       if(o in e&&e[o]!==null)
 *         r.push({file:t,path:n,message:`"${n}" is an alias for "${o}" and this file sets both; the "${n}" value was ignored. Use only "${o}".`,severity:"warning",alias:n,canonical:o});
 *       else e[o]=e[n];
 *       delete e[n];
 *     }
 *     return r;
 *   }
 *
 * Mutates `data` in place before SettingsSchema parse so aliases never hit
 * strict/unrecognized_keys, and so older clients that only know the alias
 * still load the canonical field after rewrite.
 */

export type SettingsKeyAliasPair = {
  alias: string
  canonical: string
}

/** densable BIy */
export const SETTINGS_KEY_ALIASES: readonly SettingsKeyAliasPair[] = [
  {
    alias: 'additionalMarketplaces',
    canonical: 'extraKnownMarketplaces',
  },
  {
    alias: 'allowedMarketplaces',
    canonical: 'strictKnownMarketplaces',
  },
] as const

export type SettingsAliasWarning = {
  file: string
  path: string
  message: string
  severity: 'warning'
  alias: string
  canonical: string
}

/** densable rAs — short message when both keys set */
export function formatSettingsAliasBothSetMessage(
  alias: string,
  canonical: string,
): string {
  return `"${alias}" and "${canonical}" are the same setting; keep only "${canonical}"`
}

/**
 * densable sRe — apply BIy aliases onto a raw settings object.
 * @returns warnings when both alias and canonical are set (alias ignored)
 */
export function applySettingsKeyAliases(
  data: unknown,
  filePath: string = '',
): SettingsAliasWarning[] {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return []
  }
  const e = data as Record<string, unknown>
  const warnings: SettingsAliasWarning[] = []
  for (const { alias, canonical } of SETTINGS_KEY_ALIASES) {
    if (!(alias in e)) continue
    if (canonical in e && e[canonical] !== null && e[canonical] !== undefined) {
      warnings.push({
        file: filePath,
        path: alias,
        message: `"${alias}" is an alias for "${canonical}" and this file sets both; the "${alias}" value was ignored. Use only "${canonical}".`,
        severity: 'warning',
        alias,
        canonical,
      })
    } else {
      e[canonical] = e[alias]
    }
    delete e[alias]
  }
  return warnings
}
