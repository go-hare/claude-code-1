/**
 * densable 2.1.289 DesignSync `ne` — method switch.
 * gTo/Xon are registerDesignPlan / readDesignPlan on this toolState.
 */
import { constants } from 'fs'
import { open, realpath } from 'fs/promises'
import { extname, resolve, sep } from 'path'
import { AbortError } from 'src/utils/errors.js'
import { getCwd } from 'src/utils/cwd.js'
import {
  normalizePath,
  readDesignPlan,
  registerDesignPlan,
  type DesignSessionState,
} from 'src/services/designProjectGrant.js'
import {
  createDesignProject,
  deleteDesignAsset,
  deleteDesignFiles,
  getDesignFile,
  getDesignProject,
  listDesignFiles,
  listOrgProjects,
  recordDesignAsset,
  writeDesignFiles,
  type DesignAssetCard,
  type DesignProjectItem,
  type PreparedDesignFile,
} from './api.js'
import { DESIGN_SYNC_PATH_MAX, type DesignSyncInput } from './prompt.js'

const PROJECT_TYPE = 'PROJECT_TYPE_DESIGN_SYSTEM'
const GLOB_WILDCARDS = 3
const WRITE_BATCH = 32
const WRITE_BYTE_LIMIT = 12_582_912
const TEXT_EXTENSIONS = new Set([
  'html',
  'css',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'mts',
  'cts',
  'json',
  'svg',
  'xml',
  'md',
  'txt',
  'csv',
  'yaml',
  'yml',
  'toml',
])

const PLAN_MISMATCH =
  'Plan token is missing or does not match this project. Call finalize_plan first.'

function required<T>(value: T | undefined, name: string, method: string): T {
  if (value === undefined) {
    throw new Error(`${method} requires "${name}"`)
  }
  return value
}

/** Gold `Kon`. */
export function isReservedDesignPath(path: string): boolean {
  const lower = normalizePath(path).toLowerCase()
  return (
    lower === 'claude.md' ||
    lower.startsWith('claude.md/') ||
    lower === '.claude' ||
    lower.startsWith('.claude/')
  )
}

/** Gold `Vlt`. */
export function isDesignPlanGlob(path: string): boolean {
  return /[*?]/.test(path)
}

/** Gold `m` — returns the matcher. Too-wide globs throw. */
function compilePlanGlob(pattern: string): RegExp {
  let out = ''
  let index = 0
  let stars = 0
  const bump = () => {
    stars += 1
    if (stars > GLOB_WILDCARDS) {
      throw new Error(
        `glob "${pattern}" exceeds ${GLOB_WILDCARDS} '*'/'**' wildcards`,
      )
    }
  }
  while (index < pattern.length) {
    const ch = pattern.charAt(index)
    if (ch === '*' && pattern.charAt(index + 1) === '*') {
      bump()
      if (pattern.charAt(index + 2) === '/') {
        out += '(?:.*/)?'
        index += 3
      } else {
        out += '.*'
        index += 2
      }
    } else if (ch === '*') {
      bump()
      out += '[^/]*'
      index += 1
    } else if (ch === '?') {
      out += '[^/]'
      index += 1
    } else if (/[.+^$|()[\]{}\\]/.test(ch)) {
      out += `\\${ch}`
      index += 1
    } else {
      out += ch
      index += 1
    }
  }
  return new RegExp(`^${out}$`)
}

/** Gold `Yon`. A glob that fails to compile does not match. */
export function pathInFinalizedPlan(
  path: string,
  patterns: readonly string[],
): boolean {
  const normalized = normalizePath(path)
  if (!normalized) return false
  if (normalized.length > DESIGN_SYNC_PATH_MAX) return false
  if (normalized.split('/').includes('..') || normalized.includes('\0')) {
    return false
  }
  for (const pattern of patterns) {
    const rule = normalizePath(pattern)
    if (isDesignPlanGlob(rule)) {
      try {
        if (compilePlanGlob(rule).test(normalized)) return true
      } catch {
        // gold swallows a glob that exceeds the wildcard cap
      }
    } else if (rule === normalized) {
      return true
    }
  }
  return false
}

/** Gold `se`. */
export async function resolveDesignSyncLocalDir(
  localDir?: string,
): Promise<string> {
  return realpath(resolve(getCwd(), localDir ?? '.'))
}

function withSep(dir: string): string {
  return dir.endsWith(sep) ? dir : dir + sep
}

