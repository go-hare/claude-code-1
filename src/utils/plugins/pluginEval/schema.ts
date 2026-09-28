import { z } from 'zod/v4'
import { lazySchema } from '../../lazySchema.js'
import {
  BLANK_CRITERIA_TODO,
  BLANK_PROMPT_TODO,
  SCHEMA_MAJOR,
  SCHEMA_VERSION_DEFAULT,
} from './constants.js'
import type { CaseDefinition, Grader, RegexTarget } from './types.js'

const focusSchema = lazySchema(() =>
  z.union([
    z.enum(['trace', 'last_message', 'files', 'mock_calls']),
    z.object({ source: z.literal('file'), path: z.string() }).strict(),
  ]),
)

const armSchema = lazySchema(() => z.enum(['with-only', 'both']).optional())

const toolMatchSchema = lazySchema(() =>
  z.union([
    z.string().transform(tool => ({ tool, input_match: undefined })),
    z.object({ tool: z.string(), input_match: z.string().optional() }).strict(),
  ]),
)

export const graderSchema = lazySchema(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('regex'),
        name: z.string(),
        target: focusSchema().default('last_message'),
        pattern: z.string(),
        flags: z
          .string()
          .regex(/^[dgimsuvy]*$/, 'must be JS RegExp flags (d g i m s u v y)')
          .default(''),
        match: z
          .union([
            z.enum(['contains', 'not_contains']),
            z
              .string()
              .regex(
                /^count:\d+$/,
                'must be contains | not_contains | count:N',
              ),
          ])
          .default('contains'),
        weight: z.number().positive().default(1),
        arm: armSchema(),
      })
      .strict(),
    z
      .object({
        type: z.literal('tool_order'),
        name: z.string(),
        before: toolMatchSchema(),
        after: toolMatchSchema(),
        weight: z.number().positive().default(1),
        arm: armSchema(),
      })
      .strict(),
    z
      .object({
        type: z.literal('tool_used'),
        name: z.string(),
        tool: z.string(),
        input_match: z.string().optional(),
        min: z.number().int().nonnegative().optional(),
        max: z.number().int().nonnegative().optional(),
        weight: z.number().positive().default(1),
        arm: armSchema(),
      })
      .strict(),
    z
      .object({
        type: z.literal('file_exists'),
        name: z.string(),
        path: z.string(),
        exists: z.boolean().default(true),
        weight: z.number().positive().default(1),
        arm: armSchema(),
      })
      .strict(),
    z
      .object({
        type: z.literal('llm'),
        name: z.string(),
        criteria: z.string(),
        focus: focusSchema().default('last_message'),
        weight: z.number().positive().default(1),
        arm: armSchema(),
      })
      .strict(),
    z
      .object({
        type: z.literal('baseline'),
        name: z.string(),
        baseline_file: z.string(),
        criteria: z.string(),
        weight: z.number().positive().default(1),
        arm: armSchema(),
      })
      .strict(),
  ]),
)

export const caseSchema = lazySchema(() =>
  z.object({
    schema_version: z.string(),
    name: z.string().min(1),
    description: z.string().optional(),
    tags: z.array(z.string()).default([]),
    plugins: z.array(z.string()).optional(),
    context: z
      .object({
        scaffold_script: z.string().optional(),
        history_file: z.string().optional(),
        add_dirs: z.array(z.string()).default([]),
      })
      .default({ add_dirs: [] }),
    execution: z.object({
      prompt: z.string().optional(),
      max_turns: z.number().int().positive().max(200).default(10),
      timeout_seconds: z.number().int().positive().max(3600).default(300),
      model: z.string().optional(),
      allowed_tools: z.array(z.string()).default([]),
      artifact_publish: z.boolean().optional(),
      growthbook_overrides: z
        .record(
          z.string(),
          z.union([z.boolean(), z.string(), z.number(), z.null()]),
        )
        .optional(),
      append_system_prompt: z.string().optional(),
      env: z.record(z.string(), z.string()).default({}),
    }),
    runs: z.number().int().positive().max(50).default(3),
    graders: z
      .array(graderSchema())
      .min(1)
      .superRefine((graders, ctx) => {
        const seen = new Set<string>()
        for (const grader of graders) {
          if (seen.has(grader.name)) {
            ctx.addIssue({
              code: 'custom',
              message: `duplicate grader name "${grader.name}"`,
            })
          }
          seen.add(grader.name)
        }
      }),
    expected_outcome: z.string().optional(),
  }),
)

