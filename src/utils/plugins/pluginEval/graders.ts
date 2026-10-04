/**
 * densable `Hl` graders: regex / tool_order / tool_used / file_exists / llm / baseline.
 */

import { readFile } from 'fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { getSmallFastModel } from '../../model/model.js'
import { sideQuery } from '../../sideQuery.js'
import { getTotalCostUSD } from '../../../bootstrap/state.js'
import { EVAL_ARTIFACTS_DIR } from './constants.js'
import { resolveInsideEvalRoot } from './evalFence.js'
import { PluginEvalPathError } from './pathVet.js'
import type {
  AgentRunResult,
  BaselineGrader,
  FileExistsGrader,
  Grader,
  GraderResult,
  LlmGrader,
  RegexGrader,
  RegexTarget,
  ResolvedCase,
  RunArm,
  ToolCallRecord,
  ToolMatch,
  ToolOrderGrader,
  ToolUsedGrader,
} from './types.js'

const LLM_VOTES = 3

export type GradeRunParams = {
  case_: ResolvedCase
  run: AgentRunResult
  cwdDiff: string
  sandboxCwd: string
  stubPublishDir?: string
  judgeModel?: string
  skipPaidGraders: boolean
  arm?: RunArm
  mockCallsWithOnly?: boolean
  signal: AbortSignal
  credentials?: unknown
}

function fail(grader: Grader, explanation: string): GraderResult {
  return {
    name: grader.name,
    passed: false,
    weight: grader.weight,
    explanation,
  }
}

function globToRegExp(pattern: string): RegExp {
  let out = '^'
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern.charAt(i)
    if (ch === '*') {
      if (pattern.charAt(i + 1) === '*') {
        if (pattern.charAt(i + 2) === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i++
        }
      } else out += '[^/]*'
    } else if (ch === '?') out += '.'
    else if ('.+^${}()|[]\\'.includes(ch)) out += `\\${ch}`
    else out += ch
  }
  return new RegExp(`${out}$`)
}

function toolMatches(call: ToolCallRecord, match: ToolMatch): boolean {
  if (call.name !== match.tool) return false
  if (match.input_match)
    return new RegExp(match.input_match).test(call.inputText)
  return true
}

function firstIndex(calls: ToolCallRecord[], match: ToolMatch): number {
  return calls.findIndex(call => toolMatches(call, match))
}

function isWithOnly(
  grader: Grader,
  mockCallsWithOnly: boolean | undefined,
): boolean {
  if (grader.arm === 'with-only') return true
  if (
    grader.arm === undefined &&
    grader.type === 'tool_used' &&
    grader.tool === 'Skill'
  ) {
    return true
  }
  return (
    mockCallsWithOnly === true &&
    grader.arm === undefined &&
    ((grader.type === 'regex' && grader.target === 'mock_calls') ||
      (grader.type === 'llm' && grader.focus === 'mock_calls'))
  )
}

function targetLabel(target: RegexTarget): string {
  return typeof target === 'object' ? `file ${target.path}` : target
}

/** densable `Im` — relative path under `.eval-artifacts/`, else null. */
export function evalArtifactsRelPath(path: string): string | null {
  const base = resolve('/eval-run-base')
  const resolved = resolve(base, path.replaceAll('\\', '/'))
  const rel = relative(join(base, EVAL_ARTIFACTS_DIR), resolved)
  if (rel === '') return '.'
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return rel.split(sep).join('/')
}

async function focusText(
  target: RegexTarget,
  params: GradeRunParams,
): Promise<
  { kind: 'text'; text: string } | { kind: 'unavailable'; reason: string }
> {
  if (typeof target === 'object') {
    // densable Wl: Im(path) under .eval-artifacts/ → stubPublishDir when
    // granted; ungranted throws reserved-publish copy.
    const underArtifacts = evalArtifactsRelPath(target.path)
    if (underArtifacts !== null && params.stubPublishDir === undefined) {
      throw new PluginEvalPathError(
        `focus file ${target.path} does not exist (artifact publishing was not granted for this run, so nothing was published)`,
        'grader focus file does not exist',
      )
    }
    const root =
      underArtifacts !== null && params.stubPublishDir !== undefined
        ? params.stubPublishDir
        : params.sandboxCwd
    const rel = underArtifacts ?? target.path
    const surface = `case "${params.case_.name}" grader focus file "${target.path}"`
    const rootLabel =
      underArtifacts !== null ? 'stub publish directory' : 'run sandbox'
    try {
      const resolved = await resolveInsideEvalRoot(
        root,
        rel,
        surface,
        rootLabel,
      )
      params.signal.throwIfAborted()
      return { kind: 'text', text: await readFile(resolved, 'utf8') }
    } catch (error) {
      if (error instanceof PluginEvalPathError) throw error
      return {
        kind: 'unavailable',
        reason: `focus file ${target.path} does not exist`,
      }
    }
  }
  if (target === 'last_message')
    return { kind: 'text', text: params.run.lastAssistantText }
  if (target === 'files') return { kind: 'text', text: params.cwdDiff }
  if (target === 'mock_calls') {
    if (params.run.mockTally === null) {
      return {
        kind: 'unavailable',
        reason:
          'no mock stand-ins were active in this run (--mocks off, or no mocks/ directory applies to this case) — a mock_calls grader has nothing to check',
      }
    }
    return {
      kind: 'text',
      text: params.run.toolCalls
        .filter(call => call.mock !== undefined)
        .map(call =>
          JSON.stringify({
            tool: call.name,
            input: call.input,
            ...(call.output !== undefined && { output: call.output }),
            ...(call.isError && { isError: true }),
            verdict: call.mock?.verdict,
          }),
        )
        .join('\n'),
    }
  }
  return {
    kind: 'text',
    text: params.run.trace.map(event => JSON.stringify(event)).join('\n'),
  }
}

