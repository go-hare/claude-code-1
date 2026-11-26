import {
  getFlagSettingsInline,
  setFlagSettingsInline,
} from '../../bootstrap/state.js'
import {
  type AttributionProjectResolution,
  normalizeAttributionProjectId,
  resolveAttributionProject,
} from '../../services/api/client.js'
import type { LocalCommandCall } from '../../types/command.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import {
  getSettingsFilePathForSource,
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { isAttributionProjectEligible } from './index.js'

const SAVE_FLAG = '--save'
const APPLY_FALLBACK_MSG =
  "Claude Code couldn't apply that Project here. Set CLAUDE_CODE_ATTRIBUTION_PROJECT when you start it instead."

const CLAUDE_PROJECT_URL_RE =
  /^(?:https:\/\/)?claude\.ai\/(?:code\/)?project\/([^/?#]+)\/?(?:[?#].*)?$/i

export function extractProjectIdInput(raw: string): string {
  const match = CLAUDE_PROJECT_URL_RE.exec(raw.trim())
  return match?.[1] ?? raw.trim()
}

function getInlineFlagAttributionProject(): string | undefined {
  const inline = getFlagSettingsInline()
  return typeof inline?.attributionProject === 'string'
    ? inline.attributionProject
    : undefined
}

function setInlineFlagAttributionProject(value: string | undefined): void {
  const existing = getFlagSettingsInline() ?? {}
  const { attributionProject: _prev, ...rest } = existing
  const next =
    value === undefined ? rest : { ...rest, attributionProject: value }
  setFlagSettingsInline(Object.keys(next).length > 0 ? next : null)
  resetSettingsCache()
}

function formatSourceLabel(source: string): string {
  switch (source) {
    case 'harness':
      return 'CLAUDE_CODE_ATTRIBUTION_PROJECT'
    case 'admin_default':
      return "your organization's default"
    case 'user':
      return (
        getSettingsFilePathForSource('userSettings') ??
        '~/.claude/settings.json'
      )
    case 'project':
      return '.claude/settings.json'
    case 'local':
      return '.claude/settings.local.json'
    case 'flag':
      return getInlineFlagAttributionProject() === undefined
        ? '--settings'
        : 'set with /project'
    case 'managed':
      return 'managed settings'
    default:
      return source
  }
}

function formatIgnoredLabel(source: string): string {
  switch (source) {
    case 'harness':
      return 'CLAUDE_CODE_ATTRIBUTION_PROJECT'
    case 'admin_default':
      return "your organization's default Project"
    case 'flag':
      return 'attributionProject in --settings'
    default:
      return `attributionProject in ${formatSourceLabel(source)}`
  }
}

function formatResolutionStatus(res: AttributionProjectResolution): string {
  if (res.project !== undefined) {
    const name = res.written ?? res.project.taggedId
    const [firstIgnored] = res.ignored
    const ignoredSuffix =
      firstIgnored === undefined
        ? ''
        : `; ignored the invalid ${formatIgnoredLabel(firstIgnored)}`
    const origin = `${formatSourceLabel(res.project.source)}${ignoredSuffix}`
    return `This session names claude.ai Project ${name} for usage reports (${origin}).`
  }
  const [firstIgnored] = res.ignored
  if (firstIgnored === undefined) {
    return 'This session names no claude.ai Project for usage reports.'
  }
  return `This session names no claude.ai Project for usage reports (skipped ${formatIgnoredLabel(firstIgnored)}, which isn't a Project ID).`
}

function formatPrecedenceNotice(
  res: AttributionProjectResolution,
): string | undefined {
  if (res.project?.source === 'harness') {
    return 'That variable was set when Claude Code started and takes precedence over /project. To use /project, start Claude Code without it.'
  }
  const policySettings = getSettingsForSource('policySettings')
  if (policySettings?.attributionProject !== undefined) {
    return 'Managed settings stop /project from setting a Project. Ask your administrator to change them.'
  }
  return undefined
}

function formatUsageHint(
  res: AttributionProjectResolution,
  isInteractive: boolean,
): string {
  const base = isInteractive
    ? 'Run /project <Project ID or claude.ai address> to set a Project, and add --save to keep it for this folder.'
    : 'Run /project <Project ID or claude.ai address> to set a Project.'
  if (getInlineFlagAttributionProject() !== undefined) {
    return `${base} Run /project clear to remove it.`
  }
  if (res.project?.source === 'local' && isInteractive) {
    return `${base} Run /project clear --save to remove it.`
  }
  return base
}

function readCurrentResolution(): AttributionProjectResolution {
  return resolveAttributionProject({
    getSourceSettings: source => {
      if (source === 'flagSettings') {
        return (
          (getFlagSettingsInline() as Record<string, unknown> | null) ??
          (getSettingsForSource('flagSettings') as Record<
            string,
            unknown
          > | null)
        )
      }
      return getSettingsForSource(source) as Record<string, unknown> | null
    },
  })
}

function saveLocalAttributionProject(value: string | undefined): boolean {
  const { error } = updateSettingsForSource('localSettings', {
    attributionProject: value,
  })
  if (error !== null) {
    logForDebugging(`/project: saving failed: ${errorMessage(error)}`, {
      level: 'error',
    })
  }
  return error === null
}

function textResult(value: string): { type: 'text'; value: string } {
  return { type: 'text', value }
}

export const call: LocalCommandCall = async (args, context) => {
  const tokens = args.split(/\s+/).filter(token => token !== '')
  const wantsSave = tokens.includes(SAVE_FLAG)
  const [firstArg, ...extraArgs] = tokens.filter(token => token !== SAVE_FLAG)
  const isInteractive = !context.options?.isNonInteractiveSession

  if (!isAttributionProjectEligible()) {
    return textResult(
      "This session can't name a Project. That needs your claude.ai login, a direct connection to Anthropic and no cloud session, with CLAUDE_CODE_ATTRIBUTION_HEADER not set to 0.",
    )
  }

  const current = readCurrentResolution()

  if (extraArgs.length > 0 || (firstArg === undefined && wantsSave)) {
    return textResult(
      `Nothing changed. ${formatUsageHint(current, isInteractive)}`,
    )
  }

  if (firstArg === undefined) {
    return textResult(
      `${formatResolutionStatus(current)} ${formatPrecedenceNotice(current) ?? formatUsageHint(current, isInteractive)}`,
    )
  }

  const localPath = (
    getSettingsFilePathForSource('localSettings') ??
    '.claude/settings.local.json'
  ).replace(/[\t\n\r]+/g, ' ')

  if (wantsSave && !isInteractive) {
    return textResult(
      `--save isn't available in this kind of session, so nothing changed. To change a saved Project, edit attributionProject in ${localPath}.`,
    )
  }

  if (firstArg === 'clear') {
    const hadSessionProject = getInlineFlagAttributionProject() !== undefined
    setInlineFlagAttributionProject(undefined)

    let saveMsg: string | undefined
    if (wantsSave) {
      const localSaved = getSettingsForSource('localSettings')
      if (localSaved?.attributionProject === undefined) {
        saveMsg = `No Project is saved in ${localPath}.`
      } else if (saveLocalAttributionProject(undefined)) {
        saveMsg = `Removed the Project from ${localPath}.`
      } else {
        saveMsg = `Couldn't remove the Project from ${localPath}. Check that it holds valid JSON and that you can write to it, then try again.`
      }
    }

    const after = readCurrentResolution()
    const clearMsg = hadSessionProject
      ? 'Removed the Project set with /project.'
      : wantsSave
        ? undefined
        : "/project hadn't set a Project, so nothing changed."
    const followUp =
      formatPrecedenceNotice(after) ??
      (after.project?.source === 'local' && isInteractive && !wantsSave
        ? 'To remove it, run /project clear --save.'
        : undefined)

    return textResult(
      [clearMsg, saveMsg, formatResolutionStatus(after), followUp]
        .filter((part): part is string => part !== undefined)
        .join(' '),
    )
  }

  const projectInput = extractProjectIdInput(firstArg)
  if (normalizeAttributionProjectId(projectInput) === undefined) {
    return textResult(
      "That isn't a Project /project can use, so nothing changed. Use a claude.ai Project whose address looks like https://claude.ai/project/<ID> or https://claude.ai/code/project/<ID>, or its ID.",
    )
  }

  const prevInline = getInlineFlagAttributionProject()
  setInlineFlagAttributionProject(projectInput)

  let after: AttributionProjectResolution
  try {
    after = readCurrentResolution()
  } catch (err) {
    setInlineFlagAttributionProject(prevInline)
    logForDebugging(`/project: reading back failed: ${errorMessage(err)}`, {
      level: 'error',
    })
    return textResult(`Project not changed. ${APPLY_FALLBACK_MSG}`)
  }

  if (after.project?.source !== 'flag' || after.written !== projectInput) {
    setInlineFlagAttributionProject(prevInline)
    const reason = formatPrecedenceNotice(after) ?? APPLY_FALLBACK_MSG
    return textResult(
      `Project not changed. ${formatResolutionStatus(after)} ${reason}`,
    )
  }

  const prefix = `This session now names claude.ai Project ${projectInput} for usage reports`
  if (!wantsSave) {
    const suffix = isInteractive
      ? `To keep it for this folder, run /project ${projectInput} --save.`
      : 'A one-shot claude -p run ends before any request uses this, so set CLAUDE_CODE_ATTRIBUTION_PROJECT for those.'
    return textResult(`${prefix}, until Claude Code restarts. ${suffix}`)
  }

  if (saveLocalAttributionProject(projectInput)) {
    return textResult(
      `${prefix}. Saved in ${localPath}, which every session in this folder reads.`,
    )
  }
  return textResult(
    `${prefix}, until Claude Code restarts. Couldn't save it in ${localPath}, so new sessions in this folder won't use it. Check that it holds valid JSON and that you can write to it, then try again.`,
  )
}
