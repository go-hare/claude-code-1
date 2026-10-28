/**
 * densable 2.1.289 auto-mode server-classifier context producer
 * (`Ya` / `za` / `Xa` / `Nc` / `qc` / `CPo` / `APo` / `Ha` / `M1t` / `JUo`).
 * NEVER `export function Ya`.
 */
import { homedir } from 'os'

import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileWriteTool/prompt.js'

import {
  getOriginalCwd,
  getSessionId,
  isStickyBetaRejected,
} from '../../bootstrap/state.js'
import { DANGEROUS_TOOL_USE_BETA_HEADER } from '../../constants/betas.js'
import { getToolPermissionContextFromLayers } from '../../engine/permissionLayerReaders.js'
import type { ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import type {
  PermissionRule,
  PermissionRuleSource,
} from '../../types/permissions.js'
import { uniq } from '../../utils/array.js'
import { getChromeInstallSessionState } from '../../utils/claudeInChrome/sessionState.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { parseGitRemote } from '../../utils/detectRepository.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { findGitRoot, gitExe } from '../../utils/git.js'
import { logError } from '../../utils/log.js'
import {
  countGitStatusPorcelain,
  resolveGitStatusTruncationLimit,
  resolveGitStatusType,
  resolveGitStatusUploads,
  resolveRepoVisibility,
  truncateGitStatusLines,
} from '../../utils/permissions/autoModeFlags.js'
import { isClassifyAllShellEnabled } from '../../utils/permissions/broadRuleFilter.js'
import {
  patternWithRoot,
  rootPathForSource,
  toPosixPath,
  workingDirPathsForPermission,
} from '../../utils/permissions/filesystem.js'
import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from '../../utils/permissions/permissionRuleParser.js'
import { getAllowRules } from '../../utils/permissions/permissions.js'
import { getPlatform } from '../../utils/platform.js'
import { SETTING_SOURCES } from '../../utils/settings/constants.js'
import { getAutoModeConfig } from '../../utils/settings/settings.js'
import { isDisklessLaunch } from '../../utils/sessionHost.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getGitEmail } from '../../utils/user.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { resolveAutoModeClassifierTransport } from './autoModeClassifierTransport.js'

/** densable `ARn` / `aZe` / `vPo` / `dZe` / `uZe` / `PRn` / `pZe` / `G0r` / `Y6n` / `jan` / `gZe` */
const ALLOW_RULES_CAP = 64
const IDENTITY_CLAMP = 200
const CONTEXT_OVER_CEILING_BYTES = 256_000
const PATH_CLAMP = 1024
const LIST_CAP = 16
const SHED_BUDGET_BYTES = 128_000
const GIT_STRING_CLAMP = 1024
const PORCELAIN_CAP = 4096
const REMOTES_CAP = 32
const VISIBILITY_CACHE_CAP = 256
const HOST_CLAMP = 260

/** densable `Fc` / `Wa` / `Qa` / `Dc` / `Oc` */
const GIT_PROBE_WAIT_MS = 300
const CHROME_SESSION_ID_SLICE = 128
const USER_IDENTITY_TIMEOUT_MS = 2000

/** densable `WNe` / `QUo` */
const COMPOSE_SHED_BUDGET_BYTES = 256_000
const COMPOSE_WITHHOLD_BYTES = 1_040_000

/** densable `YPe` order */
const CLASSIFIER_RULE_SOURCES: readonly PermissionRuleSource[] = [
  ...SETTING_SOURCES,
  'cliArg',
  'command',
  'session',
  'toolsNarrowing',
  'mcpServerPolicy',
  'hostCredential',
]

const USER_IDENTITY_SANITIZE = /[^a-zA-Z0-9._-]/g
const GIT_TOKEN_SANITIZE = /[^a-zA-Z0-9._/-]/g

type SerializedRule = {
  rule: string
  source: string
  canonical?: string
  root?: string | null
  pattern?: string
}

type PermissionRuleWithStored = PermissionRule & { stored?: string }

export type ClassifierContextJson = {
  permission_mode: string
  platform: string
  live_cwd: string
  home_dir: string
  rule_roots: Record<string, string>
  trusted_directories: {
    primary: { path: string; resolved: string[] }
    additional: Array<{ path: string; resolved: string[]; source: string }>
    network: string[]
    block_reads_outside_working_directories: boolean
  }
  rules: {
    allow: SerializedRule[]
    deny: SerializedRule[]
    ask: SerializedRule[]
  }
  case_insensitive_paths: boolean
  auto_mode: {
    allow: string[]
    soft_deny: string[]
    hard_deny: string[]
    environment: string[]
  }
  artifact_consent_holdback: boolean
  chrome_navigation?: {
    enabled: boolean
    baselines: Record<string, string>
    tabs?: Record<string, Record<string, string>>
  }
  truncated?: boolean
  restricted: boolean
  is_remote_mode: boolean
  classify_all_shell: boolean
  user_identity: string | null
  dropped?: Record<string, number>
}

export type ClassifierGitRemote = {
  name: string
  host: string
  remote: string
  visibility: string
}

export type ClassifierGitState = {
  cwd: string
  root: string | null
  branch: string | null
  default_branch: string | null
  status: {
    clean: boolean
    counts: {
      staged: number
      modified: number
      untracked: number | null
      untracked_normal: number | null
    } | null
    porcelain: string | null
    truncated: boolean
  } | null
  visibility: {
    origin: {
      host: string
      remote: string
      visibility: string
    } | null
    push_remote: string | null
    remotes: ClassifierGitRemote[]
    visibility_cache: Array<{ host: string }>
  } | null
  error?: string
  truncated?: boolean
}

export type AutoModeServerContextKickoff = {
  tools: ToolUseContext['options']['tools']
  context: Promise<ClassifierContextJson | undefined>
  git: Promise<ClassifierGitState>
  cwd: string
  startedAt: number
  overCeilingLogged?: boolean
  logged?: boolean
}

export type AutoModeServerContextResolved = {
  context: ClassifierContextJson
  git: ClassifierGitState
  artifacts?: unknown
}

const defaultTimers = {
  setTimeout: (fn: () => void, ms: number): (() => void) => {
    const handle = setTimeout(fn, ms)
    return () => clearTimeout(handle)
  },
}

/** densable leftover `Y5t` — artifact consent latch, default true → holdback false. */
let artifactConsentGranted: (() => boolean) | undefined

export function setArtifactConsentGrantedReader(
  reader: (() => boolean) | undefined,
): void {
  artifactConsentGranted = reader
}

function artifactConsentGrantedNow(): boolean {
  return artifactConsentGranted?.() ?? true
}

/** densable `Une` */
export function classifierContextBytes(value: unknown): number {
  return Buffer.byteLength(jsonStringify(value))
}

function clampString(
  value: string,
  max: number,
  flags: { pathClamped?: boolean; identityClamped?: boolean },
  flag: 'pathClamped' | 'identityClamped',
): string {
  if (value.length <= max) return value
  flags[flag] = true
  return value.slice(0, max)
}

function addDropped(
  flags: { dropped: Record<string, number> },
  key: string,
  n: number,
): void {
  if (n > 0) flags.dropped[key] = (flags.dropped[key] ?? 0) + n
}

function posixPath(path: string): string {
  return toPosixPath(path)
}

function mapRecord(
  record: Record<string, string>,
  map: (value: string) => string,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) next[key] = map(value)
  return next
}

