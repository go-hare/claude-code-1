/**
 * densable 2.1.289 `un` / `Gi` / `qi` / `us` / `Ki` / `zi` / `Yi` —
 * /config catalog section order. Sorts settings we already have; does not
 * invent missing rows.
 *
 * Gold `qi` only runs when maple (`Ede` / tengu_maple_sundial); local always
 * applies `qi` so /config item order matches the official catalog even when
 * DualInk is off.
 */

const CONFIG_SECTIONS = [
  'Appearance',
  'Model & output',
  'Display',
  'Input & controls',
  'Connections',
  'Plugins',
  'Advanced',
  'Experimental',
  'Internal',
] as const

export type ConfigCatalogSection = (typeof CONFIG_SECTIONS)[number]

const CONFIG_SECTION_IDS: Record<ConfigCatalogSection, string[]> = {
  Appearance: ['theme', 'language', 'reduceMotion'],
  'Model & output': [
    'model',
    'fast',
    'switchModelsOnFlag',
    'autoContinueAtUsageLimit',
    'outputStyle',
    'defaultView',
    'verbose',
    'autoCompact',
    'thinking',
    'permissionMode',
    'useAutoModeDuringPlan',
  ],
  Display: [
    'autoScroll',
    'progressBar',
    'tips',
    'turnDuration',
    'timeFormat',
    'prStatus',
    'externalEditorContext',
  ],
  'Input & controls': [
    'editor',
    'askUserQuestionTimeout',
    'modelProposedGoals',
    'copyOnSelect',
    'promptSuggestionEnabled',
    'agentsView',
    'checkpoints',
    'workflows',
    'workflowKeywordTriggerEnabled',
    'artifacts',
  ],
  Connections: [
    'notifChannel',
    'inputNeededNotifEnabled',
    'agentPushNotifEnabled',
    'autoConnectIde',
    'autoInstallIdeExtension',
    'diffTool',
    'chrome',
    'remoteControl',
    'remoteHomeSettings',
    'dialogExpiry',
    'crossSessionInbound',
    'showExternalIncludesDialog',
    'apiKey',
  ],
  // Gold `Plugins:[]` — dotted ids (`Yi`) rank here via `us` / `zi`.
  Plugins: [],
  Advanced: [
    'autoUpdatesChannel',
    'worktreeBaseRef',
    'gitignore',
    'copyFullResponse',
    'recap',
  ],
  Experimental: [
    'precomputeCompactionEnabled',
    'timestamps',
    'showStatusInTerminalTab',
    'teammateMode',
  ],
  Internal: [
    'snipEnabled',
    'snipDebug',
    'doneMeansMerged',
    'autoUploadSessions',
    'autoAddRemoteControlDaemonWorker',
    'autofixPrMode',
  ],
}

/** Local id aliases → official catalog id. */
const CATALOG_ID_ALIASES: Record<string, string> = {
  autoCompactEnabled: 'autoCompact',
  spinnerTipsEnabled: 'tips',
  prefersReducedMotion: 'reduceMotion',
  thinkingEnabled: 'thinking',
  fastMode: 'fast',
  terminalProgressBarEnabled: 'progressBar',
  showTurnDuration: 'turnDuration',
  defaultPermissionMode: 'permissionMode',
  respectGitignore: 'gitignore',
  editorMode: 'editor',
  prStatusFooterEnabled: 'prStatus',
  claudeInChromeDefaultEnabled: 'chrome',
  remoteControlAtStartup: 'remoteControl',
  fileCheckpointingEnabled: 'checkpoints',
}

const CATALOG_ORDER = new Map<string, number>(
  CONFIG_SECTIONS.flatMap((section, sectionIndex) =>
    CONFIG_SECTION_IDS[section].map(
      (id, itemIndex) => [id, sectionIndex * 1000 + itemIndex] as const,
    ),
  ),
)

