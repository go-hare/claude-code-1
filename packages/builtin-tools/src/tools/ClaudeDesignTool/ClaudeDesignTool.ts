/**
 * densable 2.1.289 ClaudeDesign (aG) — POST /v1/design/mcp JSON-RPC.
 * isEnabled: gold gAe analog (firstParty, not HIPAA).
 */
import axios from 'axios'
import { z } from 'zod/v4'
import { getOauthConfig } from 'src/constants/oauth.js'
import type { ToolUseContext } from 'src/Tool.js'
import { buildTool } from 'src/Tool.js'
import type { PermissionResult } from 'src/types/permissions.js'
import {
  DESIGN_CONSENT_DECISION_REASON,
  DESIGN_FINALIZE_PLAN_ASK,
  designAskCanReachUser,
  designConsentNoPromptMessage,
  designConsentNotShownMessage,
  designConsentRetryAction,
  designProjectGrantAuthMessage,
  designProjectGrantNoPromptMessage,
  designProjectGrantNotShownMessage,
  getDesignConsentPrompt,
  DESIGN_CONSENT_BIT,
  missingDesignConsentBit,
  postDesignConsent,
  postDesignProjectGrant,
  resolveDesignAccessToken,
} from 'src/services/designConsent.js'
import {
  allowApprovedDesignPlan,
  decideTokenlessProjectWrite,
  designConsentBlockedWrite,
  designGrantAskReachesUser,
  designSessionState,
  dropApprovedDesignPlansForProject,
  noteDesignProjectMembershipChange,
  markDesignGrantIneligible,
  recordFinalizedDesignPlan,
  rememberDesignProjectGrant,
  writeDesignConsentBit,
} from 'src/services/designProjectGrant.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { getAnthropicClientPlatform } from 'src/utils/teleport/api.js'
import {
  CLAUDE_DESIGN_LIST_OPERATION,
  CLAUDE_DESIGN_TOOL_NAME,
  describeClaudeDesignTool,
  isClaudeDesignToolEnabled,
} from './prompt.js'
import {
  getOperationHints,
  isDesignOperationReadOnly,
  recordDiscoveredOperationHints,
  redactDesignOauthToken,
  DESIGN_PROJECT_ID_LENGTH_CAP,
  validateFinalizePlanProjectId,
  validateWriteOpArgs,
} from './validateArguments.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    operation: z
      .string()
      .regex(/^[\w.-]{1,64}$/)
      .describe(
        `Claude Design action to perform. Call with "${CLAUDE_DESIGN_LIST_OPERATION}" first to discover the available operations and their argument schemas.`,
      ),
    arguments: z
      .record(z.string(), z.unknown())
      .default({})
      .describe(
        'Action input object (server-validated). Pass {} for operations that take no input.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    operation: z.string(),
    content: z.unknown(),
    isError: z.boolean().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export class DesignNeedsConsentError extends Error {
  constructor() {
    super('Claude Design requires consent')
    this.name = 'DesignNeedsConsentError'
  }
}

export class DesignNeedsProjectGrantError extends Error {
  constructor() {
    super('Claude Design requires a project write grant')
    this.name = 'DesignNeedsProjectGrantError'
  }
}

/** densable Le — 403 `needs_project_grant` with a server project id. */
function acceptedDesignProjectId(
  body: Record<string, unknown> | null,
): string | null {
  if (body?.error !== 'needs_project_grant') return null
  const id = body.project_id
  if (typeof id !== 'string' || id.length === 0) return null
  if (id.length > DESIGN_PROJECT_ID_LENGTH_CAP - 2) return null
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null
  return id
}

export class DesignNeedsScopesError extends Error {
  constructor(isNonInteractiveSession: boolean) {
    super(needsDesignScopesMessage(isNonInteractiveSession))
    this.name = 'DesignNeedsScopesError'
  }
}

export function needsDesignScopesMessage(
  isNonInteractiveSession: boolean,
): string {
  if (isNonInteractiveSession) {
    return "Claude Design rejected this session's claude.ai credential (HTTP 403): it does not carry Claude Design access, and /design login cannot run in this non-interactive session. Ask the user to run /design login once from an interactive Claude Code session on this machine — non-interactive runs here then reuse that authorization. (CI runners and hosted sessions have no interactive session; Claude Design is not reachable from those without a stored /design login credential.)"
  }
  return "Claude Design rejected this session's claude.ai credential (HTTP 403): it does not carry Claude Design access. Run /design login to authorize Claude Design, then retry."
}

function designHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'anthropic-version': '2023-06-01',
    'anthropic-client-platform': getAnthropicClientPlatform(),
    'X-Anthropic-Client': 'claude-cli-design-tool',
  }
}

