/**
 * densable `sf`/`of`/`up` — spawn the CLI child with
 * `-p --output-format stream-json` via buildCliLaunch.
 */

import { execFile, spawn } from 'child_process'
import { writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import {
  getAnthropicConfigDir,
  getAnthropicProfileSource,
} from '../../anthropicProfile.js'
import { buildCliLaunch } from '../../cliLaunch.js'
import { logForDebugging } from '../../debug.js'
import { isEnvTruthy } from '../../envUtils.js'
import { calculateUSDCost } from '../../modelCost.js'
import { assertPluginEvalGitVersion } from '../pluginEvalGit.js'
import {
  EVAL_ARTIFACTS_DIR,
  EVAL_ENV_KEY,
  GIT_CONFIG_PAIRS,
  SHELL_UNCONFINED,
} from './constants.js'
import {
  EVAL_PROC_READ_DENY,
  evalCwdGitMetaWriteDenies,
  evalToolPathRule,
  extraEvalToolDenies,
  expandWholeToolReadGrants,
  expandWholeToolWriteGrants,
  resolveEvalAddDirs,
  resolveEvalCaseAuthoredFile,
  resolveEvalReadScope,
  rewriteRelativeEvalFileRules,
  toEvalPermissionPath,
  unionEvalPathSpellings,
} from './evalFence.js'
import {
  applyEvalSandboxSettings,
  linkEvalAwsSsoCaches,
  writeEvalPolicySnapshot,
} from './evalSandboxFence.js'
import { evalSpawnCgroupExtras } from './evalCgroup.js'
import { injectEvalCredential, type EvalCredential } from './evalCredential.js'
import { foldEvalStubPublishes } from './evalArtifactsFence.js'
import {
  isEvalConnectionStringEnvKey,
  isEvalSecretShapedEnvKey,
} from './evalEnvSecretShape.js'
import {
  collectEvalArtifactPublishes,
  corroboratedStubSlugs,
} from './evalPublishTrace.js'
import {
  applyMockIntegrity,
  createMockTraceWatcher,
  mockResultText,
  type MockWatchVerdict,
  type PreparedRunMocks,
} from './mockIntegrity.js'
import { restoreEvalHistoryCostUsd } from './evalHistoryCost.js'
import { assertEvalPathScopable } from './pathVet.js'
import type {
  AgentRunResult,
  EvalSandbox,
  ResolvedCase,
  ToolCallRecord,
} from './types.js'

/** densable `Uf` exact inherit (minus S3/Kue/GB expansion). */
const EVAL_INHERIT_EXACT = new Set([
  'PATH',
  'SHELL',
  'TERM',
  'COLORTERM',
  'LANG',
  'LANGUAGE',
  'TZ',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'NO_COLOR',
  'FORCE_COLOR',
  'CI',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'USERNAME',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'PROGRAMDATA',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432',
  'ALLUSERSPROFILE',
  'PUBLIC',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
  'PSMODULEPATH',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'SSL_CERT_DIR',
  'GIT_SSL_CAPATH',
  // gold Uf: ...Object.keys(S3)
  'GIT_TERMINAL_PROMPT',
  'GIT_ASKPASS',
  'GCM_INTERACTIVE',
  '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_QUOTA_PROJECT',
  'GOOGLE_EXTERNAL_ACCOUNT_ALLOW_EXECUTABLES',
  'GCLOUD_PROJECT',
  'CLOUD_ML_REGION',
  'IDENTITY_ENDPOINT',
  'IDENTITY_HEADER',
  'IDENTITY_SERVER_THUMBPRINT',
  'IMDS_ENDPOINT',
  'MSI_ENDPOINT',
  'MSI_SECRET',
  'USER_TYPE',
  'IS_SANDBOX',
  'IS_DEMO',
  'NODE_ENV',
  // gold leftover Uf exact (no Gf prefix): timeouts, MCP, CA, CLAUDE_*
  'FORCE_HYPERLINK',
  'API_TIMEOUT_MS',
  'API_FORCE_IDLE_TIMEOUT',
  'BASH_DEFAULT_TIMEOUT_MS',
  'BASH_MAX_TIMEOUT_MS',
  'BASH_MAX_OUTPUT_LENGTH',
  'MAX_THINKING_TOKENS',
  'MAX_MCP_OUTPUT_TOKENS',
  'MAX_STRUCTURED_OUTPUT_RETRIES',
  'MCP_TIMEOUT',
  'MCP_TOOL_TIMEOUT',
  'MCP_CONNECT_TIMEOUT_MS',
  'MCP_CONNECTION_NONBLOCKING',
  'MCP_PROTOCOL_NEGOTIATION',
  'MCP_SDK_GENERATION',
  'MCP_SERVER_CONNECTION_BATCH_SIZE',
  'MCP_REMOTE_SERVER_CONNECTION_BATCH_SIZE',
  'MCP_DISCOVERY_CACHE',
  'MCP_DISCOVERY_CACHE_TTL_S',
  'MCP_DISCOVERY_CACHE_MAX_STALE_S',
  'MCP_DISCOVERY_CACHE_STRIKES',
  'MCP_OAUTH_CALLBACK_PORT',
  'MCP_OAUTH_CLIENT_METADATA_URL',
  'ENABLE_MCP_LARGE_OUTPUT_FILES',
  'SLASH_COMMAND_TOOL_CHAR_BUDGET',
  'USE_BUILTIN_RIPGREP',
  'DO_NOT_TRACK',
  'ENABLE_TOOL_SEARCH',
  'FALLBACK_FOR_ALL_PRIMARY_MODELS',
  'FORCE_PROMPT_CACHING_5M',
  'ENABLE_PROMPT_CACHING_1H',
  'ENABLE_PROMPT_CACHING_1H_BEDROCK',
  'CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR',
  'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE',
  'CLAUDE_STREAM_IDLE_TIMEOUT_MS',
  'CLAUDE_ENABLE_STREAM_WATCHDOG',
  'CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS',
  'CLAUDE_ENABLE_BYTE_WATCHDOG',
  'CLAUDE_ENABLE_BYTE_WATCHDOG_BEDROCK',
  'CLAUDE_EFFORT',
  'CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS',
  'CLAUDE_AUTO_BACKGROUND_TASKS',
  'CLAUDE_DISABLE_ADOPT',
  'CLAUDE_AFK_TIMEOUT_MS',
  'CLAUDE_AFK_COUNTDOWN_MS',
  'CLAUDE_AX_SCREEN_READER',
  'CLAUDE_AX_PREPARK_MS',
  'CLAUDE_AX_STARTUP_QUIET_MS',
  'CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS',
  'CLAUDE_AGENT_SDK_MCP_NO_PREFIX',
  // gold leftover Uf ...q1r / ...gbe / ...Kue / ...Tmn
  'YARN_HTTP_PROXY',
  'YARN_HTTPS_PROXY',
  'NPM_CONFIG_PROXY',
  'NPM_CONFIG_HTTPS_PROXY',
  'NPM_CONFIG_HTTP_PROXY',
  'NPM_CONFIG_NOPROXY',
  'JAVA_TOOL_OPTIONS',
  'GLOBAL_AGENT_HTTP_PROXY',
  'GLOBAL_AGENT_HTTPS_PROXY',
  'GLOBAL_AGENT_NO_PROXY',
  'DOCKER_HTTP_PROXY',
  'DOCKER_HTTPS_PROXY',
  'ELECTRON_GET_USE_PROXY',
  'CLOUDSDK_PROXY_TYPE',
  'CLOUDSDK_PROXY_ADDRESS',
  'CLOUDSDK_PROXY_PORT',
  'CLOUDSDK_PROXY_USERNAME',
  'CLOUDSDK_PROXY_PASSWORD',
  'FSSPEC_GCS',
  'SSL_CERT_FILE',
  'NODE_EXTRA_CA_CERTS',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  'CLOUDSDK_CORE_CUSTOM_CA_CERTS_FILE',
  'HTTPLIB2_CA_CERTS',
  'AWS_CA_BUNDLE',
  'DENO_CERT',
  'CARGO_HTTP_CAINFO',
  'PIP_CERT',
  'GIT_SSL_CAINFO',
  'GRPC_DEFAULT_SSL_ROOTS_FILE_PATH',
  'NIX_SSL_CERT_FILE',
  'HEX_CACERTS_PATH',
  'UV_NATIVE_TLS',
  'DENO_TLS_CA_STORE',
  'GCE_METADATA_HOST',
  'GCE_METADATA_ROOT',
  'GCE_METADATA_IP',
  'METADATA_SERVER_DETECTION',
])

/** densable `Gf`. */
const EVAL_INHERIT_PREFIX = [
  'ANTHROPIC_',
  'CLAUDE_CODE_',
  'DISABLE_',
  'AWS_',
  'AZURE_',
  'CLOUDSDK_',
  'VERTEX_REGION_',
  'LC_',
  'EVAL_',
]

/** densable `Ff`. */
const EVAL_STRIP_EXACT = new Set(['HOMESHARE', 'BASH_ENV', 'ENV', 'ZDOTDIR'])

/** densable `cp` — never inherit; pin only when granted. */
const EVAL_OPERATOR_ONLY = new Set([
  'CLAUDE_INTERNAL_FC_OVERRIDES',
  'CLAUDE_CODE_EVAL_ARTIFACT_STUB_DIR',
  'CLAUDE_CODE_EVAL_ALLOW_ARTIFACT_PUBLISH',
  'CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES',
])

/** densable `lp` — drop when a credential injector is present. */
const EVAL_CREDENTIAL_STRIP = new Set([
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
])

/**
 * densable `of` after `ap` inject: `lp` keys plus ANTHROPIC_CUSTOM_HEADERS
 * authorization / x-api-key lines. Gateway keeps x-api-key; gold also skips
 * the header walk when `authorizationHeaderIsCredential` (live type has no
 * such field — do not invent it).
 */
export function stripEvalOperatorAuthHeaders(
  env: NodeJS.ProcessEnv,
  credential: { kind: string },
): void {
  const dropAuthorizationOnly = credential.kind === 'gateway'
  const dropLine = dropAuthorizationOnly
    ? /^\s*authorization\s*:/i
    : /^\s*(authorization|x-api-key)\s*:/i
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase()
    if (EVAL_CREDENTIAL_STRIP.has(upper)) {
      delete env[key]
      continue
    }
    if (upper !== 'ANTHROPIC_CUSTOM_HEADERS') continue
    const kept = (env[key] ?? '')
      .split(/\r?\n/)
      .filter(line => !dropLine.test(line))
    if (kept.some(line => line.trim() !== '')) env[key] = kept.join('\n')
    else delete env[key]
  }
}

