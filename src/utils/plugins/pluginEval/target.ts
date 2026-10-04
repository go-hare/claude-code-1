/**
 * densable `kg`/`Oc`/`Ac` — screen the eval target and vet --eval-dir.
 */

import { lstat, realpath } from 'fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'path'
import { CASE_FILE_NAMES, SKIP_DIR_NAMES } from './constants.js'
import { PluginEvalPathError, vetPluginEvalPath } from './pathVet.js'
import type { EvalDirValue, PluginEvalTrustState, ScreenedEvalTarget } from './types.js'

function isCaseFileName(name: string): boolean {
  return (CASE_FILE_NAMES as readonly string[]).includes(name)
}

/** densable `kg`. */
export async function screenEvalTarget(
  target: string,
  pluginId: string | undefined,
  _trust: PluginEvalTrustState,
): Promise<ScreenedEvalTarget> {
  let targetDir = resolve(process.cwd(), target)
  try {
    await vetPluginEvalPath(process.cwd(), target, 'target')
    targetDir = await realpath(targetDir)
  } catch (error) {
    if (error instanceof PluginEvalPathError) throw error
    return {
      targetDir,
      targetIsCaseFile: !pluginId && isCaseFileName(basename(targetDir)),
      pluginRoot: pluginId ? targetDir : null,
      untrustedManifestDir: null,
      targetResolved: false,
      enclosingVerdict: null,
    }
  }
  if (pluginId) {
    return {
      targetDir,
      targetIsCaseFile: false,
      pluginRoot: targetDir,
      untrustedManifestDir: null,
      targetResolved: true,
      enclosingVerdict: null,
    }
  }
  const targetIsCaseFile = isCaseFileName(basename(targetDir))
  const dir = targetIsCaseFile ? dirname(targetDir) : targetDir
  return {
    targetDir: dir,
    targetIsCaseFile,
    pluginRoot: null,
    untrustedManifestDir: null,
    targetResolved: true,
    enclosingVerdict: { adopted: null, refused: null, namedOnly: null },
  }
}

/** densable `Oc`. */
export async function vetEvalDir(
  root: string,
  value: EvalDirValue,
): Promise<EvalDirValue> {
  if (value.source === 'default') return value
  await vetPluginEvalPath(root, value.segments.join(sep), 'eval directory')
  let real: string
  try {
    real = await realpath(join(root, ...value.segments))
  } catch {
    return value
  }
  const rel = relative(root, real)
  const segments = rel.split(sep).filter(Boolean)
  if (segments.length !== value.segments.length) return value
  if (rel === value.segments.join(sep)) return value
  let cursor = root
  for (const part of value.segments) {
    cursor = join(cursor, part)
    try {
      if ((await lstat(cursor)).isSymbolicLink()) return value
    } catch {
      return value
    }
  }
  if (segments.some(part => SKIP_DIR_NAMES.has(part))) return value
  return { ...value, dir: rel, segments }
}

/** densable `Ac`. */
export function evalDirOverlapArgs(params: {
  scopeDir: string
  scopeIsNamedDirectory: boolean
  trustedRoot: string | null
  otherManifestDir: string | null
  adoptedAbove: string | null
}): {
  pluginRoot: string | null
  overlapRoot: string
  overlapBase: string[]
  overlapAdvisory: boolean
} {
  const { scopeDir, scopeIsNamedDirectory, trustedRoot, otherManifestDir, adoptedAbove } =
    params
  return {
    pluginRoot: trustedRoot,
    overlapRoot: trustedRoot ?? otherManifestDir ?? scopeDir,
    overlapBase:
      trustedRoot === null &&
      otherManifestDir !== null &&
      (scopeDir === otherManifestDir || scopeDir.startsWith(otherManifestDir + sep))
        ? relative(otherManifestDir, scopeDir).split(sep).filter(Boolean)
        : [],
    overlapAdvisory:
      trustedRoot === null &&
      otherManifestDir !== null &&
      !(scopeIsNamedDirectory && otherManifestDir === scopeDir) &&
      otherManifestDir !== adoptedAbove,
  }
}