export const TOP_KEYS = new Set([
  'schema_version',
  'name',
  'description',
  'tags',
  'plugins',
  'runs',
  'expected_outcome',
])

export const EXECUTION_KEYS = new Set([
  'model',
  'max_turns',
  'timeout_seconds',
  'allowed_tools',
  'artifact_publish',
  'growthbook_overrides',
  'append_system_prompt',
  'env',
])

export function parseCaseDefinition(
  raw: unknown,
): { ok: true; case: CaseDefinition } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'case.yaml must be a YAML object' }
  }
  const version = (raw as { schema_version?: unknown }).schema_version
  if (typeof version !== 'string') {
    return {
      ok: false,
      error: 'missing required field schema_version (e.g. "1.0")',
    }
  }
  const major = parseInt(version.split('.')[0] ?? '', 10)
  if (Number.isNaN(major)) {
    return {
      ok: false,
      error: `schema_version "${version}" is not a valid version string`,
    }
  }
  if (major > SCHEMA_MAJOR) {
    return {
      ok: false,
      error: `schema_version "${version}" requires a newer Claude Code (this binary supports up to ${SCHEMA_MAJOR}.x)`,
    }
  }
  const parsed = caseSchema().safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: `invalid case.yaml:\n${parsed.error.issues
        .map(issue => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n')}`,
    }
  }
  const data = parsed.data as CaseDefinition
  if (!data.execution.prompt?.trim()) {
    return {
      ok: false,
      error: data.context.history_file
        ? 'context.history_file requires execution.prompt (the resumed session needs a next turn)'
        : 'execution.prompt is required (a prompt.md body, or execution.prompt in case.yaml)',
    }
  }
  if (data.execution.prompt.includes(BLANK_PROMPT_TODO)) {
    return {
      ok: false,
      error: `the prompt is still the blank \`init\` template — replace the "${BLANK_PROMPT_TODO}" line with the user prompt to test (in prompt.md, or in execution.prompt if the case is written in case.yaml)`,
    }
  }
  for (const grader of data.graders) {
    const body =
      'criteria' in grader
        ? grader.criteria
        : 'pattern' in grader
          ? grader.pattern
          : ''
    if (body.includes(BLANK_CRITERIA_TODO)) {
      return {
        ok: false,
        error: `grader "${grader.name}" is still the blank \`init\` template — replace the "${BLANK_CRITERIA_TODO}" line with concrete pass criteria`,
      }
    }
  }
  return { ok: true, case: data }
}

export function mergeProseOntoYaml(
  yaml: Record<string, unknown> | null,
  prose: {
    top: Record<string, unknown>
    execution: Record<string, unknown>
    graders: Grader[]
    prompt?: string
  },
  caseDir: string,
): Record<string, unknown> {
  const base = yaml ?? {
    schema_version: SCHEMA_VERSION_DEFAULT,
    name: caseDir.split(/[\\/]/).pop(),
  }
  const execution =
    typeof base.execution === 'object' && base.execution !== null
      ? (base.execution as Record<string, unknown>)
      : {}
  const merged: Record<string, unknown> = {
    ...base,
    ...prose.top,
    execution: {
      ...execution,
      ...prose.execution,
      ...(prose.prompt !== undefined ? { prompt: prose.prompt } : {}),
    },
  }
  if (prose.graders.length > 0) {
    merged.graders = [
      ...(Array.isArray(base.graders) ? base.graders : []),
      ...prose.graders,
    ]
  }
  return merged
}

export function normalizeFocus(value: unknown): RegexTarget {
  if (
    typeof value === 'object' &&
    value !== null &&
    'source' in value &&
    (value as { source: string }).source === 'file'
  ) {
    return {
      source: 'file',
      path: String((value as unknown as { path: unknown }).path),
    }
  }
  if (
    value === 'trace' ||
    value === 'last_message' ||
    value === 'files' ||
    value === 'mock_calls'
  ) {
    return value
  }
  return 'last_message'
}
