/**
 * densable `af` @4736 — before spawning a Bash/PowerShell-granting eval child,
 * refuse unconfined/managed-suppressed sandbox, then wx-write
 * `sandbox.configDir/settings.json`.
 */
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile,
} from 'fs/promises'
import { homedir, hostname, tmpdir, userInfo } from 'os'
import { fileURLToPath } from 'url'
import {
  delimiter,
  dirname,
  basename,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
} from 'path'
import { logForDebugging } from '../../debug.js'
import { getErrnoCode } from '../../errors.js'
import { permissionRuleValueFromString } from '../../permissions/permissionRuleParser.js'
import { getPlatform } from '../../platform.js'
import { SandboxManager } from '../../sandbox/sandbox-adapter.js'
import { getSettingsForSource } from '../../settings/settings.js'
import { getSessionCache } from '../../../services/remoteManagedSettings/syncCacheState.js'
import { jsonStringify } from '../../slowOperations.js'
import { EVAL_ARTIFACTS_DIR, SHELL_UNCONFINED } from './constants.js'
import {
  isEvalPrefixedSecretEnvKey,
  isEvalSecretShapedEnvKey,
} from './evalEnvSecretShape.js'
import { resolveEvalReadScope, toEvalPermissionPath } from './evalFence.js'
import { PluginEvalPathError } from './pathVet.js'
import type { EvalSandbox, ResolvedCase } from './types.js'

/** densable `fft` / `Di` @7144 — child `getSettingsPath()` reads this under CLAUDE_CONFIG_DIR. */
export const EVAL_REMOTE_SETTINGS_FILE = 'remote-settings.json'

/** densable `yo` @212210050 cluster. */
export const EVAL_AWS_SSO_CACHE_DIRS = [
  join('.aws', 'sso'),
  join('.aws', 'cli', 'cache'),
  join('.aws', 'boto', 'cache'),
] as const

const EVAL_SANDBOX_HOME_PREP = [
  join('.config', 'git'),
  join('.local', 'lib'),
  ...EVAL_AWS_SSO_CACHE_DIRS,
] as const

const DEV_NULL = process.platform === 'win32' ? '\\\\.\\nul' : '/dev/null'

const EVAL_SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

/** densable `yf` @212232013 — git meta under sandbox home `.git`. */
const EVAL_SANDBOX_GIT_META = ['hooks', 'config', 'commondir'] as const

/** densable `r6n` — tool-config dirs under sandbox home (not `.git`). */
const EVAL_SANDBOX_HOME_TOOL_DIRS = [
  '.vscode',
  '.idea',
  '.claude',
  '.husky',
  '.cargo',
  '.devcontainer',
  '.yarn',
  '.mvn',
] as const

/** densable `NMt` — rc/config files under sandbox home. */
const EVAL_SANDBOX_HOME_RC_FILES = [
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',
  '.zshenv',
  '.zlogin',
  '.zlogout',
  '.bash_login',
  '.bash_aliases',
  '.bash_logout',
  '.envrc',
  '.ripgreprc',
  '.mcp.json',
  '.claude.json',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.pnp.cjs',
  '.pnp.loader.mjs',
  '.pnpmfile.cjs',
  'bunfig.toml',
  '.bunfig.toml',
  '.bazelrc',
  '.bazelversion',
  '.bazeliskrc',
  '.pre-commit-config.yaml',
  'lefthook.yml',
  '.lefthook.yml',
  'lefthook.yaml',
  '.lefthook.yaml',
  'gradle-wrapper.properties',
  'maven-wrapper.properties',
  '.devcontainer.json',
  'pyrightconfig.json',
] as const

/** densable `kf` — k8s/runtime secret mounts on denyRead. */
const EVAL_SANDBOX_SECRET_MOUNTS = [
  '/var/run/secrets',
  '/run/secrets',
  '/run/credentials',
  '/etc/kubernetes/pki',
  '/var/lib/kubelet/pki',
  '/var/lib/rancher/k3s/server/tls',
  '/var/kerberos/krb5/user',
] as const

/** densable `el` — WSL Windows-side filesystems. */
const EVAL_WSL_WINDOWS_FS = new Set([
  'drvfs',
  '9p',
  'virtiofs',
  'cifs',
  'smb3',
  'smbfs',
  'nfs',
  'nfs4',
  'ntfs',
  'ntfs3',
  'fuseblk',
  'vfat',
  'exfat',
])

/**
 * densable `ho` @176698704 — sandbox.credentials.envVars deny names.
 * Gold also unions `_ne`/`X$t` secret-shaped keys and proxy `bf`; leftover
 * hole is cloud secrets + cred files, not the full classifier.
 */
const EVAL_SANDBOX_CREDENTIAL_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_ARTIFACTS_API_TOKEN',
  'CLAUDE_CODE_MEMORY_API_TOKEN',
  'CLAUDE_CODE_SLACK_TAG_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
  'ANTHROPIC_AWS_API_KEY',
  'ANTHROPIC_CUSTOM_HEADERS',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_GHA_CREDS_PATH',
  'AZURE_CLIENT_SECRET',
  'IDENTITY_HEADER',
  'MSI_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PATH',
  'AZURE_CLIENT_CERTIFICATE_PASSWORD',
  'AZURE_PASSWORD',
  'AZURE_FEDERATED_TOKEN_FILE',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'CLOUDSDK_AUTH_ACCESS_TOKEN',
  'GOOGLE_OAUTH_ACCESS_TOKEN',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'HF_TOKEN',
  'HUGGING_FACE_HUB_TOKEN',
  'HUGGINGFACEHUB_API_TOKEN',
  'NODE_AUTH_TOKEN',
  'NUGET_AUTH_TOKEN',
  'CARGO_REGISTRY_TOKEN',
  'TWINE_PASSWORD',
  'TWINE_USERNAME',
  'PYPI_TOKEN',
  'PYPI_API_TOKEN',
  'UV_PUBLISH_TOKEN',
  'UV_PUBLISH_PASSWORD',
  'UV_PUBLISH_USERNAME',
  'FLIT_PASSWORD',
  'FLIT_USERNAME',
  'HATCH_INDEX_AUTH',
  'HATCH_INDEX_USER',
  'GEM_HOST_API_KEY',
  'MATURIN_PYPI_TOKEN',
  'MATURIN_PASSWORD',
  'MATURIN_USERNAME',
  'CONAN_LOGIN_USERNAME',
  'CONAN_PASSWORD',
  'ANACONDA_API_TOKEN',
  'BINSTAR_API_TOKEN',
  'VAULT_TOKEN',
  'VAULT_AUTH_TOKEN',
  'VAULT_ROLE_ID',
  'VAULT_SECRET_ID',
  'CONSUL_HTTP_TOKEN',
  'CONSUL_HTTP_AUTH',
  'NOMAD_TOKEN',
  'NOMAD_HTTP_AUTH',
  'CI_REGISTRY_USER',
  'CI_DEPLOY_USER',
  'JF_USER',
  'FASTLANE_SESSION',
  'MATCH_GIT_BASIC_AUTHORIZATION',
  'SONAR_TOKEN',
  'SONARQUBE_SCANNER_PARAMS',
  'SONAR_SCANNER_JSON_PARAMS',
  'SLACK_WEBHOOK_URL',
  'SLACK_WEBHOOK',
  'DISCORD_WEBHOOK',
  'DISCORD_WEBHOOK_URL',
  'TEAMS_WEBHOOK_URL',
  'MS_TEAMS_WEBHOOK_URI',
  'ANTHROPIC_IDENTITY_TOKEN',
  'ANTHROPIC_IDENTITY_TOKEN_FILE',
  'CLOUDSDK_AUTH_ACCESS_TOKEN_FILE',
  'CLOUDSDK_AUTH_AUTHORIZATION_TOKEN_FILE',
  'AZURE_AUTH_LOCATION',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_RUNTIME_URL',
  'ALL_INPUTS',
  'VSS_NUGET_EXTERNAL_FEED_ENDPOINTS',
  'ARTIFACTS_CREDENTIALPROVIDER_EXTERNAL_FEED_ENDPOINTS',
  'VSS_NUGET_ACCESSTOKEN',
  'ARTIFACTS_CREDENTIALPROVIDER_ACCESSTOKEN',
  'COMPOSER_AUTH',
  'OVERRIDE_GITHUB_TOKEN',
  'DEFAULT_WORKFLOW_TOKEN',
  'SSH_SIGNING_KEY',
] as const

/**
 * densable leftover `af` `hUr`/`Dl` — JAVA/Maven/Gradle tool-option keys
 * whose values `tm` scans for `-D…Password=` / QC.
 */
const EVAL_JAVA_TOOL_OPTION_KEYS = new Set([
  'JAVA_TOOL_OPTIONS',
  'JDK_JAVA_OPTIONS',
  '_JAVA_OPTIONS',
  'IBM_JAVA_OPTIONS',
  'OPENJ9_JAVA_OPTIONS',
  'MAVEN_OPTS',
  'GRADLE_OPTS',
  'MAVEN_ARGS',
  'MAVEN_CONFIG',
  'ANT_OPTS',
  'ANT_ARGS',
  'JAVA_OPTS',
  'SBT_OPTS',
  'JVM_OPTS',
  'LEIN_JVM_OPTS',
  'ES_JAVA_OPTS',
  'SONAR_SCANNER_OPTS',
  'SONAR_SCANNER_JAVA_OPTS',
])