/** Gold `Pe`. */
async function readWriteFile(
  file: NonNullable<DesignSyncInput['files']>[number],
  localDir: string | undefined,
): Promise<PreparedDesignFile> {
  const path = normalizePath(file.path)
  if (file.localPath === undefined) {
    if (file.data === undefined) {
      throw new Error(`write_files: ${path} has neither data nor localPath`)
    }
    return {
      path,
      data: file.data,
      ...(file.encoding !== undefined ? { encoding: file.encoding } : {}),
      ...(file.mimeType !== undefined ? { mimeType: file.mimeType } : {}),
    }
  }
  if (file.data !== undefined) {
    throw new Error(`write_files: ${path} has both data and localPath`)
  }
  if (localDir === undefined) {
    throw new Error(
      'write_files with localPath requires a plan finalized with localDir. Re-run finalize_plan with the bundle directory.',
    )
  }
  const root = resolve(localDir)
  const target = resolve(root, file.localPath)
  if (target !== root && !target.startsWith(withSep(root))) {
    throw new Error(
      'write_files: localPath must be inside the directory approved at finalize_plan.',
    )
  }
  const [realTarget, realRoot] = await Promise.all([
    realpath(target),
    realpath(root),
  ])
  if (realTarget !== realRoot && !realTarget.startsWith(withSep(realRoot))) {
    throw new Error(
      'write_files: localPath resolves outside the directory approved at finalize_plan.',
    )
  }
  const handle = await open(
    realTarget,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  )
  let body: Buffer
  try {
    const info = await handle.stat()
    if (!info.isFile()) {
      throw new Error('write_files: localPath must be a regular file.')
    }
    if (info.size > WRITE_BYTE_LIMIT) {
      throw new Error(
        `write_files: file at localPath exceeds the ${WRITE_BYTE_LIMIT} byte limit.`,
      )
    }
    body = await handle.readFile()
  } finally {
    await handle.close()
  }
  const extension = extname(realTarget).slice(1).toLowerCase()
  if (TEXT_EXTENSIONS.has(extension)) {
    return {
      path,
      data: body.toString('utf8'),
      ...(file.mimeType !== undefined ? { mimeType: file.mimeType } : {}),
    }
  }
  return {
    path,
    data: body.toString('base64'),
    encoding: 'base64',
    ...(file.mimeType !== undefined ? { mimeType: file.mimeType } : {}),
  }
}

function projectWritable(item: DesignProjectItem): boolean {
  if (item.callerCanEdit != null) return Boolean(item.callerCanEdit)
  if (item.canEdit != null) return Boolean(item.canEdit)
  return Boolean(item.isOwned || item.sharing?.teamCanEdit)
}

function requirePlan(
  state: DesignSessionState,
  projectId: string,
  planId: string,
) {
  const plan = readDesignPlan(state, planId)
  if (!plan || plan.projectId !== projectId) {
    throw new Error(PLAN_MISMATCH)
  }
  return plan
}

export type DesignSyncResult =
  | {
      method: 'list_projects'
      projects: {
        projectId?: string
        name?: string
        ownerDisplayName?: string
        isOwned?: boolean
        updatedAt?: string
      }[]
    }
  | {
      method: 'get_project'
      projectId?: string
      name?: string
      type?: string
      ownerDisplayName?: string
      isOwned?: boolean
      canEdit?: boolean
    }
  | { method: 'list_files'; paths: string[] }
  | {
      method: 'get_file'
      path: string
      content: string
      contentType: string
      isBase64: boolean
      truncated: boolean
    }
  | {
      method: 'finalize_plan'
      planId: string
      writes: string[]
      deletes: string[]
    }
  | { method: 'write_files'; written: number }
  | { method: 'delete_files'; deleted: number }
  | { method: 'register_assets'; registered: number }
  | { method: 'unregister_assets'; unregistered: number }
  | { method: 'create_project'; projectId: string; name: string }
  | { method: 'report_validate' }

/**
 * Gold `ne`. `token` is the design bearer from `je`; finalize_plan does
 * not send it.
 */
