import { coerce } from 'semver'
import stripAnsi from 'strip-ansi'
import { getDirectConnectServerUrl, getSessionId } from '../bootstrap/state.js'
import { stringWidth } from '@anthropic/ink'
import type { LogOption } from '../types/logs.js'
import { getSubscriptionName, isClaudeAISubscriber } from './auth.js'
import { getGlobalConfig } from './config.js'
import { getCwd } from './cwd.js'
import { isEnvTruthy } from './envUtils.js'
import { getDisplayPath } from './file.js'
import {
  truncate,
  truncateToWidth,
  truncateToWidthNoEllipsis,
} from './format.js'
import { shouldHideCwd } from './hideCwd.js'
import { type APIProvider, getAPIProvider } from './model/providers.js'
import { getStoredChangelogFromMemory, parseChangelog } from './releaseNotes.js'
import { gt } from './semver.js'
import { getBootstrapSession, RootSessionSlot } from './sessionRoot.js'
import { loadMessageLogs } from './sessionStorage.js'
import { getInitialSettings } from './settings/settings.js'
import { plural } from './stringUtils.js'

// Layout constants
const MAX_LEFT_WIDTH = 50
const MAX_USERNAME_LENGTH = 20
const BORDER_PADDING = 4
const DIVIDER_WIDTH = 1
const CONTENT_PADDING = 2

export const CHANGELOG_DOCS_URL = 'https://code.claude.com/docs/en/changelog'
export const CHANGELOG_DOCS_LABEL = CHANGELOG_DOCS_URL.replace(
  /^https:\/\//,
  '',
)

const PROVIDER_BILLING_LABELS: Record<
  Exclude<APIProvider, 'firstParty'>,
  string
> = {
  bedrock: 'Amazon Bedrock',
  vertex: 'Google Vertex AI',
  foundry: 'Microsoft Foundry',
  anthropicAws: 'Claude Platform on AWS',
  anthropicGoogleCloud: 'Claude Platform on Google Cloud',
  mantle: 'Amazon Bedrock (Mantle)',
  gateway: 'Cloud gateway',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  grok: 'xAI Grok',
}

export type LayoutMode = 'horizontal' | 'compact'

export type LayoutDimensions = {
  leftWidth: number
  rightWidth: number
  totalWidth: number
}

/**
 * Determines the layout mode based on terminal width
 */
export function getLayoutMode(columns: number): LayoutMode {
  if (columns >= 70) return 'horizontal'
  return 'compact'
}

/**
 * Calculates layout dimensions for the LogoV2 component
 */
export function calculateLayoutDimensions(
  columns: number,
  layoutMode: LayoutMode,
  optimalLeftWidth: number,
): LayoutDimensions {
  if (layoutMode === 'horizontal') {
    const leftWidth = optimalLeftWidth
    const usedSpace =
      BORDER_PADDING + CONTENT_PADDING + DIVIDER_WIDTH + leftWidth
    const availableForRight = columns - usedSpace

    let rightWidth = Math.max(30, availableForRight)
    const totalWidth = Math.min(
      leftWidth + rightWidth + DIVIDER_WIDTH + CONTENT_PADDING,
      columns - BORDER_PADDING,
    )

    // Recalculate right width if we had to cap the total
    if (totalWidth < leftWidth + rightWidth + DIVIDER_WIDTH + CONTENT_PADDING) {
      rightWidth = totalWidth - leftWidth - DIVIDER_WIDTH - CONTENT_PADDING
    }

    return { leftWidth, rightWidth, totalWidth }
  }

  // Vertical mode
  const totalWidth = Math.min(columns - BORDER_PADDING, MAX_LEFT_WIDTH + 20)
  return {
    leftWidth: totalWidth,
    rightWidth: totalWidth,
    totalWidth,
  }
}

/**
 * Calculates optimal left panel width based on content
 */