type ShedStats = {
  bytes: number
  bytesBeforeShedding: number
  overCapBeforeShedding: boolean
  overCap: boolean
  allowRulesShed: number
  resolvedSpellingsShed: boolean
  pathClamped: boolean
  identityClamped: boolean
  additionalDirectories: number
  networkRoots: number
  arrivedTruncated: boolean
  truncated: boolean
  dropped: Record<string, number>
  denyRules: number
  askRules: number
  autoMode: {
    allow: number
    softDeny: number
    hardDeny: number
    environment: number
  }
}

/**
 * densable `CPo` @187350554.
 */
export function shedClassifierContext(
  input: ClassifierContextJson,
  onIncomplete: (stats: ShedStats) => void,
): ClassifierContextJson {
  let allowCap = ALLOW_RULES_CAP
  let pass = 0
  let first = { bytes: 0, allowDropped: 0 }
  for (;;) {
    const flags = {
      pathClamped: false,
      identityClamped: false,
      listCapped: false,
      spellingsShed: false,
      dropped: { ...(input.dropped ?? {}) },
    }
    const clampPath = (value: string) =>
      clampString(value, PATH_CLAMP, flags, 'pathClamped')
    const stripRule = (rule: SerializedRule): SerializedRule => ({
      rule: rule.rule,
      ...(rule.canonical !== undefined && { canonical: rule.canonical }),
      source: rule.source,
      ...(rule.root !== undefined && {
        root: rule.root === null ? null : clampPath(rule.root),
      }),
      ...(rule.pattern !== undefined && { pattern: rule.pattern }),
    })
    const capRules = (
      kind: 'allow' | 'deny' | 'ask',
      rules: SerializedRule[],
    ): SerializedRule[] => {
      const maxLen = kind === 'allow' ? IDENTITY_CLAMP : PATH_CLAMP
      const kept = rules.filter(rule => rule.rule.length <= maxLen)
      addDropped(flags, kind, rules.length - kept.length)
      if (kind !== 'allow' || kept.length <= allowCap)
        return kept.map(stripRule)
      addDropped(flags, kind, kept.length - allowCap)
      return kept.slice(0, allowCap).map(stripRule)
    }
    const arrivedTruncated = (): boolean =>
      input.truncated === true ||
      flags.pathClamped ||
      flags.identityClamped ||
      flags.listCapped ||
      flags.spellingsShed
    const clampTrusted = (dir: {
      path: string
      resolved: string[]
    }): { path: string; resolved: string[] } => {
      if (pass >= 2 && dir.resolved.length > 0) flags.spellingsShed = true
      return {
        path: clampPath(dir.path),
        resolved: pass >= 2 ? [] : dir.resolved.map(clampPath),
      }
    }
    const additional = input.trusted_directories.additional.slice(0, LIST_CAP)
    if (additional.length < input.trusted_directories.additional.length) {
      flags.listCapped = true
    }
    const network = input.trusted_directories.network
      .slice(0, LIST_CAP)
      .map(clampPath)
    if (network.length < input.trusted_directories.network.length) {
      flags.listCapped = true
    }
    const next: ClassifierContextJson = {
      permission_mode: input.permission_mode,
      platform: input.platform,
      live_cwd: clampPath(input.live_cwd),
      home_dir: clampPath(input.home_dir),
      rule_roots: mapRecord(input.rule_roots, clampPath),
      trusted_directories: {
        primary: clampTrusted(input.trusted_directories.primary),
        additional: additional.map(dir => ({
          ...clampTrusted(dir),
          source: dir.source,
        })),
        network,
        block_reads_outside_working_directories:
          input.trusted_directories.block_reads_outside_working_directories,
      },
      rules: {
        allow: capRules('allow', input.rules.allow),
        deny: capRules('deny', input.rules.deny),
        ask: capRules('ask', input.rules.ask),
      },
      auto_mode: {
        allow: [...input.auto_mode.allow],
        soft_deny: [...input.auto_mode.soft_deny],
        hard_deny: [...input.auto_mode.hard_deny],
        environment: [...input.auto_mode.environment],
      },
      artifact_consent_holdback: input.artifact_consent_holdback,
      ...(input.chrome_navigation !== undefined && {
        chrome_navigation: input.chrome_navigation,
      }),
      case_insensitive_paths: input.case_insensitive_paths,
      restricted: input.restricted,
      is_remote_mode: input.is_remote_mode,
      classify_all_shell: input.classify_all_shell,
      user_identity:
        input.user_identity === null
          ? null
          : clampString(
              input.user_identity,
              IDENTITY_CLAMP,
              flags,
              'identityClamped',
            ),
      ...(Object.keys(flags.dropped).length > 0 && { dropped: flags.dropped }),
      ...(arrivedTruncated() && { truncated: true }),
    }
    const bytes = classifierContextBytes(next)
    if (pass === 0) first = { bytes, allowDropped: flags.dropped.allow ?? 0 }
    const over = bytes > SHED_BUDGET_BYTES
    if (over) {
      if (pass === 0 || (pass === 1 && allowCap > 0)) {
        pass = 1
        allowCap = Math.floor(allowCap / 2)
        continue
      }
      if (pass < 2) {
        pass++
        continue
      }
    }
    const out = over ? { ...next, truncated: true } : next
    if (out.truncated === true || out.dropped !== undefined) {
      onIncomplete({
        bytes: out === next ? bytes : classifierContextBytes(out),
        bytesBeforeShedding: first.bytes,
        overCapBeforeShedding: pass > 0,
        overCap: over,
        allowRulesShed: (flags.dropped.allow ?? 0) - first.allowDropped,
        resolvedSpellingsShed: flags.spellingsShed,
        pathClamped: flags.pathClamped,
        identityClamped: flags.identityClamped,
        additionalDirectories: input.trusted_directories.additional.length,
        networkRoots: input.trusted_directories.network.length,
        arrivedTruncated: input.truncated === true,
        truncated: out.truncated === true,
        dropped: flags.dropped,
        denyRules: input.rules.deny.length,
        askRules: input.rules.ask.length,
        autoMode: {
          allow: input.auto_mode.allow.length,
          softDeny: input.auto_mode.soft_deny.length,
          hardDeny: input.auto_mode.hard_deny.length,
          environment: input.auto_mode.environment.length,
        },
      })
    }
    return out
  }
}

