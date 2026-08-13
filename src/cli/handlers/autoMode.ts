/**
 * Auto mode subcommand handlers — dump default/merged classifier rules and
 * critique user-written rules. Dynamically imported when `claude auto-mode ...` runs.
 *
 * densable 2.1.212: autoModeResetHandler (PbS) — remove autoMode from userSettings.
 */

import { createInterface } from 'readline'
import { isPoorModeActive } from '../../commands/poor/poorMode.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage, isENOENT } from '../../utils/errors.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { safeParseJSON } from '../../utils/json.js'
import {
  getMainLoopModel,
  getSmallFastModel,
  parseUserSpecifiedModel,
} from '../../utils/model/model.js'
import {
  type AutoModeRules,
  buildDefaultExternalSystemPrompt,
  getDefaultExternalAutoModeRules,
} from '../../utils/permissions/yoloClassifier.js'
import {
  getAutoModeConfig,
  getSettingsFilePathForSource,
  getSettingsForSource,
  parseSettingsFile,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import type { ValidationError } from '../../utils/settings/validation.js'
import { sideQuery } from '../../utils/sideQuery.js'
import { jsonStringify } from '../../utils/slowOperations.js'

function writeRules(rules: AutoModeRules): void {
  process.stdout.write(jsonStringify(rules, null, 2) + '\n')
}

export function autoModeDefaultsHandler(): void {
  writeRules(getDefaultExternalAutoModeRules())
}

/**
 * Dump the effective auto mode config: user settings where provided, external
 * defaults otherwise. Per-section REPLACE semantics — matches how
 * buildYoloSystemPrompt resolves the external template (a non-empty user
 * section replaces that section's defaults entirely; an empty/absent section
 * falls through to defaults).
 */
export function autoModeConfigHandler(): void {
  const config = getAutoModeConfig()
  const defaults = getDefaultExternalAutoModeRules()
  writeRules({
    allow: config?.allow?.length ? config.allow : defaults.allow,
    soft_deny: config?.soft_deny?.length
      ? config.soft_deny
      : defaults.soft_deny,
    hard_deny: config?.hard_deny?.length
      ? config.hard_deny
      : defaults.hard_deny,
    environment: config?.environment?.length
      ? config.environment
      : defaults.environment,
  })
}

const CRITIQUE_SYSTEM_PROMPT =
  'You are an expert reviewer of auto mode classifier rules for Claude Code.\n' +
  '\n' +
  'Claude Code has an "auto mode" that uses an AI classifier to decide whether ' +
  'tool calls should be auto-approved or require user confirmation. Users can ' +
  'write custom rules in four categories:\n' +
  '\n' +
  '- **allow**: Actions the classifier should auto-approve\n' +
  '- **soft_deny**: Actions the classifier should block (require user confirmation; user intent can clear)\n' +
  '- **hard_deny**: Security-boundary actions the classifier should block unconditionally (user intent does not clear these)\n' +
  "- **environment**: Context about the user's setup that helps the classifier make decisions\n" +
  '\n' +
  "Your job is to critique the user's custom rules for clarity, completeness, " +
  'and potential issues. The classifier is an LLM that reads these rules as ' +
  'part of its system prompt.\n' +
  '\n' +
  'For each rule, evaluate:\n' +
  '1. **Clarity**: Is the rule unambiguous? Could the classifier misinterpret it?\n' +
  "2. **Completeness**: Are there gaps or edge cases the rule doesn't cover?\n" +
  '3. **Conflicts**: Do any of the rules conflict with each other?\n' +
  '4. **Actionability**: Is the rule specific enough for the classifier to act on?\n' +
  '\n' +
  'Be concise and constructive. Only comment on rules that could be improved. ' +
  'If all rules look good, say so.'

export async function autoModeCritiqueHandler(options: {
  model?: string
}): Promise<void> {
  const config = getAutoModeConfig()
  const hasCustomRules =
    (config?.allow?.length ?? 0) > 0 ||
    (config?.soft_deny?.length ?? 0) > 0 ||
    (config?.hard_deny?.length ?? 0) > 0 ||
    (config?.environment?.length ?? 0) > 0

  if (!hasCustomRules) {
    process.stdout.write(
      'No custom auto mode rules found.\n\n' +
        'Add rules to your settings file under autoMode.{allow, soft_deny, hard_deny, environment}.\n' +
        'Run `claude auto-mode defaults` to see the default rules for reference.\n',
    )
    return
  }

  const model = options.model
    ? parseUserSpecifiedModel(options.model)
    : isPoorModeActive()
      ? getSmallFastModel()
      : getMainLoopModel()

  const defaults = getDefaultExternalAutoModeRules()
  const classifierPrompt = buildDefaultExternalSystemPrompt()

  const userRulesSummary =
    formatRulesForCritique('allow', config?.allow ?? [], defaults.allow) +
    formatRulesForCritique(
      'soft_deny',
      config?.soft_deny ?? [],
      defaults.soft_deny,
    ) +
    formatRulesForCritique(
      'hard_deny',
      config?.hard_deny ?? [],
      defaults.hard_deny,
    ) +
    formatRulesForCritique(
      'environment',
      config?.environment ?? [],
      defaults.environment,
    )

  process.stdout.write('Analyzing your auto mode rules…\n\n')

  let response
  try {
    response = await sideQuery({
      querySource: 'auto_mode_critique',
      model,
      system: CRITIQUE_SYSTEM_PROMPT,
      skipSystemPromptPrefix: true,
      // densable 2.1.229 forceAttributionHeader for auto-mode classifier
      forceAttributionHeader: true,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content:
            'Here is the full classifier system prompt that the auto mode classifier receives:\n\n' +
            '<classifier_system_prompt>\n' +
            classifierPrompt +
            '\n</classifier_system_prompt>\n\n' +
            "Here are the user's custom rules that REPLACE the corresponding default sections:\n\n" +
            userRulesSummary +
            '\nPlease critique these custom rules.',
        },
      ],
    })
  } catch (error) {
    process.stderr.write(
      'Failed to analyze rules: ' + errorMessage(error) + '\n',
    )
    process.exitCode = 1
    return
  }

  const textBlock = response.content.find(block => block.type === 'text')
  if (textBlock?.type === 'text') {
    process.stdout.write(textBlock.text + '\n')
  } else {
    process.stdout.write('No critique was generated. Please try again.\n')
  }
}

