/**
 * densable 2.1.289 DesignSync (`Ze` / `rUt`).
 * `call` runs `ne` (`dispatchDesignSync`) against toolState.get(oH).
 */
import { stat } from 'fs/promises'
import { resolve } from 'path'
import type { ToolUseContext } from 'src/Tool.js'
import { buildTool } from 'src/Tool.js'
import type { PermissionResult } from 'src/types/permissions.js'
import type { ValidationResult } from 'src/Tool.js'
import { isArtifactToolRegistered } from 'src/utils/artifactUrl.js'
import { getCwd } from 'src/utils/cwd.js'
import { logForDebugging } from 'src/utils/debug.js'
import { AbortError, errorMessage } from 'src/utils/errors.js'
import { isPolicyLimitsAllowed } from 'src/cli/leftoverTulip.js'
import { isEssentialTrafficOnly } from 'src/utils/privacyLevel.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import { isHipaaPolicy } from 'src/utils/midConversationSystem.js'
import {
  isDesignLoginRemote,
  isDesignOAuthClientConfigured,
  runDesignOAuthFlow,
} from 'src/cli/handlers/designOauth.js'
import {
  DESIGN_CONSENT_BIT,
  designConsentNoPromptMessage,
  designConsentNotShownMessage,
  getDesignConsentPrompt,
  missingDesignConsentBit,
  postDesignConsent,
  resolveDesignAccessToken,
} from 'src/services/designConsent.js'
import {
  designSessionState,
  normalizePath,
  writeDesignConsentBit,
} from 'src/services/designProjectGrant.js'
import { DesignAuthError, asRecord } from './api.js'
import {
  dispatchDesignSync,
  isDesignPlanGlob,
  resolveDesignSyncLocalDir,
  type DesignSyncResult,
} from './dispatch.js'
import {
  DESIGN_SYNC_FIELD_RULES,
  DESIGN_SYNC_SEARCH_HINT,
  DESIGN_SYNC_TOOL_NAME,
  describeDesignSyncTool,
  designSyncFacingName,
  designSyncUseLabel,
  getDesignSyncInputSchema,
  getDesignSyncOutputSchema,
  plural,
  shortDesignProjectId,
  type DesignSyncInput,
} from './prompt.js'

const inputSchema = getDesignSyncInputSchema
const outputSchema = getDesignSyncOutputSchema
type Input = DesignSyncInput

const INTERACTIVE_MODES = new Set(['default', 'acceptEdits', 'auto'])

export class DesignSyncPreconditionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DesignSyncPreconditionError'
  }
}

/** Gold `re`. */
export function designSyncPreconditionMessage(
  reason: string,
  opts?: { isNonInteractiveSession?: boolean },
): string {
  switch (reason) {
    case 'needs_design_login':
      if (opts?.isNonInteractiveSession) {
        return 'DesignSync needs design-system authorization, and /design-login cannot run in this non-interactive session. Ask the user to run /design-login once from an interactive Claude Code session on this machine — headless and SDK runs here then reuse that authorization. If this is claude.ai/code, ask them instead to use Claude Design\'s "Send to Claude Code Web" (which seeds the project into the workspace) or to provide the project files directly.'
      }
      return 'DesignSync needs design-system authorization. Run /design-login to authorize it with your claude.ai account — this works even when this session authenticates with an API key or a provider token.'
    case 'design_refresh_failed':
      if (opts?.isNonInteractiveSession) {
        return 'Could not refresh the design access token (transient error). Retry shortly; if the error persists, the stored credential needs re-authorization from an interactive Claude Code terminal (not available here).'
      }
      return 'Could not refresh the design access token (transient error). Retry shortly, or run /design-login to re-authorize.'
    case 'wrong_provider':
      return 'DesignSync is only available with claude.ai authentication. It is not supported through Bedrock, Vertex, or other third-party providers.'
    case 'essential_traffic_only':
      return 'DesignSync is unavailable while nonessential network traffic is restricted (CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set). Unset it to use /design-sync.'
    default:
      return reason
  }
}