function designAccessToken(credentials?: unknown): Promise<string | null> {
  return resolveDesignAccessToken(credentials)
}

function errorResult(operation: string, text: string) {
  return {
    data: {
      operation,
      content: [{ type: 'text' as const, text }],
      isError: true,
    },
  }
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
  }
  return null
}

function headerContentType(headers: unknown): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  const record = headers as Record<string, unknown> & {
    get?: (name: string) => unknown
  }
  const direct = record['content-type'] ?? record['Content-Type']
  if (typeof direct === 'string') return direct
  if (typeof record.get === 'function') {
    const got = record.get('content-type')
    if (typeof got === 'string') return got
  }
  return undefined
}

function maybeRecordDiscovery(payload: unknown): void {
  const obj = parseJsonObject(payload)
  const tools = obj?.tools ?? parseJsonObject(obj?.result)?.tools
  if (!Array.isArray(tools)) return
  recordDiscoveredOperationHints(
    tools.filter(
      (item): item is { name?: unknown; annotations?: object } =>
        typeof item === 'object' && item !== null,
    ),
  )
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** Gold vTo — plan_token and expires_at (seconds) from a text block. */
function planFromFinalizeContent(content: unknown): {
  token: string
  expiresAtMs: number | null
} | null {
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (
      block === null ||
      typeof block !== 'object' ||
      Reflect.get(block, 'type') !== 'text'
    ) {
      continue
    }
    const text = Reflect.get(block, 'text')
    if (typeof text !== 'string') continue
    try {
      const parsed = JSON.parse(text) as {
        plan_token?: unknown
        expires_at?: unknown
      }
      const token = parsed?.plan_token
      if (typeof token !== 'string' || token.length === 0) return null
      const expires = parsed.expires_at
      const expiresAtMs =
        typeof expires === 'number' && Number.isFinite(expires * 1000)
          ? expires * 1000
          : null
      return { token, expiresAtMs }
    } catch {
      return null
    }
  }
  return null
}

function safetyDeny(message: string, reason: string): PermissionResult<Input> {
  return {
    behavior: 'deny',
    message,
    decisionReason: {
      type: 'safetyCheck',
      reason,
      classifierApprovable: false,
    },
  }
}