/** densable `Kf`. */
const EVAL_STRIP_CLAUDE_PREFIX = [
  'CLAUDE_CODE_REMOTE',
  'CLAUDE_CODE_HOST_',
  'CLAUDE_CODE_SESSION_',
  'CLAUDE_CODE_SDK_',
  'CLAUDE_CODE_RELAUNCH_',
]

const EVAL_STRIP_CLAUDE_PATHISH =
  /_(DIRS?|PATHS?|FILES?|ROOTS?|HOME|LOG|TRACE)$/
const EVAL_KEEP_CLAUDE_PATHISH = new Set(['CLAUDE_CODE_GIT_BASH_PATH'])

/**
 * densable leftover `Vf` `Wf`/`M$e`/`H9e`/`Lye` — CLAUDE_CODE_ keys that
 * Yf must not inherit (gold Vf before Gf prefix).
 */
const EVAL_VF_STRIP_EXACT = new Set([
  'CLAUDE_CODE_TMPDIR',
  'CLAUDE_CODE_SUBSCRIPTION_TYPE',
  'CLAUDE_CODE_RATE_LIMIT_TIER',
  'CLAUDE_CODE_OTEL_DIAG_STDERR',
  'CLAUDE_CODE_SESSION_KIND',
  'CLAUDE_CODE_SESSION_NAME',
  'CLAUDE_CODE_RESUME_INTERRUPTED_TURN',
  'CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS',
  'CLAUDE_CODE_RESUME_PROMPT',
  'CLAUDE_CODE_RESUME_REASON',
  'CLAUDE_CODE_RESUME_SOURCE_ALIVE',
  'CLAUDE_BG_SOURCE',
  'CLAUDE_BG_ISOLATION',
  'CLAUDE_BG_BACKEND',
  'CLAUDE_BG_POST_CLEAR_RESPAWN',
  'CLAUDE_BG_SESSION_PERMISSION_RULES',
  'CLAUDE_BG_MEMORY_TOGGLED_OFF',
  'CLAUDE_BG_WORKSPACE_TRUSTED',
  'CLAUDE_BG_DISPATCHER_SUBSCRIPTION_TYPE',
  'CLAUDE_BG_DISPATCHER_RATE_LIMIT_TIER',
  'CLAUDE_CODE_MEMORY_API_BASE_URL',
  'CLAUDE_CODE_MEMORY_API_TOKEN',
  // leftover `woe`/`kor` @189121346 — session/CCR tokens gold Vf strips
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
  'CLAUDE_CODE_WORKER_EPOCH',
  'CLAUDE_CODE_CCR_EARLY_HYDRATE_PREFETCH',
  'CLAUDE_CODE_CCR_EARLY_REMOTE_CONNECT',
  'CLAUDE_CODE_BRIDGE_OWNER_ACCOUNT_UUID',
  'CLAUDE_CODE_BRIDGE_OWNER_ORG_UUID',
  'CLAUDE_CODE_SESSION_ORIGIN',
  'CLAUDE_CODE_MEMORY_SUBAGENT_APPEND',
  'CLAUDE_CODE_POST_TURN_MEMORY',
  'CLAUDE_CODE_POST_TURN_MEMORY_CONFIG',
  'CLAUDE_CODE_POST_TURN_MEMORY_SYNC',
  'CLAUDE_CODE_SYNC_SESSION_REFS',
  'CLAUDE_CODE_REMOTE_SESSION_ID',
  'CLAUDE_CODE_TRIGGER_ID',
  'CLAUDE_CODE_BASE_REF',
  'CLAUDE_CODE_BASE_REFS',
  'CLAUDE_CODE_REPO_CHECKOUTS',
  'CLAUDE_CODE_WORKFLOW_LAUNCH_SHA256',
])

/**
 * densable leftover `ri` — `_ne` hits these CLAUDE_CODE_ keys; `lmn` keeps them.
 */
const EVAL_VF_LMN_KEEP = new Set([
  'CLAUDE_CODE_CLIENT_KEY',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
  'CLAUDE_CODE_PROXY_AUTH_HELPER_TTL_MS',
  'CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER',
  'CLAUDE_CODE_AUTH_FAIL_EXIT_MS',
  'CLAUDE_CODE_ENABLE_TOKEN_USAGE_ATTACHMENT',
  'CLAUDE_CODE_IDLE_TOKEN_THRESHOLD',
  'CLAUDE_CODE_RESUME_TOKEN_THRESHOLD',
  'CLAUDE_CODE_ARG_KEY_SHAPE',
])

/** densable leftover `oi`. */
const EVAL_VF_LMN_SKIP_AUTH_RE = /^CLAUDE_CODE_SKIP_[A-Z0-9_]+_AUTH$/

/** densable leftover `Pi` — drop when gold `up` 5th arg (mocks) is true. */
const EVAL_MOCKS_STRIP = new Set([
  'MAX_MCP_OUTPUT_TOKENS',
  'MCP_TOOL_TIMEOUT',
  'MCP_TIMEOUT',
  'CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT',
])
const EVAL_PROXY_LOWER = new Set([
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'all_proxy',
])

/**
 * densable `en`/`Po` @176702900 — `U9e` exact package-index keys.
 * Hyphens → `_`, optional `INPUT_` prefix (GitHub Actions).
 */