type TokenOpts = {
  signal: AbortSignal
  isNonInteractiveSession: boolean
  permissionMode?: string
  askReachesUser: boolean
}

/**
 * Gold `je`. Token resolution is `resolveDesignAccessToken` (Vit/f).
 * The interactive branch calls `runDesignOAuthFlow` (jZt).
 */
async function designSyncAccessToken(
  credentials: unknown,
  opts: TokenOpts,
): Promise<string> {
  if (getAPIProvider() !== 'firstParty') {
    throw new DesignSyncPreconditionError(
      designSyncPreconditionMessage('wrong_provider'),
    )
  }
  if (isEssentialTrafficOnly()) {
    throw new DesignSyncPreconditionError(
      designSyncPreconditionMessage('essential_traffic_only'),
    )
  }
  const token = await resolveDesignAccessToken(credentials)
  if (token) return token
  if (
    opts.askReachesUser &&
    !opts.isNonInteractiveSession &&
    opts.permissionMode !== undefined &&
    INTERACTIVE_MODES.has(opts.permissionMode)
  ) {
    const login = await runDesignOAuthFlow(opts.signal)
    if (login.ok) return login.accessToken
    throw new DesignSyncPreconditionError(
      `DesignSync needs design-system authorization. ${login.message}`,
    )
  }
  throw new DesignSyncPreconditionError(
    designSyncPreconditionMessage('needs_design_login', {
      isNonInteractiveSession: opts.isNonInteractiveSession,
    }),
  )
}

function redactOauthToken(message: string, token: string): string {
  if (!token) return message
  return message.split(token).join('[redacted-oauth-token]')
}

function attachTelemetry(error: Error, telemetry: string): void {
  Object.assign(error, { telemetryMessage: telemetry })
}

/** Gold `ee` — the approval card can reach a person. */
function consentAskCanReachUser(context: ToolUseContext): boolean {
  if (context.options?.isNonInteractiveSession) return false
  let mode: string | undefined
  let bypassAvailable = false
  try {
    const perms = context.getAppState().toolPermissionContext
    mode = perms?.mode
    bypassAvailable = perms?.isBypassPermissionsModeAvailable === true
  } catch {
    return false
  }
  if (mode === 'bypassPermissions') return false
  if (mode === 'plan' && bypassAvailable) return false
  return true
}

function permissionMode(context: ToolUseContext): string | undefined {
  try {
    return context.getAppState().toolPermissionContext?.mode
  } catch {
    return undefined
  }
}

function authBodyError(error: DesignAuthError): string | undefined {
  const code = asRecord(error.body)?.error
  return typeof code === 'string' ? code : undefined
}

/** Gold `Ie` + `FPt`. */
function consentBitFromAuthError(error: unknown): string | null {
  if (!(error instanceof DesignAuthError) || error.status !== 403) return null
  const body = asRecord(error.body)
  if (body?.error !== 'needs_consent') return null
  const consent = body.consent
  if (consent !== DESIGN_CONSENT_BIT) return null
  return consent
}

const LOGIN_BANNER =
  "DesignSync needs design-system authorization for your claude.ai account. Approving opens your browser to authorize access to your org's design-system projects — this session's own authentication is not changed."

async function designLoginBanner(credentials: unknown): Promise<string | null> {
  if (getAPIProvider() !== 'firstParty' || isEssentialTrafficOnly()) {
    return null
  }
  if (!isDesignOAuthClientConfigured() || isDesignLoginRemote()) return null
  const token = await resolveDesignAccessToken(credentials)
  if (token) return null
  return LOGIN_BANNER
}

type Stamped = Input & {
  __consentBitShown?: string | null
  __consentAskCanReachUser?: boolean
}

