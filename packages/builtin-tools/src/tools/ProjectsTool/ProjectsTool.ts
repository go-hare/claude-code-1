/**
 * Official 2.1.331 ProjectsTool (chunks #2667, #3453).
 *
 * Read-only access to Claude Projects knowledge items (`list`, `search`,
 * `read`) delegated through an injectable per-`SessionHost` provider so
 * diskless and multi-tenant hosts never touch local disk.
 */

import { z } from 'zod/v4'
import {
  buildTool,
  type ToolDef,
  type ToolDeps,
  type ToolResultBlockParam,
} from 'src/Tool.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { getBootstrapSessionHost, HostSlot } from 'src/utils/sessionHost.js'

export const PROJECTS_TOOL_NAME = 'Projects'

const PROJECTS_TOOL_DESCRIPTION =
  'List, search, and read knowledge items attached to Claude Projects.'

const PROJECTS_TOOL_PROMPT = [
  'Use this read-only tool to list, search, or read knowledge items in Claude Projects.',
  '- `action: "list"` lists available project documents (optionally scoped by `project_id`, `page`, and `limit`).',
  '- `action: "search"` (default) searches project knowledge using `query` (optionally scoped by `project_id`, `page`, and `limit`).',
  '- `action: "read"` reads a specific document by `doc_id` (optionally with `project_id` and `page`).',
].join('\n')

const inputSchema = lazySchema(() =>
  z
    .strictObject({
      action: z
        .enum(['list', 'search', 'read'])
        .default('search')
        .describe('Operation to perform on project knowledge items'),
      query: z
        .string()
        .optional()
        .describe('Search query when action is "search"'),
      project_id: z
        .string()
        .optional()
        .describe('Optional project identifier to scope results'),
      doc_id: z
        .string()
        .optional()
        .describe('Document identifier when action is "read"'),
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('1-based page number for paginated results or documents'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('Maximum number of hits to return (1-50)'),
    })
    .superRefine((val, ctx) => {
      if (val.action === 'read' && (!val.doc_id || val.doc_id.trim() === '')) {
        ctx.addIssue({
          code: 'custom',
          path: ['doc_id'],
          message: 'doc_id is required when action is "read"',
        })
      }
      if (val.action === 'search' && (!val.query || val.query.trim() === '')) {
        ctx.addIssue({
          code: 'custom',
          path: ['query'],
          message: 'query is required when action is "search"',
        })
      }
    }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type ProjectsToolInput = z.infer<InputSchema>

const projectHitSchema = lazySchema(() =>
  z.object({
    id: z.string(),
    title: z.string().optional(),
    text: z.string().optional(),
    project_id: z.string().optional(),
    image_attached: z.boolean().optional(),
    page: z.number().int().min(1).optional(),
  }),
)

const outputSchema = lazySchema(() =>
  z.object({
    hits: z.array(projectHitSchema()),
    total: z.number().int().nonnegative().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type ProjectsToolHit = z.infer<ReturnType<typeof projectHitSchema>>
export type ProjectsToolOutput = z.infer<OutputSchema>

export type ProjectsToolProvider = (
  input: ProjectsToolInput,
  options: { signal: AbortSignal },
) => Promise<ProjectsToolOutput> | ProjectsToolOutput

const projectsToolProviderByHost = new HostSlot<{
  provider: ProjectsToolProvider | undefined
}>(() => ({ provider: undefined }))

export function registerProjectsToolProvider(
  provider: ProjectsToolProvider | undefined,
  host: object = getBootstrapSessionHost(),
): () => void {
  const slot = projectsToolProviderByHost.of(host)
  slot.provider = provider
  return () => {
    const current = projectsToolProviderByHost.peek(host)
    if (current && current.provider === provider) {
      current.provider = undefined
    }
  }
}

export function getProjectsToolProvider(
  host: object = getBootstrapSessionHost(),
): ProjectsToolProvider | undefined {
  return projectsToolProviderByHost.peek(host)?.provider
}

export function hasProjectsToolProvider(
  host: object = getBootstrapSessionHost(),
): boolean {
  return getProjectsToolProvider(host) !== undefined
}

export const ProjectsTool = buildTool({
  name: PROJECTS_TOOL_NAME,
  maxResultSizeChars: 100_000,
  shouldDefer: false,

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  async description(_input?: ProjectsToolInput, _options?: unknown) {
    return PROJECTS_TOOL_DESCRIPTION
  },
  async prompt(_options?: unknown) {
    return PROJECTS_TOOL_PROMPT
  },

  userFacingName() {
    return PROJECTS_TOOL_NAME
  },

  isEnabled() {
    return (
      isEnvTruthy(process.env.CLAUDE_CODE_PROJECTS_SESSION) ||
      hasProjectsToolProvider()
    )
  },

  isReadOnly(_input?: ProjectsToolInput) {
    return true
  },
  isConcurrencySafe(_input?: ProjectsToolInput) {
    return true
  },

  toAutoClassifierInput(input: ProjectsToolInput) {
    const action = input.action ?? 'search'
    const parts: string[] = [action]
    if (input.project_id) parts.push(`project=${input.project_id}`)
    if (input.doc_id) parts.push(`doc=${input.doc_id}`)
    if (input.query) parts.push(`query=${input.query}`)
    return parts.join(' ')
  },

  renderToolUseMessage(input: Partial<ProjectsToolInput>) {
    const action = input.action ?? 'search'
    if (action === 'read' && input.doc_id) {
      return `read ${input.doc_id}`
    }
    if (input.query) {
      return `${action}: ${input.query}`
    }
    return action
  },

  mapToolResultToToolResultBlockParam(
    output: ProjectsToolOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: JSON.stringify(output),
    }
  },

  create(deps: ToolDeps) {
    return {
      async checkPermissions(input: ProjectsToolInput) {
        return {
          behavior: 'allow' as const,
          updatedInput: input,
        }
      },

      async call(input: ProjectsToolInput, callCtx) {
        const normalizedInput: ProjectsToolInput = {
          ...input,
          action: input.action ?? 'search',
        }
        const providerHost = deps.session?.host ?? getBootstrapSessionHost()
        const provider = getProjectsToolProvider(providerHost)
        if (!provider) {
          throw new Error(
            'Projects tool is unavailable: no Projects provider is registered for this session.',
          )
        }
        const result = await provider(normalizedInput, {
          signal: callCtx.signal,
        })
        const hits = Array.isArray(result?.hits) ? result.hits : []
        const limitedHits =
          normalizedInput.limit !== undefined
            ? hits.slice(0, normalizedInput.limit)
            : hits
        return {
          data: {
            hits: limitedHits,
            total: result?.total ?? hits.length,
          },
        }
      },
    }
  },
} satisfies ToolDef<InputSchema, ProjectsToolOutput>)