function formatRulesForCritique(
  section: string,
  userRules: string[],
  defaultRules: string[],
): string {
  if (userRules.length === 0) return ''
  const customLines = userRules.map(r => '- ' + r).join('\n')
  const defaultLines = defaultRules.map(r => '- ' + r).join('\n')
  return (
    '## ' +
    section +
    ' (custom rules replacing defaults)\n' +
    'Custom:\n' +
    customLines +
    '\n\n' +
    'Defaults being replaced:\n' +
    defaultLines +
    '\n\n'
  )
}

function logReset(
  reason: string,
  extra?: Record<string, number | boolean | undefined>,
): void {
  logEvent('cli_auto_mode_reset', {
    reason:
      reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...extra,
  })
}

/**
 * densable PbS — `claude auto-mode reset [--yes]`
 * Removes the autoMode section from userSettings only (1:1 densable body).
 *
 * densable body (2.1.212):
 *   path = Lh("userSettings"); raw read; invalid JSON refuse;
 *   autoMode undefined → already defaults + EYf;
 *   IU(path) lossy warnings; --yes + lossy → refuse;
 *   list removals; confirm unless --yes; Yf delete autoMode; success + EYf.
 */
export async function autoModeResetHandler(options: {
  yes?: boolean
}): Promise<void> {
  const path = getSettingsFilePathForSource('userSettings')
  if (!path) {
    logReset('no_user_settings_path')
    process.stderr.write('Could not resolve the user settings file path.\n')
    process.exitCode = 1
    return
  }

  // densable: raw read; ENOENT → empty file; other errors → unreadable
  let rawContent: string | null = null
  try {
    rawContent = getFsImplementation().readFileSync(path, {
      encoding: 'utf-8',
    }) as string
  } catch (e) {
    if (!isENOENT(e)) {
      logReset('settings_file_unreadable')
      process.stderr.write(`Could not read ${path}: ${errorMessage(e)}\n`)
      process.exitCode = 1
      return
    }
  }

  const nonEmpty = rawContent !== null && rawContent.trim() !== ''
  const parsed = nonEmpty ? safeParseJSON(rawContent, false) : null
  // densable: non-empty file that is not a plain object → invalid
  if (nonEmpty && !isPlainObject(parsed)) {
    logReset('settings_file_invalid')
    process.stderr.write(invalidJsonResetMessage(path))
    process.exitCode = 1
    return
  }

  const autoMode = isPlainObject(parsed) ? parsed.autoMode : undefined
  if (autoMode === undefined) {
    process.stdout.write(
      `Auto mode configuration is already at defaults — ${path} has no autoMode section.\n`,
    )
    noteOtherAutoModeSources()
    logReset('already_default')
    return
  }

  // densable IU(t):
  //   a = s.settings === null ? [] : s.errors.filter(c => c.severity === "warning")
  // Local ValidationError has no top-level severity; when settings still load,
  // remaining errors are ruleWarnings / soft lossy issues only (filterInvalidPermissionRules).
  // When settings is null (fatal schema), densable treats lossy list as empty.
  const { settings: validated, errors } = parseSettingsFile(path)
  const unparseableEntries =
    validated === null ? [] : collectLossyEntryPaths(errors)

  // densable: --yes + lossy entries → refuse without writing
  if (unparseableEntries.length > 0 && options.yes) {
    logReset('lossy_write_unconfirmed')
    const n = unparseableEntries.length
    const entryWord = n === 1 ? 'entry' : 'entries'
    const itThem = n === 1 ? 'it' : 'them'
    const thatThose = n === 1 ? 'that entry' : 'those entries'
    process.stderr.write(
      `Not resetting: ${path} also contains ${n} ${entryWord} this version of Claude Code cannot parse (${unparseableEntries.join(', ')}), and saving the file would delete ${itThem} too. Fix or remove ${thatThose} first, or run the command without --yes to review and confirm.\n`,
    )
    process.exitCode = 1
    return
  }

  process.stdout.write(
    `This resets auto mode to the shipped defaults by removing the autoMode section from ${path}:\n`,
  )
  for (const line of describeAutoModeBlock(autoMode)) {
    process.stdout.write(`  - ${line}\n`)
  }
  if (unparseableEntries.length > 0) {
    const n = unparseableEntries.length
    const entryWord = n === 1 ? 'entry' : 'entries'
    process.stdout.write(
      `Saving will ALSO delete ${n} ${entryWord} this version of Claude Code cannot parse — the settings writer rewrites the file from its validated view:\n`,
    )
    for (const entry of unparseableEntries) {
      process.stdout.write(`  - ${entry}\n`)
    }
  }

  if (!options.yes) {
    const ok = await promptYesNo('Reset auto mode configuration to defaults?')
    if (!ok) {
      logReset('declined')
      process.stderr.write('Aborted.\n')
      process.exitCode = 1
      return
    }
  }

  const { error } = updateSettingsForSource('userSettings', {
    autoMode: undefined,
  } as never)

  if (error) {
    logForDebugging(`auto-mode reset write failed: ${error.message}`, {
      level: 'error',
    })
    const mapped = mapWriteError(error, path)
    logReset(mapped.code)
    process.stderr.write(mapped.message + '\n')
    process.exitCode = 1
    return
  }

  logReset('success')
  process.stdout.write(
    `Auto mode configuration reset to defaults — autoMode section removed from ${path}. Run \`claude auto-mode config\` to see the effective rules.\n`,
  )
  noteOtherAutoModeSources()
}

