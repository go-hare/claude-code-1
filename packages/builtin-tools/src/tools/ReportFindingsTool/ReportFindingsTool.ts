/**
 * Official BCe / IXi ReportFindings — host-UI typed findings for code review.
 * Gate: CLAUDE_CODE_REPORT_FINDINGS env or tengu_report_findings_tool GB.
 */
import { z } from 'zod/v4'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import type { ToolResultBlockParam } from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { REPORT_FINDINGS_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const findingSchema = lazySchema(() =>
  z.object({
    file: z
      .string()
      .describe('Repo-relative path of the file the finding is in'),
    line: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('1-indexed line the finding anchors to'),
    summary: z.string().describe('One-sentence statement of the defect'),
    failure_scenario: z
      .string()
      .describe(
        'Concrete failure path or cost (crash inputs, wrong output, wasted work, broken convention)',
      ),
    category: z
      .string()
      .optional()
      .describe(
        'Short kebab-case slug of the finding type, e.g. "correctness", "simplification", "efficiency", "test-coverage"',
      ),
    verdict: z
      .enum(['CONFIRMED', 'PLAUSIBLE'])
      .optional()
      .describe('Set when a verify pass ran; absent on inline-only reviews'),
    outcome: z
      .enum(['fixed', 'skipped', 'no_change_needed'])
      .optional()
      .describe(
        'Set ONLY when re-reporting after applying fixes: what happened to this finding',
      ),
  }),
)

const inputSchema = lazySchema(() =>
  z.strictObject({
    level: z
      .enum(['medium', 'high', 'xhigh'])
      .optional()
      .describe('Effort level the review ran at'),
    findings: z
      .array(findingSchema())
      .max(32)
      .describe('Verified findings, most-severe first; empty if none survived'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type Input = z.infer<InputSchema>
export type Finding = z.infer<ReturnType<typeof findingSchema>>

const outputSchema = lazySchema(() =>
  z.object({
    count: z.number(),
    level: z.enum(['medium', 'high', 'xhigh']).optional(),
    findings: z.array(findingSchema()),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

/** Official def() gate — env force-on or GrowthBook flag. */
export function isReportFindingsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.CLAUDE_CODE_REPORT_FINDINGS !== undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_REPORT_FINDINGS)
  }
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_report_findings_tool',
    false,
  )
}

export const ReportFindingsTool = buildTool({
  name: REPORT_FINDINGS_TOOL_NAME,
  searchHint: 'report code review findings typed host ui',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  strict: true,

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  isEnabled() {
    return isReportFindingsEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },

  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },

  userFacingName() {
    return 'Code review'
  },

  toAutoClassifierInput(input: Input) {
    const n = input.findings?.length ?? 0
    const level = input.level ? ` level=${input.level}` : ''
    return `ReportFindings${level} count=${n}`
  },

  renderToolUseMessage(input: Partial<Input>) {
    const n = input.findings?.length
    if (n === undefined) return 'Code review'
    if (n === 0) return 'Code review: no findings'
    return `Code review: ${n} finding${n === 1 ? '' : 's'}`
  },

  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content:
        content.count === 0
          ? 'Reported 0 findings.'
          : `Reported ${content.count} finding${content.count === 1 ? '' : 's'}.`,
    }
  },

  async call(input: Input) {
    const findings = input.findings ?? []
    const output: Output = {
      count: findings.length,
      level: input.level,
      findings,
    }
    return { data: output }
  },
} satisfies ToolDef<InputSchema, Output>)
