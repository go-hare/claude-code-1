import { lstatSync, readlinkSync } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import { getErrnoCode } from '../errors.js'
import { isWorktreePathNetworkRelativeToCwd } from '../worktree.js'

/**
 * densable 2.1.247 `_752` hop-walk used by WZ `Vm`/`ne` and `Qi`/`xe`.
 * Gold: gold-11-ne-win.txt / gold-11-ae-regexes.txt / gold-11-WZ-helpers-lock.txt
 *
 * `J` in ae is `_841` `$o` (Pxd). `$o` starts with 1-arg `J(){return!1}`,
 * so the volume arm never fires. `Do`/`F` is `ko` (same as WZ `Ji`).
 */

const HOP_SPLIT = /[/\\]+/
const TRAILING_SEP = /[\\/]$/
const ABS_PREFIX = /^(?:[/\\]|[A-Za-z]:[/\\])/
const ROOT_PREFIX =
  /^(?:[/\\]{2}[^/\\]+[/\\][^/\\]+[/\\]?|[A-Za-z]:[/\\]|[/\\])/

/** densable `$o` / hop-walk `J`. Official inner `J(t){return!1}`. */
function volumeHopRejects(_path: string, _base: string): boolean {
  return false
}

/** densable `Dr` */
function hopKind(
  path: string,
): 'symlink' | 'file' | 'dir' | 'absent' | 'other' {
  try {
    const st = lstatSync(path)
    if (st.isSymbolicLink()) return 'symlink'
    if (st.isFile()) return 'file'
    if (st.isDirectory()) return 'dir'
    return 'other'
  } catch (err) {
    const code = getErrnoCode(err)
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'absent' : 'other'
  }
}

/** densable `Ve` — readlink as utf-8 bytes; NUL / non-utf8 → null. */
function readlinkUtf8(path: string): string | null {
  try {
    const raw = readlinkSync(path, { encoding: 'buffer' })
    const text = raw.toString('utf-8')
    if (text.includes('\0') || !Buffer.from(text, 'utf-8').equals(raw)) {
      return null
    }
    return text
  } catch {
    return null
  }
}

/**
 * densable `ae(e,t,r=40,n=t)`. true = walk completed without a bad hop.
 */
export function gitdirHopWalkOk(
  path: string,
  _base: string,
  depth = 40,
  jBase?: string,
): boolean {
  if (depth <= 0) return false
  const prefixMatch = ROOT_PREFIX.exec(path)
  let cur = prefixMatch ? prefixMatch[0] : ''
  const parts = path.slice(cur.length).split(HOP_SPLIT)
  const volumeBase = jBase ?? _base
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part === '' || part === '.') continue
    if (part === '..') {
      cur = dirname(cur)
      continue
    }
    cur = join(cur, part)
    // official J(i,n) = $o; _841 J(t){return!1} → always false
    if (volumeHopRejects(cur, volumeBase)) return false
    const kind = hopKind(cur)
    if (kind === 'other') return false
    if (kind === 'symlink') {
      const target = readlinkUtf8(cur)
      if (target === null) return false
      if (isWorktreePathNetworkRelativeToCwd(target, dirname(cur))) {
        return false
      }
      const abs = ABS_PREFIX.test(target) ? target : dirname(cur) + sep + target
      const rest = parts.slice(i + 1).join(sep)
      const next = rest
        ? TRAILING_SEP.test(abs)
          ? abs + rest
          : abs + sep + rest
        : abs
      return gitdirHopWalkOk(next, _base, depth - 1, volumeBase)
    }
  }
  return true
}

/** densable `ne` hop-walk arm: `!ae(path, base)`. */
export function gitAdminHopUnsafe(path: string, base: string): boolean {
  return !gitdirHopWalkOk(path, base)
}

/**
 * densable `xe` / WZ `Qi`. true = reject the pointer.
 * `jBase` is xe's 3rd arg; unused while `$o` is a stub.
 */
export function gitdirPointerHopUnsafe(
  pointer: string,
  base: string,
  jBase: string = base,
): boolean {
  const first = ABS_PREFIX.test(pointer) ? pointer : base + sep + pointer
  if (!gitdirHopWalkOk(first, base, 40, jBase)) return true
  return !gitdirHopWalkOk(resolve(base, pointer), base, 40, jBase)
}