export function calculateOptimalLeftWidth(
  welcomeMessage: string,
  truncatedCwd: string,
  modelLine: string,
): number {
  const contentWidth = Math.max(
    stringWidth(welcomeMessage),
    stringWidth(truncatedCwd),
    stringWidth(modelLine),
    20, // Minimum for clawd art
  )
  return Math.min(contentWidth + 4, MAX_LEFT_WIDTH) // +4 for padding
}

/**
 * Formats the welcome message based on username
 */
export function formatWelcomeMessage(username: string | null): string {
  if (!username || username.length > MAX_USERNAME_LENGTH) {
    return 'Welcome back!'
  }
  return `Welcome back ${username}!`
}

/**
 * Truncates a path in the middle if it's too long.
 * Width-aware: uses stringWidth() for correct CJK/emoji measurement.
 */
export function truncatePath(path: string, maxLength: number): string {
  if (stringWidth(path) <= maxLength) return path

  const separator = '/'
  const ellipsis = '…'
  const ellipsisWidth = 1 // '…' is always 1 column
  const separatorWidth = 1

  const parts = path.split(separator)
  const first = parts[0] || ''
  const last = parts[parts.length - 1] || ''
  const firstWidth = stringWidth(first)
  const lastWidth = stringWidth(last)

  // Only one part, so show as much of it as we can
  if (parts.length === 1) {
    return truncateToWidth(path, maxLength)
  }

  // We don't have enough space to show the last part, so truncate it
  // But since firstPart is empty (unix) we don't want the extra ellipsis
  if (first === '' && ellipsisWidth + separatorWidth + lastWidth >= maxLength) {
    return `${separator}${truncateToWidth(last, Math.max(1, maxLength - separatorWidth))}`
  }

  // We have a first part so let's show the ellipsis and truncate last part
  if (
    first !== '' &&
    ellipsisWidth * 2 + separatorWidth + lastWidth >= maxLength
  ) {
    return `${ellipsis}${separator}${truncateToWidth(last, Math.max(1, maxLength - ellipsisWidth - separatorWidth))}`
  }

  // Truncate first and leave last
  if (parts.length === 2) {
    const availableForFirst =
      maxLength - ellipsisWidth - separatorWidth - lastWidth
    return `${truncateToWidthNoEllipsis(first, availableForFirst)}${ellipsis}${separator}${last}`
  }

  // Now we start removing middle parts

  let available =
    maxLength - firstWidth - lastWidth - ellipsisWidth - 2 * separatorWidth

  // Just the first and last are too long, so truncate first
  if (available <= 0) {
    const availableForFirst = Math.max(
      0,
      maxLength - lastWidth - ellipsisWidth - 2 * separatorWidth,
    )
    const truncatedFirst = truncateToWidthNoEllipsis(first, availableForFirst)
    return `${truncatedFirst}${separator}${ellipsis}${separator}${last}`
  }

  // Try to keep as many middle parts as possible
  const middleParts = []
  for (let i = parts.length - 2; i > 0; i--) {
    const part = parts[i]
    if (part && stringWidth(part) + separatorWidth <= available) {
      middleParts.unshift(part)
      available -= stringWidth(part) + separatorWidth
    } else {
      break
    }
  }

  if (middleParts.length === 0) {
    return `${first}${separator}${ellipsis}${separator}${last}`
  }

  return `${first}${separator}${ellipsis}${separator}${middleParts.join(separator)}${separator}${last}`
}

type LogoV2SessionState = {
  cachedActivity: LogOption[]
  cachePromise: Promise<LogOption[]> | null
  cachedStartupUpdateSummary: string | null | undefined
}

const logoV2SessionSlot = new RootSessionSlot<LogoV2SessionState>(() => ({
  cachedActivity: [],
  cachePromise: null,
  cachedStartupUpdateSummary: undefined,
}))

function getLogoV2SessionState(): LogoV2SessionState {
  return logoV2SessionSlot.of(getBootstrapSession())
}

/**
 * Preloads recent conversations for display in Logo v2
 */