const EVAL_PACKAGE_INDEX_EXACT = new Set([
  'PIP_INDEX_URL',
  'PIP_EXTRA_INDEX_URL',
  'PIP_FIND_LINKS',
  'UV_INDEX_URL',
  'UV_EXTRA_INDEX_URL',
  'UV_DEFAULT_INDEX',
  'UV_INDEX',
  'UV_FIND_LINKS',
  'UV_PUBLISH_URL',
  'TWINE_REPOSITORY_URL',
  'FLIT_INDEX_URL',
  'HATCH_INDEX_REPO',
  'NPM_CONFIG_REGISTRY',
  'YARN_REGISTRY',
  'YARN_NPM_REGISTRY_SERVER',
  'YARN_NPM_PUBLISH_REGISTRY',
  'COREPACK_NPM_REGISTRY',
  'BUN_CONFIG_REGISTRY',
  'GOPROXY',
])

/** densable `Ro` @176702900 */
const EVAL_PACKAGE_INDEX_RE = new RegExp(
  '^(?:CARGO_REGISTRIES_[A-Z0-9_]+_INDEX' +
    '|POETRY_REPOSITORIES_[A-Z0-9_]+_URL' +
    '|NPM_CONFIG_@[^:]+:REGISTRY)$',
  'i',
)

/**
 * densable `whn`/`eUe`/`Mf`/`jf`/`dBt` @212242245 — `Lf` git identity.
 * Applied after merge, before gold re-pin of `GIT_CONFIG_*`.
 */
const EVAL_GIT_STRIP_EXACT = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_SHALLOW_FILE',
  'GIT_NAMESPACE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_AUTHOR_DATE',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'GIT_COMMITTER_DATE',
  'EMAIL',
  'GIT_TEMPLATE_DIR',
  'GIT_LITERAL_PATHSPECS',
  'GIT_GLOB_PATHSPECS',
  'GIT_NOGLOB_PATHSPECS',
  'GIT_ICASE_PATHSPECS',
  'GIT_CONFIG_NOSYSTEM',
])

/** densable `dBt` */
const EVAL_GIT_CONFIG_KV_RE = /^GIT_CONFIG_(KEY|VALUE)_\d+$/i

/**
 * densable leftover `Vf` — gold order `_ne`/`lmn` then `Hf`/`Wf`/`Kf`/`P4n`/`Lye`.
 * `Yf` already uppercases before this.
 */
function isEvalClaudeCodeStripped(name: string): boolean {
  // gold leftover Vf: if(_ne(e))return!lmn(e)
  if (isEvalSecretShapedEnvKey(name)) return !isEvalVfLmnKeep(name)
  if (
    EVAL_STRIP_CLAUDE_PATHISH.test(name) &&
    !EVAL_KEEP_CLAUDE_PATHISH.has(name)
  ) {
    return true
  }
  if (EVAL_VF_STRIP_EXACT.has(name)) return true
  // gold leftover P4n: CLAUDE_CODE_ARTIFACT*_BASE_URL
  if (name.startsWith('CLAUDE_CODE_ARTIFACT') && name.endsWith('_BASE_URL')) {
    return true
  }
  return EVAL_STRIP_CLAUDE_PREFIX.some(prefix => name.startsWith(prefix))
}

/** densable leftover `lmn`. */
function isEvalVfLmnKeep(name: string): boolean {
  return EVAL_VF_LMN_KEEP.has(name) || EVAL_VF_LMN_SKIP_AUTH_RE.test(name)
}

export { isEvalConnectionStringEnvKey }

/** densable `U9e` @176703110 */
export function isEvalPackageIndexEnvKey(key: string): boolean {
  const n = key
    .toUpperCase()
    .replace(/-/g, '_')
    .replace(/^INPUT_/, '')
  return EVAL_PACKAGE_INDEX_EXACT.has(n) || EVAL_PACKAGE_INDEX_RE.test(n)
}

/** densable `gRe` — query-as-cred / unparseable userinfo replacement. */
const EVAL_INDEX_INVALID = 'http://index.invalid/'

/**
 * densable `tn` / `nn` @176703217 — extra-index keys respell onto the
 * canonical index URL when q$t cuts a credential query.
 */
const EVAL_PACKAGE_INDEX_ALIAS: Record<string, string> = {
  PIP_EXTRA_INDEX_URL: 'PIP_INDEX_URL',
  PIP_FIND_LINKS: 'PIP_INDEX_URL',
  UV_EXTRA_INDEX_URL: 'UV_DEFAULT_INDEX',
  UV_INDEX: 'UV_DEFAULT_INDEX',
  UV_FIND_LINKS: 'UV_DEFAULT_INDEX',
}

/** densable `rn` — alias already set if any of these is nonempty. */
const EVAL_PACKAGE_INDEX_ALIAS_ALREADY: Record<string, string[]> = {
  UV_DEFAULT_INDEX: ['UV_INDEX_URL'],
}

function foldPackageIndexEnvKey(key: string): string {
  return key
    .toUpperCase()
    .replace(/-/g, '_')
    .replace(/^INPUT_/, '')
}

