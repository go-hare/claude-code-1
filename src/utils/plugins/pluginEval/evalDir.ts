import { join, normalize, posix, sep } from 'path'
import {
  COMPONENT_DIR_NAMES,
  DEFAULT_EVAL_DIR,
  SKIP_DIR_NAMES,
} from './constants.js'
import type { EvalDirResult, EvalDirSource, EvalDirValue } from './types.js'

function windowsDeviceName(segment: string): string | undefined {
  if (!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(segment)) {
    return undefined
  }
  if (segment.endsWith('.') || segment.endsWith(' ')) {
    return 'ends in "." or a space, which Windows treats as another name'
  }
  if (segment.includes(':')) {
    return 'contains ":", a stream selector on Windows'
  }
  return 'is a reserved device name on Windows'
}

function quote(segment: string): string {
  return JSON.stringify(segment)
}

export function parseEvalDirFlag(
  raw: string | undefined,
): { ok: true; dir: string; segments: string[] } | { ok: false; error: string } {
  if (raw === undefined) {
    return {
      ok: true,
      dir: DEFAULT_EVAL_DIR,
      segments: [DEFAULT_EVAL_DIR],
    }
  }
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { ok: false, error: 'must not be empty' }
  }
  const posixish = trimmed.replaceAll('\\', '/')
  if (
    posix.isAbsolute(trimmed) ||
    posix.isAbsolute(posixish) ||
    /^[A-Za-z]:/.test(trimmed)
  ) {
    return {
      ok: false,
      error:
        'must be a relative path inside the plugin (e.g. quality/evals), not absolute',
    }
  }
  const segments = normalize(posixish)
    .split(sep)
    .filter(part => part !== '' && part !== '.')
  if (segments.length === 0) {
    return {
      ok: false,
      error: 'must name a directory below the plugin root, not the root itself',
    }
  }
  if (segments.some(part => part === '..')) {
    return { ok: false, error: 'must stay inside the plugin root (no ..)' }
  }
  if (trimmed.length > 200 || segments.length > 8) {
    return {
      ok: false,
      error: 'must be a short path (at most 200 characters, 8 segments)',
    }
  }
  const bad = segments.find(
    part => !/^[A-Za-z0-9][A-Za-z0-9._@+-]*$/.test(part),
  )
  if (bad !== undefined) {
    return {
      ok: false,
      error: `must use plain directory names (a letter or digit first, then letters, digits, . _ - @ +); ${quote(bad)} is not`,
    }
  }
  const last = segments.at(-1) ?? ''
  if (/\.(md|ya?ml|json)$/i.test(last)) {
    return {
      ok: false,
      error: `must name a directory, not a file (${quote(last)})`,
    }
  }
  for (const part of segments) {
    const device = windowsDeviceName(part)
    if (device !== undefined) {
      return { ok: false, error: `${quote(part)} ${device}` }
    }
  }
  if (COMPONENT_DIR_NAMES.has(segments[0]!.toLowerCase())) {
    return {
      ok: false,
      error: `must not be inside the plugin's ${segments[0]}/ directory (a loaded component directory)`,
    }
  }
  const skipped = segments.find(part => SKIP_DIR_NAMES.has(part))
  if (skipped !== undefined) {
    return {
      ok: false,
      error: `must not pass through ${quote(skipped)}, which case discovery always skips`,
    }
  }
  return { ok: true, dir: segments.join(sep), segments }
}

export function evalDirFlagSuffix(value: EvalDirValue): string {
  return value.source === 'flag' ? ` --eval-dir ${evalDirDisplay(value)}` : ''
}

export function evalDirDisplay(value: EvalDirValue | string): string {
  return (typeof value === 'string' ? value : value.dir).replaceAll('\\', '/')
}

function readManifestEvals(
  pluginRoot: string | null,
): { source: EvalDirSource; dir: string; segments: string[]; manifestPath?: string } {
  if (pluginRoot === null) {
    return {
      source: 'default',
      dir: DEFAULT_EVAL_DIR,
      segments: [DEFAULT_EVAL_DIR],
    }
  }
  try {
    const { readFileSync } = require('fs') as typeof import('fs')
    const { join: pathJoin } = require('path') as typeof import('path')
    const candidates = [
      pathJoin(pluginRoot, '.claude-plugin', 'plugin.json'),
      pathJoin(pluginRoot, 'plugin.json'),
    ]
    for (const manifestPath of candidates) {
      try {
        const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          experimental?: { evals?: unknown }
          evals?: unknown
        }
        const experimental = raw.experimental?.evals
        const value = experimental ?? raw.evals
        if (typeof value === 'string' && value.trim() !== '') {
          const parsed = parseEvalDirFlag(value)
          if (parsed.ok) {
            return {
              source: 'manifest',
              dir: parsed.dir,
              segments: parsed.segments,
              manifestPath,
            }
          }
        }
        if (Array.isArray(value) && typeof value[0] === 'string') {
          const parsed = parseEvalDirFlag(value[0])
          if (parsed.ok) {
            return {
              source: 'manifest',
              dir: parsed.dir,
              segments: parsed.segments,
              manifestPath,
            }
          }
        }
      } catch {
        continue
      }
    }
  } catch {
    // ignore
  }
  return {
    source: 'default',
    dir: DEFAULT_EVAL_DIR,
    segments: [DEFAULT_EVAL_DIR],
  }
}

export async function resolveEvalDir(params: {
  flag?: string
  pluginRoot: string | null
}): Promise<EvalDirResult> {
  if (params.flag !== undefined) {
    const parsed = parseEvalDirFlag(params.flag)
    if (!parsed.ok) {
      return { ok: false, error: `--eval-dir ${parsed.error}` }
    }
    return {
      ok: true,
      value: { ...parsed, source: 'flag' },
    }
  }
  const fromManifest = readManifestEvals(params.pluginRoot)
  return { ok: true, value: fromManifest }
}

export function joinEvalDir(root: string, value: EvalDirValue): string {
  return join(root, ...value.segments)
}
