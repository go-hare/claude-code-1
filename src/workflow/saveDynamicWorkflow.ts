/**
 * densable 2.1.216 L1a / K4b — save a dynamic named workflow under
 * `.claude/workflows/<slug>.js` with symlink chain guards (YNn) + M6 overwrite.
 */

import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import {
  assertDirChainReal,
  isClaudeConfigDirPath,
  writeFileAndFlush,
} from '../utils/symlinkWriteGuard.js'

const ALREADY_EXISTS_HINT = 'Use a different name or overwrite.' as const

export type WorkflowSaveScope = 'project' | 'user'

export type SaveDynamicWorkflowInput = {
  name: string
  scope: WorkflowSaveScope
  script: string
  overwrite: boolean
  cwd: string
}

export type SaveDynamicWorkflowResult = {
  name: string
  path: string
  scope: WorkflowSaveScope
}

/** densable f_e — slugify workflow name for filename. */
export function slugifyWorkflowName(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'workflow'
}

/**
 * densable K4b — resolve workflows directory.
 * user → `<config>/workflows` (or config-home workflows);
 * project → `<cwd>/.claude/workflows` (or project root when resolvable).
 */
export function resolveWorkflowsDir(
  scope: WorkflowSaveScope,
  cwd: string,
): string {
  if (scope === 'user') {
    return join(getClaudeConfigHomeDir(), 'workflows')
  }
  return join(cwd, '.claude', 'workflows')
}

/**
 * densable L1a — write dynamic workflow script with chain guard + M6.
 */
export async function saveDynamicWorkflow(
  input: SaveDynamicWorkflowInput,
): Promise<SaveDynamicWorkflowResult> {
  const slug = slugifyWorkflowName(input.name)
  const workflowsDir = resolveWorkflowsDir(input.scope, input.cwd)
  const filePath = join(workflowsDir, `${slug}.js`)

  // densable: needsChainGuard = scope !== "user" && !VEt(dirname(workflowsDir))
  // dirname(workflowsDir) for project = `<cwd>/.claude`
  const needsChainGuard =
    input.scope !== 'user' && !isClaudeConfigDirPath(dirname(workflowsDir))

  if (needsChainGuard) {
    // YNn(dirname(dirname(workflowsDir)), workflowsDir)
    // = YNn(cwd, cwd/.claude/workflows)
    await assertDirChainReal(dirname(dirname(workflowsDir)), workflowsDir)
  }

  await mkdir(workflowsDir, { recursive: true, mode: 0o700 })

  try {
    if (input.overwrite) {
      await writeFileAndFlush(filePath, input.script, {
        encoding: 'utf8',
        mode: 0o600,
        checkParentDir: needsChainGuard,
      })
    } else {
      // densable: create with wx (no M6) after chain guard + mkdir
      await writeFile(filePath, input.script, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      })
    }
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : undefined
    if (!input.overwrite && code === 'EEXIST') {
      throw new Error(
        `Dynamic workflow "${slug}" already exists at ${filePath}. ${ALREADY_EXISTS_HINT}`,
      )
    }
    throw err
  }

  logEvent('tengu_workflow_saved', {
    scope:
      input.scope as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    overwrite:
      input.overwrite as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    script_size_chars: input.script
      .length as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  return { name: slug, path: filePath, scope: input.scope }
}