async function gradeRegex(
  grader: RegexGrader,
  params: GradeRunParams,
): Promise<GraderResult> {
  const focus = await focusText(grader.target, params)
  const label = targetLabel(grader.target)
  if (focus.kind === 'unavailable') return fail(grader, focus.reason)
  const regex = new RegExp(grader.pattern, grader.flags)
  const globalFlags = grader.flags.includes('g')
    ? grader.flags
    : `${grader.flags}g`
  const matches =
    focus.text.match(new RegExp(grader.pattern, globalFlags)) ?? []
  let passed: boolean
  let explanation: string
  if (grader.match === 'contains') {
    passed = regex.test(focus.text)
    explanation = passed
      ? `matched ${grader.pattern}`
      : `pattern not found in ${label}`
  } else if (grader.match === 'not_contains') {
    passed = !regex.test(focus.text)
    explanation = passed
      ? 'pattern absent as expected'
      : 'pattern found (expected absent)'
  } else if (grader.match.startsWith('count:')) {
    const expected = parseInt(grader.match.slice(6), 10)
    passed = matches.length === expected
    explanation = `found ${matches.length} matches (expected ${expected})`
  } else {
    passed = false
    explanation = `unknown match mode "${grader.match}" (use contains | not_contains | count:N)`
  }
  return { name: grader.name, passed, weight: grader.weight, explanation }
}

function gradeToolOrder(
  grader: ToolOrderGrader,
  params: GradeRunParams,
): GraderResult {
  const before = firstIndex(params.run.toolCalls, grader.before)
  const after = firstIndex(params.run.toolCalls, grader.after)
  if (before === -1)
    return fail(grader, `"before" tool ${grader.before.tool} never called`)
  if (after === -1)
    return fail(grader, `"after" tool ${grader.after.tool} never called`)
  const passed = before < after
  return {
    name: grader.name,
    passed,
    weight: grader.weight,
    explanation: passed
      ? `${grader.before.tool}@${before} precedes ${grader.after.tool}@${after}`
      : `${grader.before.tool}@${before} does NOT precede ${grader.after.tool}@${after}`,
  }
}

function gradeToolUsed(
  grader: ToolUsedGrader,
  params: GradeRunParams,
): GraderResult {
  const match = { tool: grader.tool, input_match: grader.input_match }
  const count = params.run.toolCalls.filter(call =>
    toolMatches(call, match),
  ).length
  const min = grader.min ?? 1
  const max = grader.max ?? Number.POSITIVE_INFINITY
  const passed = count >= min && count <= max
  return {
    name: grader.name,
    passed,
    weight: grader.weight,
    explanation: `${grader.tool} called ${count}x (expected ${min}..${max === Number.POSITIVE_INFINITY ? '∞' : max})`,
  }
}

function gradeFileExists(
  grader: FileExistsGrader,
  params: GradeRunParams,
): GraderResult {
  const re = globToRegExp(grader.path)
  const exists = (params.cwdDiff ?? '')
    .split('\n')
    .filter(line => line.trim())
    .some(line => re.test(line.trim()))
  const passed = exists === grader.exists
  return {
    name: grader.name,
    passed,
    weight: grader.weight,
    explanation: passed
      ? `${grader.path} ${grader.exists ? 'exists' : 'absent'} as expected`
      : `${grader.path} ${exists ? 'exists' : 'missing'} (expected ${grader.exists ? 'present' : 'absent'})`,
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block =>
      typeof block === 'object' &&
      block !== null &&
      'text' in block &&
      typeof (block as { text: unknown }).text === 'string'
        ? (block as { text: string }).text
        : '',
    )
    .join('')
}

async function judgeOnce(
  prompt: string,
  params: GradeRunParams,
): Promise<string> {
  const model = params.judgeModel?.trim() || getSmallFastModel()
  const message = await sideQuery({
    querySource: 'plugin_eval_judge',
    model,
    system: 'You are a strict, terse evaluation judge for coding-agent traces.',
    messages: [{ role: 'user', content: prompt }],
    signal: params.signal,
    skipSystemPromptPrefix: true,
  })
  return extractText(message.content)
}