function decodeUriComponentLoose(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * densable `QC` userinfo / query-as-cred subset used by `To`/`q$t`.
 * Full QC catalog (sonar.login, mailto, …) is not the leftover `up` hole.
 */
function packageIndexValueLooksLikeCredential(raw: string): boolean {
  const n = raw.length > 4096 ? raw.slice(0, 4096) : raw
  const userinfoLooksLikeCred = (fragment: string): boolean => {
    const space = fragment.search(/\s/)
    const token = space === -1 ? fragment : fragment.slice(0, space)
    const at = token.lastIndexOf('@')
    if (at === -1) return false
    const user = token.slice(0, at)
    const host = token.slice(at + 1)
    // gold qt: skip typical emails (no password in the userinfo)
    if (
      !user.includes(':') &&
      /^[A-Za-z0-9._%+-]+$/.test(user) &&
      /\./.test(host)
    ) {
      return false
    }
    return user.includes(':') || (!/[/?#]/.test(user) && user.length > 0)
  }
  let s = n.indexOf('://')
  while (s !== -1) {
    if (s > 0 && /[a-z0-9+.-]/i.test(n[s - 1] ?? '')) {
      if (userinfoLooksLikeCred(n.slice(s + 3))) return true
    }
    s = n.indexOf('://', s + 3)
  }
  if (n.startsWith('//') && userinfoLooksLikeCred(n.slice(2))) return true
  if (/[?&](?:token|password|secret|key|auth|login)=/i.test(n)) return true
  if (/\bauthorization\s*[:=]/i.test(n)) return true
  return false
}

/** densable `To` @176703643 — strip URL userinfo; cut query-as-cred. */
function stripPackageIndexUrlUserinfo(value: string): {
  text: string
  cut: boolean
  stripped: boolean
} {
  const protocolRelative = value.startsWith('//')
  let parsed: URL
  try {
    parsed = new URL(protocolRelative ? `https:${value}` : value)
  } catch {
    const stripped = value.replace(
      /^([a-z][a-z0-9+.-]*:)?\/\/[^/?#]*@/i,
      '$1//',
    )
    if (packageIndexValueLooksLikeCredential(stripped)) {
      return { text: EVAL_INDEX_INVALID, cut: true, stripped: true }
    }
    return { text: stripped, cut: false, stripped: stripped !== value }
  }
  const hasUserinfo =
    parsed.password !== '' ||
    (parsed.username !== '' && /(^|\+)https?:$/i.test(parsed.protocol))
  if (hasUserinfo) {
    parsed.username = ''
    parsed.password = ''
  }
  let cut = false
  if (
    packageIndexValueLooksLikeCredential(decodeUriComponentLoose(parsed.search))
  ) {
    parsed.search = ''
    parsed.hash = ''
    cut = true
  }
  const href = parsed.href
  return {
    text: protocolRelative ? href.replace(/^https:/, '') : href,
    cut,
    stripped: hasUserinfo,
  }
}

function packageIndexAliasAlreadySet(
  env: NodeJS.ProcessEnv,
  alias: string,
): boolean {
  const names = [alias, ...(EVAL_PACKAGE_INDEX_ALIAS_ALREADY[alias] ?? [])]
  return names.some(name => (env[name] ?? '') !== '')
}

function packageIndexOriginAlias(
  key: string,
  value: string,
): { name: string; value: string } | undefined {
  if (/^INPUT_/i.test(key)) return undefined
  const alias = EVAL_PACKAGE_INDEX_ALIAS[foldPackageIndexEnvKey(key)]
  if (alias === undefined) return undefined
  const piece = value
    .split(/\s+|,|\|/)
    .map(part =>
      part.replace(/^[A-Za-z0-9_.-]+=(?=[a-z][a-z0-9+.-]*:\/\/|\/\/)/i, ''),
    )
    .find(part => part.startsWith('//') || /^https?:\/\//i.test(part))
  let origin = EVAL_INDEX_INVALID
  if (piece !== undefined) {
    try {
      const href = new URL(piece.startsWith('//') ? `https:${piece}` : piece)
        .origin
      origin = href === 'null' ? EVAL_INDEX_INVALID : `${href}/`
    } catch {
      origin = EVAL_INDEX_INVALID
    }
  }
  return { name: alias, value: origin }
}

/** densable `q$t` @176704150 */
function respellPackageIndexValue(
  key: string,
  value: string,
): { value: string; cut: boolean; stripped: boolean } {
  if (value.trim() === '') {
    return { value, cut: false, stripped: false }
  }
  const goproxy = /^(?:INPUT_)?GOPROXY$/i.test(key)
  const aliased =
    !/^INPUT_/i.test(key) &&
    EVAL_PACKAGE_INDEX_ALIAS[foldPackageIndexEnvKey(key)] !== undefined
  const splitter = goproxy ? /(\s*[,|]\s*|\s+)/ : aliased ? /(\s+)/ : null
  let cut = false
  let stripped = false
  let restOff = false
  const parts = (splitter === null ? [value] : value.split(splitter)).flatMap(
    piece => {
      if (restOff) return []
      const prefix =
        /^([A-Za-z0-9_.-]+=)(?=[a-z][a-z0-9+.-]*:\/\/|\/\/)/i.exec(
          piece,
        )?.[1] ?? ''
      const rest = piece.slice(prefix.length)
      if (!rest.startsWith('//') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(rest)) {
        if (
          piece.trim() !== '' &&
          packageIndexValueLooksLikeCredential(piece)
        ) {
          cut = true
          stripped = true
          return [goproxy ? 'off' : EVAL_INDEX_INVALID]
        }
        return [piece]
      }
      const next = stripPackageIndexUrlUserinfo(rest)
      stripped = stripped || next.cut || next.stripped === true
      if (next.cut || (next.stripped && (goproxy || aliased))) {
        cut = true
        if (goproxy) {
          restOff = true
          return ['off']
        }
      }
      return [`${prefix}${next.text}`]
    },
  )
  let joined = parts.join('')
  if (goproxy) joined = joined.replace(/[,|\s]+$/, '')
  if (joined !== '' && packageIndexValueLooksLikeCredential(joined)) {
    return {
      value: goproxy ? 'off' : EVAL_INDEX_INVALID,
      cut: true,
      stripped: true,
    }
  }
  return {
    value: joined === '' ? EVAL_INDEX_INVALID : joined,
    cut,
    stripped,
  }
}

/**
 * densable `HNo`/`on` @176705117 — respell U9e URL userinfo/query onto the
 * inherited bag. `lostCredential` is unused by leftover `up`.
 */
export function respellInheritedPackageIndexUrls(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const respelled: NodeJS.ProcessEnv = {}
  for (const [key, raw] of Object.entries(env)) {
    if (raw === undefined || !isEvalPackageIndexEnvKey(key)) continue
    const value = typeof raw === 'string' ? raw : String(raw)
    const next = respellPackageIndexValue(key, value)
    if (next.value !== value) respelled[key] = next.value
    if (next.cut) {
      const alias = packageIndexOriginAlias(key, next.value)
      if (
        alias !== undefined &&
        !packageIndexAliasAlreadySet(env, alias.name) &&
        respelled[alias.name] === undefined
      ) {
        respelled[alias.name] = alias.value
      }
    }
  }
  return respelled
}

/** densable `LD` @176038… — host-managed API tokens. */
const EVAL_HOST_MANAGED_LD = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
  'ANTHROPIC_AWS_API_KEY',
] as const

/** densable `Xn` — AWS-family provider selectors. */
const EVAL_HOST_MANAGED_XN = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_MANTLE',
] as const

/** densable `sc` — AWS bearer pointers. */
const EVAL_HOST_MANAGED_SC = [
  'AWS_BEARER_TOKEN_BEDROCK',
  'ANTHROPIC_AWS_API_KEY',
] as const

/** densable `qn`. */
const EVAL_HOST_MANAGED_QN = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
] as const

/** densable `zpt`. */
const EVAL_HOST_MANAGED_ZPT = [
  ...EVAL_HOST_MANAGED_QN,
  'AWS_PROFILE',
  'AWS_CONFIG_FILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
] as const

/** densable `ZB` — blocked as HOST_AUTH_ENV_VAR names. */
const EVAL_HOST_AUTH_ENV_BLOCKED = new Set([
  'ANTHROPIC_UNIX_SOCKET',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CODE_HOST_AUTH_ENV_VAR',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_GATEWAY',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'ANTHROPIC_AWS_WORKSPACE_ID',
  'ANTHROPIC_GOOGLE_CLOUD_PROJECT',
  'ANTHROPIC_GOOGLE_CLOUD_LOCATION',
  'ANTHROPIC_GOOGLE_CLOUD_WORKSPACE_ID',
  'CLOUD_ML_REGION',
])

/** densable `Tp` @212262191 — first-wins uppercase fold. */
function firstWinsUpperEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    const upper = key.toUpperCase()
    if (!(upper in out)) out[upper] = value
  }
  return out
}

/** densable `TRe`. */
function hostAuthEnvVarDropKey(env: NodeJS.ProcessEnv): string | undefined {
  const name = env.CLAUDE_CODE_HOST_AUTH_ENV_VAR
  if (!name || EVAL_HOST_AUTH_ENV_BLOCKED.has(name)) return undefined
  return name
}

/**
 * densable `Y$e` @176039902 — keys dropped from leftover `up` when
 * CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST is truthy.
 */
export function hostManagedEvalEnvDropKeys(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const folded = firstWinsUpperEnv(env)
  if (!isEnvTruthy(folded.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)) return []
  const awsFamily = EVAL_HOST_MANAGED_XN.some(key => isEnvTruthy(folded[key]))
  const awsPointers =
    !!folded.CLAUDE_CODE_HOST_AUTH_ENV_VAR ||
    EVAL_HOST_MANAGED_SC.some(key => !!folded[key]) ||
    !!folded.AWS_PROFILE ||
    !!folded.AWS_CONFIG_FILE ||
    !!folded.AWS_SHARED_CREDENTIALS_FILE
  const emptySentinels = EVAL_HOST_MANAGED_ZPT.filter(key => folded[key] === '')
  return [
    'ANTHROPIC_CUSTOM_HEADERS',
    ...EVAL_HOST_MANAGED_LD,
    ...(awsFamily && awsPointers ? EVAL_HOST_MANAGED_QN : []),
    ...emptySentinels,
    hostAuthEnvVarDropKey(folded),
    'CLAUDE_CODE_HOST_CREDS_FILE',
  ].filter((key): key is string => !!key)
}

function stripHostManagedEvalEnv(env: NodeJS.ProcessEnv): void {
  const drop = new Set(
    hostManagedEvalEnvDropKeys(process.env).map(key => key.toUpperCase()),
  )
  if (drop.size === 0) return
  drop.add('ANTHROPIC_CONFIG_DIR')
  drop.add('ANTHROPIC_PROFILE')
  for (const key of Object.keys(env)) {
    if (drop.has(key.toUpperCase())) delete env[key]
  }
}

/**
 * densable leftover `up` `j` @212253200 — when Y$e is empty, pin operator-home
 * AWS/gcloud/Azure credential files if the child bag does not already have them.
 */