/**
 * densable `APo` @187353560.
 */
export function clampClassifierGitState(
  git: ClassifierGitState,
): ClassifierGitState {
  let truncated = git.truncated === true
  const clamp = (value: string): string => {
    if (value.length <= GIT_STRING_CLAMP) return value
    truncated = true
    return value.slice(0, GIT_STRING_CLAMP)
  }
  const clampNull = (value: string | null): string | null =>
    value === null ? null : clamp(value)
  const clampHost = (value: string): string => {
    if (value.length <= HOST_CLAMP) return value
    truncated = true
    return value.slice(0, HOST_CLAMP)
  }
  const cap = <T>(list: T[], max: number): T[] => {
    if (list.length > max) truncated = true
    return list.slice(0, max)
  }
  const visibility = git.visibility
  return {
    cwd: clamp(git.cwd),
    root: clampNull(git.root),
    branch: clampNull(git.branch),
    default_branch: clampNull(git.default_branch),
    status: git.status,
    visibility:
      visibility === null
        ? null
        : {
            origin:
              visibility.origin === null
                ? null
                : {
                    ...visibility.origin,
                    host: clampHost(visibility.origin.host),
                  },
            push_remote: clampNull(visibility.push_remote),
            remotes: cap(visibility.remotes, REMOTES_CAP).map(remote => ({
              ...remote,
              host: clampHost(remote.host),
            })),
            visibility_cache: cap(
              visibility.visibility_cache,
              VISIBILITY_CACHE_CAP,
            ).map(entry => ({ ...entry, host: clampHost(entry.host) })),
          },
    ...(git.error !== undefined && { error: git.error }),
    ...(truncated && { truncated: true }),
  }
}