async function majorityVotes(
  prompt: string,
  params: GradeRunParams,
): Promise<boolean[]> {
  const votes: boolean[] = []
  for (let i = 0; i < LLM_VOTES; i++) {
    const text = await judgeOnce(prompt, params)
    votes.push(/\bPASS\b/i.test(text) && !/\bFAIL\b/i.test(text))
  }
  return votes
}

async function gradeLlm(
  grader: LlmGrader,
  params: GradeRunParams,
): Promise<GraderResult> {
  const focus = await focusText(grader.focus, params)
  if (focus.kind === 'unavailable') return fail(grader, focus.reason)
  const body =
    focus.text === '' && grader.focus === 'files'
      ? '(no file changes)'
      : focus.text === '' && grader.focus === 'mock_calls'
        ? '(no mocked tool calls)'
        : focus.text
  const prompt = `You are grading the output of a coding agent against a criterion.

Criterion:
${grader.criteria}


Agent output (${targetLabel(grader.focus)}):
${body}


Respond with exactly one word: PASS or FAIL.`
  const votes = await majorityVotes(prompt, params)
  const passed = votes.filter(Boolean).length > votes.length / 2
  return {
    name: grader.name,
    passed,
    weight: grader.weight,
    explanation: `judge votes: ${votes.map(v => (v ? 'PASS' : 'FAIL')).join(' ')}`,
  }
}

async function gradeBaseline(
  grader: BaselineGrader,
  params: GradeRunParams,
): Promise<GraderResult> {
  let baseline: unknown[]
  try {
    const text = await readFile(
      join(params.case_.caseDir, grader.baseline_file),
      'utf8',
    )
    baseline = text
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as unknown)
  } catch (error) {
    return fail(
      grader,
      `failed to read baseline: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const prompt = [
    'You are comparing a NEW coding-agent trajectory against a BASELINE.',
    `Criterion:\n${grader.criteria}`,
    `\nBASELINE trajectory:\n${baseline.map(e => JSON.stringify(e)).join('\n')}`,
    `\nNEW trajectory:\n${params.run.trace.map(e => JSON.stringify(e)).join('\n')}`,
    '\nDoes the NEW trajectory satisfy the criterion at least as well as the BASELINE?',
    'Respond with exactly one word: PASS or FAIL.',
  ].join('\n\n')
  const votes = await majorityVotes(prompt, params)
  const passed = votes.filter(Boolean).length > votes.length / 2
  return {
    name: grader.name,
    passed,
    weight: grader.weight,
    explanation: `judge votes: ${votes.map(v => (v ? 'PASS' : 'FAIL')).join(' ')}`,
  }
}

async function gradeOne(
  grader: Grader,
  params: GradeRunParams,
): Promise<GraderResult> {
  try {
    switch (grader.type) {
      case 'regex':
        return await gradeRegex(grader, params)
      case 'tool_order':
        return gradeToolOrder(grader, params)
      case 'tool_used':
        return gradeToolUsed(grader, params)
      case 'file_exists':
        return gradeFileExists(grader, params)
      case 'llm':
      case 'baseline':
        if (params.skipPaidGraders) {
          return {
            name: grader.name,
            passed: false,
            weight: grader.weight,
            explanation: 'skipped: cost ceiling',
          }
        }
        return grader.type === 'llm'
          ? await gradeLlm(grader, params)
          : await gradeBaseline(grader, params)
    }
  } catch (error) {
    if (error instanceof PluginEvalPathError) throw error
    return fail(
      grader,
      `grader threw: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export function scoreGraders(results: GraderResult[]): number {
  const scored = results.filter(r => r.scored !== false && !r.with_only)
  const total = scored.reduce((sum, r) => sum + r.weight, 0)
  if (total === 0) return 0
  return scored.reduce((sum, r) => sum + (r.passed ? r.weight : 0), 0) / total
}

/** densable `Hl`. */
export async function gradeRun(params: GradeRunParams): Promise<{
  results: GraderResult[]
  judgeCostUsd: number
  paidGradersSkipped: boolean
}> {
  const withOnly = (grader: Grader) =>
    isWithOnly(grader, params.mockCallsWithOnly)
  const allWithOnly = params.case_.graders.every(withOnly)
  const graders =
    params.arm === 'without' && !allWithOnly
      ? params.case_.graders.filter(g => !withOnly(g))
      : params.case_.graders
  const paidGradersSkipped =
    !!params.skipPaidGraders &&
    graders.some(g => g.type === 'llm' || g.type === 'baseline')
  const results: GraderResult[] = []
  const costBefore = getTotalCostUSD()
  for (const grader of graders) {
    const result = await gradeOne(grader, params)
    if (params.arm !== undefined && !allWithOnly && withOnly(grader)) {
      result.with_only = true
    }
    result.scored = !result.with_only
    results.push(result)
  }
  // densable Hl: judgeCostUsd = mg()-r (cost ledger delta across paid graders)
  return {
    results,
    judgeCostUsd: getTotalCostUSD() - costBefore,
    paidGradersSkipped,
  }
}