function pinOperatorHomeCredentialFiles(env: NodeJS.ProcessEnv): void {
  if (hostManagedEvalEnvDropKeys(process.env).length > 0) return
  const home = homedir()
  const gcloud =
    process.platform === 'win32'
      ? join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'gcloud')
      : join(home, '.config', 'gcloud')
  const pins: Record<string, string> = {
    AWS_SHARED_CREDENTIALS_FILE: join(home, '.aws', 'credentials'),
    AWS_CONFIG_FILE: join(home, '.aws', 'config'),
    CLOUDSDK_CONFIG: gcloud,
    AZURE_CONFIG_DIR: join(home, '.azure'),
  }
  const present = new Set(Object.keys(env).map(key => key.toUpperCase()))
  for (const [key, value] of Object.entries(pins)) {
    if (!present.has(key)) env[key] = value
  }
}

/**
 * densable leftover `up` `KS()==="env-quad"` then `D$e()`:
 * pin CLAUDE_CODE_FEDERATION_CACHE_DIR (Yf strips `*_DIR`, so inherit cannot).
 */
function pinEnvQuadFederationCacheDir(env: NodeJS.ProcessEnv): void {
  if (getAnthropicProfileSource(process.env) !== 'env-quad') return
  const explicit = process.env.CLAUDE_CODE_FEDERATION_CACHE_DIR
  if (explicit) {
    env.CLAUDE_CODE_FEDERATION_CACHE_DIR = explicit
    return
  }
  const configDir = getAnthropicConfigDir(process.env)
  if (configDir === null) return
  env.CLAUDE_CODE_FEDERATION_CACHE_DIR = join(
    configDir,
    'credentials',
    'federation',
  )
}

/** densable `Lf` @212242245 */
export function stripEvalGitIdentity(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (
      EVAL_GIT_STRIP_EXACT.has(key.toUpperCase()) ||
      EVAL_GIT_CONFIG_KV_RE.test(key)
    ) {
      delete env[key]
    }
  }
}

/** densable `Yf`. */
export function isEvalInheritedEnvKey(key: string): boolean {
  if (EVAL_PROXY_LOWER.has(key)) return true
  const name = key.toUpperCase()
  if (EVAL_INHERIT_EXACT.has(name)) return true
  if (name.startsWith('CLAUDE_CODE_') && isEvalClaudeCodeStripped(name)) {
    return false
  }
  if (name.startsWith('EVAL_')) return true
  // gold U9e(e) before mUr(e) before Gf prefixes
  if (isEvalPackageIndexEnvKey(key)) return true
  if (isEvalConnectionStringEnvKey(key)) return false
  if (EVAL_STRIP_EXACT.has(name)) return false
  return EVAL_INHERIT_PREFIX.some(prefix => name.startsWith(prefix))
}

function inheritOperatorEnv(
  pinned: NodeJS.ProcessEnv,
  mocksPresent = false,
): NodeJS.ProcessEnv {
  const pinnedUpper = new Set(Object.keys(pinned).map(key => key.toUpperCase()))
  const inherited: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (!isEvalInheritedEnvKey(key)) continue
    const name = key.toUpperCase()
    if (pinnedUpper.has(name)) continue
    if (EVAL_OPERATOR_ONLY.has(name)) continue
    if (EVAL_STRIP_EXACT.has(name)) continue
    // gold leftover up `s&&Pi.has(Y)` — mocks drop MCP timeout inherit
    if (mocksPresent && EVAL_MOCKS_STRIP.has(name)) continue
    inherited[key] = value
  }
  // gold up: Object.assign(w, HNo(w)) after hs() inherit
  Object.assign(inherited, respellInheritedPackageIndexUrls(inherited))
  return inherited
}

/**
 * densable `tpe` (`...S` plus host/session/tty keys). `up` then
 * `tpe.filter(F => F!==ANTHROPIC_MODEL && F!==CLAUDE_AX_SCREEN_READER &&
 * !(F in S3))`, `K.delete("CLAUDE_CODE_RESTRICTED")`, re-pin EVAL_CONFINED.
 */
const EVAL_TPE_KEYS = [
  'CLAUDE_CODE_SAFE_MODE',
  'CLAUDE_CODE_SIMPLE',
  'CLAUDE_CODE_RESTRICTED',
  'CLAUDE_BG_POST_CLEAR_RESPAWN',
  'CLAUDE_CODE_RESUME_INTERRUPTED_TURN',
  'CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS',
  'CLAUDE_CODE_RESUME_PROMPT',
  'CLAUDE_CODE_RESUME_REASON',
  'CLAUDE_CODE_QUESTION_PREVIEW_FORMAT',
  'CLAUDE_CODE_QUESTION_EXTENDED',
  'CLAUDE_CODE_QUESTION_OPTIONAL_DESCRIPTIONS',
  'CLAUDE_CODE_MCP_APPS_HOST',
  'CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH',
  'GITHUB_ACTIONS',
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_CHROME_MCP_ORG_DENIED',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_COWORK_FRAME_ARTIFACTS',
  'CLAUDE_CODE_HOST_SCHEDULED_RUN',
  'CLAUDE_CODE_SKILL_PROPOSALS',
  'CLAUDE_CODE_BRIDGE_CHILD_AUTO_DEFAULT',
  'CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT',
  'CLAUDE_CODE_BRIDGE_CHILD_MACHINE_SETTINGS',
  'CLAUDE_CODE_EVAL_INTERVIEW_SESSION',
  'CLAUDE_CODE_EVAL_ARTIFACT_STUB_DIR',
  'CLAUDE_CODE_EVAL_ALLOW_ARTIFACT_PUBLISH',
  'CLAUDE_CODE_EVAL_ALLOW_FLAG_OVERRIDES',
  'CLAUDE_CODE_EVAL_CONFINED',
  'CLAUDE_BG_RV_AUTH',
  'CLAUDE_BG_PTY_AUTH',
  'CLAUDE_BG_SOCKET_TOKENS_PATH',
  'CLAUDE_BG_ISOLATION',
  'CLAUDE_CODE_RESUME_SOURCE_ALIVE',
  'CLAUDE_BG_SESSION_PERMISSION_RULES',
  'CLAUDE_BG_MEMORY_TOGGLED_OFF',
  'CLAUDE_BG_WORKSPACE_TRUSTED',
  'CLAUDE_CODE_COORDINATOR_MODE',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_AX_SCREEN_READER',
  'CLAUDE_CODE_SKIP_PROMPT_HISTORY',
  'ANTHROPIC_MODEL',
  'CLAUDE_CODE_PLUGIN_DIRS',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  '__CFBundleIdentifier',
  'KITTY_WINDOW_ID',
  'WT_SESSION',
  'KONSOLE_VERSION',
  'VTE_VERSION',
  'ZED_TERM',
  'ZELLIJ',
  'TMUX',
  'TMUX_PANE',
  'CLAUDE_CODE_TMUX_SESSION',
  'CLAUDE_CODE_TMUX_PREFIX',
  'CLAUDE_CODE_TMUX_PREFIX_CONFLICTS',
  'STY',
  'CLAUDE_CODE_RELAUNCH_TERMINAL_SIZE',
  'CLAUDE_RELAUNCH_SESSION_ADD_DIRS',
  'LC_TERMINAL',
  'SSH_CONNECTION',
  'SSH_CLIENT',
  'SSH_TTY',
  'COLORFGBG',
  'CURSOR_TRACE_ID',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'SSH_ASKPASS_REQUIRE',
  'VSCODE_GIT_ASKPASS_MAIN',
  'VSCODE_GIT_ASKPASS_NODE',
  'VSCODE_GIT_ASKPASS_EXTRA_ARGS',
  'VSCODE_GIT_IPC_HANDLE',
  'TERMINAL_EMULATOR',
  'ITERM_SESSION_ID',
  'GNOME_TERMINAL_SERVICE',
  'XTERM_VERSION',
  'ALACRITTY_LOG',
  'TILIX_ID',
  'TERMINATOR_UUID',
  'ConEmuANSI',
  'ConEmuPID',
  'ConEmuTask',
  'MSYSTEM',
  'CLAUDE_CODE_SSE_PORT',
  'FORCE_CODE_TERMINAL',
]