function serializeRules(
  _behavior: 'allow' | 'deny' | 'ask',
  rules: PermissionRuleWithStored[],
): SerializedRule[] {
  return rules.map(rule => {
    const canonical = permissionRuleValueToString(rule.ruleValue)
    const stored = rule.stored
    const serialized: SerializedRule = {
      rule: stored ?? canonical,
      source: rule.source,
      ...(stored !== undefined && stored !== canonical && { canonical }),
    }
    const { toolName, ruleContent } = rule.ruleValue
    if (
      ruleContent === undefined ||
      (toolName !== FILE_READ_TOOL_NAME && toolName !== FILE_WRITE_TOOL_NAME)
    ) {
      return serialized
    }
    const rooted = patternWithRoot(ruleContent, rule.source)
    return {
      ...serialized,
      root: rooted.root === null ? null : posixPath(rooted.root),
      pattern: rooted.relativePattern,
    }
  })
}

function rulesFromStored(
  stored: Partial<Record<PermissionRuleSource, readonly string[] | undefined>>,
  behavior: 'deny' | 'ask',
): PermissionRuleWithStored[] {
  return CLASSIFIER_RULE_SOURCES.flatMap(source =>
    (stored[source] ?? []).map(value => ({
      source,
      ruleBehavior: behavior,
      ruleValue: permissionRuleValueFromString(value),
      stored: value,
    })),
  )
}

function chromeUrlOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout((ok, value) => ok(value), ms, resolve, fallback)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function classifierUserIdentity(): Promise<string | null> {
  const envName =
    process.env.GITHUB_ACTOR ?? process.env.USER ?? process.env.USERNAME
  const email =
    envName === undefined && !isDisklessLaunch()
      ? ((await getGitEmail()) ?? null)
      : null
  const raw = envName ?? (email ? email.split('@')[0] : null)
  return raw?.replace(USER_IDENTITY_SANITIZE, '').slice(0, 64) || null
}

let lastIncompleteCwd: string | undefined

/**
 * densable `qc` @195397185.
 */
export async function buildClassifierContextJson(
  context: ToolPermissionContext,
  isRemote = false,
): Promise<ClassifierContextJson> {
  const { mcpServerPolicy: _mcpAsk, ...askWithoutMcp } = context.alwaysAskRules
  const autoMode = getAutoModeConfig()
  const sessionId = getSessionId()
  const lastUrl =
    getChromeInstallSessionState().lastExecutedTabUrlByScope.get(sessionId)
  const baselines =
    lastUrl === undefined ? [] : ([[sessionId, lastUrl]] as const)
  const chrome =
    baselines.length === 0
      ? undefined
      : {
          enabled: context.chromeClassifierFloorEnabled === true,
          baselines: Object.fromEntries(
            baselines.map(([id, url]) => [
              id.slice(0, CHROME_SESSION_ID_SLICE),
              chromeUrlOrigin(url),
            ]),
          ),
        }
  const trustedPath = (path: string) => ({
    path: posixPath(path),
    resolved: workingDirPathsForPermission(path).map(posixPath),
  })
  const built: ClassifierContextJson = {
    permission_mode: context.mode,
    platform: getPlatform(),
    live_cwd: posixPath(getCwd()),
    home_dir: posixPath(homedir().normalize('NFC')),
    rule_roots: Object.fromEntries(
      CLASSIFIER_RULE_SOURCES.map(source => [
        source,
        posixPath(rootPathForSource(source)),
      ]),
    ),
    trusted_directories: {
      primary: trustedPath(getOriginalCwd()),
      additional: Array.from(
        context.additionalWorkingDirectories.values(),
        dir => ({ ...trustedPath(dir.path), source: dir.source }),
      ),
      network: uniq(
        Array.from(
          context.trustedNetworkDirectories?.entries() ?? [],
          ([k, v]) => [k, ...v],
        )
          .flat()
          .map(posixPath),
      ),
      block_reads_outside_working_directories:
        context.blockReadsOutsideWorkingDirectories === true,
    },
    rules: {
      allow: serializeRules('allow', getAllowRules(context)),
      deny: serializeRules(
        'deny',
        rulesFromStored(context.alwaysDenyRules, 'deny'),
      ),
      ask: serializeRules('ask', rulesFromStored(askWithoutMcp, 'ask')),
    },
    case_insensitive_paths: getPlatform() === 'windows',
    auto_mode: {
      allow: autoMode?.allow ?? [],
      soft_deny: autoMode?.soft_deny ?? [],
      hard_deny: autoMode?.hard_deny ?? [],
      environment: autoMode?.environment ?? [],
    },
    artifact_consent_holdback: !artifactConsentGrantedNow(),
    ...(chrome !== undefined && { chrome_navigation: chrome }),
    restricted: context.restricted === true,
    is_remote_mode: isRemote,
    classify_all_shell: isClassifyAllShellEnabled(),
    user_identity: await raceTimeout(
      classifierUserIdentity(),
      USER_IDENTITY_TIMEOUT_MS,
      null,
    ),
  }
  return shedClassifierContext(built, stats => {
    const cwd = getCwd()
    if (lastIncompleteCwd === cwd) return
    lastIncompleteCwd = cwd
    logEvent('tengu_auto_mode_context_incomplete', {
      bytes: stats.bytes,
      bytes_before_shedding: stats.bytesBeforeShedding,
      over_cap_before_shedding: stats.overCapBeforeShedding,
      over_cap: stats.overCap,
      allow_rules_shed: stats.allowRulesShed,
      resolved_spellings_shed: stats.resolvedSpellingsShed,
      path_clamped: stats.pathClamped,
      identity_clamped: stats.identityClamped,
      additional_directories: stats.additionalDirectories,
      network_roots: stats.networkRoots,
      chrome_tabs_cut: false,
      truncated: stats.truncated,
      dropped_allow: stats.dropped.allow ?? 0,
      dropped_deny: stats.dropped.deny ?? 0,
      dropped_ask: stats.dropped.ask ?? 0,
      deny_rules: stats.denyRules,
      ask_rules: stats.askRules,
      auto_mode_allow: stats.autoMode.allow,
      auto_mode_soft_deny: stats.autoMode.softDeny,
      auto_mode_hard_deny: stats.autoMode.hardDeny,
      auto_mode_environment: stats.autoMode.environment,
    })
  })
}

