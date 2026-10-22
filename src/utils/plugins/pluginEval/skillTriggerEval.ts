/**
 * densable `xf` / `yl` / `hl` — evals/*.md trigger tests (query + should_trigger).
 * Gold @217417000. Model scorer is `fl=async()=>null` until wired.
 */
import { readdir, readFile } from 'fs/promises'
import { basename, join } from 'path'
import { homedir } from 'os'
import { errorMessage, isENOENT } from '../../errors.js'
import { FRONTMATTER_REGEX } from '../../frontmatterParser.js'
import { stripBOM } from '../../jsonRead.js'
import { logForDebugging } from '../../debug.js'
import { parseYaml } from '../../yaml.js'
import { z } from 'zod/v4'

const MIN_QUERIES = 5

const querySchema = z.object({
  query: z.string().min(1),
  should_trigger: z.boolean(),
})

export type SkillTriggerQuery = {
  file: string
  query: string
  shouldTrigger: boolean
  notes?: string
}

export type SkillTriggerResult = {
  query: SkillTriggerQuery
  modelWouldTrigger: boolean | null
  reason: string
  verdict: 'pass' | 'fail' | 'skipped'
}

export type SkillTriggerReport = {
  pluginName: string
  pluginPath: string
  evalsPath: string
  queries: SkillTriggerQuery[]
  warnings: string[]
  triggerResults: SkillTriggerResult[]
  passCount: number
  failCount: number
  skippedCount: number
}

type TriggerScorer = (input: {
  skillName: string
  description: string
  query: SkillTriggerQuery
  signal: AbortSignal
}) => Promise<{ wouldTrigger: boolean; reason: string } | null>

/** densable `fl` — model evaluation not yet wired. */
const pendingScorer: TriggerScorer = async () => null

async function loadSkillDescription(pluginPath: string): Promise<string> {
  try {
    const raw = stripBOM(await readFile(join(pluginPath, 'SKILL.md'), 'utf8'))
    const match = raw.match(FRONTMATTER_REGEX)
    if (!match) return ''
    const parsed = parseYaml(match[1] ?? '')
    if (
      parsed &&
      typeof parsed === 'object' &&
      'description' in parsed &&
      typeof (parsed as { description: unknown }).description === 'string'
    ) {
      return (parsed as { description: string }).description
    }
  } catch {
    // gold swallows
  }
  return ''
}

/** densable `xf`. */
export async function loadSkillTriggerQueries(evalsPath: string): Promise<{
  queries: SkillTriggerQuery[]
  warnings: string[]
}> {
  const queries: SkillTriggerQuery[] = []
  const warnings: string[] = []
  let names: string[]
  try {
    names = await readdir(evalsPath)
  } catch (error) {
    if (isENOENT(error)) {
      return {
        queries: [],
        warnings: [
          `No evals/ folder found at ${evalsPath}. Create one with at least ${MIN_QUERIES} <name>.md files (frontmatter: query, should_trigger).`,
        ],
      }
    }
    throw error
  }
  for (const file of names.filter(n => n.endsWith('.md')).sort()) {
    const path = join(evalsPath, file)
    let raw: string
    try {
      raw = stripBOM(await readFile(path, 'utf8'))
    } catch (error) {
      warnings.push(`Could not read ${file}: ${errorMessage(error)}`)
      continue
    }
    const match = raw.match(FRONTMATTER_REGEX)
    if (!match) {
      warnings.push(
        `${file}: missing YAML frontmatter (expected ---\\nquery: …\\nshould_trigger: …\\n---).`,
      )
      continue
    }
    let yaml: unknown
    try {
      yaml = parseYaml(match[1] ?? '')
    } catch (error) {
      warnings.push(`${file}: invalid YAML — ${errorMessage(error)}`)
      continue
    }
    const parsed = querySchema.safeParse(yaml)
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map(issue => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')
      warnings.push(`${file}: ${issues}`)
      continue
    }
    const notes = raw.slice(match[0].length).trim()
    queries.push({
      file,
      query: parsed.data.query,
      shouldTrigger: parsed.data.should_trigger,
      ...(notes ? { notes } : {}),
    })
  }
  if (queries.length > 0 && queries.length < MIN_QUERIES) {
    warnings.push(
      `Only ${queries.length} eval ${queries.length === 1 ? 'query' : 'queries'} found; the spec recommends at least ${MIN_QUERIES} for meaningful coverage.`,
    )
  }
  return { queries, warnings }
}