export const ClaudeDesignTool = buildTool({
  name: CLAUDE_DESIGN_TOOL_NAME,
  searchHint: 'work with Claude Design (claude.ai/design) projects',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isClaudeDesignToolEnabled()
  },
  isConcurrencySafe(input: Input) {
    if (input.operation === CLAUDE_DESIGN_LIST_OPERATION) return true
    return isDesignOperationReadOnly(input.operation)
  },
  isReadOnly(input: Input) {
    if (input.operation === CLAUDE_DESIGN_LIST_OPERATION) return true
    return isDesignOperationReadOnly(input.operation)
  },
  async description() {
    return describeClaudeDesignTool()
  },
  async prompt() {
    return describeClaudeDesignTool()
  },
  userFacingName(input?: Partial<Input>) {
    const op = input?.operation
    return op ? `Claude Design: ${op}` : 'Claude Design'
  },
  async validateInput(input) {
    const argsError = validateWriteOpArgs(input.operation, input.arguments)
    if (argsError) {
      return { result: false as const, message: argsError, errorCode: 1 }
    }
    if (input.operation === 'finalize_plan') {
      const projectError = validateFinalizePlanProjectId(
        input.arguments?.project_id,
      )
      if (projectError) {
        return { result: false as const, message: projectError, errorCode: 1 }
      }
    }
    return { result: true as const }
  },
  async checkPermissions(input, context): Promise<PermissionResult<Input>> {
    const grantState = designSessionState(context)
    const args = input.arguments ?? {}
    if (input.operation === 'finalize_plan' && args.scope === 'project') {
      return safetyDeny(
        'ClaudeDesign finalize_plan: scope "project" is no longer supported by this client. Write files directly without plan_token — the first write to a project asks for a one-time durable approval — or use finalize_plan with writes/deletes for path-scoped plans and deletes.',
        'finalize_plan scope:"project" is superseded by the durable per-project write grant',
      )
    }
    if (
      input.operation === 'copy_files' &&
      !(typeof args.plan_token === 'string' && args.plan_token.length > 0)
    ) {
      return safetyDeny(
        'ClaudeDesign copy_files: copying without a plan_token always requires per-batch approval — use finalize_plan declaring every destination in writes, then pass the returned plan_token.',
        'tokenless copy_files is per-batch-only — its destinations have no reserved-path or render-integrity gate',
      )
    }
    const missingConsent =
      input.operation === CLAUDE_DESIGN_LIST_OPERATION
        ? null
        : await missingDesignConsentBit(grantState, context.credentials)
    const askCanReachUser = designAskCanReachUser(context)
    const stamped = {
      ...input,
      __consentBitShown: missingConsent,
      __consentAskCanReachUser: askCanReachUser,
      __projectGrantAskShown: undefined,
      __projectGrantServerObserved: undefined,
      __reservedTargetsAskShown: undefined,
      __finalizePlanAskShown: undefined,
    } as Input
    const readOnly =
      input.operation === CLAUDE_DESIGN_LIST_OPERATION ||
      isDesignOperationReadOnly(input.operation)
    if (missingConsent !== null) {
      const blocked = designConsentBlockedWrite(input.operation, args)
      if (blocked !== null) return safetyDeny(blocked.message, blocked.reason)
      const writeLine = readOnly
        ? ''
        : `Design ${input.operation} writes to claude.ai/design.`
      const finalizeExtra =
        input.operation === 'finalize_plan' ? DESIGN_FINALIZE_PLAN_ASK : ''
      return {
        behavior: 'ask',
        message: [getDesignConsentPrompt(), writeLine, finalizeExtra]
          .filter(part => part.length > 0)
          .join(' '),
        updatedInput:
          input.operation === 'finalize_plan'
            ? ({ ...stamped, __finalizePlanAskShown: true } as Input)
            : stamped,
        localDisplayOnly: true,
        decisionReason: {
          type: 'safetyCheck',
          reason: DESIGN_CONSENT_DECISION_REASON,
          classifierApprovable: false,
        },
      }
    }
    if (readOnly) {
      return { behavior: 'allow', updatedInput: stamped }
    }
    if (allowApprovedDesignPlan(input.operation, args, context)) {
      return { behavior: 'allow', updatedInput: stamped }
    }
    if (input.operation === 'finalize_plan') {
      return {
        behavior: 'ask',
        message: `Design finalize_plan writes to claude.ai/design. ${DESIGN_FINALIZE_PLAN_ASK}`,
        updatedInput: { ...stamped, __finalizePlanAskShown: true } as Input,
        localDisplayOnly: true,
        decisionReason: {
          type: 'safetyCheck',
          reason:
            'finalize_plan — the human is the path-review boundary; approval also grants prompt-free writes to these paths for 15 min',
          classifierApprovable: false,
        },
      }
    }
    const grant = await decideTokenlessProjectWrite(
      input.operation,
      args,
      context,
    )
    if (grant.kind === 'allow') {
      return { behavior: 'allow', updatedInput: stamped }
    }
    if (grant.kind === 'deny') return safetyDeny(grant.message, grant.reason)
    if (grant.kind === 'ask-grant') {
      return {
        behavior: 'ask',
        message: grant.message,
        updatedInput: {
          ...stamped,
          __projectGrantAskShown: grant.projectId,
        } as Input,
        localDisplayOnly: true,
        serverApprovalWatch: {
          kind: 'design_project_grant',
          projectId: grant.projectId,
        },
        decisionReason: {
          type: 'safetyCheck',
          reason:
            'first write under a project grant — approval mints a durable write grant for this project, revocable at claude.ai/design settings',
          classifierApprovable: false,
        },
      }
    }
    const hints = getOperationHints(input.operation)
    const destructive = hints === undefined || hints.destructive !== false
    const reserved = grant.kind === 'ask-reserved'
    return {
      behavior: 'ask',
      message: `Design ${input.operation} writes to claude.ai/design.`,
      updatedInput: reserved
        ? ({ ...stamped, __reservedTargetsAskShown: true } as Input)
        : stamped,
      localDisplayOnly: true,
      decisionReason: {
        type: 'safetyCheck',
        reason: destructive
          ? hints
            ? 'destructive — model-generated arguments'
            : 'unknown operation — fail-closed to destructive write'
          : 'remote write — model-generated arguments',
        classifierApprovable: false,
      },
    }
  },
  async call(input: Input, context: ToolUseContext) {
    const stamped = input as Input & {
      __consentBitShown?: string | null
      __consentAskCanReachUser?: boolean
      __projectGrantAskShown?: string
      __projectGrantServerObserved?: boolean
      __finalizePlanAskShown?: boolean
    }
    const grantState = designSessionState(context)
    if (
      input.operation === 'finalize_plan' &&
      stamped.__consentAskCanReachUser === true
    ) {
      const projectId = input.arguments?.project_id
      if (typeof projectId === 'string' && projectId.length > 0) {
        dropApprovedDesignPlansForProject(grantState, projectId)
      }
    }
    noteDesignProjectMembershipChange(
      grantState,
      input.operation,
      input.arguments?.project_id,
    )
    const token = await designAccessToken(context.credentials)
    if (!token) {
      return errorResult(
        input.operation,
        'No design-capable credential. Run /design login to authorize Claude Design.',
      )
    }
    const argsError = validateWriteOpArgs(input.operation, input.arguments)
    if (argsError) {
      return errorResult(input.operation, argsError)
    }
    const url = `${getOauthConfig().BASE_API_URL}/v1/design/mcp`
    const method =
      input.operation === CLAUDE_DESIGN_LIST_OPERATION
        ? 'tools/list'
        : 'tools/call'
    const params =
      method === 'tools/list'
        ? {}
        : { name: input.operation, arguments: input.arguments ?? {} }
    const shown = stamped.__consentBitShown ?? null
    const askCanReachUser =
      stamped.__consentAskCanReachUser === true &&
      designAskCanReachUser(context)
    const postRpc = () =>
      axios.post(
        url,
        { jsonrpc: '2.0', id: 1, method, params },
        {
          headers: designHeaders(token),
          timeout: 60_000,
          validateStatus: () => true,
          signal: context.abortController.signal,
        },
      )
    let consentPosted = false
    let grantPosted = false
    let res = await postRpc()
    for (;;) {
      const contentType = headerContentType(res.headers)
      if (
        typeof contentType === 'string' &&
        contentType.toLowerCase().startsWith('text/event-stream')
      ) {
        return errorResult(
          input.operation,
          'Claude Design returned a text/event-stream response; this client only handles JSON.',
        )
      }
      if (res.status === 401) {
        return errorResult(
          input.operation,
          'No design-capable credential. Run /design login to authorize Claude Design.',
        )
      }
      if (res.status !== 403) break
      const body = parseJsonObject(res.data)
      if (body?.error === 'needs_project_grant') {
        const projectId = acceptedDesignProjectId(body)
        if (projectId === null) break
        const shownGrant = stamped.__projectGrantAskShown
        if (
          projectId !== shownGrant ||
          stamped.__projectGrantServerObserved === true
        ) {
          return errorResult(
            input.operation,
            designProjectGrantNotShownMessage({
              operation: input.operation,
              nonInteractive: context.options?.isNonInteractiveSession === true,
            }),
          )
        }
        if (!askCanReachUser) {
          return errorResult(
            input.operation,
            designProjectGrantNoPromptMessage(),
          )
        }
        if (grantPosted) {
          return errorResult(
            input.operation,
            new DesignNeedsProjectGrantError().message,
          )
        }
        try {
          await postDesignProjectGrant(projectId, context.credentials)
          rememberDesignProjectGrant(grantState, projectId)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (message.includes('cannot hold a durable write grant')) {
            markDesignGrantIneligible(grantState, projectId)
          }
          return errorResult(
            input.operation,
            message === 'no-auth' ? designProjectGrantAuthMessage() : message,
          )
        }
        grantPosted = true
        res = await postRpc()
        continue
      }
      if (body?.error === 'needs_design_scopes') {
        return errorResult(
          input.operation,
          new DesignNeedsScopesError(
            context.options?.isNonInteractiveSession === true,
          ).message,
        )
      }
      if (body?.error !== 'needs_consent') break
      const bodyConsent = typeof body.consent === 'string' ? body.consent : null
      const action = designConsentRetryAction({
        shown,
        askCanReachUser,
        bodyConsent,
      })
      if (action === 'post_and_retry' && !consentPosted) {
        try {
          await postDesignConsent(grantState, context.credentials)
        } catch (error) {
          return errorResult(
            input.operation,
            error instanceof Error ? error.message : String(error),
          )
        }
        consentPosted = true
        res = await postRpc()
        continue
      }
      if (action === 'not_shown') {
        writeDesignConsentBit(
          grantState,
          bodyConsent ?? DESIGN_CONSENT_BIT,
          false,
        )
        return errorResult(input.operation, designConsentNotShownMessage())
      }
      if (action === 'no_prompt') {
        writeDesignConsentBit(
          grantState,
          bodyConsent ?? DESIGN_CONSENT_BIT,
          false,
        )
        return errorResult(input.operation, designConsentNoPromptMessage())
      }
      return errorResult(input.operation, new DesignNeedsConsentError().message)
    }
    if (res.status < 200 || res.status >= 300) {
      return errorResult(
        input.operation,
        redactDesignOauthToken(
          `Claude Design ${input.operation} failed: HTTP ${res.status} ${stringifyUnknown(res.data)}`,
          token,
        ),
      )
    }
    const body = res.data as {
      error?: { message?: string; data?: unknown }
      result?: { content?: unknown; isError?: boolean; tools?: unknown }
    }
    maybeRecordDiscovery(body)
    maybeRecordDiscovery(body.result)
    if (body.error) {
      return errorResult(
        input.operation,
        redactDesignOauthToken(
          String(body.error.message ?? 'error') +
            (body.error.data ? ` — ${stringifyUnknown(body.error.data)}` : ''),
          token,
        ),
      )
    }
    if (
      input.operation === 'finalize_plan' &&
      stamped.__finalizePlanAskShown === true &&
      stamped.__consentAskCanReachUser === true &&
      designAskCanReachUser(context) &&
      designGrantAskReachesUser(context) &&
      body.result?.isError !== true
    ) {
      const args = input.arguments ?? {}
      const parsed = planFromFinalizeContent(body.result?.content)
      if (
        parsed !== null &&
        typeof args.project_id === 'string' &&
        args.scope !== 'project'
      ) {
        recordFinalizedDesignPlan(grantState, parsed.token, {
          projectId: args.project_id,
          writes: stringList(args.writes),
          deletes: stringList(args.deletes),
          serverExpiresAtMs: parsed.expiresAtMs ?? undefined,
        })
      }
    }
    if (
      typeof stamped.__consentBitShown === 'string' &&
      stamped.__consentBitShown.length > 0 &&
      body.result?.isError !== true
    ) {
      writeDesignConsentBit(grantState, stamped.__consentBitShown, true)
    }
    return {
      data: {
        operation: input.operation,
        content: body.result?.content ?? body,
        isError: body.result?.isError,
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const text =
      typeof output.content === 'string'
        ? output.content
        : JSON.stringify(output.content)
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: text.slice(0, 8000),
    }
  },
  renderToolUseMessage(input) {
    return `Claude Design: ${input.operation ?? ''}`
  },
})