function emptyGit(
  cwd: string,
  error: string,
  visibilityOn: boolean,
): ClassifierGitState {
  return {
    cwd,
    root: null,
    branch: null,
    default_branch: null,
    status: null,
    visibility: visibilityOn
      ? {
          origin: null,
          push_remote: null,
          remotes: [],
          visibility_cache: [],
        }
      : null,
    error,
  }
}

type GitRun = {
  ok: boolean
  stdout: string
  code: number | null
  timedOut: boolean
  overflowed: boolean
}

async function runGit(
  cwd: string,
  args: string[],
  options: { abortSignal?: AbortSignal } = {},
): Promise<GitRun> {
  try {
    const result = await execFileNoThrowWithCwd(
      gitExe(),
      ['--no-optional-locks', ...args],
      {
        cwd,
        env: { GIT_OPTIONAL_LOCKS: '0' },
        abortSignal: options.abortSignal,
        maxBuffer: 1_000_000,
        preserveOutputOnError: false,
        stripFinalNewline: false,
      },
    )
    if (result.code === 0) {
      return {
        ok: true,
        stdout: result.stdout,
        code: 0,
        timedOut: false,
        overflowed: false,
      }
    }
    return {
      ok: false,
      stdout: result.stdout ?? '',
      code: result.code ?? null,
      timedOut: /timed out/i.test(result.error ?? ''),
      overflowed: false,
    }
  } catch {
    return {
      ok: false,
      stdout: '',
      code: null,
      timedOut: false,
      overflowed: false,
    }
  }
}

async function porcelainStatus(
  cwd: string,
  uploadsOn: boolean,
  signal: AbortSignal,
): Promise<{ normal: GitRun; all: GitRun | null }> {
  const run = (untracked: 'normal' | 'all') =>
    runGit(
      cwd,
      [
        'status',
        '--porcelain',
        '--ignore-submodules=dirty',
        `--untracked-files=${untracked}`,
      ],
      { abortSignal: signal },
    )
  const [normal, all] = await Promise.all([
    run('normal'),
    uploadsOn ? run('all') : Promise.resolve(null),
  ])
  return { normal, all }
}

function sanitizeGitToken(value: string): string {
  return value.replace(GIT_TOKEN_SANITIZE, '').slice(0, 128)
}

function sanitizeGitName(value: string): string | null {
  return sanitizeGitToken(value) === value && value !== '' ? value : null
}

function sanitizeGitBranch(value: string): string | null {
  return sanitizeGitToken(value) || null
}

type GitRemoteUrls = { url: string[]; pushurl: string[] }

type GitRemoteConfig = {
  remotes: Map<string, GitRemoteUrls>
  branchRemotes: Map<string, string>
  pushDefault: string | undefined
}

async function readGitRemoteConfig(
  cwd: string,
  signal: AbortSignal,
): Promise<GitRemoteConfig | null> {
  const result = await runGit(
    cwd,
    [
      'config',
      '-z',
      '--get-regexp',
      '^(remote\\..+\\.(url|pushurl)|remote\\.pushdefault|branch\\..+\\.remote)$',
    ],
    { abortSignal: signal },
  )
  const empty: GitRemoteConfig = {
    remotes: new Map(),
    branchRemotes: new Map(),
    pushDefault: undefined,
  }
  if (!result.ok) {
    return result.code === 1 && !result.timedOut && !result.overflowed
      ? empty
      : null
  }
  for (const record of result.stdout.split('\0')) {
    const nl = record.indexOf('\n')
    if (nl < 0) continue
    const key = record.slice(0, nl)
    const value = record.slice(nl + 1)
    if (key === 'remote.pushdefault') {
      empty.pushDefault = value
      continue
    }
    const remoteMatch = key.match(/^remote\.(.+)\.(url|pushurl)$/)
    if (remoteMatch !== null) {
      const name = remoteMatch[1]
      const kind = remoteMatch[2]
      if (name === undefined || (kind !== 'url' && kind !== 'pushurl')) {
        continue
      }
      const entry = empty.remotes.get(name) ?? { url: [], pushurl: [] }
      entry[kind].push(value)
      empty.remotes.set(name, entry)
      continue
    }
    const branchMatch = key.match(/^branch\.(.+)\.remote$/)
    if (branchMatch !== null && branchMatch[1] !== undefined) {
      empty.branchRemotes.set(branchMatch[1], value)
    }
  }
  return empty
}

function pushRemoteName(
  config: GitRemoteConfig,
  branch: string | null,
): string {
  return (
    (branch !== null && branch !== 'HEAD'
      ? config.branchRemotes.get(branch)
      : undefined) ??
    config.pushDefault ??
    'origin'
  )
}

