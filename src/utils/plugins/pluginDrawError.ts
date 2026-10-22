/**
 * densable 2.1.289 `Ymn` / `Xmn` / `L1t` / `NBr` / `Jmn` / `Bmn` / `jmn` /
 * `Imt` / `oBr` / `f3` / `O9` / `s8e` / `rft`. Author toast is Ymn; debug
 * names via f3+O9. No lead / no module is unattributed.
 */

import { dirname, join, resolve } from 'path'
import { logForDebugging } from '../debug.js'
import { parsePluginIdentifier } from './pluginIdentifier.js'

/** densable `oBr`. */
export const HOOKS_LEAD = 'hooks'

/** densable `Kc` in the plugin-id chunk — inline / --plugin-dir sentinel. */
const INLINE_MARKETPLACE = 'inline'

/** densable `Ai`. */
const BUILTIN_MARKETPLACE = 'builtin'

/** densable `Ymn`. */
export const Ymn = Object.freeze({
  AbovePrompt: 'nothing was drawn',
  Pane: 'the pane was closed',
})

export type DrawErrorTeller = {
  load: string
  lead: string
}

export type PluginLeadAttrs = {
  plugin_name_redacted: string
  provenance: string
}

/** densable `O9({pluginStorageId, pluginRoot})`. */
export type O9Input = {
  pluginStorageId: string
  pluginRoot?: string
}

const CHARACTER_CLASSES = {
  escape: String.raw`\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f`,
  placeholder: String.raw`\u{10eeee}`,
  loneSurrogate: String.raw`\ud800-\udfff`,
}
const LINE_SCRUB = new RegExp(
  `[${String.raw`\t\n\r`}${CHARACTER_CLASSES.escape}${CHARACTER_CLASSES.loneSurrogate}${CHARACTER_CLASSES.placeholder}]`,
  'gu',
)

/** densable `x3`. */
const reported = new Set<string>()

/** densable `qre` — `tL` → `?`. */
export function qre(text: string): string {
  return text.replace(LINE_SCRUB, '?')
}

/** densable `Bmn` — one name is the lead; else `hooks`. */
export function Bmn(names: readonly string[]): string {
  const [n, ...rest] = names
  return n !== undefined && rest.length === 0 ? n : HOOKS_LEAD
}

/** densable `jmn`. */
export function jmn(
  mods: readonly { name: string; environmentId?: string }[],
): string {
  return mods.map(mod => `${mod.name}#${mod.environmentId ?? ''}`).join()
}

/** densable `Imt`. */
export function Imt(
  mods: readonly { name: string; environmentId?: string }[],
): DrawErrorTeller {
  return { load: jmn(mods), lead: Bmn(mods.map(mod => mod.name)) }
}

/** densable `Xmn`. */
export function Xmn(component: string, teller: DrawErrorTeller): string {
  return [teller.load, component, 'threw while drawn'].join(' ')
}

/** densable `$r` — NFC fold for managed-id compare. */
function foldId(id: string): string {
  return id.normalize('NFC').toLowerCase()
}

/** densable `rft=()=>join(we(),"dev-mods")`. */
function rft(): string {
  const { getClaudeConfigHomeDir } =
    require('../envUtils.js') as typeof import('../envUtils.js')
  return join(getClaudeConfigHomeDir(), 'dev-mods')
}

/** densable `s8e` — `marketplace===Ai && sE(name)!==undefined`. */
function s8e(storageId: string): boolean {
  const { name, marketplace } = parsePluginIdentifier(storageId)
  if (marketplace !== BUILTIN_MARKETPLACE) return false
  try {
    const { getBuiltinPluginDefinition } =
      require('../../plugins/builtinPlugins.js') as typeof import('../../plugins/builtinPlugins.js')
    return getBuiltinPluginDefinition(name) !== undefined
  } catch {
    return false
  }
}

/** densable `aF` ids — policy `plugin@marketplace` keys, fold-compared. */
function managedIds(): string[] {
  try {
    const { getSettingsForSource } =
      require('../settings/settings.js') as typeof import('../settings/settings.js')
    const enabled = getSettingsForSource('policySettings')?.enabledPlugins
    if (!enabled) return []
    return Object.entries(enabled).flatMap(([id, value]) =>
      typeof value === 'boolean' && id.includes('@') ? [id] : [],
    )
  } catch {
    return []
  }
}

function isManagedId(storageId: string): boolean {
  const folded = foldId(storageId)
  return managedIds().some(id => foldId(id) === folded)
}