const EVAL_TRUSTSTORE_CHANGEIT = /^-D[\w.-]*trust-?store-?password=changeit$/i

/** densable leftover `zo`. */
const EVAL_JAVA_V4N_ZO = new Set([
  'sonar.login',
  'sonar.token',
  'sonar.password',
])

/** densable leftover `EUr`. */
const EVAL_QC_PEM = /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/

/**
 * densable leftover `QC` Bearer/Basic tail (JAVA `-D` values + non-JAVA `QC(s)`).
 */
const EVAL_QC_BEARER_BASIC =
  /\b(?:Bearer|Basic)\s+(?=[A-Za-z._~+/=-]*[0-9]|(?:[A-Za-z0-9._~+/=-]*?[a-z][A-Z](?![a-z])){2}|[A-Za-z0-9.-]*[_~+/=])[A-Za-z0-9._~+/=-]{8,}/

/**
 * densable leftover `af` `bf` @212233367 — proxy env names on
 * sandbox.credentials.envVars. Gold unions q1r except JAVA_TOOL_OPTIONS
 * (`tm` scans those values instead).
 */
const EVAL_SANDBOX_PROXY_ENV_VARS = [
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'all_proxy',
  'no_proxy',
  'npm_config_http_proxy',
  'NPM_CONFIG_PROXY',
  'NPM_CONFIG_HTTPS_PROXY',
  'NPM_CONFIG_HTTP_PROXY',
  'YARN_PROXY',
  'YARN_HTTP_PROXY',
  'YARN_HTTPS_PROXY',
  'npm_config_proxy',
  'npm_config_https_proxy',
  'npm_config_noproxy',
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
] as const

/**
 * densable leftover `af` `Qa` @212232047 — env keys whose values are
 * credential-file pointers. `Te` unions child env and process.env.
 * KUBECONFIG (`Sf`) is delimiter-split. GOENV value `off` is skipped.
 */
const EVAL_CREDENTIAL_POINTER_ENV = [
  'CLAUDE_ENV_FILE',
  'SSL_CLIENT_CERT',
  'REGISTRY_AUTH_FILE',
  'RCLONE_CONFIG',
  'SOPS_AGE_KEY_FILE',
  'ANSIBLE_VAULT_PASSWORD_FILE',
  'BOTO_CONFIG',
  'S3CMD_CONFIG',
  'HEX_HOME',
  'BUN_CONFIG_FILE',
  'GOENV',
  'HF_TOKEN_PATH',
  'HF_STORED_TOKENS_PATH',
  'HELM_REGISTRY_CONFIG',
  'HELM_REPOSITORY_CONFIG',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_CONFIG_FILE',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'CLOUDSDK_CONFIG',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_GHA_CREDS_PATH',
  'AZURE_CLIENT_CERTIFICATE_PATH',
  'AZURE_FEDERATED_TOKEN_FILE',
  'AZURE_CONFIG_DIR',
  'KUBECONFIG',
  'DOCKER_CONFIG',
  'DOCKER_CERT_PATH',
  'NPM_CONFIG_GLOBALCONFIG',
  'NETRC',
  'NPM_CONFIG_USERCONFIG',
  'GH_CONFIG_DIR',
  'CLAUDE_CODE_CLIENT_KEY',
  'CLAUDE_CODE_CLIENT_CERT',
  'GIT_SSL_KEY',
  'GIT_SSL_CERT',
  'PIP_CLIENT_CERT',
  'PIP_CONFIG_FILE',
  'PGPASSFILE',
  'PGSERVICEFILE',
  'PGSSLKEY',
  'VAULT_CLIENT_KEY',
  'VAULT_CLIENT_CERT',
  'CONSUL_CLIENT_KEY',
  'CONSUL_CLIENT_CERT',
  'NOMAD_CLIENT_KEY',
  'NOMAD_CLIENT_CERT',
  'CONSUL_HTTP_TOKEN_FILE',
  'TF_CLI_CONFIG_FILE',
  'WGETRC',
  'GNUPGHOME',
  'CREDENTIALS_DIRECTORY',
  'ANTHROPIC_CONFIG_DIR',
  'CLAUDE_CODE_FEDERATION_CACHE_DIR',
  'ANTHROPIC_IDENTITY_TOKEN_FILE',
  'AZURE_AUTH_LOCATION',
  'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
  'CLOUDSDK_AUTH_ACCESS_TOKEN_FILE',
  'CLOUDSDK_AUTH_AUTHORIZATION_TOKEN_FILE',
] as const

const EVAL_CREDENTIAL_POINTER_SPLIT = new Set(['KUBECONFIG'])

export type EvalSandboxFenceSeams = {
  isSupportedPlatform?: () => boolean
  checkDependencies?: () => { errors: unknown[] }
  isPlatformInEnabledList?: () => boolean
  operatorHome?: () => string
  policySandboxes?: () => Record<string, unknown>[]
  policyCache?: () => Record<string, unknown> | null
  policyEligible?: () => boolean
  /** densable `af` `s` — child env for credentials.envVars case-pin skip. */
  childEnv?: NodeJS.ProcessEnv
  /** densable `Ef` — `/proc/mounts` text; tests inject instead of reading. */
  wslMountTable?: string
}

function pick(
  source: Record<string, unknown> | undefined,
  keys: string[],
): Record<string, unknown> | undefined {
  if (!source) return undefined
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * densable `dKn` visible slice — deny/ask/sandbox-deny plus disable/enable
 * polarity. Does not invent the Qe() catalog.
 */
export function pickEvalPolicySnapshot(
  cache: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!cache) return {}
  const out: Record<string, unknown> = {}
  const permissions = cache.permissions
  if (permissions && typeof permissions === 'object') {
    const slice = pick(permissions as Record<string, unknown>, [
      'deny',
      'ask',
      'disableBypassPermissionsMode',
      'disableAutoMode',
    ])
    if (slice) out.permissions = slice
  }
  if (cache.attribution === false) {
    out.attribution = { sessionUrl: false }
  }
  if (cache.disableAllHooks === true) out.allowManagedHooksOnly = true
  if (
    Array.isArray(cache.httpHookAllowedEnvVars) &&
    cache.httpHookAllowedEnvVars.length === 0
  ) {
    out.httpHookAllowedEnvVars = []
  }
  const sandbox = cache.sandbox
  if (sandbox && typeof sandbox === 'object') {
    const sb = sandbox as Record<string, unknown>
    const filesystem = pick(
      sb.filesystem as Record<string, unknown> | undefined,
      ['denyRead', 'denyWrite', 'allowManagedReadPathsOnly'],
    )
    const network = pick(sb.network as Record<string, unknown> | undefined, [
      'deniedDomains',
      'strictAllowlist',
      'allowManagedDomainsOnly',
    ])
    const credentials = pick(
      sb.credentials as Record<string, unknown> | undefined,
      ['files', 'envVars'],
    )
    const sandboxOut: Record<string, unknown> = {}
    if (filesystem) sandboxOut.filesystem = filesystem
    if (network) sandboxOut.network = network
    if (credentials) sandboxOut.credentials = credentials
    if (Object.keys(sandboxOut).length > 0) out.sandbox = sandboxOut
  }
  for (const [key, value] of Object.entries(cache)) {
    if (key.startsWith('disable') && (value === true || value === 'disable')) {
      out[key] = value
    }
    if (key.startsWith('enable') && value === false) out[key] = value
  }
  return out
}

function defaultPolicyCache(): Record<string, unknown> | null {
  const cache = getSessionCache()
  if (cache && typeof cache === 'object') {
    return cache as Record<string, unknown>
  }
  return null
}

function defaultPolicyEligible(): boolean {
  try {
    const { isRemoteManagedSettingsEligible } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../services/remoteManagedSettings/syncCache.js') as typeof import('../../../services/remoteManagedSettings/syncCache.js')
    return isRemoteManagedSettingsEligible()
  } catch {
    return false
  }
}

/**
 * densable `sp` @246668 — wx `configDir/remote-settings.json` for the child.
 * Identical existing file is kept; any other occupant throws.
 */