function parseClassifierRemotes(
  config: GitRemoteConfig,
): ClassifierGitRemote[] {
  const remotes: ClassifierGitRemote[] = []
  for (const [name, urls] of config.remotes) {
    const sanitized = sanitizeGitName(name)
    if (sanitized === null) continue
    const candidates = urls.pushurl.length > 0 ? urls.pushurl : urls.url
    const seen = new Set<string>()
    for (const url of candidates) {
      const parsed = parseGitRemote(url)
      if (parsed === null) continue
      const slug = `${parsed.owner}/${parsed.name}`
      const key = `${parsed.host}/${slug}`
      if (seen.has(key)) continue
      seen.add(key)
      remotes.push({
        name: sanitized,
        host: parsed.host,
        remote: sanitizeGitToken(slug),
        visibility: 'unknown',
      })
    }
  }
  remotes.sort(
    (a, b) => a.name.localeCompare(b.name) || a.remote.localeCompare(b.remote),
  )
  return remotes
}

function originFromConfig(config: GitRemoteConfig | null): {
  host: string
  remote: string
  visibility: string
} | null {
  if (config === null) return null
  const origin = config.remotes.get('origin')
  if (origin === undefined) return null
  const urls = origin.pushurl.length > 0 ? origin.pushurl : origin.url
  for (const url of urls) {
    const parsed = parseGitRemote(url)
    if (parsed === null) continue
    return {
      host: parsed.host,
      remote: sanitizeGitToken(`${parsed.owner}/${parsed.name}`),
      visibility: 'unknown',
    }
  }
  return null
}

async function defaultBranchName(
  cwd: string,
  signal: AbortSignal,
): Promise<string | null> {
  const result = await runGit(
    cwd,
    ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
    { abortSignal: signal },
  )
  const name = result.ok ? result.stdout.trim().replace(/^origin\//, '') : ''
  return name === '' ? null : name
}

/**
 * densable `Ha` @195395382 — classifier git probe (not dPu fetchAutoModeGitStatus).
 */
export async function probeClassifierGitState(
  cwd: string,
  signal: AbortSignal,
): Promise<ClassifierGitState> {
  let visibilityOn = false
  try {
    visibilityOn = resolveRepoVisibility()
  } catch {
    visibilityOn = false
  }
  const failed = (error: string) => emptyGit(cwd, error, visibilityOn)
  if (isDisklessLaunch()) return failed('error')
  try {
    const root = findGitRoot(cwd)
    if (root === null) return failed('not_a_repo')
    const wantType = resolveGitStatusType().value
    const wantUploads = resolveGitStatusUploads().value
    const [status, branch, defaultBranch, remotesConfig] = await Promise.all([
      wantType || wantUploads
        ? porcelainStatus(cwd, wantUploads, signal)
        : null,
      runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], {
        abortSignal: signal,
      }),
      defaultBranchName(cwd, signal),
      visibilityOn ? readGitRemoteConfig(cwd, signal) : null,
    ])
    const branchRaw = branch.ok ? branch.stdout.trim() : null
    const branchName = branchRaw === null ? null : sanitizeGitBranch(branchRaw)
    const defaultName =
      defaultBranch === null ? null : sanitizeGitBranch(defaultBranch)
    const remoteRows =
      remotesConfig === null ? [] : parseClassifierRemotes(remotesConfig)
    const truncated =
      remoteRows.length > REMOTES_CAP ||
      branchName !== branchRaw ||
      defaultName !== defaultBranch
    const base: ClassifierGitState = {
      cwd,
      root,
      branch: branchName,
      default_branch: defaultName,
      visibility: visibilityOn
        ? {
            origin: originFromConfig(remotesConfig),
            push_remote:
              remotesConfig === null
                ? null
                : sanitizeGitName(pushRemoteName(remotesConfig, branchRaw)),
            remotes: remoteRows.slice(0, REMOTES_CAP),
            visibility_cache: [],
          }
        : null,
      ...(truncated && { truncated: true }),
      status: null,
    }
    if (status === null) return base
    const { normal, all } = status
    const used = all?.ok ? all : normal.ok ? normal : null
    if (used === null) {
      return {
        ...base,
        status: null,
        error:
          (!normal.ok && normal.timedOut) ||
          (all !== null && !all.ok && all.timedOut)
            ? 'timeout'
            : 'error',
      }
    }
    const lines = used.stdout.split('\n').filter(line => line.length > 0)
    const ordered = [
      ...lines.filter(line => line.startsWith('??')),
      ...lines.filter(line => !line.startsWith('??')),
    ].join('\n')
    const limit = resolveGitStatusTruncationLimit().value
    const porcelain = wantUploads
      ? truncateGitStatusLines(
          ordered,
          limit > 0 ? Math.min(limit, PORCELAIN_CAP) : PORCELAIN_CAP,
        )
      : null
    const counts = countGitStatusPorcelain(used.stdout)
    return {
      ...base,
      status: {
        clean: lines.length === 0,
        counts: wantType
          ? {
              staged: counts.staged,
              modified: counts.modified,
              untracked: all?.ok ? counts.untracked : null,
              untracked_normal: normal.ok
                ? countGitStatusPorcelain(normal.stdout).untracked
                : null,
            }
          : null,
        porcelain,
        truncated:
          porcelain !== null && (used !== all || porcelain !== ordered),
      },
    }
  } catch {
    return failed('error')
  }
}