/**
 * densable `O9`.
 * `s8e` → builtin; managed via `aF`; marketplace `Kc` (inline) →
 * `rft` parent `dev_mods` else `plugin_dir`; else installed.
 */
export function O9(mod: O9Input): PluginLeadAttrs {
  const storage = mod.pluginStorageId
  const { name, marketplace } = parsePluginIdentifier(storage)
  const shownName = (name || storage.replace(/^builtin:/, '')).trim() || storage
  const a = dirname(resolve(mod.pluginRoot ?? ''))
  let mods: string
  try {
    mods = resolve(rft())
  } catch {
    mods = ''
  }
  const x =
    mods !== '' && (a === mods || dirname(a) === mods)
      ? 'dev_mods'
      : 'plugin_dir'
  const O = isManagedId(storage)
    ? 'managed'
    : marketplace === INLINE_MARKETPLACE
      ? x
      : 'installed'
  const w = s8e(storage) ? 'builtin' : O
  let redacted = shownName
  try {
    const { buildPluginTelemetryFields } =
      require('../telemetry/pluginTelemetry.js') as typeof import('../telemetry/pluginTelemetry.js')
    redacted = String(
      buildPluginTelemetryFields(shownName, marketplace).plugin_name_redacted,
    )
  } catch {
    // telemetry optional
  }
  return { plugin_name_redacted: redacted, provenance: w }
}

/** densable `v8e` then `f3=(o)=>v8e(o)?.args`. */
export function f3(lead: string): O9Input | null {
  if (lead === '' || lead === HOOKS_LEAD) return null
  try {
    const { getLoadedFunctionHooksModules } =
      require('./functionHooksModules.js') as typeof import('./functionHooksModules.js')
    const found = getLoadedFunctionHooksModules().find(mod => mod.name === lead)
    if (found === undefined || found.pluginStorageId === undefined) {
      return null
    }
    return {
      pluginStorageId: found.pluginStorageId,
      ...(found.root !== undefined && { pluginRoot: found.root }),
    }
  } catch {
    return null
  }
}

/** densable `f3(lead) && O9(h)`. Missing module is unattributed. */
export function pluginFromLead(lead: string): PluginLeadAttrs | null {
  const rec = f3(lead)
  return rec === null ? null : O9(rec)
}

/** densable `Imt([v8e(plugin)].filter(Boolean))`. */
export function tellerOfPlugin(plugin: string): DrawErrorTeller {
  try {
    const { getLoadedFunctionHooksModules } =
      require('./functionHooksModules.js') as typeof import('./functionHooksModules.js')
    const found = getLoadedFunctionHooksModules().find(
      mod => mod.name === plugin,
    )
    return found === undefined ? Imt([]) : Imt([found])
  } catch {
    return Imt([])
  }
}

/** densable `NBr`. */
export function NBr(component: string, detail: string): string {
  return (
    `ui.render (${component}) threw while drawn: ${detail}; ` +
    (Ymn[component as keyof typeof Ymn] ?? 'the engine drew its own')
  )
}

/**
 * densable `L1t`. Returns null when this teller+kind was already
 * reported. Kind is `answer` (tree/site) or `Client`.
 */
export function L1t(
  component: string,
  teller: DrawErrorTeller,
  kind: string,
): string | null {
  const key = `reported ${kind} ${Xmn(component, teller)}`
  if (reported.has(key)) return null
  reported.add(key)
  const attrs = pluginFromLead(teller.lead)
  const name = attrs?.plugin_name_redacted ?? 'unattributed'
  const provenance = attrs?.provenance ?? 'unattributed'
  return `ui.render (${component}): a plugin's ${kind} threw while drawn (plugin ${name}, ${provenance})`
}

/** densable `Jmn` / `bxe` — toast once per Xmn key; warn `${lead}: ${NBr}`. */
export function Jmn(input: {
  component: string
  teller: DrawErrorTeller
  error: unknown
}): { key: string; lead: string; text: string } | null {
  const key = Xmn(input.component, input.teller)
  if (reported.has(`noted ${key}`)) return null
  reported.add(`noted ${key}`)
  const detail = qre(
    input.error instanceof Error ? input.error.message : String(input.error),
  )
  const text = NBr(input.component, detail)
  logForDebugging(`${input.teller.lead}: ${text}`, { level: 'warn' })
  return {
    key,
    lead: input.teller.lead,
    text,
  }
}

export function resetDrawErrorNotes(): void {
  reported.clear()
}

export function tellerOf(names: readonly string[]): DrawErrorTeller {
  return Imt(
    names
      .filter(name => name !== '')
      .map(name => ({ name, environmentId: name })),
  )
}