export async function writeEvalPolicySnapshot(
  sandbox: EvalSandbox,
  seams: EvalSandboxFenceSeams = {},
): Promise<void> {
  const cache = (seams.policyCache ?? defaultPolicyCache)()
  const eligible = (seams.policyEligible ?? defaultPolicyEligible)()
  if (!cache && eligible) {
    logForDebugging(
      '[eval] no cached organization policy to hand the child (the managed-settings fetch has not produced one); a child that cannot fetch runs without the remote-managed tier',
      { level: 'warn' },
    )
  }
  const snapshot = {
    ...pickEvalPolicySnapshot(cache),
    managedSourcesBehavior: 'merge',
  }
  const path = join(sandbox.configDir, EVAL_REMOTE_SETTINGS_FILE)
  const body = jsonStringify(snapshot)
  try {
    await writeFile(path, body, { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if (getErrnoCode(error) !== 'EEXIST') {
      throw new PluginEvalPathError(
        'the organization policy snapshot could not be placed in the evaluation sandbox (a different file is already there or it could not be written)',
        'eval policy snapshot refused',
      )
    }
    const existing = await readFile(path, 'utf8').catch(() => null)
    const st = await stat(path).catch(() => null)
    if (
      !st?.isFile() ||
      st.size !== Buffer.byteLength(body) ||
      existing !== body
    ) {
      throw new PluginEvalPathError(
        'the organization policy snapshot could not be placed in the evaluation sandbox (a different file is already there or it could not be written)',
        'eval policy snapshot refused',
      )
    }
  }
}

function awsCredEnvSet(env: NodeJS.ProcessEnv): boolean {
  const nul = DEV_NULL
  for (const [key, value] of Object.entries(env)) {
    const name = key.toUpperCase()
    if (name !== 'AWS_CONFIG_FILE' && name !== 'AWS_SHARED_CREDENTIALS_FILE') {
      continue
    }
    const trimmed = (value ?? '').trim()
    if (trimmed !== '' && trimmed !== nul) return true
  }
  return false
}

/**
 * densable `rp` + of mkdir — junction SSO caches into sandbox home when AWS
 * config/credentials files are pinned; always mkdir git/lib/aws cache dirs.
 */
export async function linkEvalAwsSsoCaches(
  sandbox: EvalSandbox,
  env: NodeJS.ProcessEnv,
  seams: EvalSandboxFenceSeams = {},
): Promise<void> {
  const operatorHome = seams.operatorHome ?? (() => homedir())
  if (awsCredEnvSet(env)) {
    const home = operatorHome()
    for (const rel of EVAL_AWS_SSO_CACHE_DIRS) {
      const source = join(home, rel)
      const dest = join(sandbox.home, rel)
      const isDir = await stat(source).then(
        st => st.isDirectory(),
        () => false,
      )
      if (!isDir) continue
      await mkdir(dirname(dest), { recursive: true })
      try {
        await symlink(source, dest, 'junction')
      } catch (error) {
        logForDebugging(
          `[eval] could not link ${rel} into the sandbox home (${getErrnoCode(error) ?? 'unknown'}); an SSO-cached login will not reach the child`,
          { level: getErrnoCode(error) === 'EEXIST' ? 'debug' : 'warn' },
        )
      }
    }
  }
  for (const rel of EVAL_SANDBOX_HOME_PREP) {
    await mkdir(join(sandbox.home, rel), { recursive: true })
  }
}

function grantedToolNames(rules: string[]): Set<string> {
  return new Set(rules.map(raw => permissionRuleValueFromString(raw).toolName))
}

function isFilesystemRoot(path: string): boolean {
  if (!path || !isAbsolute(path)) return false
  const n = resolve(path)
  return n === dirname(n)
}

function hasGlobChar(path: string): boolean {
  return /[*?[\]]/.test(path)
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(path => path !== ''))]
}

/** densable leftover `af` `kr` — windows identity, else `ht` `//` prefix. */
function sandboxSettingsPath(path: string): string {
  return getPlatform() === 'windows' ? path : toEvalPermissionPath(path)
}

/** densable leftover `QC` `be`. */
const EVAL_QC_VALUE_CAP = 8192

/** densable leftover `li`. */
const EVAL_QC_LI_PREFIX =
  /^(?:gh[opusr]_|github_pat_|glpat-|xox[abpr]-|sk-|pk-|AKIA|eyJ|ya29\.|npm_)/

