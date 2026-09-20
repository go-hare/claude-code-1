/**
 * densable 2.1.247 wrap preflight — `fN` / `_y` / `pN` / `dN` / `Fm` / `uu`.
 * Gold: gold-11-fn-fN-body.txt / gold-11-fn-_y-async.txt / gold-11-dN-0.txt
 *
 * Official `wv` = `_r` → `Ue.record` (`gold-11-Ue-ident.txt`).
 * `kv` = `Rt` (`addFileGlobRuleToGitignore`).
 */
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  rmdirSync,
  unlinkSync,
} from 'fs'
import { mkdir } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { getCwdState, getOriginalCwd } from '../../bootstrap/state.js'
import { getCwd } from '../cwd.js'
import { addFileGlobRuleToGitignore } from '../git/gitignore.js'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { errorMessage, getErrnoCode } from '../errors.js'
import { getSettingsFilePathForSource } from '../settings/settings.js'
import { CLAUDE_ATOMIC_STAGING_LEAF } from '../symlinkWriteGuard.js'

const O_RDONLY = fsConstants.O_RDONLY
const O_DIRECTORY = fsConstants.O_DIRECTORY ?? 0
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
const STAGING_DIR_MODE = 448
let stagingDirGitignoreFired = false

/** densable `Ue` — `had`/`wv`. Key is `resolve` (`we`=`te`). */
type StagingDirIdentity = { dev: number; ino: number; fd: number }
const stagingDirIdentities = new Map<string, StagingDirIdentity>()

/** densable `_r` / `Ue.record`. Keeps `fd` open; closes the previous fd. */
export function recordStagingDirIdentity(
  path: string,
  dev: number,
  ino: number,
  fd: number,
): void {
  const key = resolve(path)
  const prev = stagingDirIdentities.get(key)
  if (prev) {
    try {
      closeSync(prev.fd)
    } catch {
      // official swallows close of the replaced fd
    }
  }
  stagingDirIdentities.set(key, { dev, ino, fd })
}

/** densable `Ue.identity`. */
export function getStagingDirIdentity(
  path: string,
): StagingDirIdentity | undefined {
  return stagingDirIdentities.get(resolve(path))
}

/** densable `Ue.reset`. */
export function resetStagingDirIdentities(): void {
  for (const { fd } of stagingDirIdentities.values()) {
    try {
      closeSync(fd)
    } catch {
      // official swallows
    }
  }
  stagingDirIdentities.clear()
}

/** densable `Qd` */
const BRIDGE_SPAWN_LEAF = 'bridge-spawn'

/** densable `Um` */
function atomicStagingDir(root: string): string {
  return join(root, '.claude', CLAUDE_ATOMIC_STAGING_LEAF)
}

/** densable `Ia` */
function isNestedSandbox(): boolean {
  return Boolean(process.env.IS_SANDBOX)
}

/** densable `dN` */
function atomicWriteStagingDirs(includeSessionCwd = true): string[] {
  const out = new Set<string>()
  out.add(atomicStagingDir(getOriginalCwd()))
  if (includeSessionCwd) out.add(atomicStagingDir(getCwdState()))
  out.add(atomicStagingDir(getCwd()))
  out.add(join(getClaudeConfigHomeDir(), CLAUDE_ATOMIC_STAGING_LEAF))
  const localSettings = getSettingsFilePathForSource('localSettings')
  if (localSettings) {
    out.add(join(dirname(localSettings), CLAUDE_ATOMIC_STAGING_LEAF))
  }
  return [...out]
}

/** densable `uu` — parent is a real directory, no symlink hop. */
function parentIsRealDirectory(path: string): boolean {
  try {
    closeSync(openSync(dirname(path), O_RDONLY | O_DIRECTORY | O_NOFOLLOW))
    return true
  } catch (err) {
    const code = getErrnoCode(err)
    return code !== 'ELOOP' && code !== 'ENOTDIR'
  }
}

/** densable `Fm` */
function mkdirAtomicStaging(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  mkdirSync(path, { recursive: true, mode: STAGING_DIR_MODE })
}

/**
 * densable `_y` — `join(homedir(), ".claude", "bridge-spawn")`, parent
 * recursive, dir mode 448, ignore EEXIST.
 */
export async function ensureBridgeSpawnRootDir(): Promise<string> {
  const path = join(homedir(), '.claude', BRIDGE_SPAWN_LEAF)
  await mkdir(dirname(path), { recursive: true })
  try {
    await mkdir(path, { mode: STAGING_DIR_MODE })
  } catch (err) {
    if (getErrnoCode(err) !== 'EEXIST') throw err
  }
  return path
}

/** densable `fN` */
export async function ensureBridgeSpawnRootDirForWrap(): Promise<void> {
  await ensureBridgeSpawnRootDir().catch(err => {
    logForDebugging(
      `ensureBridgeSpawnRootDir: could not create the bridge-spawn root: ${errorMessage(err) || 'error'}`,
      { level: 'warn' },
    )
  })
}

/** densable `pN`. `wv` = `Ue.record`. `kv` = `Rt`. */
export function ensureAtomicWriteStagingDirs(): void {
  for (const path of atomicWriteStagingDirs(!isNestedSandbox())) {
    if (!parentIsRealDirectory(path)) continue
    let established = false
    try {
      if (!lstatSync(path).isDirectory()) {
        if (!parentIsRealDirectory(path)) continue
        unlinkSync(path)
        mkdirAtomicStaging(path)
        established = true
      } else {
        try {
          closeSync(openSync(path, O_RDONLY | O_DIRECTORY))
          established = true
        } catch {
          try {
            if (!parentIsRealDirectory(path)) continue
            rmdirSync(path)
            mkdirAtomicStaging(path)
            established = true
          } catch {
            // official swallows the inner rmdir/Fm failure
          }
        }
      }
    } catch {
      try {
        if (!parentIsRealDirectory(path)) continue
        mkdirAtomicStaging(path)
        established = true
      } catch (err) {
        logForDebugging(
          `ensureAtomicWriteStagingDirs: failed to create ${path}: ${err}`,
        )
      }
    }
    try {
      const fd = openSync(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
      try {
        const st = fstatSync(fd)
        recordStagingDirIdentity(path, st.dev, st.ino, fd)
      } catch (err) {
        closeSync(fd)
        throw err
      }
    } catch (err) {
      if (established) {
        logForDebugging(
          `Staging dir ${path} was just established but identity-record open failed (${getErrnoCode(err) ?? err})`,
        )
      }
    }
  }
  // densable kv / Rt — once per process (hN.stagingDirGitignoreFired)
  if (!stagingDirGitignoreFired) {
    stagingDirGitignoreFired = true
    void addFileGlobRuleToGitignore(
      `.claude/${CLAUDE_ATOMIC_STAGING_LEAF}/`,
      getOriginalCwd(),
    ).then(result => {
      if (!result.written) return
      if (result.effective) {
        logForDebugging('gitignore_global_rule')
      } else if (result.reason === 'already_tracked') {
        logForDebugging('gitignore_global_rule already_tracked')
      } else {
        logForDebugging(
          `gitignore_global_rule ${result.reason ?? 'write_ineffective'}`,
        )
      }
    })
  }
}
