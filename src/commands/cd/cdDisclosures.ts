/**
 * densable 2.1.246 `so` / `me` / `fe` / `pe` / `ge`.
 * Trust-prompt disclosures for the *target* directory (not cwd).
 */
import { join, resolve } from 'path'
import { formatEnglishSourceList } from '../../components/TrustDialog/utils.js'
import {
  findCanonicalGitRootUncached,
  findGitRootUncached,
} from '../../utils/git.js'
import { parseSettingsFile } from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { truncateCodeUnitsSafe } from '../../utils/stringUtils.js'
import { hasUnsafePathChars } from './cdPermission.js'

const MAX_DISCLOSURE_ENTRY_LENGTH = 200

/**
 * Entries here are read from the *target* directory's settings — the untrusted
 * input this prompt exists to judge. Rendered raw, a cloned repo could put
 * newlines or escape sequences in an allow rule or additionalDirectories entry
 * and restructure the very dialog that decides whether to trust it. Same
 * smuggling UNSAFE_PATH_CHARS already blocks for the directory argument.
 *
 * densable 2.1.248 #28 `d`: long entries use leftover `de` /
 * `truncateCodeUnitsSafe` (not `slice`) so a mid-emoji cut cannot leave a
 * lone high surrogate. 247 `H` still sliced.
 */
function safeDisclosureEntry(value: string): string {
  if (hasUnsafePathChars(value)) {
    return '<unprintable entry>'
  }
  return value.length > MAX_DISCLOSURE_ENTRY_LENGTH
    ? `${truncateCodeUnitsSafe(value, MAX_DISCLOSURE_ENTRY_LENGTH)}…`
    : value
}

export type CdAllowRulesDisclosure = {
  rawCount: number
  rules: string[]
  sources: string[]
}

export type CdAdditionalDirectoriesDisclosure = {
  rawCount: number
  dirs: string[]
  sources: string[]
}

export type CdDisclosures = {
  allowRules: CdAllowRulesDisclosure
  additionalDirectories: CdAdditionalDirectoriesDisclosure
  hookSources: string[]
  commandHelperSources: string[]
}

type SettingsBag = {
  sources: Array<['projectSettings' | 'localSettings', string]>
  read: (source: 'projectSettings' | 'localSettings') => SettingsJson | null
  rules: (source: 'projectSettings' | 'localSettings') => string[]
}

function hasCommandHelpers(settings: SettingsJson | null): boolean {
  if (!settings) {
    return false
  }
  return Boolean(
    settings.apiKeyHelper ||
      settings.awsAuthRefresh ||
      settings.awsCredentialExport ||
      settings.gcpAuthRefresh ||
      settings.otelHeadersHelper,
  )
}

function hasHooks(settings: SettingsJson | null): boolean {
  if (settings === null || settings.disableAllHooks) {
    return false
  }
  if (settings.statusLine || settings.fileSuggestion) {
    return true
  }
  if (!settings.hooks) {
    return false
  }
  return Object.values(settings.hooks).some(
    cfg => Array.isArray(cfg) && cfg.length > 0,
  )
}

function pe(bag: SettingsBag): CdAllowRulesDisclosure {
  const rules: string[] = []
  const sources: string[] = []
  for (const [source, label] of bag.sources) {
    const raw = bag.rules(source)
    if (raw.length > 0) {
      sources.push(label)
      rules.push(...raw.map(safeDisclosureEntry))
    }
  }
  return { rawCount: rules.length, rules, sources }
}

function ge(bag: SettingsBag): CdAdditionalDirectoriesDisclosure {
  const dirs: string[] = []
  const sources: string[] = []
  for (const [source, label] of bag.sources) {
    const extra = bag.read(source)?.permissions?.additionalDirectories ?? []
    if (extra.length > 0) {
      sources.push(label)
      dirs.push(...extra.map(safeDisclosureEntry))
    }
  }
  return { rawCount: dirs.length, dirs, sources }
}

/** densable `so(o)`. */
export function readCdDisclosures(directory: string): CdDisclosures {
  const repo = findCanonicalGitRootUncached(directory) ?? resolve(directory)
  const worktree = findGitRootUncached(directory) ?? repo
  const projectFile = join(repo, '.claude', 'settings.json')
  const worktreeLocal = join(worktree, '.claude', 'settings.local.json')
  const repoLocal = join(repo, '.claude', 'settings.local.json')
  const projectSettings = parseSettingsFile(projectFile).settings
  const localFiles = [
    parseSettingsFile(worktreeLocal).settings,
    ...(worktreeLocal === repoLocal
      ? []
      : [parseSettingsFile(repoLocal).settings]),
  ].filter((s): s is SettingsJson => s !== null)
  const localSettings =
    localFiles.length === 0
      ? null
      : {
          permissions: {
            additionalDirectories: localFiles.flatMap(
              s => s.permissions?.additionalDirectories ?? [],
            ),
            allow: localFiles.flatMap(s => s.permissions?.allow ?? []),
          },
        }
  const bySource = {
    projectSettings,
    localSettings,
  }
  const bag: SettingsBag = {
    sources: [
      ['projectSettings', '.claude/settings.json'],
      ['localSettings', '.claude/settings.local.json'],
    ],
    read: source => bySource[source] ?? null,
    rules: source => {
      if (source === 'localSettings') {
        return localFiles.flatMap(s => s.permissions?.allow ?? [])
      }
      return bySource[source]?.permissions?.allow ?? []
    },
  }
  const hookSources: string[] = []
  const commandHelperSources: string[] = []
  if (hasHooks(projectSettings)) {
    hookSources.push('.claude/settings.json')
  }
  if (localFiles.some(hasHooks)) {
    hookSources.push('.claude/settings.local.json')
  }
  if (hasCommandHelpers(projectSettings)) {
    commandHelperSources.push('.claude/settings.json')
  }
  if (localFiles.some(hasCommandHelpers)) {
    commandHelperSources.push('.claude/settings.local.json')
  }
  return {
    allowRules: pe(bag),
    additionalDirectories: ge(bag),
    hookSources,
    commandHelperSources,
  }
}

/** densable `fe` — backstop only needs grants (hooks/helpers empty). */
export function emptyHookDisclosures(): Pick<
  CdDisclosures,
  'hookSources' | 'commandHelperSources'
> {
  return { hookSources: [], commandHelperSources: [] }
}

/** densable `me(o, {backstop})`. */
export function shouldShowCdDisclosures(
  disclosures: CdDisclosures | undefined,
  backstop = false,
): boolean {
  if (!disclosures) {
    return false
  }
  return (
    disclosures.allowRules.sources.length > 0 ||
    disclosures.additionalDirectories.sources.length > 0 ||
    (!backstop &&
      (disclosures.hookSources.length > 0 ||
        disclosures.commandHelperSources.length > 0))
  )
}

export function formatCdDisclosureCount(
  count: number,
  singular: string,
  plural: string,
): string {
  return count === 1 ? singular : plural
}

export function formatCdDisclosureList(
  items: string[],
  maxItems?: number,
): string {
  return formatEnglishSourceList(items, maxItems)
}

/** densable `fe` / `Pt` — backstop prompt after relocate. */
export function readCdBackstopDisclosures(): CdDisclosures {
  const full = readCdDisclosures(process.cwd())
  return {
    ...full,
    hookSources: [],
    commandHelperSources: [],
  }
}