/** densable `S3` — tpe.filter skips these (`!(F in S3)`). */
const EVAL_TPE_S3: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  GCM_INTERACTIVE: 'never',
}
const EVAL_TPE_S3_BY_UPPER: Record<string, string> = Object.fromEntries(
  Object.entries(EVAL_TPE_S3).map(([key, value]) => [key.toUpperCase(), value]),
)

const EVAL_TPE_STRIP = new Set(
  EVAL_TPE_KEYS.filter(
    key =>
      key !== 'ANTHROPIC_MODEL' &&
      key !== 'CLAUDE_AX_SCREEN_READER' &&
      !(key in EVAL_TPE_S3),
  ).map(key => key.toUpperCase()),
)
EVAL_TPE_STRIP.delete('CLAUDE_CODE_RESTRICTED')

export function isEvalTpeStrippedKey(key: string): boolean {
  return EVAL_TPE_STRIP.has(key.toUpperCase())
}

function stripEvalTpeKeys(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (isEvalTpeStrippedKey(key)) delete env[key]
  }
}

/**
 * densable `mG` — drop host IDE/desktop entrypoint after tpe.filter.
 * Other CLAUDE_CODE_ENTRYPOINT values stay.
 */
const EVAL_MG_ENTRYPOINTS = new Set([
  'claude-vscode',
  'claude-desktop',
  'claude-desktop-3p',
])

export function isEvalHostEntrypoint(value: string | undefined): boolean {
  return value !== undefined && EVAL_MG_ENTRYPOINTS.has(value)
}

function stripEvalHostEntrypoint(env: NodeJS.ProcessEnv): void {
  if (isEvalHostEntrypoint(env.CLAUDE_CODE_ENTRYPOINT)) {
    delete env.CLAUDE_CODE_ENTRYPOINT
  }
}

const STDOUT_CAP = 67_108_864

export type SpawnEvalParams = {
  case_: ResolvedCase
  sandbox: EvalSandbox
  allowedTools: string[]
  operatorAllowedTools?: string[]
  modelOverride?: string
  artifactPublishGranted: boolean
  growthbookOverrides?: Record<string, unknown>
  verbose: boolean
  mocks?: PreparedRunMocks
  signal: AbortSignal
  /** densable `gl` `credential` — gold `xa` then `ap`. */
  credential?: EvalCredential | null
}

function gitConfigEnv(): Record<string, string> {
  const env: Record<string, string> = {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_PROXY_COMMAND: '',
    GIT_CONFIG_COUNT: String(GIT_CONFIG_PAIRS.length),
  }
  GIT_CONFIG_PAIRS.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key
    env[`GIT_CONFIG_VALUE_${index}`] = value
  })
  return env
}

/** densable `up`. */
export function buildEvalChildEnv(
  case_: ResolvedCase,
  sandbox: EvalSandbox,
  artifactPublishGranted: boolean,
  growthbookOverrides?: Record<string, unknown>,
  mocksPresent = false,
): NodeJS.ProcessEnv {
  for (const key of Object.keys(case_.execution.env)) {
    if (!EVAL_ENV_KEY.test(key)) {
      throw new Error(
        `case "${case_.name}" execution.env key "${key}" is not allowed — only EVAL_* keys can be set from case.yaml. Anything else must come from the operator's shell.`,
      )
    }
  }
  const pinned: NodeJS.ProcessEnv = {
    CLAUDE_CONFIG_DIR: sandbox.configDir,
    HOME: sandbox.home,
    USERPROFILE: sandbox.home,
    XDG_CONFIG_HOME: join(sandbox.home, '.config'),
    XDG_DATA_HOME: join(sandbox.home, '.local', 'share'),
    XDG_CACHE_HOME: join(sandbox.home, '.cache'),
    XDG_STATE_HOME: join(sandbox.home, '.local', 'state'),
    TMPDIR: sandbox.tmpDir,
    TMP: sandbox.tmpDir,
    TEMP: sandbox.tmpDir,
    CLAUDE_CODE_TMPDIR: sandbox.tmpDir,
    CLAUDE_CODE_MANAGED_SETTINGS_PATH: sandbox.configDir,
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_EVAL_CONFINED: '1',
    ...gitConfigEnv(),
  }
  if (process.platform === 'win32') {
    const drive = /^[A-Za-z]:/.test(sandbox.home)
      ? sandbox.home.slice(0, 2)
      : ''
    pinned.HOMEDRIVE = drive
    pinned.HOMEPATH = sandbox.home.slice(drive.length)
    pinned.APPDATA = join(sandbox.home, 'AppData', 'Roaming')
    pinned.LOCALAPPDATA = join(sandbox.home, 'AppData', 'Local')
  }
  const inherited = inheritOperatorEnv(pinned, mocksPresent)
  for (const [key, value] of Object.entries(process.env)) {
    if (/^EVAL_/i.test(key) && value !== undefined) inherited[key] = value
  }
  // gold up: Y$e(Tp(process.env)) drop + CONFIG_DIR/PROFILE when host-managed
  stripHostManagedEvalEnv(inherited)
  const env: NodeJS.ProcessEnv = {
    ...inherited,
    ...case_.execution.env,
    ...pinned,
  }
  // gold up `j`: when not host-managed, pin operator-home cred files if unset
  pinOperatorHomeCredentialFiles(env)
  // gold up: KS()==="env-quad" then D$e() pin federation cache dir
  pinEnvQuadFederationCacheDir(env)
  // gold up: Lf(b) then re-pin GIT_CONFIG_*
  stripEvalGitIdentity(env)
  Object.assign(env, gitConfigEnv())
  // gold up: drop S3 keys whose value is not the gold pin
  for (const key of Object.keys(env)) {
    const pin = EVAL_TPE_S3_BY_UPPER[key.toUpperCase()]
    if (pin !== undefined && env[key] !== pin) delete env[key]
  }
  // gold GWr P9n + re: REPLACE/TERMINAL_PROMPT/LFS; drop GIT_NO_LAZY_FETCH
  Object.assign(env, {
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
  })
  delete env.GIT_NO_LAZY_FETCH
  stripEvalTpeKeys(env)
  stripEvalHostEntrypoint(env)
  env.CLAUDE_CODE_EVAL_CONFINED = '1'
  if (artifactPublishGranted) {
    env.CLAUDE_CODE_EVAL_ARTIFACT_STUB_DIR = join(
      sandbox.outDir,
      'stub-publishes',
    )
    if (growthbookOverrides && Object.keys(growthbookOverrides).length > 0) {
      env.CLAUDE_INTERNAL_FC_OVERRIDES = JSON.stringify(growthbookOverrides)
    }
  }
  return env
}

