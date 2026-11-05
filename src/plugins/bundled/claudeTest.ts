/**
 * densable 2.1.289 yfe `cc-plugin-claude-test` (`wr` / `Se` / `He` / `P`).
 */
import { randomBytes, randomUUID } from 'crypto'
import { constants as fsConstants } from 'fs'
import {
  lstat,
  mkdir,
  open as fsOpen,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  utimes,
} from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js'
import {
  leftoverComplianceTaintsSettled,
  leftoverPolicyLimitsDu,
  leftoverPolicyLimitsHost,
  leftoverTaintsInclude,
} from '../../cli/leftoverTulip.js'
import type { Command } from '../../commands.js'
import { getPinnedFeatureValue } from '../../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import type { McpServerConfig } from '../../services/mcp/types.js'
import type { BundledSkillDefinition } from '../../skills/bundledSkills.js'
import { substituteArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { isBareMode } from '../../utils/envUtils.js'
import { errorMessage, getErrnoCode } from '../../utils/errors.js'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { getPlatform } from '../../utils/platform.js'
import { leftoverFu } from '../../utils/plugins/functionHooksModules.js'
import { pluginDataDirPath } from '../../utils/plugins/pluginDirectories.js'
import { safeParseJSON } from '../../utils/json.js'
import { registerBuiltinPlugin } from '../builtinPlugins.js'
import {
  type ClaudeTestSkillKey,
  loadClaudeTestAssets,
} from './claudeTestAssets.js'
import { CLAUDE_TEST_SCAN_FILES } from './claudeTestScanFiles.js'
import {
  HELPER_SERVER_KEY,
  HELPER_STATE,
  LOAD_LINE_LEAD,
  NEEDS_TERMINAL_TEXT,
  NOT_IN_CHARGE_TEXT,
  NOT_STARTED_YET_TEXT,
  otherPluginFirstText,
  RUNNER_AGENT_TYPE,
  register as registerClaudeTestHooks,
  SKILL_NAMES,
  waitPrompt,
} from '../../../vendor/claude-code-mods/mods/cc-plugin-claude-test/hooks/register.js'

export const CLAUDE_TEST_PLUGIN_NAME = 'cc-plugin-claude-test'
export const CLAUDE_TEST_PLUGIN_DESCRIPTION =
  'Claude Test: runs the plain-language specs in .claude-test/specs/ against your local dev server in a real browser and reports PASS or FAIL per spec, with a screenshot'
export const CLAUDE_TEST_PLUGIN_VERSION = '0.4.17'
export const CLAUDE_TEST_GB_FEATURE = 'tengu_mellow_hollerith'
export const CLAUDE_TEST_DATA_PLUGIN_ID = 'claude-test@builtin'
export const CLAUDE_TEST_MARKETPLACE_PLUGIN_NAME = 'claude-test'

export const CLAUDE_TEST_BLOCKED_WORDS = [
  'needs_input',
  'blocked_before_specs',
  'specs_blocked',
  'signin_missing',
  'signin_expired',
  'used_folder',
  'server_unreachable',
  'restart_needed',
  'signin_needed',
  'upload_unsupported',
  'blank_page',
  'assets_blocked',
  'other',
] as const

const CLAUDE_TEST_PLATFORMS = new Set(['linux', 'macos', 'wsl'])

export function getClaudeTestInstalledRoot(): string {
  return join(
    pluginDataDirPath(CLAUDE_TEST_DATA_PLUGIN_ID),
    CLAUDE_TEST_PLUGIN_VERSION,
  )
    .split(sep)
    .join('/')
}

export function portClaudeTestNames(text: string): string {
  return text.replace(
    /claude-test:(run|execute|draft)\b/g,
    (_match, key: string) =>
      SKILL_NAMES[key as ClaudeTestSkillKey] ?? `claude-test:${key}`,
  )
}

export function portClaudeTestInstalledFiles(
  files: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [relPath, content] of Object.entries(files)) {
    out[relPath] =
      relPath.endsWith('.md') || relPath.endsWith('.mjs')
        ? portClaudeTestNames(content)
        : content
  }
  return out
}