/** densable leftover `qt` host:port/path image-ref. */
const EVAL_QC_HOST_PORT_PATH =
  /^([a-z0-9_-]+(?:\.[a-z0-9_-]+)*):\d+([/?#].*)$/is

/** densable leftover `ui`. */
const EVAL_QC_UI =
  /^(?:localhost|[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.(?=[a-z0-9-]*[a-z])[a-z0-9-]+|[a-z0-9_.-]+(?=:\d+(?:[/?#]|$))|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])(?::\d+)?(?:[/?#]|$)/i

/** densable leftover `di`. */
const EVAL_QC_DI =
  /^(?:(?=[a-z0-9._-]*[a-z])[a-z0-9._-]+|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])(?::\d+)?(?:[/?#]|$)/i

/** densable leftover `li`. */
function isEvalQcSecretUserinfo(user: string): boolean {
  return (
    EVAL_QC_LI_PREFIX.test(user) ||
    (user.length >= 20 && /[0-9]/.test(user) && /[a-z]/i.test(user))
  )
}

/** densable leftover `qt`. */
function isEvalQcHostPortImageFalsePositive(
  user: string,
  rest: string,
): boolean {
  const match = EVAL_QC_HOST_PORT_PATH.exec(user)
  if (!match) return false
  if (/[?#&]/.test(match[2] ?? '')) return true
  if (EVAL_QC_UI.test(rest)) return false
  if (user.endsWith('/')) return true
  if (/^(?:v?\d|sha\d*:)/i.test(rest)) return true
  return !EVAL_QC_DI.test(rest)
}

/**
 * densable leftover `QC` userinfo `r` — `://` then `user:pass@` or
 * secret-shaped userinfo without a password (`sk-…@host`).
 */
function evalQcUrlUserinfoLooksLikeCredential(value: string): boolean {
  const n =
    value.length > EVAL_QC_VALUE_CAP ? value.slice(0, EVAL_QC_VALUE_CAP) : value
  const looks = (g: string): boolean => {
    const space = g.search(/\s/)
    const token = space === -1 ? g : g.slice(0, space)
    const at = token.lastIndexOf('@')
    if (at === -1) return false
    const user = token.slice(0, at)
    const rest = token.slice(at + 1)
    if (isEvalQcHostPortImageFalsePositive(user, rest)) return false
    return (
      user.includes(':') ||
      (!/[/?#]/.test(user) && isEvalQcSecretUserinfo(user))
    )
  }
  let s = n.indexOf('://')
  while (s !== -1) {
    const prev = n[s - 1] ?? ''
    if (s > 0 && /[a-z0-9+.-]/i.test(prev) && looks(n.slice(s + 3))) {
      return true
    }
    s = n.indexOf('://', s + 3)
  }
  return n.startsWith('//') && looks(n.slice(2))
}

function envValueLooksLikeCredential(value: string): boolean {
  if (/[?&](?:token|password|secret|key|auth|login)=/i.test(value)) return true
  if (/\bauthorization\s*[:=]/i.test(value)) return true
  if (EVAL_QC_PEM.test(value)) return true
  if (EVAL_QC_BEARER_BASIC.test(value)) return true
  return evalQcUrlUserinfoLooksLikeCredential(value)
}

function foldEnvKey(key: string): string {
  return key
    .toUpperCase()
    .replace(/^INPUT_/, '')
    .replace(/-/g, '_')
}

/** densable leftover `Ce` on a JAVA `-D` last segment. */
function foldJavaPropertyLast(name: string): string[] {
  const last = name.split('.').at(-1) ?? ''
  return last
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .split(/[_-]+/)
    .filter(Boolean)
    .map(part => part.toUpperCase().replace(/\d+$/, ''))
    .filter(Boolean)
}

/**
 * densable leftover `V4n` — `zo` sonar.login/token/password, last-segment
 * USERNAME/USER, secret-shaped property names.
 */
function javaPropertyLooksLikeV4n(name: string): boolean {
  if (EVAL_JAVA_V4N_ZO.has(name.toLowerCase())) return true
  const parts = foldJavaPropertyLast(name)
  const last = parts.at(-1)
  if (!last) return false
  if (/^sonar\./i.test(name) && last === 'SECURED') return true
  if (
    /password|passwd|secret|token|credential|api[_-]?key|passphrase/i.test(name)
  ) {
    return true
  }
  return last === 'USERNAME' || (last === 'USER' && parts.length > 1)
}

/** densable leftover `j9e` — quote-aware split of JAVA_TOOL_OPTIONS. */
function splitJavaToolOptions(value: string): string[] | null {
  const out: string[] = []
  let cur = ''
  let inToken = false
  let i = 0
  while (i < value.length) {
    const ch = value[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (inToken) {
        out.push(cur)
        cur = ''
        inToken = false
      }
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      const close = value.indexOf(ch, i + 1)
      if (close === -1) return null
      cur += value.slice(i + 1, close)
      inToken = true
      i = close + 1
      continue
    }
    cur += ch
    inToken = true
    i++
  }
  if (inToken) out.push(cur)
  return out
}

/** densable leftover `j9e`/`amn` subset — split JAVA_TOOL_OPTIONS -D flags. */
function javaToolOptionLooksLikeCredential(value: string): boolean {
  const trimmed = value.trim()
  if (EVAL_TRUSTSTORE_CHANGEIT.test(trimmed)) return false
  const tokens = splitJavaToolOptions(trimmed)
  if (tokens === null) return true
  const defs = tokens.flatMap((token, index) => {
    const prev = index > 0 ? tokens[index - 1] : undefined
    if (prev === '-D' || prev === '--define') return [`-D${token}`]
    if (token.startsWith('--define='))
      return [`-D${token.slice('--define='.length)}`]
    return [token]
  })
  for (const def of defs) {
    const match = /^-D([^=]+)=(.*)$/s.exec(def)
    if (!match) {
      if (envValueLooksLikeCredential(def)) return true
      continue
    }
    const name = match[1] ?? ''
    const val = match[2] ?? ''
    // gold leftover tm: V4n(name) && !bUr(name, val)
    if (
      javaPropertyLooksLikeV4n(name) &&
      val !== '' &&
      val.toLowerCase() !== 'changeit' &&
      !/^(?:\d+[a-z]{0,2}|true|false)$/i.test(val)
    ) {
      return true
    }
    if (envValueLooksLikeCredential(val)) return true
  }
  return false
}

/**
 * densable leftover `af` `tm` @212285494 — env keys whose values look like
 * creds (JAVA -D password, proxy userinfo, URL userinfo).
 */
function scanEnvValuesForCredentials(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = []
  for (const [key, raw] of Object.entries(env)) {
    const value = raw === undefined ? '' : String(raw).trim()
    if (!value) continue
    const folded = foldEnvKey(key)
    if (EVAL_JAVA_TOOL_OPTION_KEYS.has(folded)) {
      if (javaToolOptionLooksLikeCredential(value)) out.push(key)
      continue
    }
    if (/proxy/i.test(key) && value.includes('@')) {
      out.push(key)
      continue
    }
    if (envValueLooksLikeCredential(value)) out.push(key)
  }
  return out
}

/** densable leftover `af` `Za`/`wf`/`go`. */
function sandboxTmpRoots(platform: string): string[] {
  if (platform === 'windows') return []
  const unixTmp = ['/tmp', '/var/tmp', '/dev/shm', '/run/shm']
  if (platform === 'macos') {
    return [...unixTmp, '/private/tmp', '/private/var/tmp']
  }
  return unixTmp
}

async function realpathOrSelf(path: string): Promise<string> {
  return realpath(path).catch(() => path)
}

/** densable leftover `Re` subset — child strictly under ancestor. */
function isPathInside(ancestor: string, child: string): boolean {
  const rel = relative(ancestor, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * densable leftover `af` macos `Pe`/`Ye` — `vt` realpath of `go()` tmp
 * roots. Whole root is Pe unless `dir===L || real===L` (`L=dirname(root)`);
 * then Ye is unique named dirs under both spellings.
 */
async function macosEvalTmpDenyWrites(sandbox: EvalSandbox): Promise<string[]> {
  if (getPlatform() !== 'macos') return []
  const parent = dirname(sandbox.root)
  const roots = await Promise.all(
    sandboxTmpRoots('macos').map(async dir => ({
      dir,
      real: await realpathOrSelf(dir),
    })),
  )
  const isParent = (row: { dir: string; real: string }) =>
    row.dir === parent || row.real === parent
  const pe = roots.filter(row => !isParent(row)).map(row => row.dir)
  const ne = roots.filter(isParent)
  const uid = process.getuid?.() ?? 0
  const named = [
    `claude-${uid}`,
    `cc-daemon-${uid}`,
    'cc-socks',
    `cc-socks-${uid}`,
  ]
  const extra = process.env.CLAUDE_CODE_TMPDIR?.trim()
  let extraNamed: string[] = []
  if (extra) {
    extraNamed = uniquePaths([extra, await realpathOrSelf(extra)]).flatMap(
      dir => [`claude-${uid}`, 'cc-socks'].map(name => join(dir, name)),
    )
    extraNamed = extraNamed.filter(path =>
      ne.some(
        row => isPathInside(row.dir, path) || isPathInside(row.real, path),
      ),
    )
  }
  const ye = uniquePaths([
    ...ne.flatMap(({ dir, real }) =>
      uniquePaths([dir, real]).flatMap(base =>
        named.map(name => join(base, name)),
      ),
    ),
    ...extraNamed,
  ])
  return [...pe, ...ye]
}

/** densable `vf` @212233737 — WSL Windows-side mount points. */
export function parseWslWindowsMounts(table: string): string[] {
  const out: string[] = []
  for (const line of table.split('\n')) {
    const [source, mount, fstype, opts] = line.split(' ')
    if (
      mount === undefined ||
      fstype === undefined ||
      !posix.isAbsolute(mount)
    ) {
      continue
    }
    const base = fstype.split('.')[0] ?? fstype
    if (
      EVAL_WSL_WINDOWS_FS.has(fstype) ||
      EVAL_WSL_WINDOWS_FS.has(base) ||
      base === 'fuse' ||
      /^[A-Za-z]:/.test(source ?? '') ||
      /^(\\\\|\/\/)/.test(source ?? '') ||
      /^[^/\s]+:\//.test(source ?? '') ||
      /(^|,)aname=drvfs/.test(opts ?? '')
    ) {
      out.push(
        mount.replace(/\\([0-7]{3})/g, (_m, oct: string) =>
          String.fromCharCode(parseInt(oct, 8)),
        ),
      )
    }
  }
  return uniquePaths(out)
}

async function readWslWindowsMounts(
  platform: string,
  table: string | undefined,
): Promise<string[]> {
  if (platform !== 'wsl') return []
  const text =
    table ??
    (await readFile('/proc/mounts', 'utf8').catch(() => {
      throw new PluginEvalPathError(
        "A shell tool was granted, but the WSL mount table (/proc/mounts) cannot be read, so the Windows side could not be put out of the sandboxed shell's reach — the run was refused.",
        'eval: WSL Windows-side mounts undetermined',
      )
    }))
  const mounts = parseWslWindowsMounts(text)
  if (mounts.length === 0) {
    throw new PluginEvalPathError(
      "A shell tool was granted, but no Windows filesystem mount was recognized in the WSL mount table, so the Windows side could not be put out of the sandboxed shell's reach — the run was refused.",
      'eval: WSL Windows-side mounts undetermined',
    )
  }
  return mounts
}

/** densable `mo` @212191294 — unique realpath spellings on linux/wsl. */
async function uniqueRealpathSpellings(paths: string[]): Promise<string[]> {
  const out: string[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    const spelling = path.startsWith('//') ? path.slice(1) : path
    const resolved = await realpath(spelling).catch(() => spelling)
    if (!seen.has(resolved)) {
      seen.add(resolved)
      out.push(resolved)
    }
  }
  return out
}

function expandHomePrefix(value: string, home: string): string {
  return value.replace(/^~(?=[\\/]|$)/, home)
}

/**
 * densable leftover `af` `Te` — child env then process.env, case-folded.
 * `Sf` (`KUBECONFIG`) splits on the path delimiter. `GOENV=off` is skipped.
 */
function pointerValuesForKey(
  childEnv: NodeJS.ProcessEnv,
  name: string,
): string[] {
  const out: string[] = []
  for (const bag of [childEnv, process.env]) {
    for (const [key, value] of Object.entries(bag)) {
      if (key.toUpperCase() !== name.toUpperCase() || value === undefined) {
        continue
      }
      if (name === 'GOENV' && value.trim() === 'off') continue
      if (EVAL_CREDENTIAL_POINTER_SPLIT.has(name)) {
        out.push(...value.split(delimiter))
      } else {
        out.push(value)
      }
    }
  }
  return out
}

/** densable leftover `af` `se` — child env wins, else process.env. */
function pointerEnv(
  childEnv: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  for (const bag of [childEnv, process.env]) {
    for (const [key, value] of Object.entries(bag)) {
      if (key.toUpperCase() === name.toUpperCase() && value !== undefined) {
        return value
      }
    }
  }
  return undefined
}

/** densable leftover `af` `ye`. */
function credentialsPointerUnreadable(detail: string): PluginEvalPathError {
  return new PluginEvalPathError(
    `a credentials file in this environment (the AWS config / shared credentials file, the GCP application-default credentials, a kubeconfig, or an Anthropic profile config) could not be followed (${detail}), so the Bash sandbox cannot exclude the files it points at — a Bash-granting evaluation cannot run here`,
    'eval shell grant refused: credentials pointer file unreadable',
  )
}

function requireAbsolutePointer(path: string, detail: string): string {
  if (!isAbsolute(path)) throw credentialsPointerUnreadable(detail)
  return path
}

/**
 * densable leftover `af` `Ce(name, fallback)` — fallback plus an absolute
 * `se` override. Both must be absolute.
 */
function pointerOrFallback(
  childEnv: NodeJS.ProcessEnv,
  home: string,
  name: string,
  fallback: string,
): string[] {
  const raw = pointerEnv(childEnv, name)?.trim()
  const override = raw
    ? requireAbsolutePointer(
        expandHomePrefix(raw, home),
        `${name} holds a relative path`,
      )
    : undefined
  const out = [fallback]
  if (override && override !== fallback) out.push(override)
  return out.filter(path => isAbsolute(path))
}

/** densable leftover `af` `ke` — one absolute `se` path, or none. */
function pointerOnly(
  childEnv: NodeJS.ProcessEnv,
  home: string,
  name: string,
): string | undefined {
  const raw = pointerEnv(childEnv, name)?.trim()
  if (!raw) return undefined
  return requireAbsolutePointer(
    expandHomePrefix(raw, home),
    `${name} holds a relative path`,
  )
}

/**
 * densable leftover `af` `un` — COURSIER_CREDENTIALS.
 * Property form (`host=…`) and non-file URLs are ignored. `file:` must be local.
 */
function coursierCredentialPath(
  childEnv: NodeJS.ProcessEnv,
  home: string,
): string | undefined {
  const raw = pointerEnv(childEnv, 'COURSIER_CREDENTIALS')?.trim()
  if (!raw || /[\r\n]/.test(raw) || /^[^/]*=/.test(raw)) return undefined
  let path = raw
  if (/^file:/i.test(raw)) {
    try {
      path = fileURLToPath(raw)
    } catch {
      throw credentialsPointerUnreadable(
        'COURSIER_CREDENTIALS holds a file: URL that is not a local path',
      )
    }
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return undefined
  }
  return requireAbsolutePointer(
    expandHomePrefix(path, home),
    'COURSIER_CREDENTIALS holds a relative path',
  )
}

/**
 * densable leftover `af` `$l` — FILE/WRFILE/DIR Kerberos cache or keytab.
 * DIR with a leading `:` also denies the parent directory.
 */
function kerberosCredentialPaths(value: string | undefined): string[] {
  const raw = value?.trim()
  if (!raw) return []
  const match = /^([A-Za-z]+):(.*)$/.exec(raw)
  const kind = (match?.[1] ?? 'FILE').toUpperCase()
  let path = match ? match[2] : raw
  if (kind !== 'FILE' && kind !== 'WRFILE' && kind !== 'DIR') return []
  let includeDir = false
  if (kind === 'DIR' && path.startsWith(':')) {
    path = path.slice(1)
    includeDir = true
  }
  if (!isAbsolute(path)) {
    throw credentialsPointerUnreadable(
      'a Kerberos ticket cache / keytab is named by a relative path',
    )
  }
  return includeDir ? [path, dirname(path)] : [path]
}

const KRB5_INCLUDE_RE = /^(include|includedir)\s+(.+)$/i
const KRB5_SECTION_RE = /^\[([^\]]+)\]/
const KRB5_DEFAULT_NAME_RE =
  /^(default_ccache_name|default_keytab_name|default_client_keytab_name)\s*=\s*(.+)$/i
const KRB5_UID_RE = /%\{(?:uid|euid|USERID)\}/g
const KRB5_CONF_NAME_RE = /^[A-Za-z0-9_-]+$/

/**
 * densable leftover `af` `jp` — `KRB5_CONFIG` (default `/etc/krb5.conf`)
 * include/includedir walk, then `[libdefaults]` ccache/keytab names via `$l`.
 */
async function krb5ConfigCredentialPaths(
  childEnv: NodeJS.ProcessEnv,
): Promise<string[]> {
  const raw = pointerEnv(childEnv, 'KRB5_CONFIG')?.trim() || '/etc/krb5.conf'
  const roots = raw
    .split(delimiter)
    .map(part => part.trim())
    .filter(part => part !== '')
  if (roots.some(path => !isAbsolute(path))) {
    throw credentialsPointerUnreadable('KRB5_CONFIG holds a relative path')
  }
  const uid = String(process.getuid?.() ?? '')
  const out: string[] = []
  const seen = new Set<string>()
  const walk = async (path: string, depth: number): Promise<void> => {
    if (seen.has(path)) return
    if (depth > 8) {
      throw credentialsPointerUnreadable(
        'krb5.conf include files nest too deeply',
      )
    }
    seen.add(path)
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      const code = getErrnoCode(error)
      if (code === 'ENOENT' || code === 'ENOTDIR') return
      throw credentialsPointerUnreadable('a credential store')
    }
    let inLibdefaults = false
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      const include = KRB5_INCLUDE_RE.exec(trimmed)
      if (include) {
        const target = include[2]?.trim() ?? ''
        if (!isAbsolute(target)) {
          throw credentialsPointerUnreadable(
            'a krb5.conf include names a relative path',
          )
        }
        if (include[1]?.toLowerCase() === 'include') {
          await walk(target, depth + 1)
        } else {
          let names: string[]
          try {
            names = await readdir(target)
          } catch (error) {
            const code = getErrnoCode(error)
            if (code === 'ENOENT' || code === 'ENOTDIR') continue
            throw credentialsPointerUnreadable(
              'a krb5.conf includedir could not be listed',
            )
          }
          for (const name of names.sort()) {
            if (KRB5_CONF_NAME_RE.test(name) || name.endsWith('.conf')) {
              await walk(join(target, name), depth + 1)
            }
          }
        }
        continue
      }
      const section = KRB5_SECTION_RE.exec(trimmed)
      if (section) {
        inLibdefaults = section[1]?.trim().toLowerCase() === 'libdefaults'
        continue
      }
      if (!inLibdefaults) continue
      const locator = KRB5_DEFAULT_NAME_RE.exec(trimmed)
      if (!locator) continue
      const value = (locator[2] ?? '').trim().replace(KRB5_UID_RE, uid)
      if (/%\{/.test(value)) {
        throw credentialsPointerUnreadable(
          'a krb5.conf credential locator uses a parameter expansion that cannot be resolved',
        )
      }
      out.push(...kerberosCredentialPaths(value))
    }
  }
  for (const root of roots) await walk(root, 0)
  return out
}

const SSH_DIRECTIVE_RE =
  /^\s*(identityfile|certificatefile|include)(?:\s*=\s*|\s+)(.+?)\s*$/i
const SSH_TOKEN_RE = /"([^"]*)"|(\S+)/g

/** densable leftover `af` `Cr` token split (quotes kept as one token). */
function sshConfigTokens(value: string): string[] {
  return [...value.matchAll(SSH_TOKEN_RE)].map(
    match => match[1] ?? match[2] ?? '',
  )
}

/**
 * densable leftover `af` `Nl` — ssh `%` tokens then `~`. Connection-time
 * tokens, `${ENV}`, and `~otheruser` throw.
 */
function expandSshConfigPath(token: string, home: string): string {
  const host = hostname()
  let out = ''
  for (let i = 0; i < token.length; i++) {
    const ch = token[i]
    if (ch !== '%') {
      out += ch
      continue
    }
    const next = token[++i]
    if (next === '%') out += '%'
    else if (next === 'd') out += home
    else if (next === 'u') out += sshUsername()
    else if (next === 'i') out += String(process.getuid?.() ?? '')
    else if (next === 'l') out += host
    else if (next === 'L') out += host.replace(/\..*$/s, '')
    else {
      throw credentialsPointerUnreadable(
        'an ssh configuration or command names a key file with a connection-time %-token',
      )
    }
  }
  if (/\$\{[^}]*\}/.test(out) || /^~[^/]/.test(out)) {
    throw credentialsPointerUnreadable(
      "an ssh configuration or command names a key file through ${ENV} or another user's ~",
    )
  }
  return out.replace(/^~(?=\/|$)/, home)
}

function sshUsername(): string {
  try {
    return userInfo().username
  } catch {
    return ''
  }
}

/**
 * densable leftover `af` `Cr` without `ProxyCommand`/`To`.
 * `~/.ssh/config` and `/etc/ssh/ssh_config`: absolute IdentityFile /
 * CertificateFile, plus Include (depth ≤16). Relative key throws.
 */
async function sshConfigCredentialPaths(home: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (
    path: string,
    depth: number,
    base: string,
  ): Promise<void> => {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      const code = getErrnoCode(error)
      if (code === 'ENOENT' || code === 'ENOTDIR') return
      throw credentialsPointerUnreadable('a credential store')
    }
    if (depth > 16) {
      throw credentialsPointerUnreadable(
        'ssh_config Include / ProxyCommand -F chains nest too deeply (a cycle?)',
      )
    }
    const resolveToken = (token: string, against: string | null): string => {
      const expanded = expandSshConfigPath(token, home)
      if (isAbsolute(expanded)) return expanded
      if (against === null) {
        throw credentialsPointerUnreadable(
          'an ssh_config names a key file by a relative path (resolved against whatever directory ssh runs in)',
        )
      }
      return join(against, expanded)
    }
    for (const line of text.split(/\r?\n/)) {
      const match = SSH_DIRECTIVE_RE.exec(line)
      if (!match) continue
      const kind = (match[1] ?? '').toLowerCase()
      const rest = match[2] ?? ''
      if (kind !== 'include') {
        const token = sshConfigTokens(rest)[0] ?? rest
        if (token.toLowerCase() === 'none') continue
        out.push(resolveToken(token, null))
        continue
      }
      for (const token of sshConfigTokens(rest)) {
        const included = resolveToken(token, base)
        if (!hasGlobChar(included)) {
          await walk(included, depth + 1, base)
          continue
        }
        const dir = dirname(included)
        if (hasGlobChar(dir)) {
          throw credentialsPointerUnreadable(
            'an ssh_config Include pattern with a wildcard directory cannot be followed',
          )
        }
        let names: string[]
        try {
          names = await readdir(dir)
        } catch (error) {
          const code = getErrnoCode(error)
          if (code === 'ENOENT' || code === 'ENOTDIR') continue
          throw credentialsPointerUnreadable(
            `an ssh_config Include directory could not be read (${code ?? 'unreadable'})`,
          )
        }
        const pattern = basename(included)
        const dotted = pattern.startsWith('.')
        const re = globToRegExp(pattern)
        for (const name of names) {
          if (!re.test(name)) continue
          if (!dotted && name.startsWith('.')) continue
          await walk(join(dir, name), depth + 1, base)
        }
      }
    }
  }
  await walk(join(home, '.ssh', 'config'), 0, join(home, '.ssh'))
  await walk('/etc/ssh/ssh_config', 0, '/etc/ssh')
  return out
}

const GITCONFIG_SECTION_RE = /^\s*\[\s*([a-z0-9.-]+)[^\]]*\]\s*(.*)$/i
const GITCONFIG_KV_RE = /^\s*([a-z][a-z0-9-]*)\s*=\s*(.+?)\s*$/i
const GITCONFIG_HELPER_TOKEN_RE = /(?:"[^"]*"|'[^']*'|\\.|[^\s\\'"])+/g
const GIT_CONFIG_PARAM_QUOTED = String.raw`'([^']*(?:'\\[!'](?:'[^']*)?)*)'?`
const GIT_CONFIG_PARAM_PAIR = new RegExp(
  `${GIT_CONFIG_PARAM_QUOTED}(?:=${GIT_CONFIG_PARAM_QUOTED})?`,
  'g',
)

/** densable leftover `af` `gt` quoted-pair unescape. */
function unescapeGitConfigParam(value: string): string {
  return value.replace(/'\\(['!])'?/g, '$1')
}

/**
 * densable leftover `af` `gt` — `GIT_CONFIG_PARAMETERS` plus
 * `GIT_CONFIG_KEY_n`/`VALUE_n` as an in-memory gitconfig.
 */
function gitConfigFromEnv(childEnv: NodeJS.ProcessEnv): string {
  const countRaw = pointerEnv(childEnv, 'GIT_CONFIG_COUNT') ?? '0'
  const count = Number(countRaw)
  if (!Number.isInteger(count) || count < 0 || count > 256) {
    throw credentialsPointerUnreadable(
      'GIT_CONFIG_COUNT is not a count this can follow',
    )
  }
  const lines: string[] = []
  const unescape = unescapeGitConfigParam
  const parameters = pointerEnv(childEnv, 'GIT_CONFIG_PARAMETERS') ?? ''
  const leftover = parameters.replace(GIT_CONFIG_PARAM_PAIR, '').trim()
  if (leftover !== '') {
    throw credentialsPointerUnreadable(
      'GIT_CONFIG_PARAMETERS is not in a form this can follow',
    )
  }
  for (const match of parameters.matchAll(GIT_CONFIG_PARAM_PAIR)) {
    const first = unescape(match[1] ?? '')
    const eq = match[2] === undefined ? first.indexOf('=') : first.length
    const key = eq === -1 ? first : first.slice(0, eq)
    const value =
      match[2] === undefined
        ? eq === -1
          ? 'true'
          : first.slice(eq + 1)
        : unescape(match[2])
    const dot = key.lastIndexOf('.')
    if (dot > 0) {
      lines.push(`[${key.slice(0, key.indexOf('.'))}]`)
      lines.push(`${key.slice(dot + 1)} = ${JSON.stringify(value)}`)
    }
  }
  for (let i = 0; i < count; i++) {
    const key = pointerEnv(childEnv, `GIT_CONFIG_KEY_${i}`) ?? ''
    const value = pointerEnv(childEnv, `GIT_CONFIG_VALUE_${i}`) ?? ''
    const dot = key.lastIndexOf('.')
    if (dot > 0) {
      lines.push(`[${key.slice(0, key.indexOf('.'))}]`)
      lines.push(`${key.slice(dot + 1)} = ${JSON.stringify(value)}`)
    }
  }
  return lines.join('\n')
}

/** densable leftover `af` `Zn` value unescape (quotes, \\n/\\t, comments). */
function unescapeGitconfigValue(raw: string): string {
  let out = ''
  let inQuote = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '"') inQuote = !inQuote
    else if (ch === '\\' && i + 1 < raw.length) {
      const next = raw[++i]
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next
    } else if (!inQuote && (ch === ';' || ch === '#')) break
    else out += ch
  }
  return out.trim()
}

/**
 * densable leftover `af` `Zn` without `core.sshCommand`/`To`.
 * include/includeIf path recurse ≤10; http.sslKey/sslCert/cookieFile;
 * user.signingKey (strip .pub); credential.helper --file/-f.
 */
async function gitconfigCredentialPaths(
  path: string | null,
  home: string,
  depth = 0,
  inline?: string | null,
): Promise<string[]> {
  const text = inline ?? (path === null ? null : await readGitconfigText(path))
  if (text === null || text === '') return []
  if (depth > 10) {
    throw credentialsPointerUnreadable(
      'gitconfig include files nest too deeply',
    )
  }
  const unfolded = text.replace(/\\\r?\n/g, '')
  const out: string[] = []
  let section = ''
  for (const rawLine of unfolded.split(/\r?\n/)) {
    let line = rawLine
    const header = GITCONFIG_SECTION_RE.exec(line)
    if (header) {
      section = (header[1] ?? '').toLowerCase()
      line = header[2] ?? ''
    }
    const kv = GITCONFIG_KV_RE.exec(line)
    if (!kv) continue
    const key = (kv[1] ?? '').toLowerCase()
    const value = unescapeGitconfigValue(kv[2] ?? '')
    if (key === 'path' && (section === 'include' || section === 'includeif')) {
      const expanded = expandHomePrefix(value, home)
      const next = isAbsolute(expanded)
        ? expanded
        : resolve(path === null ? home : dirname(path), expanded)
      out.push(...(await gitconfigCredentialPaths(next, home, depth + 1)))
      continue
    }
    if (
      (key === 'sslkey' || key === 'sslcert' || key === 'cookiefile') &&
      section === 'http'
    ) {
      const expanded = expandHomePrefix(value, home)
      if (expanded === '') continue
      if (isAbsolute(expanded)) out.push(expanded)
      else {
        throw credentialsPointerUnreadable(
          `a gitconfig http.${kv[1]} is a relative path`,
        )
      }
      continue
    }
    if (key === 'signingkey' && section === 'user') {
      const expanded = expandHomePrefix(value, home)
      if (isAbsolute(expanded)) out.push(expanded.replace(/\.pub$/, ''))
      continue
    }
    if (key !== 'helper' || section !== 'credential') continue
    const tokens = [...value.matchAll(GITCONFIG_HELPER_TOKEN_RE)].map(match =>
      match[0].replace(
        /"([^"]*)"|'([^']*)'|\\(.)/g,
        (_m, d, s, e) => d ?? s ?? e,
      ),
    )
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i] ?? ''
      const assigned = /^--?[A-Za-z][\w-]*=(.*)$/s.exec(token)?.[1]
      const candidate = expandHomePrefix(assigned ?? token, home)
      if (isAbsolute(candidate)) {
        out.push(candidate)
        continue
      }
      const fileFlag = /^(?:--file|-f)$/.test(token)
      if (fileFlag || /^--file=/.test(token)) {
        const file = fileFlag
          ? expandHomePrefix(tokens[i + 1] ?? '', home)
          : candidate
        if (!isAbsolute(file)) {
          throw credentialsPointerUnreadable(
            'a gitconfig credential helper names its file by a relative path',
          )
        }
        out.push(file)
        if (fileFlag) i++
      }
    }
  }
  return out
}