export async function getRecentActivity(): Promise<LogOption[]> {
  const state = getLogoV2SessionState()
  // Return existing promise if already loading
  if (state.cachePromise) {
    return state.cachePromise
  }

  const currentSessionId = getSessionId()
  state.cachePromise = loadMessageLogs(10)
    .then(logs => {
      state.cachedActivity = logs
        .filter(log => {
          if (log.isSidechain) return false
          if (log.sessionId === currentSessionId) return false
          if (log.summary?.includes('I apologize')) return false

          // Filter out sessions where both summary and firstPrompt are "No prompt" or missing
          const hasSummary = log.summary && log.summary !== 'No prompt'
          const hasFirstPrompt =
            log.firstPrompt && log.firstPrompt !== 'No prompt'
          return hasSummary || hasFirstPrompt
        })
        .slice(0, 3)
      return state.cachedActivity
    })
    .catch(() => {
      state.cachedActivity = []
      return state.cachedActivity
    })

  return state.cachePromise
}

/**
 * Gets cached activity synchronously
 */
export function getRecentActivitySync(): LogOption[] {
  return logoV2SessionSlot.peek(getBootstrapSession())?.cachedActivity ?? []
}

/**
 * Formats release notes for display, with smart truncation
 */
export function formatReleaseNoteForDisplay(
  note: string,
  maxWidth: number,
): string {
  // Simply truncate at the max width, same as Recent Activity descriptions
  return truncate(note, maxWidth)
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: official 2.1.325 DLe/NC welcome header sanitization strips C0/C1 control characters
const WELCOME_CONTROL_CHARS_RE = /[\x00-\x1f\x7f-\x9f]/g
const WELCOME_HIDDEN_UNICODE_RE =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u2028\u2029]/g

function stripAnsiPerLine(text: string): string {
  return text.replace(/[^\n\r\v\f\x85\u2028\u2029]+/g, line => stripAnsi(line))
}

/**
 * Official 2.1.325 `DLe` (#2274): strip ANSI escapes, hidden/bidi Unicode,
 * C0/C1 control characters, and collapse line breaks/whitespace from the
 * welcome header agent name.
 */
