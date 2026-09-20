/**
 * densable `_577` `fe` / TCt `J4n` — refuse home / fs-root / config-home git roots.
 * Gold: gold-forged-J4n-fe.txt / gold-forged-J4n-mod.txt / gold-forged-mXo.txt
 * `w`/`ho`/`IGb`: gold-forged-IGb-w.txt (`D()==="wsl"&&lr.test(e)`).
 *
 * `h(e)` is `_752` `J3c`/`Wn` — `ge(v().canonicalRootByRoot,T(e),lr)`.
 * Local host: `findCanonicalGitRoot`. Third arg `t=h(e)??e`.
 */

import { realpathSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, parse, relative, resolve, sep } from 'path'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { findCanonicalGitRoot } from '../git.js'
import { getPlatform } from '../platform.js'

export type SeedHomeRootKind =
  | 'folder_is_home'
  | 'folder_is_root'
  | 'folder_holds_config'

export const SEED_HOME_ROOT_ERROR: Record<SeedHomeRootKind, string> = {
  folder_is_home:
    'Not uploading this working tree: this checkout\u2019s git root is your home directory, or a folder above it (a repository rooted there makes every folder under it part of it, so the upload would carry your tracked home files). Start from a project folder that is its own repository, or work on these files from a separate clone.',
  folder_is_root:
    'Not uploading this working tree: this checkout\u2019s git root is the filesystem root. Start from a project folder that is its own repository.',
  folder_holds_config:
    'Not uploading this working tree: this checkout\u2019s git root holds (or sits inside) Claude Code\u2019s own configuration directory. Start from a project folder that is its own repository.',
}

/** densable `a` — realpathSync.native, else resolve. */
function nativePath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

function foldCase(path: string, fold: boolean): string {
  return fold ? path.normalize('NFC').toLowerCase() : path
}

/**
 * densable `_580` `ho`/`IGb` — WSL whole-drive (`lr`).
 * `lr=/^\/mnt(?:\/[a-z])?\/?$/i`
 */
function isWslWholeDrive(path: string): boolean {
  return getPlatform() === 'wsl' && /^\/mnt(?:\/[a-z])?\/?$/i.test(path)
}

/** densable `u` */
function containsPath(parent: string, path: string, fold: boolean): boolean {
  const rel = relative(foldCase(parent, fold), foldCase(path, fold))
  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  )
}

export type SeedHomeRootAnchors = {
  home?: string
  configHome?: string
}

/**
 * densable `_752` `J3c`/`Wn`/`h` — `ge(v().canonicalRootByRoot,T(e),lr)`.
 * Import alias of `findCanonicalGitRoot` (`bd` / `Yc` + `cTt` + `Ydu`).
 */
function h(e: string): string | null {
  return findCanonicalGitRoot(e)
}

/**
 * densable `fe` / `J4n(gitRoot, rootAnchors)`.
 * Third arg `t=h(e)??e`; folders `t===e?[a(e)]:[a(e),a(t)]`.
 */
export function refuseSeedHomeRoot(
  gitRoot: string,
  anchors: SeedHomeRootAnchors = {},
  canonicalRoot: string = h(gitRoot) ?? gitRoot,
): SeedHomeRootKind | null {
  const folders =
    canonicalRoot === gitRoot
      ? [nativePath(gitRoot)]
      : [nativePath(gitRoot), nativePath(canonicalRoot)]
  if (
    folders.some(path => path === parse(path).root || isWslWholeDrive(path))
  ) {
    return 'folder_is_root'
  }
  const homeAbs = isAbsolute(anchors.home ?? homedir())
  const configAbs = isAbsolute(anchors.configHome ?? getClaudeConfigHomeDir())
  const home = nativePath(anchors.home ?? homedir())
  const configHome = nativePath(anchors.configHome ?? getClaudeConfigHomeDir())
  const fold = getPlatform() === 'windows' || getPlatform() === 'macos'
  for (const folder of folders) {
    if (homeAbs && containsPath(folder, home, fold)) return 'folder_is_home'
    if (
      configAbs &&
      (containsPath(folder, configHome, fold) ||
        containsPath(configHome, folder, fold))
    ) {
      return 'folder_holds_config'
    }
  }
  return null
}
