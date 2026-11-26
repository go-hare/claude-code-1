/**
 * Official 2.1.331 `claude plugin tag [path]` handler (`Kid`, `keo`, `Eeo`, `iAn`).
 *
 * Creates a `{name}--v{version}` annotated git tag for a plugin release,
 * validating that `plugin.json` and any enclosing `marketplace.json` agree.
 */
import { execFile } from 'node:child_process'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { getCwd } from '../../utils/cwd.js'
import { errorMessage } from '../../utils/errors.js'
import { safeParseJSON } from '../../utils/json.js'
import { cliError, cliOk } from '../exit.js'

const execFileAsync = promisify(execFile)

const SEMVER_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

const INVALID_GIT_REF_RE = /[\s~^:?*[\\]|\.\.|@\{|\/\//

export type PluginTagPlan = {
  pluginName: string
  version: string
  versionFrom: 'plugin.json' | 'marketplace entry'
  tag: string
  pluginRoot: string
  gitRoot: string
  marketplace?: {
    path: string
    entryIndex: number
    entryVersion?: string
  }
}

export type PlanPluginTagResult =
  | { ok: true; plan: PluginTagPlan; warnings: string[] }
  | { ok: false; error: string; warnings: string[] }

export function formatTagAnnotationMessage(
  plan: Pick<PluginTagPlan, 'pluginName' | 'version'>,
  template?: string,
): string {
  return template === undefined
    ? `${plan.pluginName} ${plan.version}`
    : template.replaceAll('%s', plan.version)
}

export function buildPluginReleaseTag(name: string, version: string): string {
  return `${name}--v${version}`
}

async function runGit(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      timeout: 30_000,
    })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string }
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      stderr: typeof e.stderr === 'string' ? e.stderr : errorMessage(err),
    }
  }
}

async function readPluginManifestFromTarget(targetPath: string): Promise<
  | {
      ok: true
      pluginRoot: string
      manifestPath: string
      manifest: Record<string, unknown>
    }
  | { ok: false; error: string }
> {
  let abs = resolve(targetPath)
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(abs)
    abs = await realpath(abs).catch(() => abs)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return {
      ok: false,
      error:
        code === 'ENOENT'
          ? `Path not found: ${abs}`
          : `Cannot stat ${abs}: ${errorMessage(err)}`,
    }
  }

  const candidates: Array<[string, string]> = info.isFile()
    ? [[dirname(dirname(abs)), abs]]
    : [
        [abs, join(abs, '.claude-plugin', 'plugin.json')],
        [dirname(abs), join(abs, 'plugin.json')],
      ]

  for (const [pluginRoot, manifestPath] of candidates) {
    let raw: string
    try {
      raw = await readFile(manifestPath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      return {
        ok: false,
        error: `Cannot read ${manifestPath}: ${errorMessage(err)}`,
      }
    }
    const parsed = safeParseJSON(raw, false)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: `Invalid JSON in ${manifestPath}` }
    }
    return {
      ok: true,
      pluginRoot,
      manifestPath,
      manifest: parsed as Record<string, unknown>,
    }
  }

  return {
    ok: false,
    error: `No plugin manifest found. Expected ${join(abs, '.claude-plugin', 'plugin.json')}.`,
  }
}