function missingFields(input: Input): string[] {
  const rules = DESIGN_SYNC_FIELD_RULES[input.method]
  const absent = rules.present.filter(key => input[key] === undefined)
  const empty = rules.nonEmpty.filter(key => {
    const value = input[key]
    return value === undefined || (Array.isArray(value) && value.length === 0)
  })
  return [...absent, ...empty]
}

export const DesignSyncTool = buildTool({
  name: DESIGN_SYNC_TOOL_NAME,
  searchHint: DESIGN_SYNC_SEARCH_HINT,
  shouldDefer: true,
  backgrounding: 'never',
  maxResultSizeChars: 300_000,
  isEnabled() {
    // Gold DD: sn("allow_design_sync"), then not essential-traffic, then firstParty.
    // HIPAA env is the local stand-in for that key's deniedUnder: ['hipaa'].
    if (!isPolicyLimitsAllowed('allow_design_sync')) return false
    if (isHipaaPolicy()) return false
    if (isEssentialTrafficOnly()) return false
    return getAPIProvider() === 'firstParty'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly(input: Input) {
    return (
      input.method === 'list_projects' ||
      input.method === 'get_project' ||
      input.method === 'list_files' ||
      input.method === 'get_file' ||
      input.method === 'report_validate'
    )
  },
  isDestructive(input: Input) {
    return (
      input.method === 'write_files' ||
      input.method === 'delete_files' ||
      input.method === 'unregister_assets'
    )
  },
  get inputSchema() {
    return inputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  async description() {
    return describeDesignSyncTool(isArtifactToolRegistered())
  },
  async prompt() {
    return describeDesignSyncTool(isArtifactToolRegistered())
  },
  userFacingName(input?: Partial<Input>) {
    return designSyncFacingName(input)
  },
  getToolUseSummary(input?: Partial<Input>) {
    return input?.method ? designSyncUseLabel(input) : null
  },
  toAutoClassifierInput(input: Input) {
    if (input.method === 'finalize_plan') {
      const list = (paths?: string[]) => {
        const rows = paths ?? []
        if (rows.length <= 50) return rows.join(', ')
        return `${rows.length} paths (too many to list here; the user's permission prompt shows the full list)`
      }
      const folder = resolve(getCwd(), input.localDir ?? '.')
      return `project ${input.projectId ?? '?'} from ${folder}: write ${list(input.writes)}; delete ${list(input.deletes)}`
    }
    if (input.method === 'create_project') {
      return `create project "${input.name ?? '?'}"`
    }
    return input.method
  },
  renderToolUseMessage(input: Partial<Input>) {
    if (input.method === 'finalize_plan') {
      return shortDesignProjectId(input.projectId)
    }
    return designSyncUseLabel(input)
  },
  async validateInput(input: Input): Promise<ValidationResult> {
    const missing = missingFields(input)
    if (missing.length > 0) {
      return {
        result: false,
        message: `${input.method} requires: ${missing.join(', ')}.`,
        errorCode: 1,
      }
    }
    if (
      input.method === 'finalize_plan' &&
      (input.writes?.length ?? 0) === 0 &&
      (input.deletes?.length ?? 0) === 0
    ) {
      return {
        result: false,
        message: 'finalize_plan needs at least one write or delete path.',
        errorCode: 1,
      }
    }
    if (input.method === 'write_files') {
      for (const file of input.files ?? []) {
        const hasData = file.data !== undefined
        const hasLocal = file.localPath !== undefined
        if (hasData === hasLocal) {
          return {
            result: false,
            message: `Each file needs exactly one of "data" or "localPath" (offending path: ${file.path}).`,
            errorCode: 1,
          }
        }
        if (hasLocal && file.encoding !== undefined) {
          return {
            result: false,
            message: `"encoding" only applies to inline "data"; localPath files are encoded automatically (offending path: ${file.path}).`,
            errorCode: 1,
          }
        }
      }
    }
    return { result: true }
  },
  async checkPermissions(
    input: Input,
    context: ToolUseContext,
  ): Promise<PermissionResult<Input>> {
    const state = designSessionState(context)
    const shown = await missingDesignConsentBit(state, context.credentials)
    const ask = consentAskCanReachUser(context)
    const stamped = {
      ...input,
      __consentBitShown: shown,
      __consentAskCanReachUser: ask,
    } as Input
    const consentLine = shown !== null ? getDesignConsentPrompt() : null
    const loginLine = await designLoginBanner(context.credentials)
    const banner =
      [consentLine, loginLine].filter(line => line !== null).join('\n\n') ||
      null
    if (
      banner &&
      input.method !== 'finalize_plan' &&
      input.method !== 'create_project' &&
      input.method !== 'report_validate'
    ) {
      const reason = [
        consentLine
          ? 'design agent consent — approving records a server-side grant for Claude agents to write your design projects'
          : null,
        loginLine
          ? 'design login — approving opens a browser OAuth consent and stores a design credential'
          : null,
      ]
        .filter(part => part !== null)
        .join('; ')
      return {
        behavior: 'ask',
        message: banner,
        updatedInput: stamped,
        localDisplayOnly: true,
        decisionReason: {
          type: 'safetyCheck',
          reason: reason || 'design credential prompt',
          classifierApprovable: false,
        },
      }
    }
    if (input.method === 'finalize_plan') {
      const writes = (input.writes ?? []).map(normalizePath)
      const deletes = (input.deletes ?? []).map(normalizePath)
      let localDir: string
      try {
        localDir = await resolveDesignSyncLocalDir(input.localDir)
      } catch (error) {
        return {
          behavior: 'deny',
          message: `localDir does not exist or is not accessible: ${input.localDir ?? getCwd()} (${errorMessage(error)})`,
          decisionReason: {
            type: 'safetyCheck',
            reason: 'localDir not found',
            classifierApprovable: false,
          },
        }
      }
      const writeGlobs = writes.filter(isDesignPlanGlob)
      const writeLiterals = writes.filter(path => !isDesignPlanGlob(path))
      const deleteGlobs = deletes.filter(isDesignPlanGlob)
      const deleteLiterals = deletes.filter(path => !isDesignPlanGlob(path))
      const found = await Promise.all(
        writeLiterals.map(async path => {
          try {
            await stat(resolve(localDir, path))
            return true
          } catch {
            return false
          }
        }),
      )
      const missing = writeLiterals.filter((_path, index) => !found[index])
      const typo =
        writeLiterals.length - missing.length > 0 && missing.length > 0
          ? `⚠ ${missing.length} of ${writeLiterals.length} literal write ${plural(writeLiterals.length, 'path')} not found under localDir — expected if they use a different localPath or inline data, otherwise check for a typo: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? `, … and ${missing.length - 5} more` : ''}`
          : null
      const lines = [
        banner,
        `To project: ${shortDesignProjectId(input.projectId)}`,
        `From folder: ${localDir}`,
        writeLiterals.length > 0
          ? `Upload ${writeLiterals.length} ${plural(writeLiterals.length, 'file')}: ${writeLiterals.join(', ')}`
          : null,
        writeGlobs.length > 0
          ? `Upload files matching: ${writeGlobs.join(', ')}`
          : null,
        typo,
        deleteLiterals.length > 0
          ? `Delete ${deleteLiterals.length} ${plural(deleteLiterals.length, 'file')}: ${deleteLiterals.join(', ')}`
          : null,
        deleteGlobs.length > 0
          ? `Delete files matching: ${deleteGlobs.join(', ')}`
          : null,
      ].filter(line => line !== null)
      return {
        behavior: 'ask',
        message: lines.join('\n'),
        updatedInput: { ...stamped, localDir } as Input,
        localDisplayOnly: true,
        decisionReason: {
          type: 'safetyCheck',
          reason: banner
            ? 'Approving also grants Claude ongoing write access to your design projects.'
            : 'Review what will be uploaded before continuing.',
          classifierApprovable: false,
        },
      }
    }
    if (input.method === 'create_project') {
      const lines = [
        banner,
        `Create design-system project "${input.name ?? '?'}" on claude.ai/design. The new project will be visible to your whole org (server default — you can change this from the Share menu after creation).`,
      ].filter(line => line !== null)
      return {
        behavior: 'ask',
        message: lines.join('\n'),
        updatedInput: stamped,
        localDisplayOnly: true,
        decisionReason: {
          type: 'safetyCheck',
          reason: banner
            ? 'Approving also grants Claude ongoing write access to your design projects.'
            : 'This creates a new project on your claude.ai account.',
          classifierApprovable: false,
        },
      }
    }
    return { behavior: 'allow', updatedInput: stamped }
  },
  async call(input: Input, context: ToolUseContext) {
    if (input.method === 'report_validate') {
      return { data: { method: 'report_validate' } }
    }
    const signal = context.abortController.signal
    const stamped = input as Stamped
    const state = designSessionState(context)
    const shown = stamped.__consentBitShown ?? null
    const askStamp = stamped.__consentAskCanReachUser === true
    const askNow = askStamp && consentAskCanReachUser(context)
    let token = ''
    try {
      token = await designSyncAccessToken(context.credentials, {
        signal,
        isNonInteractiveSession:
          context.options?.isNonInteractiveSession === true,
        permissionMode: permissionMode(context),
        askReachesUser: askStamp,
      })
      if (shown !== null && askNow && input.method === 'finalize_plan') {
        await postDesignConsent(state, context.credentials).catch(error => {
          logForDebugging(
            `Proactive design consent POST for finalize_plan failed (${errorMessage(error)}); the next RPC call's 403 intercept will retry.`,
          )
        })
      }
      let result: DesignSyncResult
      try {
        result = await dispatchDesignSync(state, input, token, signal)
        // A successful non-finalize RPC is not a server grant. Recording the
        // bit locally first makes the next checkPermissions leave `shown`
        // empty, so a later 403 takes the not-shown path and never POSTs.
        if (shown !== null && askNow && input.method !== 'finalize_plan') {
          await postDesignConsent(state, context.credentials).catch(error => {
            logForDebugging(
              `Design consent POST after ${input.method} failed (${errorMessage(error)}); the next call can still show the bit and retry on 403.`,
            )
          })
        }
      } catch (error) {
        const bit = consentBitFromAuthError(error)
        if (bit === null) {
          if (
            (error instanceof DesignAuthError &&
              authBodyError(error) === 'insufficient_scope') ||
            (error instanceof DesignAuthError && error.status === 401)
          ) {
            throw new DesignSyncPreconditionError(
              designSyncPreconditionMessage('needs_design_login', {
                isNonInteractiveSession:
                  context.options?.isNonInteractiveSession === true,
              }),
            )
          }
          throw error
        }
        if (bit !== shown) {
          writeDesignConsentBit(state, bit, false)
          throw new DesignSyncPreconditionError(designConsentNotShownMessage())
        }
        if (!askNow) {
          writeDesignConsentBit(state, bit, false)
          throw new DesignSyncPreconditionError(designConsentNoPromptMessage())
        }
        await postDesignConsent(state, context.credentials)
        result = await dispatchDesignSync(state, input, token, signal)
      }
      return { data: result }
    } catch (error) {
      if (signal.aborted) throw new AbortError()
      const message = redactOauthToken(errorMessage(error), token)
      const telemetry =
        error instanceof DesignAuthError
          ? error.telemetryMessage
          : 'DesignSync tool call failed'
      if (error instanceof DesignSyncPreconditionError) {
        const wrapped = new DesignSyncPreconditionError(message)
        attachTelemetry(wrapped, telemetry)
        throw wrapped
      }
      const wrapped = new Error(message)
      attachTelemetry(wrapped, telemetry)
      throw wrapped
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(output),
    }
  },
})