export function portClaudeTestPaths(text: string, root: string): string {
  return text
    .replaceAll('${CLAUDE_SKILL_DIR}/../run', () => `${root}/skills/run`)
    .replaceAll('${CLAUDE_SKILL_DIR}', () => `${root}/skills/run`)
}

export function buildClaudeTestBrowserServer(): Record<
  string,
  McpServerConfig
> {
  return {
    [HELPER_SERVER_KEY]: {
      command: 'node',
      args: [
        `${getClaudeTestInstalledRoot()}/skills/run/scripts/playwright-mcp.mjs`,
      ],
      env: { CLAUDE_TEST_PROJECT_DIR: '${CLAUDE_PROJECT_DIR}' },
    },
  }
}

async function readRegularFileMatchingSize(
  filePath: string,
  expectedBytes: number,
): Promise<string | false | undefined> {
  const noFollow = fsConstants.O_NOFOLLOW ?? 0
  const nonBlock = fsConstants.O_NONBLOCK ?? 0
  try {
    const handle = await fsOpen(
      filePath,
      fsConstants.O_RDONLY | noFollow | nonBlock,
    )
    try {
      const st = await handle.stat()
      return st.isFile() && st.nlink < 2 && st.size === expectedBytes
        ? await handle.readFile({ encoding: 'utf8' })
        : false
    } finally {
      await handle.close()
    }
  } catch (err) {
    const code = getErrnoCode(err)
    if (code === 'ENOENT') return undefined
    if (code === 'ELOOP') return false
    throw err
  }
}

async function atomicWriteHelperFile(
  filePath: string,
  content: string,
): Promise<void> {
  const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
  const noFollow = fsConstants.O_NOFOLLOW ?? 0
  try {
    const handle = await fsOpen(
      tmpPath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        noFollow,
      0o600,
    )
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmpPath, filePath)
  } catch (err) {
    await rm(tmpPath, { force: true })
    throw err
  }
}

async function ensureHelperFile(
  filePath: string,
  content: string,
): Promise<boolean> {
  const bytes = Buffer.byteLength(content)
  const existing = await readRegularFileMatchingSize(filePath, bytes)
  if (existing !== undefined) return existing !== content
  try {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
    await atomicWriteHelperFile(filePath, content)
  } catch (err) {
    if ((await readRegularFileMatchingSize(filePath, bytes)) !== content) {
      throw err
    }
  }
  return false
}

async function installClaudeTestFiles(
  root: string,
  files: Record<string, string>,
): Promise<string | undefined> {
  for (const [relPath, content] of Object.entries(files)) {
    const differs = await ensureHelperFile(join(root, relPath), content)
    if (differs) return relPath
  }
  return undefined
}

async function findLinkedAncestor(
  root: string,
  relPaths: string[],
): Promise<string | undefined> {
  const dirs = new Set<string>(['.'])
  for (const relPath of relPaths) {
    for (
      let parent = dirname(relPath);
      parent !== '.';
      parent = dirname(parent)
    ) {
      dirs.add(parent)
    }
  }
  for (const dir of [...dirs].sort()) {
    const st = await lstat(join(root, dir)).catch(() => undefined)
    if (st?.isSymbolicLink()) return dir
  }
  return undefined
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/
const SHA_DIR_RE = /-[0-9a-f]{64}$/
const RUN_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d+)?$/
const STALE_MS = 30 * 24 * 60 * 60 * 1000