async function readGitconfigText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw credentialsPointerUnreadable('a credential store')
  }
}

/**
 * densable leftover `af` `xo` gitconfig slice: ~/.gitconfig, XDG git/config,
 * GIT_CONFIG_GLOBAL/SYSTEM, plus `gt()` env parameters.
 */
async function gitCredentialFiles(
  home: string,
  childEnv: NodeJS.ProcessEnv,
): Promise<string[]> {
  const xdg = pointerEnv(process.env, 'XDG_CONFIG_HOME')?.trim()
  const configHome = xdg && isAbsolute(xdg) ? xdg : join(home, '.config')
  const extra: string[] = []
  for (const name of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM'] as const) {
    const raw = pointerEnv(childEnv, name)?.trim()
    if (!raw) continue
    extra.push(requireAbsolutePointer(raw, `${name} holds a relative path`))
  }
  const files = uniquePaths([
    join(home, '.gitconfig'),
    join(configHome, 'git', 'config'),
    ...extra,
  ])
  const out: string[] = []
  for (const file of files) {
    out.push(...(await gitconfigCredentialPaths(file, home)))
  }
  out.push(
    ...(await gitconfigCredentialPaths(
      null,
      home,
      0,
      gitConfigFromEnv(childEnv),
    )),
  )
  return out
}