/** densable `sf`. */
export async function buildEvalChildArgv(
  case_: ResolvedCase,
  sandbox: EvalSandbox,
  allowedTools: string[],
  modelOverride: string | undefined,
  mcpConfigPath: string | undefined,
): Promise<string[]> {
  const argv = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--max-turns',
    String(case_.execution.max_turns),
    '--permission-mode',
    'dontAsk',
    '--setting-sources',
    'user',
  ]
  const model = modelOverride ?? case_.execution.model
  if (model) argv.push(`--model=${model}`)
  for (const dir of case_.pluginDirs) argv.push('--plugin-dir', dir)
  // gold On @212231087 — before ht() interpolation
  assertEvalPathScopable(sandbox.root, 'sandbox')
  const addDirs = await resolveEvalAddDirs(case_)
  const pluginAndCase = await unionEvalPathSpellings([
    ...case_.pluginDirsUnderTest,
    case_.caseDir,
  ])
  const readScope = await resolveEvalReadScope(case_)
  for (const dir of [...pluginAndCase, ...addDirs, ...readScope.readRoots]) {
    assertEvalPathScopable(dir, 'plugin/case/add_dirs')
  }
  for (const path of readScope.denyPaths) {
    assertEvalPathScopable(path, 'eval deny path')
  }
  // gold pf → mf([home,tmp,...readRoots,...addDirs], readFiles) → df
  let allowed = rewriteRelativeEvalFileRules(allowedTools, sandbox.cwd)
  allowed = expandWholeToolReadGrants(
    allowed,
    [sandbox.home, sandbox.tmpDir, ...readScope.readRoots, ...addDirs],
    readScope.readFiles,
  )
  allowed = expandWholeToolWriteGrants(allowed, [sandbox.cwd, sandbox.tmpDir])
  allowed = [
    ...allowed,
    ...addDirs.flatMap(dir =>
      ['Read', 'Glob', 'Grep'].map(tool => evalToolPathRule(tool, dir)),
    ),
  ]
  allowed = [...new Set(allowed)]
  if (allowed.length > 0) {
    argv.push(`--allowed-tools=${allowed.join(',')}`)
  }
  const artifacts = join(sandbox.cwd, EVAL_ARTIFACTS_DIR)
  const disallowed = [
    evalToolPathRule('Read', sandbox.configDir),
    evalToolPathRule('Write', sandbox.configDir),
    evalToolPathRule('Read', sandbox.outDir),
    evalToolPathRule('Write', sandbox.outDir),
    `Write(${toEvalPermissionPath(artifacts)})`,
    evalToolPathRule('Write', artifacts),
    ...pluginAndCase.map(dir => evalToolPathRule('Write', dir)),
    ...evalCwdGitMetaWriteDenies(sandbox.cwd),
    ...readScope.denies,
    ...readScope.denyPaths.flatMap(path => [
      `Write(${toEvalPermissionPath(path)})`,
      evalToolPathRule('Write', path),
    ]),
    // gold sf R.push(...Ai(r)) — r is original allowedTools, before mf/df
    ...extraEvalToolDenies(allowedTools),
  ]
  if (process.platform !== 'win32') disallowed.push(EVAL_PROC_READ_DENY)
  argv.push(`--disallowed-tools=${disallowed.join(',')}`)
  if (case_.context.history_file) {
    argv.push(
      '--resume',
      await resolveEvalCaseAuthoredFile(
        case_,
        case_.context.history_file,
        'history_file',
      ),
    )
  }
  if (case_.execution.append_system_prompt) {
    argv.push(`--append-system-prompt=${case_.execution.append_system_prompt}`)
  }
  if (mcpConfigPath !== undefined) argv.push(`--mcp-config=${mcpConfigPath}`)
  return argv
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

/** densable `bgt` @198662378 */
const SANDBOX_REQUIRED_UNAVAILABLE = 'Sandbox required but unavailable'
/** densable vp strip of the O6 failIfUnavailable tail. */
const FAIL_IF_UNAVAILABLE_TAIL =
  /\s*Set sandbox\.failIfUnavailable=false[^.]*\.?/

export type ParseEvalTraceClose =
  | { kind: 'ok' }
  | { kind: 'error'; message: string }
  | { kind: 'exit'; code: string; stderrTail: string }

/** densable `vp` @212257854 */
export function parseEvalChildTrace(
  events: unknown[],
  timedOut: boolean,
  close: ParseEvalTraceClose,
  tracePath: string,
  opts: { shellGranted?: boolean; restoredCostUsd?: number } = {},
): AgentRunResult {
  return parseTrace(events, timedOut, close, tracePath, opts)
}

function parseTrace(
  events: unknown[],
  timedOut: boolean,
  close: ParseEvalTraceClose,
  tracePath: string,
  opts: { shellGranted?: boolean; restoredCostUsd?: number } = {},
): AgentRunResult {
  const toolCalls: ToolCallRecord[] = []
  const byId = new Map<string, ToolCallRecord>()
  const seenAssistantIds = new Set<string>()
  let lastAssistantText = ''
  let numTurns = 0
  let costUsd = 0
  let reconstructedCost = 0
  let assistantCount = 0
  let sawResult = false
  let resultError: string | null = null
  let authRejected = false
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const rec = event as Record<string, unknown>
    if (rec.type === 'assistant') {
      const message = rec.message as Record<string, unknown> | undefined
      // gold vp: unique message.id (null id still counts); ace(model, usage)
      const messageId = typeof message?.id === 'string' ? message.id : null
      if (messageId === null || !seenAssistantIds.has(messageId)) {
        if (messageId !== null) seenAssistantIds.add(messageId)
        assistantCount++
        const model = message?.model
        const usage = message?.usage
        if (
          typeof model === 'string' &&
          usage !== null &&
          typeof usage === 'object'
        ) {
          try {
            reconstructedCost += calculateUSDCost(
              model,
              usage as Parameters<typeof calculateUSDCost>[1],
            )
          } catch {
            // gold ace swallow
          }
        }
      }
      const content = message?.content
      if (Array.isArray(content)) {
        const texts: string[] = []
        for (const block of content) {
          if (!block || typeof block !== 'object') continue
          const b = block as Record<string, unknown>
          if (b.type === 'tool_use') {
            const call: ToolCallRecord = {
              name: String(b.name ?? ''),
              input: b.input,
              inputText: jsonText(b.input),
            }
            toolCalls.push(call)
            if (typeof b.id === 'string') byId.set(b.id, call)
          } else if (b.type === 'text') texts.push(String(b.text ?? ''))
        }
        if (texts.length > 0) lastAssistantText = texts.join('\n')
      }
      if (
        rec.parent_tool_use_id == null &&
        (rec.error === 'authentication_failed' ||
          rec.error === 'oauth_org_not_allowed')
      ) {
        authRejected = true
      }
    } else if (rec.type === 'user') {
      const message = rec.message as { content?: unknown } | undefined
      const content = message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') continue
          const b = block as Record<string, unknown>
          if (b.type !== 'tool_result' || typeof b.tool_use_id !== 'string')
            continue
          const call = byId.get(b.tool_use_id)
          if (!call) continue
          // gold vp Ei: string as-is; [{text}] concatenated; else ''
          call.output = mockResultText(b.content)
          call.isError = b.is_error === true
        }
      }
    } else if (rec.type === 'result') {
      sawResult = true
      if (typeof rec.num_turns === 'number') numTurns = rec.num_turns
      if (typeof rec.total_cost_usd === 'number') {
        costUsd = Math.max(0, rec.total_cost_usd - (opts.restoredCostUsd ?? 0))
      }
      if (Array.isArray(rec.permission_denials)) {
        for (const denial of rec.permission_denials) {
          const id =
            denial !== null &&
            typeof denial === 'object' &&
            'tool_use_id' in denial
              ? (denial as { tool_use_id?: unknown }).tool_use_id
              : undefined
          const call = typeof id === 'string' ? byId.get(id) : undefined
          if (call) call.deniedByChild = true
        }
      }
      if (rec.is_error === true) {
        if (typeof rec.result === 'string') {
          resultError = rec.result
        } else if (Array.isArray(rec.errors) && rec.errors.length > 0) {
          const lines = rec.errors.map(String)
          resultError =
            opts.shellGranted === true &&
            lines.some(line => line.startsWith(SANDBOX_REQUIRED_UNAVAILABLE))
              ? `${SHELL_UNCONFINED} ${lines
                  .map(line => line.replace(FAIL_IF_UNAVAILABLE_TAIL, ''))
                  .join(' ')}`
              : lines.join(' ')
        }
      }
    }
  }
  // gold vp !W: costUsd = Σ ace; numTurns falls back to unique assistant count
  if (!sawResult) {
    costUsd = reconstructedCost
    if (numTurns === 0) numTurns = assistantCount
  }
  let error: string | null = null
  switch (close.kind) {
    case 'ok':
      error = null
      break
    case 'error':
      error = close.message
      break
    case 'exit':
      error = resultError
        ? `exit ${close.code}: ${resultError.slice(0, 2000)}${close.stderrTail ? ` · stderr: ${close.stderrTail}` : ''}`
        : `exit ${close.code}: ${close.stderrTail || '(no stderr)'}`
      break
  }
  return {
    lastAssistantText,
    trace: events,
    toolCalls,
    numTurns,
    costUsd,
    error,
    timedOut,
    killedInFlight: timedOut,
    aborted: null,
    mockSetupFailure: null,
    mockTally: null,
    mockCalls: [] as unknown[],
    mockRecordings: [],
    artifactPublishes: collectEvalArtifactPublishes(events),
    authRejected: sawResult ? authRejected && error !== null : null,
    tracePath,
  }
}