async function removeStaleClaudeTestVersions(root: string): Promise<void> {
  try {
    const now = new Date()
    await utimes(root, now, now)
    const cutoff = new Date(Date.now() - STALE_MS)
    const parent = dirname(root)
    const entries = await readdir(parent, { withFileTypes: true })
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        entry.name !== CLAUDE_TEST_PLUGIN_VERSION &&
        SEMVER_RE.test(entry.name) &&
        (await stat(join(parent, entry.name))).mtime < cutoff
      ) {
        await rm(join(parent, entry.name), { recursive: true, force: true })
      }
    }
    const liveRoot = join(parent, 'live')
    const liveDirs = entries.some(
      entry => entry.name === 'live' && entry.isDirectory(),
    )
      ? await readdir(liveRoot, { withFileTypes: true }).catch(() => [])
      : []
    for (const dir of liveDirs) {
      if (!dir.isDirectory() || !SHA_DIR_RE.test(dir.name)) continue
      const runs = await readdir(join(liveRoot, dir.name), {
        withFileTypes: true,
      }).catch(() => [])
      for (const run of runs) {
        const runPath = join(liveRoot, dir.name, run.name)
        if (
          run.isDirectory() &&
          RUN_TS_RE.test(run.name) &&
          (await lstat(runPath)).mtime < cutoff
        ) {
          await rm(runPath, { recursive: true, force: true })
        }
      }
      await rmdir(join(liveRoot, dir.name)).catch(() => {})
    }
  } catch (err) {
    logForDebugging(
      `claude-test: old version folders or live pages not cleaned up: ${errorMessage(err)}`,
    )
  }
}