function raceGit(
  git: Promise<ClassifierGitState>,
  timers: typeof defaultTimers,
  ms: number,
  fallback: ClassifierGitState,
): Promise<ClassifierGitState> {
  return new Promise(resolve => {
    let done = false
    const cancel = timers.setTimeout(() => {
      if (!done) {
        done = true
        resolve(fallback)
      }
    }, ms)
    git.then(
      value => {
        if (!done) {
          done = true
          cancel()
          resolve(value)
        }
      },
      () => {
        if (!done) {
          done = true
          cancel()
          resolve(fallback)
        }
      },
    )
  })
}

/**
 * densable `Ya` @195399877.
 */
export function kickoffAutoModeServerContext(
  toolUseContext: ToolUseContext,
  stickyRejected: boolean = isStickyBetaRejected(
    DANGEROUS_TOOL_USE_BETA_HEADER,
  ),
): AutoModeServerContextKickoff | undefined {
  try {
    const permissions = getToolPermissionContextFromLayers(toolUseContext)
    if (
      resolveAutoModeClassifierTransport(permissions.mode) === 'off' ||
      stickyRejected
    ) {
      return
    }
    const cwd = getCwd()
    return {
      tools: toolUseContext.options.tools,
      context: buildClassifierContextJson(
        permissions,
        permissions.servedCall === true,
      ).catch(error => {
        logError(error)
        return undefined
      }),
      git: probeClassifierGitState(cwd, toolUseContext.abortController.signal),
      cwd,
      startedAt: Date.now(),
    }
  } catch (error) {
    logError(error)
    return
  }
}

/**
 * densable `za` @195400178.
 */
export function isServerClassifierKickoffActive(
  toolUseContext: ToolUseContext,
): boolean {
  try {
    return (
      resolveAutoModeClassifierTransport(
        getToolPermissionContextFromLayers(toolUseContext).mode,
      ) !== 'off'
    )
  } catch (error) {
    logError(error)
    return false
  }
}

/**
 * densable `Nc` / `Xa` @195400252.
 */
export async function awaitAutoModeServerContext(
  kickoff: AutoModeServerContextKickoff | undefined,
  timers = defaultTimers,
): Promise<AutoModeServerContextResolved | undefined> {
  if (kickoff === undefined) return
  try {
    const context = await kickoff.context
    if (context === undefined) return
    const bytes = classifierContextBytes(context)
    if (
      bytes > CONTEXT_OVER_CEILING_BYTES &&
      kickoff.overCeilingLogged === undefined
    ) {
      kickoff.overCeilingLogged = true
      logEvent('tengu_auto_mode_context_over_ceiling', { bytes })
    }
    const waitStarted = Date.now()
    const git = clampClassifierGitState(
      await raceGit(
        kickoff.git,
        timers,
        GIT_PROBE_WAIT_MS,
        emptyGit(kickoff.cwd, 'pending', false),
      ),
    )
    if (kickoff.logged === undefined) {
      kickoff.logged = true
      const outcome =
        git.error ??
        (git.status === null
          ? 'no_status'
          : git.status.clean
            ? 'clean'
            : 'dirty')
      logEvent('tengu_auto_mode_git_state_probe', {
        duration_ms: waitStarted - kickoff.startedAt,
        wait_ms: Date.now() - waitStarted,
        outcome:
          outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        truncated: git.truncated === true || git.status?.truncated === true,
      })
    }
    return { context, git }
  } catch (error) {
    logError(error)
    return
  }
}

type ComposedClassifierContext = ClassifierContextJson & {
  v?: 1
  git_state: ClassifierGitState
  prior_turn_context?: unknown[]
  system_reminders?: unknown[]
  artifacts?: unknown
  shed?: string[]
}

/**
 * densable `JUo` — field-level shed to WNe.
 */