export async function dispatchDesignSync(
  state: DesignSessionState,
  input: DesignSyncInput,
  token: string,
  signal: AbortSignal,
): Promise<DesignSyncResult> {
  switch (input.method) {
    case 'list_projects': {
      const items = await listOrgProjects(token, PROJECT_TYPE, signal)
      return {
        method: 'list_projects',
        projects: items.filter(projectWritable).map(item => ({
          projectId: item.projectId,
          name: item.name,
          ownerDisplayName: item.ownerDisplayName,
          isOwned: item.isOwned,
          updatedAt: item.updatedAt,
        })),
      }
    }
    case 'get_project': {
      const projectId = required(input.projectId, 'projectId', input.method)
      const project = await getDesignProject(token, projectId, signal)
      return {
        method: 'get_project',
        projectId: project.projectId,
        name: project.name,
        type: project.type,
        ownerDisplayName: project.ownerDisplayName,
        isOwned: project.isOwned,
        canEdit: project.callerCanEdit ?? project.canEdit,
      }
    }
    case 'list_files': {
      const projectId = required(input.projectId, 'projectId', input.method)
      return {
        method: 'list_files',
        paths: await listDesignFiles(token, projectId, signal),
      }
    }
    case 'get_file': {
      const projectId = required(input.projectId, 'projectId', input.method)
      const path = required(input.path, 'path', input.method)
      const file = await getDesignFile(token, projectId, path, signal)
      return {
        method: 'get_file',
        path,
        content: file.content,
        contentType: file.contentType,
        isBase64: file.isBase64,
        truncated: file.truncated,
      }
    }
    case 'finalize_plan': {
      const projectId = required(input.projectId, 'projectId', input.method)
      const writes = required(input.writes, 'writes', input.method).map(
        normalizePath,
      )
      const deletes = required(input.deletes, 'deletes', input.method).map(
        normalizePath,
      )
      const localDir = await resolveDesignSyncLocalDir(input.localDir)
      return {
        method: 'finalize_plan',
        planId: registerDesignPlan(state, {
          projectId,
          writes,
          deletes,
          localDir,
        }),
        writes,
        deletes,
      }
    }
    case 'write_files': {
      const projectId = required(input.projectId, 'projectId', input.method)
      const planId = required(input.planId, 'planId', input.method)
      const files = required(input.files, 'files', input.method)
      const plan = requirePlan(state, projectId, planId)
      const reserved = files.map(file => file.path).filter(isReservedDesignPath)
      if (reserved.length > 0) {
        throw new Error(
          `Cannot write reserved paths: ${reserved.join(', ')}. CLAUDE.md and .claude/ carry instructions to the design agent and are blocked regardless of the plan.`,
        )
      }
      const outside = files
        .map(file => normalizePath(file.path))
        .filter(path => !pathInFinalizedPlan(path, plan.writes))
      if (outside.length > 0) {
        throw new Error(
          `Cannot write paths outside the finalized plan: ${outside.join(', ')}. Re-run finalize_plan with the full set.`,
        )
      }
      const prepared: PreparedDesignFile[] = []
      for (let index = 0; index < files.length; index += WRITE_BATCH) {
        if (signal.aborted) throw new AbortError()
        const batch = files.slice(index, index + WRITE_BATCH)
        prepared.push(
          ...(await Promise.all(
            batch.map(file => readWriteFile(file, plan.localDir)),
          )),
        )
      }
      const written = await writeDesignFiles(token, projectId, prepared, signal)
      return { method: 'write_files', written: written.length }
    }
    case 'delete_files': {
      const projectId = required(input.projectId, 'projectId', input.method)
      const planId = required(input.planId, 'planId', input.method)
      const paths = required(input.paths, 'paths', input.method)
      const plan = requirePlan(state, projectId, planId)
      const reserved = paths.filter(isReservedDesignPath)
      if (reserved.length > 0) {
        throw new Error(
          `Cannot delete reserved paths: ${reserved.join(', ')}. CLAUDE.md and .claude/ carry instructions to the design agent and are blocked regardless of the plan.`,
        )
      }
      const outside = paths
        .map(normalizePath)
        .filter(path => !pathInFinalizedPlan(path, plan.deletes))
      if (outside.length > 0) {
        throw new Error(
          `Cannot delete paths outside the finalized plan: ${outside.join(', ')}. Re-run finalize_plan with the full set.`,
        )
      }
      return {
        method: 'delete_files',
        deleted: await deleteDesignFiles(
          token,
          projectId,
          paths.map(normalizePath),
          signal,
        ),
      }
    }
    case 'register_assets': {
      const projectId = required(input.projectId, 'projectId', input.method)
      const planId = required(input.planId, 'planId', input.method)
      const assets = required(input.assets, 'assets', input.method)
      const plan = requirePlan(state, projectId, planId)
      const outside = assets
        .map(asset => normalizePath(asset.path))
        .filter(path => !pathInFinalizedPlan(path, plan.writes))
      if (outside.length > 0) {
        throw new Error(
          `Cannot register paths outside the finalized plan: ${outside.join(', ')}. Re-run finalize_plan with the full set.`,
        )
      }
      let registered = 0
      for (const asset of assets) {
        if (signal.aborted) throw new AbortError()
        const card: DesignAssetCard = {
          name: asset.name,
          path: normalizePath(asset.path),
          ...(asset.subtitle !== undefined ? { subtitle: asset.subtitle } : {}),
          ...(asset.viewport !== undefined ? { viewport: asset.viewport } : {}),
          ...(asset.group !== undefined ? { group: asset.group } : {}),
        }
        await recordDesignAsset(token, projectId, card, signal)
        registered += 1
      }
      return { method: 'register_assets', registered }
    }
    case 'unregister_assets': {
      const projectId = required(input.projectId, 'projectId', input.method)
      const planId = required(input.planId, 'planId', input.method)
      const paths = required(input.paths, 'paths', input.method)
      const plan = requirePlan(state, projectId, planId)
      const outside = paths
        .map(normalizePath)
        .filter(path => !pathInFinalizedPlan(path, plan.deletes))
      if (outside.length > 0) {
        throw new Error(
          `Cannot unregister cards for paths outside the finalized plan's deletes: ${outside.join(', ')}. Re-run finalize_plan with the full set.`,
        )
      }
      let unregistered = 0
      for (const path of paths.map(normalizePath)) {
        if (signal.aborted) throw new AbortError()
        await deleteDesignAsset(token, projectId, path, signal)
        unregistered += 1
      }
      return { method: 'unregister_assets', unregistered }
    }
    case 'create_project': {
      const name = required(input.name, 'name', input.method)
      const created = await createDesignProject(token, name, signal)
      return {
        method: 'create_project',
        projectId: created.projectId,
        name: created.name,
      }
    }
    case 'report_validate':
      return { method: 'report_validate' }
  }
}