/** densable `yl`. */
export async function runSkillTriggerEval(
  target: string,
  signal: AbortSignal,
  scorer: TriggerScorer = pendingScorer,
): Promise<SkillTriggerReport> {
  const pluginPath =
    target === '~' || target.startsWith('~/')
      ? join(homedir(), target.slice(1))
      : target
  const resolved = join(pluginPath)
  const pluginName = basename(resolved)
  const description = await loadSkillDescription(resolved)
  const evalsPath = join(resolved, 'evals')
  const { queries, warnings } = await loadSkillTriggerQueries(evalsPath)
  const triggerResults: SkillTriggerResult[] = []
  for (const query of queries) {
    if (signal.aborted) break
    try {
      const scored = await scorer({
        skillName: pluginName,
        description,
        query,
        signal,
      })
      if (scored === null) {
        triggerResults.push({
          query,
          modelWouldTrigger: null,
          reason:
            'Model evaluation not yet wired up — tracks the plugin evaluation framework.',
          verdict: 'skipped',
        })
        continue
      }
      triggerResults.push({
        query,
        modelWouldTrigger: scored.wouldTrigger,
        reason: scored.reason,
        verdict: scored.wouldTrigger === query.shouldTrigger ? 'pass' : 'fail',
      })
    } catch (error) {
      logForDebugging(
        `plugin eval: trigger test for ${query.file} threw: ${errorMessage(error)}`,
        { level: 'error' },
      )
      triggerResults.push({
        query,
        modelWouldTrigger: null,
        reason: errorMessage(error),
        verdict: 'fail',
      })
    }
  }
  return {
    pluginName,
    pluginPath: resolved,
    evalsPath,
    queries,
    warnings,
    triggerResults,
    passCount: triggerResults.filter(r => r.verdict === 'pass').length,
    failCount: triggerResults.filter(r => r.verdict === 'fail').length,
    skippedCount: triggerResults.filter(r => r.verdict === 'skipped').length,
  }
}

/** densable `hl`. */
export function formatSkillTriggerReport(report: SkillTriggerReport): string {
  const lines: string[] = [
    `Evaluating ${report.pluginName} (${report.evalsPath})`,
    '',
  ]
  for (const warning of report.warnings) lines.push(`! ${warning}`)
  if (report.warnings.length > 0) lines.push('')
  if (report.queries.length === 0) {
    lines.push('No eval queries to run.')
    return lines.join('\n')
  }
  lines.push('Level 1 — trigger tests:')
  for (const row of report.triggerResults) {
    const tag = row.verdict.toUpperCase().padEnd(7)
    const expected = row.query.shouldTrigger ? 'trigger' : 'skip'
    if (row.verdict === 'skipped') {
      lines.push(`  [${tag}] ${row.query.file} — expected ${expected}`)
      continue
    }
    const got = row.modelWouldTrigger ? 'trigger' : 'skip'
    lines.push(
      `  [${tag}] ${row.query.file} — expected ${expected}, got ${got}`,
    )
    if (row.verdict === 'fail') lines.push(`            ${row.reason}`)
  }
  lines.push('')
  if (report.skippedCount === report.triggerResults.length) {
    lines.push('All trigger tests skipped — model evaluation not yet wired up.')
  } else {
    const ran = report.passCount + report.failCount
    lines.push(
      `${report.passCount}/${ran} trigger tests passed${
        report.skippedCount > 0 ? ` (${report.skippedCount} skipped)` : ''
      }.`,
    )
  }
  lines.push('')
  lines.push(
    'Level 2 — interplay tests: not yet implemented. Tracks the plugin evaluation framework.',
  )
  return lines.join('\n')
}