async function findEnclosingMarketplaceEntry(
  pluginRoot: string,
  pluginName: string,
  gitRoot: string | null,
): Promise<PluginTagPlan['marketplace'] | undefined> {
  let dir = pluginRoot
  for (;;) {
    const mpPath = join(dir, '.claude-plugin', 'marketplace.json')
    try {
      const raw = await readFile(mpPath, 'utf8')
      const parsed = safeParseJSON(raw, false) as {
        plugins?: Array<{ name?: string; version?: string; source?: unknown }>
      } | null
      if (parsed && Array.isArray(parsed.plugins)) {
        for (let i = 0; i < parsed.plugins.length; i++) {
          const entry = parsed.plugins[i]
          if (entry && entry.name === pluginName) {
            return {
              path: mpPath,
              entryIndex: i,
              entryVersion:
                typeof entry.version === 'string' && entry.version.length > 0
                  ? entry.version
                  : undefined,
            }
          }
        }
      }
    } catch {
      // No marketplace.json at this directory level
    }
    if (gitRoot && dir === gitRoot) return undefined
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export async function planPluginTag(
  targetPath: string = '.',
  options: { force?: boolean } = {},
): Promise<PlanPluginTagResult> {
  const warnings: string[] = []
  const manifestRes = await readPluginManifestFromTarget(targetPath)
  if (!manifestRes.ok) {
    return { ok: false, error: manifestRes.error, warnings }
  }
  const { pluginRoot, manifestPath, manifest } = manifestRes

  const pluginName = manifest.name
  if (typeof pluginName !== 'string' || pluginName.length === 0) {
    return {
      ok: false,
      error: `plugin.json at ${manifestPath} has no "name" field`,
      warnings,
    }
  }

  const gitTopRes = await runGit([
    '-C',
    pluginRoot,
    'rev-parse',
    '--show-toplevel',
  ])
  const gitRoot =
    gitTopRes.code === 0 && gitTopRes.stdout.trim().length > 0
      ? gitTopRes.stdout.trim()
      : null

  const marketplace = await findEnclosingMarketplaceEntry(
    pluginRoot,
    pluginName,
    gitRoot,
  )

  const manifestVersion =
    typeof manifest.version === 'string' && manifest.version.length > 0
      ? manifest.version
      : undefined
  let version: string
  let versionFrom: 'plugin.json' | 'marketplace entry'
  if (manifestVersion !== undefined) {
    version = manifestVersion
    versionFrom = 'plugin.json'
  } else if (marketplace?.entryVersion) {
    version = marketplace.entryVersion
    versionFrom = 'marketplace entry'
  } else {
    const relManifest = relative(getCwd(), manifestPath) || manifestPath
    const mpSuffix = marketplace
      ? ` or in the marketplace entry at ${relative(getCwd(), marketplace.path)} plugins[${marketplace.entryIndex}].`
      : '.'
    return {
      ok: false,
      error: `No version to tag. Set "version" in ${relManifest}${mpSuffix} Tags are only used for dependency version constraints and for finding an older version that fits this Claude Code, which require an explicit semver — the git-SHA fallback does not need a tag.`,
      warnings,
    }
  }

  if (
    marketplace?.entryVersion &&
    manifestVersion !== undefined &&
    marketplace.entryVersion !== manifestVersion
  ) {
    const relMp = relative(getCwd(), marketplace.path) || marketplace.path
    return {
      ok: false,
      error: `Version mismatch: plugin.json says "${manifestVersion}" but ${relMp} plugins[${marketplace.entryIndex}].version says "${marketplace.entryVersion}". plugin.json wins at install time, so update the marketplace entry to "${manifestVersion}" (or remove it) before tagging.`,
      warnings,
    }
  }

  if (!SEMVER_RE.test(version)) {
    return {
      ok: false,
      error: `Version "${version}" is not valid semver. Dependency resolution (resolveVersionRange) ignores tags whose suffix doesn't parse as semver, so this tag would never be selected.`,
      warnings,
    }
  }

  const tag = buildPluginReleaseTag(pluginName, version)
  if (INVALID_GIT_REF_RE.test(tag)) {
    return {
      ok: false,
      error: `Computed tag name "${tag}" is not a valid git ref. Check the plugin name for characters git rejects (spaces, ~, ^, :, ?, *, [, \\, or sequences like .., @{, //).`,
      warnings,
    }
  }

  if (gitRoot === null) {
    return {
      ok: false,
      error: `${pluginRoot} is not inside a git repository. Dependency tags are resolved via git ls-remote, so the plugin must live in a git repo.`,
      warnings,
    }
  }

  if (!options.force) {
    const relPaths = [
      relative(gitRoot, pluginRoot) || '.',
      ...(marketplace ? [relative(gitRoot, marketplace.path)] : []),
    ]
    const statusRes = await runGit([
      '-C',
      gitRoot,
      '--no-optional-locks',
      'status',
      '--porcelain',
      '--',
      ...relPaths,
    ])
    const dirty = statusRes.stdout
      .split('\n')
      .map(line => line.slice(3).trim())
      .filter(Boolean)
    if (dirty.length > 0) {
      const shown = dirty.slice(0, 5).join('\n  ')
      const extra = dirty.length > 5 ? `\n  …and ${dirty.length - 5} more` : ''
      return {
        ok: false,
        error: `Uncommitted changes affecting this release — commit them first so the tag points at the version you intend to release (or use --force):\n  ${shown}${extra}`,
        warnings,
      }
    }

    const existingTag = await runGit(['-C', gitRoot, 'tag', '-l', '--', tag])
    if (existingTag.code === 0 && existingTag.stdout.trim() === tag) {
      return {
        ok: false,
        error: `Tag "${tag}" already exists locally. Bump the version in ${versionFrom}, or re-run with --force to move the tag.`,
        warnings,
      }
    }
  }

  return {
    ok: true,
    warnings,
    plan: {
      pluginName,
      version,
      versionFrom,
      tag,
      pluginRoot,
      gitRoot,
      marketplace,
    },
  }
}

export async function createPluginGitTag(
  plan: PluginTagPlan,
  options: {
    push?: boolean
    force?: boolean
    message?: string
    remote?: string
  } = {},
): Promise<{ ok: true; pushed: boolean } | { ok: false; error: string }> {
  const remote = options.remote ?? 'origin'
  const force = options.force === true
  const annotation = formatTagAnnotationMessage(plan, options.message)

  const tagArgs = ['-C', plan.gitRoot, 'tag']
  if (force) tagArgs.push('-f')
  tagArgs.push('-a', '-m', annotation, '--', plan.tag, 'HEAD')

  const tagRes = await runGit(tagArgs)
  if (tagRes.code !== 0) {
    return {
      ok: false,
      error: `git tag failed (exit ${tagRes.code}): ${tagRes.stderr.trim() || tagRes.stdout.trim()}`,
    }
  }

  if (!options.push) {
    return { ok: true, pushed: false }
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remote)) {
    return {
      ok: false,
      error: `Tag created locally but not pushed: "${remote}" is not a valid remote name.`,
    }
  }

  const pushArgs = ['-C', plan.gitRoot, 'push']
  if (force) pushArgs.push('--force')
  pushArgs.push(remote, `refs/tags/${plan.tag}`)

  const pushRes = await runGit(pushArgs)
  if (pushRes.code !== 0) {
    return {
      ok: false,
      error: `Tag created locally but push failed (exit ${pushRes.code}): ${pushRes.stderr.trim() || pushRes.stdout.trim()}`,
    }
  }
  return { ok: true, pushed: true }
}

export async function pluginTagHandler(
  targetPath: string | undefined,
  options: {
    push?: boolean
    dryRun?: boolean
    force?: boolean
    message?: string
    remote?: string
  } = {},
): Promise<void> {
  const planned = await planPluginTag(targetPath ?? '.', {
    force: options.force,
  })
  for (const warn of planned.warnings) {
    process.stderr.write(`Warning: ${warn}\n`)
  }
  if (!planned.ok) {
    return cliError(planned.error)
  }

  const { plan } = planned
  const remote = options.remote ?? 'origin'
  const force = options.force === true
  const annotation = formatTagAnnotationMessage(plan, options.message)
  const pushCmd = `git -C ${plan.gitRoot} push ${force ? '--force ' : ''}${remote} refs/tags/${plan.tag}`

  const lines: string[] = [
    `Plugin:  ${plan.pluginName}`,
    `Version: ${plan.version} (from ${plan.versionFrom})`,
  ]
  if (plan.marketplace) {
    lines.push(
      `Marketplace entry: plugins[${plan.marketplace.entryIndex}] in ${plan.marketplace.path}${plan.marketplace.entryVersion ? ` (version: ${plan.marketplace.entryVersion})` : ''}`,
    )
  }
  lines.push(`Tag:     ${plan.tag}`, '')

  if (options.dryRun) {
    lines.push(
      `Dry run — would create tag ${plan.tag} at HEAD in ${plan.gitRoot}`,
      `  git -C ${plan.gitRoot} tag ${force ? '-f ' : ''}-a ${plan.tag} -m ${JSON.stringify(annotation)}`,
      `  ${pushCmd}`,
    )
    return cliOk(lines.join('\n'))
  }

  const created = await createPluginGitTag(plan, {
    push: options.push,
    force,
    message: options.message,
    remote,
  })
  if (!created.ok) {
    return cliError(created.error)
  }
  lines.push(`Created tag ${plan.tag}`)
  if (created.pushed) {
    lines.push(`Pushed to ${remote}`)
  } else {
    lines.push(`  Push with: ${pushCmd}`)
  }
  return cliOk(lines.join('\n'))
}
