/**
 * densable `_580` `sn` / `er` / `k0` (Ptc/`on` segment fold).
 * Gold: gold-forged-sn-wide.txt; k0 @208712687.
 *
 * `_465` hs `on` is `EGb` = this `sn` (not confusable `Eo`).
 */

import { getPlatform } from '../platform.js'

const DIR_NAMES = [
  '.ssh',
  '.aws',
  '.azure',
  '.gnupg',
  '.kube',
  '.docker',
] as const

const PATH_TUPLES: ReadonlyArray<readonly string[]> = [
  ['.config', 'git'],
  ['.config', 'gh'],
  ['.config', 'glab-cli'],
  ['.config', 'gcloud'],
  ['appdata', 'roaming', 'gcloud'],
  ['.cargo', 'credentials'],
  ['.cargo', 'credentials.toml'],
  ['.gem', 'credentials'],
  ['.m2', 'settings.xml'],
  ['.gradle', 'gradle.properties'],
  ['documents', 'powershell', 'profile.ps1'],
  ['documents', 'windowspowershell', 'profile.ps1'],
  ['.config', 'powershell', 'profile.ps1'],
  ['.claude', 'settings.json'],
  ['.claude', 'settings.local.json'],
  ['appdata', 'roaming', 'github cli'],
  ['appdata', 'roaming', 'gh'],
  ['appdata', 'roaming', 'glab-cli'],
  ['appdata', 'roaming', 'gnupg'],
]

const LEAF_NAMES = [
  '.netrc',
  '_netrc',
  '.git-credentials',
  '.gitconfig',
  '.credentials.json',
  '.claude.json',
  '.envrc',
  '.mcp.json',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.pypirc',
  '.pgpass',
  '.my.cnf',
  '.mylogin.cnf',
  '.terraformrc',
  'terraform.rc',
  'credentials.tfrc.json',
  '.boto',
  '.s3cfg',
  'kubeconfig',
  'kubeconfig.yaml',
  'kubeconfig.yml',
  'kubeconfig.json',
  '.bashrc',
  '.bash_profile',
  '.bash_login',
  '.bash_logout',
  '.bash_aliases',
  '.profile',
  '.zshrc',
  '.zshenv',
  '.zprofile',
  '.zlogin',
  '.zlogout',
  'config.fish',
  'microsoft.powershell_profile.ps1',
  'microsoft.vscode_profile.ps1',
  'microsoft.powershellise_profile.ps1',
  '.bash_history',
  '.zsh_history',
  'fish_history',
  'consolehost_history.txt',
  '.python_history',
  '.node_repl_history',
  '.psql_history',
  '.mysql_history',
] as const

const ENV_LEAF = '.env'
const CLAUDE_JSON = '.claude.json'
const ENV_EXCEPTIONS = ['example', 'sample', 'template', 'dist'] as const
const BACKUP_SUFFIX = /(?:\.bak|\.old|\.orig|\.backup|\.~\d+~|~)$/
const GIT_DIR_NAME = '.git'
const CONFIG_LEAF = 'config'
const SECRET_LEAF =
  /(?:\.(?:pem|key|p12|pfx|keystore|jks)|_(?:rsa|dsa|ecdsa|ed25519)(?:_sk(?:_rk(?:_.*)?)?)?|secrets?\.(?:ya?ml|json|toml)|^terraform\.tfvars(?:\.json)?)$/

/**
 * densable `k0` / Ptc — fold one path segment before `sn` tables.
 */
export function foldSeedPathSegment(seg: string): string {
  const lowered = seg
    .toLowerCase()
    .replace(/\u0131/g, 'i')
    .replace(/\u017f/g, 's')
  return (
    lowered
      .replace(/[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g, '')
      .replace(/:.*$/, '')
      .replace(/[. ]+$/, '') || lowered
  )
}

/** densable `_580` `er` — split + `on`/`k0`. */
export function credentialPathSegments(path: string): string[] {
  return path
    .split(getPlatform() === 'windows' ? /[\\/]/ : '/')
    .filter(seg => seg !== '')
    .map(foldSeedPathSegment)
}

/** densable `an` — strip backup suffix recursively. */
function stripBackupSuffix(name: string): string {
  const match = BACKUP_SUFFIX.exec(name)
  if (match === null || match.index === 0) return name
  return stripBackupSuffix(name.slice(0, match.index))
}

/** densable `tn` — consecutive tuple match. */
function hasSegmentTuple(
  segs: readonly string[],
  tuple: readonly string[],
): boolean {
  return segs.some((_, i) => tuple.every((part, j) => segs[i + j] === part))
}

/** densable `nr` — an ancestor ends with `.git`. */
function ancestorEndsWithGit(
  segs: readonly string[],
  leafIndex: number,
): boolean {
  return segs.slice(0, leafIndex).some(seg => seg.endsWith(GIT_DIR_NAME))
}

/** densable `rn` — leaf name / secret suffix / `.env` / `.claude.json`. */
function isCredentialLeaf(name: string): boolean {
  return (
    (LEAF_NAMES as readonly string[]).includes(name) ||
    SECRET_LEAF.test(name) ||
    name === ENV_LEAF ||
    name.startsWith(`${CLAUDE_JSON}.`) ||
    (name.startsWith(`${ENV_LEAF}.`) &&
      !(ENV_EXCEPTIONS as readonly string[]).includes(
        name.slice(ENV_LEAF.length + 1),
      ))
  )
}

/** densable `tr` — `config` / `config.*` */
function isGitConfigLeaf(name: string): boolean {
  return name === CONFIG_LEAF || name.startsWith(`${CONFIG_LEAF}.`)
}

/** densable `sn` — credential-named path (hs `on`). */
export function isSeedCredentialPath(path: string): boolean {
  const segs = credentialPathSegments(path)
  const leaf = segs.at(-1) ?? ''
  const stripped = stripBackupSuffix(leaf)
  const strippedSegs = [...segs.slice(0, -1), stripped]
  return (
    segs.some(seg => (DIR_NAMES as readonly string[]).includes(seg)) ||
    PATH_TUPLES.some(
      tuple =>
        hasSegmentTuple(segs, tuple) || hasSegmentTuple(strippedSegs, tuple),
    ) ||
    isCredentialLeaf(leaf) ||
    isCredentialLeaf(stripped) ||
    (isGitConfigLeaf(stripped) && ancestorEndsWithGit(segs, segs.length - 1))
  )
}