function composeAndShedClassifierContext(
  context: ClassifierContextJson,
  git: ClassifierGitState,
  priorTurn: unknown[],
  systemReminders: unknown[],
  artifacts: unknown,
): ComposedClassifierContext {
  const compose = (
    nextGit: ClassifierGitState,
    includeTabs: boolean,
    nextPrior: unknown[],
    nextReminders: unknown[],
    nextArtifacts: unknown,
    shed: string[],
  ): ComposedClassifierContext => {
    const chrome = context.chrome_navigation
    return {
      v: 1,
      ...context,
      ...(chrome !== undefined && {
        chrome_navigation: includeTabs
          ? chrome
          : { enabled: chrome.enabled, baselines: chrome.baselines },
      }),
      git_state: nextGit,
      ...(nextPrior.length > 0 && { prior_turn_context: nextPrior }),
      ...(nextReminders.length > 0 && { system_reminders: nextReminders }),
      ...(nextArtifacts !== undefined && { artifacts: nextArtifacts }),
      ...(shed.length > 0 && { shed }),
    }
  }

  let nextGit = git
  let includeTabs = context.chrome_navigation?.tabs !== undefined
  let nextPrior = priorTurn
  let nextReminders = systemReminders
  let nextArtifacts = artifacts
  const shed: string[] = []
  const fits = () =>
    classifierContextBytes(
      compose(
        nextGit,
        includeTabs,
        nextPrior,
        nextReminders,
        nextArtifacts,
        shed,
      ),
    ) <= COMPOSE_SHED_BUDGET_BYTES

  if (fits()) {
    return compose(
      nextGit,
      includeTabs,
      nextPrior,
      nextReminders,
      nextArtifacts,
      shed,
    )
  }

  if (nextPrior.length > 0) {
    let keep = nextPrior.length
    while (keep > 0) {
      keep = Math.floor(keep / 2)
      nextPrior = keep > 0 ? priorTurn.slice(priorTurn.length - keep) : []
      if (keep === 0) shed.push('prior_turn_context')
      if (fits()) {
        return compose(
          nextGit,
          includeTabs,
          nextPrior,
          nextReminders,
          nextArtifacts,
          shed,
        )
      }
    }
  }

  if (includeTabs) {
    includeTabs = false
    shed.push('chrome_navigation.tabs')
    if (fits()) {
      return compose(
        nextGit,
        includeTabs,
        nextPrior,
        nextReminders,
        nextArtifacts,
        shed,
      )
    }
  }

  if (
    nextGit.visibility !== null &&
    nextGit.visibility.visibility_cache.length > 0
  ) {
    nextGit = {
      ...nextGit,
      visibility: { ...nextGit.visibility, visibility_cache: [] },
      truncated: true,
    }
    shed.push('git_state.visibility.visibility_cache')
    if (fits()) {
      return compose(
        nextGit,
        includeTabs,
        nextPrior,
        nextReminders,
        nextArtifacts,
        shed,
      )
    }
  }

  if (nextGit.visibility !== null && nextGit.visibility.remotes.length > 0) {
    nextGit = {
      ...nextGit,
      visibility: { ...nextGit.visibility, remotes: [] },
      truncated: true,
    }
    shed.push('git_state.visibility.remotes')
    if (fits()) {
      return compose(
        nextGit,
        includeTabs,
        nextPrior,
        nextReminders,
        nextArtifacts,
        shed,
      )
    }
  }

  if (nextGit.status !== null && nextGit.status.porcelain !== null) {
    nextGit = {
      ...nextGit,
      status: { ...nextGit.status, porcelain: null, truncated: false },
      truncated: true,
    }
    shed.push('git_state.status.porcelain')
    if (fits()) {
      return compose(
        nextGit,
        includeTabs,
        nextPrior,
        nextReminders,
        nextArtifacts,
        shed,
      )
    }
  }

  if (nextReminders.length > 0) {
    let keep = nextReminders.length
    while (keep > 0) {
      keep = Math.floor(keep / 2)
      nextReminders =
        keep > 0 ? systemReminders.slice(systemReminders.length - keep) : []
      if (keep === 0) shed.push('system_reminders')
      if (fits()) {
        return compose(
          nextGit,
          includeTabs,
          nextPrior,
          nextReminders,
          nextArtifacts,
          shed,
        )
      }
    }
  }

  if (nextArtifacts !== undefined) {
    nextArtifacts = undefined
    shed.push('artifacts')
  }

  const out = compose(
    nextGit,
    includeTabs,
    nextPrior,
    nextReminders,
    nextArtifacts,
    shed,
  )
  if (classifierContextBytes(out) > COMPOSE_SHED_BUDGET_BYTES) {
    logForDebugging(
      `[server-classifier] the permission rule lists alone exceed the auto-mode context budget (${COMPOSE_SHED_BUDGET_BYTES} bytes): every variable part (git state, repository visibility, Chrome tabs, prior-turn history, system-reminder ids, artifact state) was left out of this request's classifier context — trim the deny/ask rules or settings.autoMode entries`,
      { level: 'warn' },
    )
    logEvent('tengu_auto_mode_context_static_over_budget', {
      bytes: classifierContextBytes(out),
      deny_rules: context.rules.deny.length,
      ask_rules: context.rules.ask.length,
      auto_mode_entries:
        context.auto_mode.soft_deny.length + context.auto_mode.hard_deny.length,
    })
  }
  return out
}

/**
 * densable `M1t` @189165752. priorTurn/systemReminders default [] (gold `n??[]`).
 */
export function composeAutoModeClassifierContext(args: {
  autoModeServerContext: AutoModeServerContextResolved
  priorTurnContext?: unknown[]
  systemReminders?: unknown[]
}): ComposedClassifierContext | undefined {
  const composed = composeAndShedClassifierContext(
    args.autoModeServerContext.context,
    args.autoModeServerContext.git,
    args.priorTurnContext ?? [],
    args.systemReminders ?? [],
    args.autoModeServerContext.artifacts,
  )
  const bytes = classifierContextBytes(composed)
  if (bytes > COMPOSE_WITHHOLD_BYTES) {
    logEvent('tengu_auto_mode_context_withheld', {
      reason:
        'field_over_ceiling' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      bytes,
    })
    return
  }
  return composed
}

/** densable `x1t` — cache fingerprint. */
export function slimClassifierContextForHistory(
  composed: ComposedClassifierContext,
): {
  git_state: ClassifierGitState
  chrome_navigation?: ClassifierContextJson['chrome_navigation']
  live_cwd: string
  platform: string
} {
  return {
    git_state: composed.git_state,
    ...(composed.chrome_navigation !== undefined && {
      chrome_navigation: composed.chrome_navigation,
    }),
    live_cwd: composed.live_cwd,
    platform: composed.platform,
  }
}