const SECTION_BY_ID = new Map<string, ConfigCatalogSection>(
  CONFIG_SECTIONS.flatMap(section =>
    CONFIG_SECTION_IDS[section].map(id => [id, section] as const),
  ),
)

const ADVANCED_CATALOG_IDS = new Set(CONFIG_SECTION_IDS.Advanced)

/** densable `Ec` — Plugins rank for dotted ids. */
const PLUGINS_ORDER = CONFIG_SECTIONS.indexOf('Plugins') * 1000
/** densable `Ac` — unknown ids after official Advanced rows. */
const UNKNOWN_ORDER = CONFIG_SECTIONS.indexOf('Advanced') * 1000 + 999

function catalogId(id: string): string {
  return CATALOG_ID_ALIASES[id] ?? id
}

/** densable `Yi` — plugin option ids are `name.key`. */
function isPluginCatalogId(id: string): boolean {
  return catalogId(id).includes('.')
}

/** densable `zi`. */
function catalogRank(id: string): number {
  const cid = catalogId(id)
  return (
    CATALOG_ORDER.get(cid) ??
    (isPluginCatalogId(id) ? PLUGINS_ORDER : UNKNOWN_ORDER)
  )
}

/** densable `us`. */
export function configSectionForId(id: string): ConfigCatalogSection {
  const cid = catalogId(id)
  return (
    SECTION_BY_ID.get(cid) ?? (isPluginCatalogId(id) ? 'Plugins' : 'Advanced')
  )
}

/** densable `Ki` — Advanced official rows get the settings.json note. */
export function configSectionHeading(id: string): {
  name: ConfigCatalogSection
  note?: string
} {
  const section = configSectionForId(id)
  return section === 'Advanced' && ADVANCED_CATALOG_IDS.has(catalogId(id))
    ? { name: section, note: 'moving to settings.json' }
    : { name: section }
}

export type ConfigSectionHeading = {
  name: ConfigCatalogSection
  note?: string
}

export type ConfigDisplayEntry<T extends { id: string }> =
  | { kind: 'heading'; key: string; heading: ConfigSectionHeading }
  | { kind: 'item'; item: T; settingIndex: number }

/**
 * densable DualInk-off `us`/`Ki` list: maple inserts a heading that occupies
 * a `maxVisible` slot. Gold empty `nl.Heading` gap is DualInk analog — skip.
 */
export function buildConfigDisplayEntries<T extends { id: string }>(
  items: T[],
  mapleSundial: boolean,
): ConfigDisplayEntry<T>[] {
  if (!mapleSundial) {
    return items.map((item, settingIndex) => ({
      kind: 'item' as const,
      item,
      settingIndex,
    }))
  }
  const rows: ConfigDisplayEntry<T>[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item === undefined) continue
    const section = configSectionForId(item.id)
    const previous =
      i === 0 ? undefined : configSectionForId(items[i - 1]?.id ?? '')
    if (section !== previous) {
      rows.push({
        kind: 'heading',
        key: `section:${section}`,
        heading: configSectionHeading(item.id),
      })
    }
    rows.push({ kind: 'item', item, settingIndex: i })
  }
  return rows
}

/** densable: setting index → display-row index (headings occupy slots). */
export function displayIndexForSetting<T extends { id: string }>(
  entries: ConfigDisplayEntry<T>[],
  settingIndex: number,
): number {
  const found = entries.findIndex(
    entry => entry.kind === 'item' && entry.settingIndex === settingIndex,
  )
  return found >= 0 ? found : Math.max(0, entries.length - 1)
}

/**
 * densable `qi` — stable section-order sort. Unknown ids keep input
 * order after official Advanced rows. Dotted plugin ids rank in Plugins.
 */
export function sortConfigCatalog<T extends { id: string }>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const delta = catalogRank(a.item.id) - catalogRank(b.item.id)
      return delta !== 0 ? delta : a.i - b.i
    })
    .map(({ item }) => item)
}