/** densable leftover `af` `Np` — ssh Include basename glob. */
function globToRegExp(pattern: string): RegExp {
  let body = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*') body += '[^/]*'
    else if (ch === '?') body += '[^/]'
    else if (ch === '[') {
      const close = pattern.indexOf(']', i + 1)
      if (close === -1) body += '\\['
      else {
        const inner = pattern.slice(i + 1, close).replace(/\\/g, '\\\\')
        body += `[${inner.startsWith('!') ? `^${inner.slice(1)}` : inner}]`
        i = close
      }
    } else {
      body += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${body}$`)
}

/**
 * densable leftover `af` `mt` paths that sit outside operator home:
 * static pg/bundle/conda/wget/pip, plus `ke`/`$l` pointers.
 */
function outsideHomeCredentialFiles(
  home: string,
  childEnv: NodeJS.ProcessEnv,
): string[] {
  const only = (name: string) => pointerOnly(childEnv, home, name)
  const pgSys = only('PGSYSCONFDIR')
  const cloudSdkRoot = only('CLOUDSDK_ROOT_DIR')
  const mavenHomes = [only('M2_HOME'), only('MAVEN_HOME')].filter(
    (path): path is string => path !== undefined,
  )
  const bundleApp = only('BUNDLE_APP_CONFIG')
  const hfHome = only('HF_HOME')
  const poetry = only('POETRY_CONFIG_DIR')
  const curlHome = only('CURL_HOME')
  const coursier = coursierCredentialPath(childEnv, home)
  return [
    ...(pgSys ? [join(pgSys, 'pg_service.conf')] : []),
    '/etc/postgresql-common/pg_service.conf',
    '/etc/pg_service.conf',
    '/usr/local/etc/postgresql/pg_service.conf',
    '/opt/homebrew/etc/postgresql/pg_service.conf',
    '/opt/local/etc/postgresql/pg_service.conf',
    ...(cloudSdkRoot ? [join(cloudSdkRoot, 'properties')] : []),
    ...(coursier ? [coursier] : []),
    '/usr/local/bundle/config',
    ...(bundleApp ? [join(bundleApp, 'config')] : []),
    ...(hfHome ? [join(hfHome, 'token'), join(hfHome, 'stored_tokens')] : []),
    ...mavenHomes.map(dir => join(dir, 'conf', 'settings.xml')),
    ...['/etc/conda', '/var/lib/conda'].flatMap(dir => [
      join(dir, '.condarc'),
      join(dir, 'condarc'),
      join(dir, 'condarc.d'),
    ]),
    ...(only('CONDARC') ? [only('CONDARC') as string] : []),
    ...(poetry ? [join(poetry, 'auth.toml')] : []),
    ...(only('UV_CONFIG_FILE') ? [only('UV_CONFIG_FILE') as string] : []),
    ...(only('SBT_CREDENTIALS') ? [only('SBT_CREDENTIALS') as string] : []),
    ...(only('SYSTEM_WGETRC') ? [only('SYSTEM_WGETRC') as string] : []),
    '/etc/wgetrc',
    '/usr/local/etc/wgetrc',
    '/opt/homebrew/etc/wgetrc',
    '/opt/local/etc/wgetrc',
    '/etc/pip.conf',
    '/etc/xdg/pip/pip.conf',
    ...(curlHome ? [join(curlHome, '.curlrc')] : []),
    ...['KRB5CCNAME', 'KRB5_KTNAME', 'KRB5_CLIENT_KTNAME'].flatMap(name =>
      kerberosCredentialPaths(pointerEnv(childEnv, name)),
    ),
  ]
}

/**
 * densable leftover `af` `mn` without the `ve` walker (`Xf`/`Vp`).
 * `Qa` pointers from child env and process.env, plus default kube/helm/sops
 * and system cred files (`mt`).
 */
async function operatorCredentialFiles(
  home: string,
  childEnv: NodeJS.ProcessEnv,
): Promise<string[]> {
  const xdg = pointerEnv(process.env, 'XDG_CONFIG_HOME')?.trim()
  const configHome = xdg && isAbsolute(xdg) ? xdg : join(home, '.config')
  const docker = pointerOrFallback(
    childEnv,
    home,
    'DOCKER_CONFIG',
    join(home, '.docker'),
  )
  const dockerCert = pointerOrFallback(
    childEnv,
    home,
    'DOCKER_CERT_PATH',
    join(home, '.docker'),
  )
  const gh = uniquePaths([
    join(home, '.config', 'gh'),
    ...pointerOrFallback(
      childEnv,
      home,
      'GH_CONFIG_DIR',
      join(configHome, 'gh'),
    ),
  ])
  const helmHomes = [
    ...pointerOrFallback(
      childEnv,
      home,
      'HELM_CONFIG_HOME',
      join(configHome, 'helm'),
    ),
    join(home, 'Library', 'Preferences', 'helm'),
  ]
  const npmPrefixes = uniquePaths(
    [
      ...pointerValuesForKey(childEnv, 'NPM_CONFIG_PREFIX'),
      pointerEnv(childEnv, 'PREFIX'),
    ]
      .filter((value): value is string => value !== undefined)
      .map(value => value.trim())
      .filter(value => value !== '')
      .map(value => expandHomePrefix(value, home)),
  )
  if (npmPrefixes.some(path => !isAbsolute(path))) {
    throw credentialsPointerUnreadable(
      'an npm prefix variable holds a relative path',
    )
  }
  const botoPath = (pointerEnv(childEnv, 'BOTO_PATH') ?? '')
    .split(delimiter)
    .map(part => part.trim())
    .filter(part => part !== '')
    .map(part =>
      requireAbsolutePointer(
        expandHomePrefix(part, home),
        'BOTO_PATH names a relative path',
      ),
    )
  const kube = uniquePaths([
    join(home, '.kube', 'config'),
    ...(pointerEnv(childEnv, 'KUBECONFIG') ?? '')
      .split(delimiter)
      .map(part => part.trim())
      .filter(part => part !== '')
      .map(part =>
        requireAbsolutePointer(
          expandHomePrefix(part, home),
          'KUBECONFIG names a relative path',
        ),
      ),
  ])
  const defaults = [
    join(home, '.aws', 'credentials'),
    join(home, '.aws', 'config'),
    join(home, '.config', 'gcloud'),
    join(home, '.config', 'gcloud', 'application_default_credentials.json'),
    join(home, '.azure'),
    join(home, '.netrc'),
    join(home, '.npmrc'),
    join(home, '.docker', 'config.json'),
    join(configHome, 'gh', 'hosts.yml'),
    join(home, '.config', 'gh', 'hosts.yml'),
    ...docker.flatMap(dir => [
      join(dir, 'config.json'),
      join(dir, 'contexts'),
      join(dir, 'key.pem'),
    ]),
    ...dockerCert.map(dir => join(dir, 'key.pem')),
    ...gh.map(dir => join(dir, 'hosts.yml')),
    join(configHome, 'sops', 'age', 'keys.txt'),
    join(home, '.config', 'sops', 'age', 'keys.txt'),
    join(home, 'Library', 'Application Support', 'sops', 'age', 'keys.txt'),
    join(home, '.vault_pass.txt'),
    join(home, '.kube', 'cache', 'kubelogin'),
    join(home, '.kube', 'cache', 'oidc-login'),
    ...kube,
    ...helmHomes.flatMap(dir => [
      join(dir, 'registry', 'config.json'),
      join(dir, 'repositories.yaml'),
    ]),
    '/opt/homebrew/etc/npmrc',
    '/usr/etc/npmrc',
    '/etc/npmrc',
    ...npmPrefixes.map(prefix => join(prefix, 'etc', 'npmrc')),
    join(home, '.vault-token'),
    join(home, '.boto'),
    '/etc/boto.cfg',
    join(home, '.s3cfg'),
    ...botoPath,
    '/usr/local/etc/npmrc',
    ...outsideHomeCredentialFiles(home, childEnv),
    ...(await krb5ConfigCredentialPaths(childEnv)),
    ...(await sshConfigCredentialPaths(home)),
    ...(await gitCredentialFiles(home, childEnv)),
  ]
  const pointers: string[] = []
  for (const name of EVAL_CREDENTIAL_POINTER_ENV) {
    for (const raw of pointerValuesForKey(childEnv, name)) {
      const trimmed = raw.trim()
      if (trimmed === '') continue
      pointers.push(
        requireAbsolutePointer(
          expandHomePrefix(trimmed, home),
          'a credentials pointer variable (AWS_CONFIG_FILE, GOOGLE_APPLICATION_CREDENTIALS, ANTHROPIC_CONFIG_DIR and the like) holds a relative path',
        ),
      )
    }
  }
  return uniquePaths([...defaults, ...pointers])
}

/**
 * densable leftover `wUr` subset — child keys `_ne`/`X$t` plus GITHUB_TOKEN.
 * `B9e` yo-as-envVars is 不报 (files already deny).
 */
function secretShapedChildEnvKeys(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = ['GITHUB_TOKEN', 'GH_TOKEN']
  for (const key of Object.keys(env)) {
    if (isEvalSecretShapedEnvKey(key) || isEvalPrefixedSecretEnvKey(key)) {
      out.push(key)
    }
  }
  return out
}

function sandboxCredentialEnvVars(
  childEnv: NodeJS.ProcessEnv,
  caseEnv: Record<string, string>,
): Array<{ name: string; mode: 'deny' }> {
  const names = uniquePaths([
    ...EVAL_SANDBOX_CREDENTIAL_ENV_VARS,
    ...EVAL_SANDBOX_CREDENTIAL_ENV_VARS.map(name => `INPUT_${name}`),
    ...secretShapedChildEnvKeys(childEnv),
    ...EVAL_SANDBOX_PROXY_ENV_VARS,
    ...scanEnvValuesForCredentials(childEnv),
  ])
  return names
    .filter(name => {
      if (Object.hasOwn(caseEnv, name) && childEnv[name] === caseEnv[name]) {
        return false
      }
      return true
    })
    .map(name => ({ name, mode: 'deny' as const }))
}

function policySandboxesDefault(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const source of ['policySettings', 'flagSettings'] as const) {
    const sandbox = getSettingsForSource(source)?.sandbox
    if (sandbox && typeof sandbox === 'object') {
      out.push(sandbox as Record<string, unknown>)
    }
  }
  return out
}

function managedSuppressReason(
  sandboxes: Record<string, unknown>[],
  platform: string,
  webfetchDomains: string[],
): string | null {
  const some = (pred: (s: Record<string, unknown>) => boolean) =>
    sandboxes.some(pred)
  if (
    some(s => {
      const platforms = s.enabledPlatforms
      return Array.isArray(platforms) && !platforms.includes(platform)
    })
  ) {
    return `sandbox.enabledPlatforms excludes ${platform}`
  }
  if (some(s => s.enabled === false)) return 'sandbox.enabled is false'
  if (some(s => s.failIfUnavailable === false)) {
    return 'sandbox.failIfUnavailable is false (a missing backend would run the shell unconfined)'
  }
  if (some(s => s.allowUnsandboxedCommands === true)) {
    return 'sandbox.allowUnsandboxedCommands is true'
  }
  if (
    some(s => {
      const excluded = s.excludedCommands
      return Array.isArray(excluded) && excluded.length > 0
    })
  ) {
    return 'sandbox.excludedCommands exempts commands'
  }
  if (some(s => s.autoAllowBashIfSandboxed === true)) {
    return 'sandbox.autoAllowBashIfSandboxed would run commands the operator never granted'
  }
  if (some(s => s.enableWeakerNestedSandbox === true)) {
    return 'sandbox.enableWeakerNestedSandbox exposes the host /proc'
  }
  if (some(s => s.enableWeakerNetworkIsolation === true)) {
    return 'sandbox.enableWeakerNetworkIsolation loosens the egress lock'
  }
  if (some(s => s.allowAppleEvents === true)) {
    return 'sandbox.allowAppleEvents removes macOS automation isolation'
  }
  if (
    some(s => {
      const fs = s.filesystem
      return (
        fs !== null &&
        typeof fs === 'object' &&
        (fs as { disabled?: boolean }).disabled === true
      )
    })
  ) {
    return 'sandbox.filesystem.disabled turns filesystem confinement off'
  }
  if (
    some(s => {
      const fs = s.filesystem
      return (
        fs !== null &&
        typeof fs === 'object' &&
        (fs as { allowManagedReadPathsOnly?: boolean })
          .allowManagedReadPathsOnly === true
      )
    })
  ) {
    return "sandbox.filesystem.allowManagedReadPathsOnly would drop the sandbox's own directories from the readable set"
  }
  if (
    webfetchDomains.length > 0 &&
    some(s => {
      const network = s.network
      return (
        network !== null &&
        typeof network === 'object' &&
        (network as { allowManagedDomainsOnly?: boolean })
          .allowManagedDomainsOnly === true
      )
    })
  ) {
    return "sandbox.network.allowManagedDomainsOnly means the WebFetch domains you granted cannot open the sandboxed shell's network on this machine"
  }
  return null
}

function webfetchDomains(rules: string[]): string[] {
  const out: string[] = []
  for (const raw of rules) {
    const parsed = permissionRuleValueFromString(raw)
    if (
      parsed.toolName === 'WebFetch' &&
      parsed.ruleContent?.startsWith('domain:')
    ) {
      out.push(parsed.ruleContent.slice('domain:'.length))
    }
  }
  return [...new Set(out)]
}

/**
 * densable `af`. No-op unless Bash/PowerShell is granted.
 */
export async function applyEvalSandboxSettings(
  sandbox: EvalSandbox,
  allowedTools: string[],
  operatorAllowedTools: string[],
  case_: ResolvedCase,
  seams: EvalSandboxFenceSeams = {},
): Promise<void> {
  const granted = grantedToolNames(allowedTools)
  if (![...EVAL_SHELL_TOOLS].some(name => granted.has(name))) return

  const isSupported =
    seams.isSupportedPlatform ?? (() => SandboxManager.isSupportedPlatform())
  const deps =
    seams.checkDependencies ?? (() => SandboxManager.checkDependencies())
  const platformEnabled =
    seams.isPlatformInEnabledList ??
    (() => SandboxManager.isPlatformInEnabledList())
  const operatorHome = seams.operatorHome ?? (() => homedir())
  const policies = seams.policySandboxes ?? policySandboxesDefault

  if (!isSupported() || deps().errors.length > 0 || !platformEnabled()) {
    throw new PluginEvalPathError(
      SHELL_UNCONFINED,
      'eval shell grant refused: sandbox unavailable',
    )
  }

  const platform = getPlatform()
  const managed = managedSuppressReason(
    policies(),
    platform,
    webfetchDomains(operatorAllowedTools),
  )
  if (managed !== null) {
    throw new PluginEvalPathError(
      `${SHELL_UNCONFINED} (this machine's managed settings: ${managed})`,
      'eval shell grant refused: managed policy suppresses the sandbox',
    )
  }

  const home = operatorHome()
  if (isFilesystemRoot(home)) {
    throw new PluginEvalPathError(
      "the operator's home directory is the filesystem root, so the Bash sandbox cannot exclude it — a Bash-granting evaluation cannot run here (set HOME to a real home directory)",
      'eval shell grant refused: home is the filesystem root',
    )
  }
  const wslMounts = await readWslWindowsMounts(platform, seams.wslMountTable)
  const childEnv = seams.childEnv ?? {}
  const runtimeDir =
    childEnv.XDG_RUNTIME_DIR ??
    process.env.XDG_RUNTIME_DIR ??
    (typeof process.getuid === 'function'
      ? `/run/user/${process.getuid()}`
      : '')
  // gold af R("CLAUDE_CODE_FEDERATION_CACHE_DIR") — child bag after up pin
  const federationDir =
    childEnv.CLAUDE_CODE_FEDERATION_CACHE_DIR ??
    process.env.CLAUDE_CODE_FEDERATION_CACHE_DIR ??
    ''
  // gold af: glob in home / dirname(home) / operatorConfig / plugin-parent /
  // case-parent / dirname(sandbox.root) / tmpdir / WSL mounts / runtime.
  const globRoots = [
    home,
    dirname(home),
    sandbox.operatorConfigDir,
    dirname(sandbox.root),
    tmpdir(),
    ...case_.pluginDirsUnderTest.map(dir => dirname(dir)),
    dirname(case_.caseDir),
    ...wslMounts,
    runtimeDir,
    federationDir,
  ]
  if (globRoots.some(hasGlobChar)) {
    throw new PluginEvalPathError(
      'the home, Claude config, temp, plugin-parent or case-parent directory on this machine has a glob character (* ? [ ]) in its path (as written or where it really points), so the Bash sandbox cannot exclude it — a Bash-granting evaluation cannot run here',
      'eval shell grant refused: glob char in a sandbox deny root',
    )
  }

  const readScope = await resolveEvalReadScope(case_)
  const caseEnv = case_.execution.env ?? {}

  let denyWrite = uniquePaths([
    sandbox.configDir,
    sandbox.outDir,
    ...case_.pluginDirsUnderTest,
    case_.caseDir,
    ...readScope.denyPaths,
    join(sandbox.home, '.config', 'git'),
    join(sandbox.home, '.local', 'lib'),
    ...EVAL_AWS_SSO_CACHE_DIRS.flatMap(rel => [
      join(sandbox.home, rel),
      join(sandbox.home, dirname(rel)),
    ]),
    ...EVAL_SANDBOX_GIT_META.map(name => join(sandbox.home, '.git', name)),
    join(sandbox.cwd, EVAL_ARTIFACTS_DIR),
    ...EVAL_SANDBOX_HOME_TOOL_DIRS.map(name => join(sandbox.home, name)),
    ...EVAL_SANDBOX_HOME_RC_FILES.map(name => join(sandbox.home, name)),
    ...(await macosEvalTmpDenyWrites(sandbox)),
  ])
  let denyRead = uniquePaths([
    home,
    sandbox.operatorConfigDir,
    sandbox.configDir,
    sandbox.outDir,
    tmpdir(),
    ...wslMounts,
    ...EVAL_SANDBOX_SECRET_MOUNTS,
    ...(runtimeDir ? [runtimeDir] : []),
    ...(federationDir ? [federationDir] : []),
    ...EVAL_AWS_SSO_CACHE_DIRS.map(rel => join(sandbox.home, rel)),
    ...readScope.denyPaths,
  ])
  let allowRead = uniquePaths([
    sandbox.home,
    sandbox.tmpDir,
    ...case_.pluginDirs,
  ])
  let credentialFiles = uniquePaths(
    await operatorCredentialFiles(home, childEnv),
  )

  if (platform === 'linux' || platform === 'wsl') {
    denyWrite = await uniqueRealpathSpellings(denyWrite)
    denyRead = await uniqueRealpathSpellings(denyRead)
    allowRead = await uniqueRealpathSpellings(allowRead)
    credentialFiles = await uniqueRealpathSpellings(credentialFiles)
  }

  // gold leftover af: `[...ve,...K,...Z].some(qn)` — glob in a cred pointer
  // cannot be excluded; refuse rather than write a glob deny spelling.
  if (credentialFiles.some(hasGlobChar)) {
    throw new PluginEvalPathError(
      'a cloud credential file path in this environment (AWS_SHARED_CREDENTIALS_FILE, GOOGLE_APPLICATION_CREDENTIALS and the like) has a glob character (* ? [ ]) in it, so the Bash sandbox cannot exclude it — a Bash-granting evaluation cannot run here',
      'eval shell grant refused: glob char in a credential file path',
    )
  }

  const body = {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
      filesystem: {
        allowWrite: [sandbox.home, sandbox.tmpDir].map(sandboxSettingsPath),
        denyWrite: denyWrite.map(sandboxSettingsPath),
        denyRead: denyRead.map(sandboxSettingsPath),
        allowRead: allowRead.map(sandboxSettingsPath),
      },
      network: {
        allowedDomains: webfetchDomains(operatorAllowedTools),
      },
      credentials: {
        envVars: sandboxCredentialEnvVars(childEnv, caseEnv),
        files: credentialFiles.map(path => ({
          path: sandboxSettingsPath(path),
          mode: 'deny' as const,
        })),
      },
    },
  }
  await writeFile(
    join(sandbox.configDir, 'settings.json'),
    `${JSON.stringify(body, null, 2)}\n`,
    { flag: 'wx' },
  )
}