/**
 * densable IU warning paths when settings still validated:
 *   s.settings === null ? [] : s.errors.filter(c => c.severity === "warning")
 * Local ruleWarnings lack severity; when settings non-null they are the soft
 * lossy set. Skip mcp fatal severity if present.
 */
function collectLossyEntryPaths(errors: ValidationError[]): string[] {
  const paths: string[] = []
  for (const e of errors) {
    if (e.mcpErrorMetadata?.severity === 'fatal') continue
    const p = e.path || 'unknown entry'
    if (!paths.includes(p)) paths.push(p)
  }
  return paths
}

function invalidJsonResetMessage(path: string): string {
  return `The settings file at ${path} contains invalid JSON — fix or remove it, then re-run reset.\n`
}

/** densable Sbs / bbs */
function mapWriteError(
  error: Error,
  path: string,
): { code: string; message: string } {
  if (error.message.includes('Invalid JSON syntax')) {
    return {
      code: 'settings_file_invalid',
      message: invalidJsonResetMessage(path).replace(/\n$/, ''),
    }
  }
  return {
    code: 'write_failed',
    message: `Could not write ${path} — check file permissions and disk space (run with --debug for the underlying error).`,
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** densable wYf */
function describeAutoModeBlock(autoMode: unknown): string[] {
  if (!isPlainObject(autoMode)) {
    return ['autoMode (unrecognized value)']
  }
  return Object.entries(autoMode).map(([key, value]) =>
    Array.isArray(value)
      ? `${key} (${value.length} ${value.length === 1 ? 'entry' : 'entries'})`
      : key,
  )
}

/** densable EYf — note non-user sources that still contribute autoMode */
function noteOtherAutoModeSources(): void {
  for (const source of ['policySettings', 'flagSettings'] as const) {
    const settings = getSettingsForSource(source)
    if (
      settings &&
      typeof settings === 'object' &&
      (settings as { autoMode?: unknown }).autoMode !== undefined
    ) {
      process.stdout.write(
        'Note: auto mode rules from managed or --settings flag sources still apply — reset only changes your user settings file.\n',
      )
      return
    }
  }
}

async function promptYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      `${question} [y/N]\n(non-interactive stdin; pass --yes to confirm)\n`,
    )
    return false
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await new Promise<string>(resolve => {
      rl.question(`${question} [y/N] `, resolve)
    })
    const n = answer.trim().toLowerCase()
    return n === 'y' || n === 'yes'
  } finally {
    rl.close()
  }
}
