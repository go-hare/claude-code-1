/**
 * densable U_c / Wfg / I00 / jfg — /config catalog section order.
 * Sorts settings we already have; does not invent missing rows.
 */

const CONFIG_SECTIONS = [
  'Appearance',
  'Model & output',
  'Display',
  'Input & controls',
  'Connections',
  'Advanced',
  'Experimental',
  'Internal',
] as const

const CONFIG_SECTION_IDS: Record<(typeof CONFIG_SECTIONS)[number], string[]> = {
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
    'dialogExpiry',
    'crossSessionInbound',
    'showExternalIncludesDialog',
    'apiKey',
  ],
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

const UNKNOWN_ORDER = CONFIG_SECTIONS.indexOf('Advanced') * 1000 + 999

/**
 * densable `U_c` — stable section-order sort. Unknown ids keep input
 * order after official rows (Advanced default rank).
 */
export function sortConfigCatalog<T extends { id: string }>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const aId = CATALOG_ID_ALIASES[a.item.id] ?? a.item.id
      const bId = CATALOG_ID_ALIASES[b.item.id] ?? b.item.id
      const delta =
        (CATALOG_ORDER.get(aId) ?? UNKNOWN_ORDER) -
        (CATALOG_ORDER.get(bId) ?? UNKNOWN_ORDER)
      return delta !== 0 ? delta : a.i - b.i
    })
    .map(({ item }) => item)
}