export async function ensureClaudeTestFilesReady(): Promise<{
  folder: string
  problem?: 'linked' | 'differs' | 'unwritable'
  what?: string
}> {
  const root = getClaudeTestInstalledRoot()
  const { INSTALLED_FILES } = await loadClaudeTestAssets()
  const ported = portClaudeTestInstalledFiles(INSTALLED_FILES)
  try {
    const linked = await findLinkedAncestor(root, Object.keys(ported))
    if (linked !== undefined) {
      logEvent('tengu_feature_sad', {
        feature_name:
          'claude_test_helper_files' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'linked' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return {
        folder: root,
        problem: 'linked',
        what: linked === '.' ? root : join(root, linked),
      }
    }
    const differed = await installClaudeTestFiles(root, ported)
    if (differed !== undefined) {
      logEvent('tengu_feature_sad', {
        feature_name:
          'claude_test_helper_files' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'differs' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return { folder: root, problem: 'differs', what: differed }
    }
  } catch (err) {
    logEvent('tengu_feature_sad', {
      feature_name:
        'claude_test_helper_files' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        'unwritable' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return { folder: root, problem: 'unwritable', what: errorMessage(err) }
  }
  await removeStaleClaudeTestVersions(root)
  logEvent('tengu_feature_ok', {
    feature_name:
      'claude_test_helper_files' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return { folder: root }
}

/**
 * densable Vr("mcpAutoDiscovered") — missing → false so !Vr stays true.
 */
function leftoverVrMcpAutoDiscovered(): boolean {
  try {
    const { getSettings_DEPRECATED } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/settings/settings.js') as typeof import('../../utils/settings/settings.js')
    const settings = getSettings_DEPRECATED() as {
      mcpAutoDiscovered?: unknown
    } | null
    return settings?.mcpAutoDiscovered === true
  } catch {
    return false
  }
}

/**
 * densable iTn — verdict undefined → false; else policyVerdictAbsent catch true.
 * Never export minify `iTn`.
 */
function leftoverItn(): boolean {
  const verdict = leftoverPolicyLimitsHost().verdict
  if (verdict === undefined) return false
  try {
    return leftoverPolicyLimitsDu()
  } catch {
    return true
  }
}

/**
 * densable Se — !Or && !Vr(mcpAutoDiscovered) && sTn && !iTn && !dl(hipaa/zdr)
 * && linux|macos|wsl && uid≠0 && eo(tengu_mellow_hollerith, false).
 * Never export minify `Se`.
 */
function leftoverSe(): boolean {
  if (isBareMode()) return false
  if (leftoverVrMcpAutoDiscovered()) return false
  if (!leftoverComplianceTaintsSettled()) return false
  if (leftoverItn()) return false
  if (leftoverTaintsInclude('hipaa') || leftoverTaintsInclude('zdr')) {
    return false
  }
  if (!CLAUDE_TEST_PLATFORMS.has(getPlatform())) return false
  const uid = process.getuid?.()
  if (uid === undefined || uid === 0) return false
  return getPinnedFeatureValue(CLAUDE_TEST_GB_FEATURE, false)
}

export function isClaudeTestPluginAvailable(): boolean {
  return leftoverSe()
}

type NotedRunState = {
  root: string
  isDraftSent: boolean
  isRunSent: boolean
  isBusy: boolean
}

const notedRuns = new Map<string, NotedRunState>()
const MAX_NOTED_RUNS = 64

function isPathInsideRoot(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return (
    rel !== '' &&
    !rel.startsWith(`..${sep}`) &&
    rel !== '..' &&
    !isAbsolute(rel)
  )
}

export function noteClaudeTestRun(runFolder: string): void {
  try {
    if (!isAbsolute(runFolder)) return
    const root = getOriginalCwd()
    const resolved = resolve(runFolder)
    if (
      !isPathInsideRoot(root, resolved) ||
      resolved.startsWith('//') ||
      resolved.startsWith('\\\\') ||
      notedRuns.has(resolved)
    ) {
      return
    }
    if (notedRuns.size >= MAX_NOTED_RUNS) {
      const oldest = notedRuns.keys().next()
      if (!oldest.done) notedRuns.delete(oldest.value)
    }
    notedRuns.set(resolved, {
      root,
      isDraftSent: false,
      isRunSent: false,
      isBusy: false,
    })
  } catch (err) {
    logForDebugging(
      `Claude Test could not remember a run folder, so that run is not counted in the usage events: ${errorMessage(err)}`,
      { level: 'error' },
    )
  }
}

function parseDraftEvent(raw: unknown):
  | {
      proposed: number
      filed: number
      first_time: boolean
    }
  | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const rec = raw as Record<string, unknown>
  const proposed = rec.proposed
  const firstTime = rec.firstTime
  const filed = rec.filed
  const replaced = rec.replaced
  if (
    typeof proposed !== 'number' ||
    !Number.isInteger(proposed) ||
    proposed <= 0 ||
    proposed > 1000 ||
    typeof firstTime !== 'boolean' ||
    !Array.isArray(filed) ||
    filed.length > 1000 ||
    !filed.every(item => typeof item === 'string') ||
    !Array.isArray(replaced) ||
    replaced.length > 1000 ||
    !replaced.every(item => typeof item === 'string')
  ) {
    return undefined
  }
  return {
    proposed,
    filed: filed.length + replaced.length,
    first_time: firstTime,
  }
}

function isBoundedCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000
}

function parseRunEvent(raw: unknown):
  | {
      errorCode: string | undefined
      counts: {
        specs_total: number
        passed: number
        failed: number
        blocked: number
        seconds: number
        hosts_refused: number
      }
    }
  | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const rec = raw as Record<string, unknown>
  if (rec.schema !== 'claude-test-results/1') return undefined
  const counts = rec.counts as Record<string, unknown> | undefined
  if (
    typeof counts !== 'object' ||
    counts === null ||
    !isBoundedCount(counts.specs) ||
    !isBoundedCount(counts.passed) ||
    !isBoundedCount(counts.failed) ||
    !isBoundedCount(counts.blocked) ||
    typeof rec.runnerSeconds !== 'number' ||
    !Number.isInteger(rec.runnerSeconds) ||
    rec.runnerSeconds < 0 ||
    rec.runnerSeconds > 86_400 ||
    !isBoundedCount(rec.hostsRefused)
  ) {
    return undefined
  }
  const word =
    typeof rec.blockedWord === 'string' &&
    (CLAUDE_TEST_BLOCKED_WORDS as readonly string[]).includes(rec.blockedWord)
      ? rec.blockedWord
      : rec.blockedWord === undefined
        ? undefined
        : 'other'
  return {
    errorCode:
      counts.passed + counts.failed > 0 ? undefined : (word ?? 'other'),
    counts: {
      specs_total: counts.specs,
      passed: counts.passed,
      failed: counts.failed,
      blocked: counts.blocked,
      seconds: rec.runnerSeconds,
      hosts_refused: rec.hostsRefused,
    },
  }
}

async function readJsonSafe(filePath: string): Promise<unknown> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return safeParseJSON(raw.replace(/^﻿/, ''), false)
  } catch {
    return null
  }
}

export async function reportClaudeTestRuns(): Promise<void> {
  for (const [folder, entry] of notedRuns) {
    if (entry.isRunSent || entry.isBusy) continue
    entry.isBusy = true
    try {
      const st = await lstat(folder).catch(() => null)
      if (!st || st.isSymbolicLink() || !st.isDirectory()) continue
      if (!entry.isDraftSent) {
        const draft = parseDraftEvent(
          await readJsonSafe(join(folder, 'saved.json')),
        )
        if (draft !== undefined) {
          logEvent('tengu_feature_ok', {
            feature_name:
              'claude_test_draft' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            ...draft,
          })
          entry.isDraftSent = true
        }
      }
      const run = parseRunEvent(
        await readJsonSafe(join(folder, 'results.json')),
      )
      if (run === undefined) continue
      if (run.errorCode === undefined) {
        logEvent('tengu_feature_ok', {
          feature_name:
            'claude_test_run' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ...run.counts,
        })
      } else {
        logEvent('tengu_feature_sad', {
          feature_name:
            'claude_test_run' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          error_code:
            run.errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ...run.counts,
        })
      }
      entry.isRunSent = true
    } catch (err) {
      logForDebugging(
        `Claude Test could not count a run in the usage events; it is looked at again when the runner next stops: ${errorMessage(err)}`,
        { level: 'error' },
      )
    } finally {
      entry.isBusy = false
    }
  }
}

export function reportClaudeTestStart(outcome: string): void {
  if (outcome === 'listed') {
    logEvent('tengu_feature_ok', {
      feature_name:
        'claude_test_helper_start' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } else {
    logEvent('tengu_feature_sad', {
      feature_name:
        'claude_test_helper_start' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
}

const BUILTIN_SUBCOMMAND_SUGGESTIONS = [
  { value: 'fix', description: 'Do the fix the last results recommended' },
  { value: 'onboard', description: 'Set up this machine and repository' },
]

export async function getClaudeTestArgumentCompletions(
  typedTokens: string[],
  partial: string,
): Promise<Array<{ value: string; description?: string }>> {
  const specFiles = await readdir(
    join(getCwd(), '.claude-test', 'specs'),
  ).catch(() => [] as string[])
  const alreadyTyped = new Set(typedTokens)
  return [
    ...BUILTIN_SUBCOMMAND_SUGGESTIONS,
    ...specFiles
      .filter(name => name.endsWith('.md'))
      .map(name => ({ value: name.slice(0, -3) })),
  ].filter(
    item => item.value.startsWith(partial) && !alreadyTyped.has(item.value),
  )
}

export const CLAUDE_TEST_DRAFT_LISTING = Object.freeze({
  description:
    'Internal to Claude Test — drafts spec files in the background for a first run. Started only by the claude-test run skill.',
  disallowedTools: [
    'Edit(.claude-test/specs/**)',
    'Edit(**/.claude-test/specs/**)',
    'Edit(.claude-test/filed)',
    'Edit(**/.claude-test/filed)',
    'Edit(.claude-test/skills/**)',
    'Edit(**/.claude-test/skills/**)',
    'Edit(.claude-testrc)',
    'Edit(**/.claude-testrc)',
    'mcp__plugin_claude-test_browser__claude_test_allow',
    'mcp__plugin_claude-test_browser__claude_test_app_up',
    'mcp__plugin_claude-test_browser__claude_test_show_run',
    'Edit(.claude-test/runs/*/*.*)',
    'Edit(**/.claude-test/runs/*/*.*)',
    'Edit(**/CLAUDE.md)',
    'Edit(**/CLAUDE.local.md)',
    'Edit(**/.claude/**)',
    'Edit(**/.mcp.json)',
    'Read(**/.git/**)',
    'Read(**/.env)',
    'Read(**/.env.*)',
    'Read(**/*.env)',
    'Read(**/.envrc)',
    'Read(**/.npmrc)',
    'Read(**/.netrc)',
    'Read(**/*.pem)',
    'Read(**/*.key)',
    'Read(**/*.p12)',
    'Read(**/*.pfx)',
    'Read(**/*.crt)',
    'Read(**/*.jks)',
    'Read(**/*.keystore)',
    'Read(**/*.sqlite)',
    'Read(**/*.sqlite3)',
    'Read(**/*.db)',
    'Read(**/id_rsa*)',
    'Read(**/id_ed25519*)',
    'Read(**/*secret*)',
    'Read(**/*credential*)',
    'Read(**/*token*.json)',
    'Read(**/*service-account*.json)',
    'Read(**/*service_account*.json)',
    'Read(~/.ssh/**)',
    'Read(~/.aws/**)',
    'Read(~/.config/**)',
    'Read(~/.claude/.credentials.json)',
    'Read(~/.claude.json)',
    'Read(~/.claude/settings.json)',
    'Read(~/.claude/settings.local.json)',
    'Read(~/.claude/projects/**)',
    'Read(~/.claude/shell-snapshots/**)',
    'Read(~/.claude/history*)',
    'Read(~/.claude/todos/**)',
    'Read(~/.claude/statsig/**)',
    'Read(~/.claude/ide/**)',
    'Read(~/.netrc)',
    'Read(~/.npmrc)',
    'Read(~/.git-credentials)',
    'Read(~/.pgpass)',
    'Read(~/.bash_history)',
    'Read(~/.zsh_history)',
    'Read(~/.*_history)',
    'Read(~/.bashrc)',
    'Read(~/.zshrc)',
    'Read(~/.zshenv)',
    'Read(~/.profile)',
    'Read(~/.bash_profile)',
    'Read(~/.local/share/keyrings/**)',
    'Read(~/.claude/file-history/**)',
    'Read(~/.docker/**)',
    'Read(~/.kube/**)',
    'Read(~/.gnupg/**)',
    'Read(~/Library/**)',
    'Read(~/AppData/**)',
  ],
})

export const CLAUDE_TEST_EXECUTE_LISTING = Object.freeze({
  description:
    'Internal to Claude Test — runs the specs in a background browser. Started only by the claude-test run skill.',
  disallowedTools: [
    'Edit(.claude-test/specs/**)',
    'Edit(**/.claude-test/specs/**)',
    'Edit(.claude-test/filed)',
    'Edit(**/.claude-test/filed)',
    'Edit(.claude-testrc)',
    'Edit(**/.claude-testrc)',
    'mcp__plugin_claude-test_browser__claude_test_allow',
    'mcp__plugin_claude-test_browser__claude_test_app_up',
    'mcp__plugin_claude-test_browser__claude_test_show_run',
    'Edit(.claude-test/runs/**/proposed/**)',
    'Edit(**/.claude-test/runs/**/proposed/**)',
    'Edit(**/.claude-test/runs/**/Proposed/**)',
    'Edit(**/.claude-test/runs/**/PROPOSED/**)',
    'mcp__plugin_claude-test_browser__browser_run_code_unsafe',
    'mcp__plugin_claude-test_browser__browser_file_upload',
    'mcp__plugin_claude-test_browser__browser_drop',
    'mcp__plugin_claude-test_browser__browser_route',
    'mcp__plugin_claude-test_browser__browser_unroute',
    'mcp__plugin_claude-test_browser__browser_install',
  ],
})

export const CLAUDE_TEST_RUN_LISTING = Object.freeze({
  description: 'Run tests on this machine (local)',
  whenToUse:
    'Checks that the web app in this repo still works — plain-language specs in .claude-test/specs/ run in the background in a fenced headless browser against the local dev server, and a PASS / FAIL summary comes back with screenshots. On a first run it proposes a starter set of specs for the person to approve. Use when the user asks ("test my app", "did I break anything?", "run claude test"). When the user asks for it. Unasked, only in a project that already has .claude-test/specs/ and only after a change a person can see in the app — then OFFER to run it in one line; never start it, or begin setup, on your own. Skip for docs-only or test-only changes.',
  argumentHint:
    '[app folder] [words from a spec name, to run only those | fix | onboard]',
  disallowedTools: [
    'Edit(.claude-test/specs/**)',
    'Edit(**/.claude-test/specs/**)',
    'Edit(.claude-test/filed)',
    'Edit(**/.claude-test/filed)',
  ],
})

const MARKETPLACE_REPO_RE = new RegExp(
  `^${CLAUDE_TEST_MARKETPLACE_PLUGIN_NAME}@[A-Za-z0-9][A-Za-z0-9._-]{0,39}$`,
)

function findOtherClaudeTestPluginSource(
  commands: readonly Command[],
): string | undefined {
  for (const cmd of commands) {
    if (cmd.type !== 'prompt') continue
    const info = (
      cmd as {
        pluginInfo?: { pluginManifest?: { name?: string }; repository?: string }
      }
    ).pluginInfo
    if (
      info?.pluginManifest?.name === CLAUDE_TEST_MARKETPLACE_PLUGIN_NAME &&
      typeof info.repository === 'string' &&
      MARKETPLACE_REPO_RE.test(info.repository)
    ) {
      return info.repository
    }
  }
  return undefined
}

const RUN_FOLDER_ARG_RE =
  /^\s*run[ \t]+["']?((?:[A-Za-z]:)?[\\/][^\n"']{0,1024}?[\\/]{1,4}\.claude-test[\\/]{1,4}runs[\\/]{1,4}\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d+)?)[\\/]{0,4}["']?(?:\s|$)/

export function extractClaudeTestRunFolder(args: string): string | undefined {
  return RUN_FOLDER_ARG_RE.exec(args)?.[1]
}

async function loadClaudeTestSkillParts(key: ClaudeTestSkillKey): Promise<{
  allowedTools: string[]
  body: string
}> {
  const { SKILL_MD } = await loadClaudeTestAssets()
  const root = getClaudeTestInstalledRoot()
  const { frontmatter, content } = parseFrontmatter(
    portClaudeTestNames(SKILL_MD[key]).replace(/\r\n/g, '\n'),
  )
  const rawAllowed = frontmatter['allowed-tools']
  return {
    allowedTools: (Array.isArray(rawAllowed) ? rawAllowed : [])
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => portClaudeTestPaths(entry, root)),
    body: `Base directory for this skill: ${root}/skills/run\n\n${content.trim()}`,
  }
}

const MAX_LOAD_TOKENS = 16

function mintLoadMarkedBody(body: string): string {
  const { loads } = HELPER_STATE
  const id = randomUUID()
  loads.set(id, { issuedAt: Date.now() })
  for (const oldKey of [...loads.keys()].slice(0, -MAX_LOAD_TOKENS)) {
    loads.delete(oldKey)
  }
  return `${LOAD_LINE_LEAD}${id}\n${body}`
}

function checkSkillReadiness(
  key: ClaudeTestSkillKey,
  isNonInteractiveSession: boolean,
  commands: readonly Command[],
): string | undefined {
  if (!HELPER_STATE.isModuleLoaded) {
    const other = findOtherClaudeTestPluginSource(commands)
    return other === undefined
      ? NOT_IN_CHARGE_TEXT
      : otherPluginFirstText(other)
  }
  if (key === 'run') return undefined
  if (isNonInteractiveSession) return NEEDS_TERMINAL_TEXT
  return HELPER_STATE.hasStartedServer ? undefined : NOT_STARTED_YET_TEXT
}

function createClaudeTestSkill(
  key: ClaudeTestSkillKey,
  spec: {
    description: string
    whenToUse?: string
    argumentHint?: string
    disallowedTools: readonly string[]
    userInvocable: boolean
    context?: 'fork'
    agent?: string
    getArgumentCompletions?: Command['getArgumentCompletions']
  },
): BundledSkillDefinition {
  return {
    ...spec,
    name: SKILL_NAMES[key],
    requires: { workspace: true },
    getAllowedTools: async () =>
      checkSkillReadiness(key, false, []) === undefined
        ? (await loadClaudeTestSkillParts(key)).allowedTools
        : [],
    async getPromptForCommand(args, ctx) {
      const blocked = checkSkillReadiness(
        key,
        ctx.options.isNonInteractiveSession,
        ctx.options.commands,
      )
      if (blocked !== undefined) {
        return [{ type: 'text', text: waitPrompt(blocked) }]
      }
      if (key === 'execute' && ctx.options.isSkillPreload !== true) {
        const folder = extractClaudeTestRunFolder(args)
        if (folder !== undefined) noteClaudeTestRun(folder)
      }
      const { body } = await loadClaudeTestSkillParts(key)
      const substituted = portClaudeTestPaths(
        substituteArguments(body, args, true, []),
        getClaudeTestInstalledRoot(),
      )
      return [
        {
          type: 'text',
          text: key === 'run' ? mintLoadMarkedBody(substituted) : substituted,
        },
      ]
    },
  }
}

export const CLAUDE_TEST_SKILLS: BundledSkillDefinition[] = [
  createClaudeTestSkill('run', {
    ...CLAUDE_TEST_RUN_LISTING,
    userInvocable: true,
    getArgumentCompletions:
      getClaudeTestArgumentCompletions as unknown as Command['getArgumentCompletions'],
  }),
  createClaudeTestSkill('execute', {
    ...CLAUDE_TEST_EXECUTE_LISTING,
    userInvocable: false,
    context: 'fork',
    agent: RUNNER_AGENT_TYPE,
  }),
  createClaudeTestSkill('draft', {
    ...CLAUDE_TEST_DRAFT_LISTING,
    userInvocable: false,
    context: 'fork',
    agent: 'claude-test:author',
  }),
]

export function registerClaudeTestBuiltinPlugin(): void {
  const helperState = HELPER_STATE as {
    wantedSessions: Set<unknown>
    hasStartedServer: boolean
    isModuleLoaded: boolean
    loads: Map<unknown, unknown>
    filesReady?: () => Promise<{
      folder: string
      problem?: 'linked' | 'differs' | 'unwritable'
      what?: string
    }>
    report?: (outcome: string) => void
    reportRuns?: () => Promise<void>
  }
  helperState.isModuleLoaded = false
  helperState.hasStartedServer = false
  helperState.wantedSessions.clear()
  helperState.loads.clear()
  helperState.filesReady = ensureClaudeTestFilesReady
  helperState.report = reportClaudeTestStart
  helperState.reportRuns = reportClaudeTestRuns
  registerBuiltinPlugin({
    name: CLAUDE_TEST_PLUGIN_NAME,
    description: CLAUDE_TEST_PLUGIN_DESCRIPTION,
    version: CLAUDE_TEST_PLUGIN_VERSION,
    isAvailable: isClaudeTestPluginAvailable,
    skills: CLAUDE_TEST_SKILLS,
    get mcpServers(): Record<string, McpServerConfig> | undefined {
      return HELPER_STATE.wantedSessions.has(getSessionId())
        ? buildClaudeTestBrowserServer()
        : undefined
    },
    hooksModule: leftoverFu(
      join(
        import.meta.dir,
        '../../../vendor/claude-code-mods/mods/cc-plugin-claude-test',
      ),
      { register: registerClaudeTestHooks },
      () => ({
        scan: {
          hooks: ['command.run', 'skill.prompt', 'classic.SubagentStop'],
          calls: [
            'clock.now',
            'clock.sleep',
            'mcp.connect',
            'session.id',
            'session.surfaces',
            'tool.list',
            'ui.log',
            'ui.toast',
          ],
          runCommands: ['claude-test'],
        },
        files: CLAUDE_TEST_SCAN_FILES,
      }),
    ),
  })
}