/** densable `_o` on of/dt — dump stream-json events to outDir/trace.jsonl. */
export async function writeEvalChildTrace(
  path: string,
  events: unknown[],
): Promise<void> {
  const body = events.map(event => JSON.stringify(event) ?? '').join('\n')
  await writeFile(path, body)
}

/** densable `gl` + `of`. */
export async function spawnEvalChild(
  params: SpawnEvalParams,
): Promise<AgentRunResult> {
  const argv = await buildEvalChildArgv(
    params.case_,
    params.sandbox,
    params.allowedTools,
    params.modelOverride,
    params.mocks?.configPath,
  )
  const env = buildEvalChildEnv(
    params.case_,
    params.sandbox,
    params.artifactPublishGranted,
    params.growthbookOverrides,
    params.mocks !== undefined,
  )
  const injected = params.credential
    ? await injectEvalCredential(params.credential)
    : null
  if (injected) {
    Object.assign(env, injected.env)
    stripEvalOperatorAuthHeaders(env, params.credential!)
  }
  await assertPluginEvalGitVersion(env)
  // gold gl: await Li(D), await sp(r) then of
  await writeEvalPolicySnapshot(params.sandbox)
  // gold of: await rp(v, r); mkdir .config/git .local/lib yo; await af(...)
  await linkEvalAwsSsoCaches(params.sandbox, env)
  await applyEvalSandboxSettings(
    params.sandbox,
    params.allowedTools,
    params.operatorAllowedTools ?? [],
    params.case_,
    { childEnv: env },
  )
  const launch = buildCliLaunch(argv, { env })
  const tracePath = join(params.sandbox.outDir, 'trace.jsonl')
  // gold gl: j = history_file ? await rf(await ko(...)) : 0
  let restoredCostUsd = 0
  if (params.case_.context.history_file) {
    restoredCostUsd = await restoreEvalHistoryCostUsd(
      await resolveEvalCaseAuthoredFile(
        params.case_,
        params.case_.context.history_file,
        'history_file',
      ),
    )
  }
  return await new Promise<AgentRunResult>((resolve, reject) => {
    const events: unknown[] = []
    let buf = ''
    let bytes = 0
    let stderr = ''
    let timedOut = false
    let aborted = false
    let oversize = false
    let settled = false
    let watchVerdict: MockWatchVerdict | null = null
    const watchJobs: Promise<void>[] = []
    const watch = params.mocks ? createMockTraceWatcher(params.mocks) : null
    const child = spawn(launch.execPath, launch.args, {
      cwd: params.sandbox.cwd,
      env: launch.env,
      stdio: injected?.viaFd
        ? ['pipe', 'pipe', 'pipe', 'pipe']
        : ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
      ...evalSpawnCgroupExtras('agent'),
    })
    if (injected?.viaFd && params.credential) {
      const token =
        params.credential.kind === 'gateway'
          ? params.credential.jwt
          : params.credential.accessToken
      const fd = child.stdio[3]
      if (fd && 'write' in fd) {
        fd.write(token)
        if ('end' in fd) (fd as { end: () => void }).end()
      }
    }
    // gold of Te: unix process-group SIGKILL; no-op on windows
    const killGroup = () => {
      if (child.pid === undefined || process.platform === 'win32') return
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // process already gone
      }
    }
    // gold of te: win taskkill /T /F then SIGKILL; else Te + SIGKILL
    const killTree = () => {
      if (child.pid === undefined) return
      if (process.platform === 'win32') {
        execFile('taskkill', ['/T', '/F', '/PID', String(child.pid)], () => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL')
          }
        })
        return
      }
      killGroup()
      child.kill('SIGKILL')
    }
    process.on('exit', killGroup)
    child.stdin?.on('error', () => {})
    child.stdin?.end(params.case_.execution.prompt ?? '')
    const timeout = setTimeout(() => {
      timedOut = true
      killTree()
    }, params.case_.execution.timeout_seconds * 1000)
    const onAbort = () => {
      aborted = true
      killTree()
    }
    if (params.signal.aborted) onAbort()
    else params.signal.addEventListener('abort', onAbort, { once: true })
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      bytes += chunk.length
      if (bytes > STDOUT_CAP) {
        if (!oversize) {
          oversize = true
          killTree()
        }
        return
      }
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        try {
          const event = JSON.parse(line) as unknown
          events.push(event)
          if (watch !== null && watchVerdict === null) {
            watchJobs.push(
              Promise.resolve(watch(event)).then(
                verdict => {
                  if (verdict !== null && watchVerdict === null) {
                    watchVerdict = verdict
                    killTree()
                  }
                },
                error => {
                  logForDebugging(`eval: mock watch failed: ${error}`, {
                    level: 'error',
                  })
                },
              ),
            )
          }
        } catch {
          // ignore non-JSON stream noise
        }
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 65536) stderr += chunk
    })
    const finish = (
      close:
        | { kind: 'ok' }
        | { kind: 'error'; message: string }
        | { kind: 'exit'; code: string; stderrTail: string },
    ) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      params.signal.removeEventListener('abort', onAbort)
      process.removeListener('exit', killGroup)
      const shellGranted = params.allowedTools.some(
        rule =>
          rule === 'Bash' ||
          rule.startsWith('Bash(') ||
          rule === 'PowerShell' ||
          rule.startsWith('PowerShell('),
      )
      const result = parseTrace(events, timedOut, close, tracePath, {
        shellGranted,
        restoredCostUsd,
      })
      result.killedInFlight = timedOut || aborted || oversize
      const mocks = params.mocks
      // gold of dt: _o.catch.then(mocks Ha; nf fold; ue(Me) reject; Q(De))
      void writeEvalChildTrace(tracePath, events)
        .catch(() => {})
        .then(async () => {
          if (mocks) {
            try {
              const integrity = await applyMockIntegrity({
                toolCalls: result.toolCalls,
                mocks,
                watchVerdict,
                watchJobs,
                killedInFlight: result.killedInFlight === true,
                interrupted: aborted,
                error: result.error,
                stderr,
              })
              result.mockSetupFailure = integrity.mockSetupFailure
              result.aborted = integrity.aborted
              result.error = integrity.error
              result.mockCalls = integrity.mockCalls
              result.mockTally = integrity.mockTally
            } catch (error) {
              logForDebugging(`eval: reading mock call log failed: ${error}`, {
                level: 'error',
              })
            }
          }
          try {
            if (params.artifactPublishGranted) {
              result.artifactPublishes.push(
                ...(await foldEvalStubPublishes(
                  params.sandbox,
                  corroboratedStubSlugs(events),
                )),
              )
            }
          } catch (error) {
            logForDebugging(`eval: folding stub publishes failed: ${error}`, {
              level: 'error',
            })
            reject(error)
            return
          }
          resolve(result)
        })
    }
    child.on('error', error =>
      finish({ kind: 'error', message: String(error) }),
    )
    child.on('close', (code, signal) => {
      killGroup()
      finish(
        aborted
          ? { kind: 'error', message: 'interrupted' }
          : oversize
            ? {
                kind: 'error',
                message: `subprocess stdout exceeded ${STDOUT_CAP} bytes — killed`,
              }
            : watchVerdict !== null
              ? { kind: 'error', message: watchVerdict.message }
              : timedOut
                ? {
                    kind: 'error',
                    message: `timed out after ${params.case_.execution.timeout_seconds}s`,
                  }
                : code === 0
                  ? { kind: 'ok' }
                  : {
                      kind: 'exit',
                      code: String(code ?? `signal ${signal ?? 'unknown'}`),
                      stderrTail: stderr.slice(-2000),
                    },
      )
    })
    void reject
  }).finally(() => {
    void injected?.cleanup()
  })
}