export function sanitizeWelcomeAgentName(raw: string): string {
  return stripAnsiPerLine(raw)
    .replace(WELCOME_HIDDEN_UNICODE_RE, '')
    .replace(WELCOME_CONTROL_CHARS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Official 2.1.325 `NC` (#2274): strip ANSI escapes, hidden/bidi Unicode,
 * control characters, and replace tabs/line breaks with spaces in welcome
 * header working folder display.
 */
export function sanitizeWelcomeCwd(raw: string): string {
  return stripAnsi(raw)
    .replace(WELCOME_HIDDEN_UNICODE_RE, '')
    .replace(/[\t\n\r\v\f\x85]+/g, ' ')
    .replace(WELCOME_CONTROL_CHARS_RE, '')
}

/**
 * Gets the common logo display data used by both LogoV2 and CondensedLogo
 */
export function getLogoDisplayData(): {
  version: string
  cwd: string
  billingType: string
  agentName: string | undefined
} {
  const version = process.env.DEMO_VERSION ?? MACRO.VERSION
  const serverUrl = getDirectConnectServerUrl()
  const displayPath = process.env.DEMO_VERSION
    ? '/code/claude'
    : getDisplayPath(getCwd())
  const cwd = shouldHideCwd()
    ? ''
    : sanitizeWelcomeCwd(
        serverUrl
          ? `${displayPath} in ${serverUrl.replace(/^https?:\/\//, '')}`
          : displayPath,
      )
  const provider = getAPIProvider()
  const billingType =
    provider !== 'firstParty'
      ? PROVIDER_BILLING_LABELS[provider]
      : isClaudeAISubscriber()
        ? getSubscriptionName()
        : 'API Usage Billing'
  const rawAgentName = getInitialSettings().agent
  const agentName = rawAgentName
    ? sanitizeWelcomeAgentName(rawAgentName) || undefined
    : undefined

  return {
    version,
    cwd,
    billingType,
    agentName,
  }
}

/**
 * Determines how to display model and billing information based on available width
 */
export function formatModelAndBilling(
  modelName: string,
  billingType: string,
  availableWidth: number,
): {
  shouldSplit: boolean
  truncatedModel: string
  truncatedBilling: string
} {
  const separator = ' · '
  const combinedWidth =
    stringWidth(modelName) + separator.length + stringWidth(billingType)
  const shouldSplit = combinedWidth > availableWidth

  if (shouldSplit) {
    return {
      shouldSplit: true,
      truncatedModel: truncate(modelName, availableWidth),
      truncatedBilling: truncate(billingType, availableWidth),
    }
  }

  return {
    shouldSplit: false,
    truncatedModel: truncate(
      modelName,
      Math.max(
        availableWidth - stringWidth(billingType) - separator.length,
        10,
      ),
    ),
    truncatedBilling: billingType,
  }
}

/**
 * Gets recent release notes for Logo v2 display
 * For ants, uses commits bundled at build time
 * For external users, uses public changelog
 */
export function getRecentReleaseNotesSync(maxItems: number): string[] {
  // For ants, use bundled changelog
  if (process.env.USER_TYPE === 'ant') {
    const changelog = MACRO.VERSION_CHANGELOG
    if (changelog) {
      const commits = changelog.trim().split('\n').filter(Boolean)
      return commits.slice(0, maxItems)
    }
    return []
  }

  const changelog = getStoredChangelogFromMemory()
  if (!changelog) {
    return []
  }

  let parsed
  try {
    parsed = parseChangelog(changelog)
  } catch {
    return []
  }

  // Get notes from recent versions
  const allNotes: string[] = []
  const versions = Object.keys(parsed)
    .sort((a, b) => (gt(a, b) ? -1 : 1))
    .slice(0, 3) // Look at top 3 recent versions

  for (const version of versions) {
    const notes = parsed[version]
    if (notes) {
      allNotes.push(...notes)
    }
  }

  // Return raw notes without filtering or premature truncation
  return allNotes.slice(0, maxItems)
}

const BUG_FIX_RE =
  /^(fix(ed|es)?|resolve[ds]?|correct(ed|s)?|prevent(ed|s)?|(\S+\s+){0,2}no longer|revert(ed|s)?|bug fix(es)?)\b/
const FEATURE_RE =
  /^(add(ed|s)?|new|introduce[ds]?|support(ed|s)?|launch(ed|es)?|ship(ped|s)?|enable[ds]?)\b/
const BRACKET_PREFIX_RE = /^\[[^\]]+\]\s*/
const SCOPE_PREFIX_RE = /^[a-z0-9 /._`-]{1,40}:\s*/
const BUG_FIX_ROLLUP_RE = /^(various )?bug ?fixes\b.*\bimprovements$/
const MAX_NOTE_CLASSIFY_LEN = 500

type ReleaseNoteCategory = 'feature' | 'bugFix' | 'other' | 'bugFixRollup'

function classifyStrippedNote(text: string): 'feature' | 'bugFix' | 'other' {
  if (BUG_FIX_RE.test(text) || text.includes('regression')) return 'bugFix'
  if (FEATURE_RE.test(text)) return 'feature'
  return 'other'
}

function classifyReleaseNote(raw: string): ReleaseNoteCategory {
  const normalized = raw.slice(0, MAX_NOTE_CLASSIFY_LEN).trim().toLowerCase()
  if (BUG_FIX_ROLLUP_RE.test(normalized)) return 'bugFixRollup'
  const direct = classifyStrippedNote(normalized)
  if (direct !== 'other') return direct
  return classifyStrippedNote(
    normalized.replace(BRACKET_PREFIX_RE, '').replace(SCOPE_PREFIX_RE, ''),
  )
}

function formatOxfordList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

export function summarizeReleaseNotes(input: {
  entries: readonly string[]
}): string | null {
  const entries = input.entries.filter(
    entry => typeof entry === 'string' && entry.trim() !== '',
  )
  if (entries.length === 0) return null

  let features = 0
  let bugFixes = 0
  let others = 0
  for (const entry of entries) {
    switch (classifyReleaseNote(entry)) {
      case 'feature':
        features++
        break
      case 'bugFix':
        bugFixes++
        break
      case 'other':
        others++
        break
      case 'bugFixRollup':
        break
    }
  }

  const parts: string[] = []
  if (features > 0) parts.push(`${features} ${plural(features, 'feature')}`)
  if (bugFixes > 0) {
    parts.push(`${bugFixes} ${plural(bugFixes, 'bugfix', 'bugfixes')}`)
  }
  if (others > 0) {
    const noun = parts.length > 0 ? 'other change' : 'change'
    parts.push(`${others} ${plural(others, noun)}`)
  }
  if (parts.length === 0) return 'Updated to latest.'
  return `Updated to latest. Got ${formatOxfordList(parts)}.`
}

function isValidSemver(value: string | undefined): value is string {
  return Boolean(value && coerce(value) !== null)
}

export function hasUnseenReleaseVersion(
  lastSeen: string | undefined,
  currentVersion: string = MACRO.VERSION,
): boolean {
  if (!isValidSemver(currentVersion)) return false
  if (!isValidSemver(lastSeen)) return true
  try {
    const cur = coerce(currentVersion)
    const prev = coerce(lastSeen)
    if (!cur || !prev) return true
    return gt(cur.version, prev.version)
  } catch {
    return true
  }
}

function parseForceFirstLaunchEnv():
  | { pretendLastSeen: string | undefined }
  | undefined {
  const raw = process.env.CLAUDE_CODE_FORCE_FIRST_LAUNCH
  if (raw === undefined) return undefined
  if (isValidSemver(raw)) return { pretendLastSeen: raw }
  return isEnvTruthy(raw) ? { pretendLastSeen: undefined } : undefined
}

function getEntriesBetweenVersions(
  changelogContent: string,
  fromExclusive: string | undefined,
  toInclusive: string,
): string[] {
  const parsed = parseChangelog(changelogContent)
  const sortedVersions = Object.keys(parsed)
    .filter(v => isValidSemver(v))
    .sort((a, b) => (gt(a, b) ? -1 : 1))

  if (fromExclusive === undefined) {
    const latest = sortedVersions[0]
    return latest ? (parsed[latest] ?? []) : []
  }

  const fromVer = coerce(fromExclusive)?.version
  const toVer = coerce(toInclusive)?.version
  if (!fromVer || !toVer) return []

  const out: string[] = []
  for (const version of sortedVersions) {
    const v = coerce(version)?.version
    if (!v) continue
    if (gt(v, fromVer) && !gt(v, toVer)) {
      const notes = parsed[version]
      if (notes) out.push(...notes)
    }
  }
  return out
}

export function _resetStartupUpdateSummaryForTesting(): void {
  const state = logoV2SessionSlot.peek(getBootstrapSession())
  if (state) state.cachedStartupUpdateSummary = undefined
}

export function getStartupUpdateSummary(
  currentVersion: string = MACRO.VERSION,
): string | null {
  const state = getLogoV2SessionState()
  if (state.cachedStartupUpdateSummary !== undefined) {
    return state.cachedStartupUpdateSummary
  }
  try {
    const forced = parseForceFirstLaunchEnv()
    const changelog = getStoredChangelogFromMemory()
    if (forced) {
      const entries = getEntriesBetweenVersions(
        changelog,
        forced.pretendLastSeen,
        currentVersion,
      )
      state.cachedStartupUpdateSummary = summarizeReleaseNotes({ entries })
      return state.cachedStartupUpdateSummary
    }

    const lastSeen = getGlobalConfig().lastReleaseNotesSeen
    if (
      !isValidSemver(lastSeen) ||
      !hasUnseenReleaseVersion(lastSeen, currentVersion)
    ) {
      state.cachedStartupUpdateSummary = null
      return null
    }

    const entries = getEntriesBetweenVersions(
      changelog,
      lastSeen,
      currentVersion,
    )
    state.cachedStartupUpdateSummary = summarizeReleaseNotes({ entries })
    return state.cachedStartupUpdateSummary
  } catch {
    state.cachedStartupUpdateSummary = null
    return null
  }
}
