/**
 * densable vf — live-edit permission surface (2.1.239).
 *
 * densable Artifact module keeps `vf=null` until a feature bind; checkPermissions
 * does `if (!vf) deny "live-edit is not available in this build"`. Tip mirrors
 * that gate via getArtifactLiveEditVf(); product install binds the module.
 */
import type { ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import type { PermissionResult } from '../../types/permissions.js'

export type LiveEditPermissionInput = {
  action: 'live-edit'
  url: string
  html: string
}

export type LiveEditPermissionOpts = {
  planConsentMustDeny?: (ctx: unknown) => boolean
  getToolPermissionContext: (ctx: unknown) => ToolPermissionContext
}

export type ArtifactLiveEditVf = {
  checkLiveEditPermissions: (
    input: LiveEditPermissionInput,
    toolUseContext: unknown,
    opts: LiveEditPermissionOpts,
  ) => Promise<PermissionResult>
  classifyLiveEdit: (input: LiveEditPermissionInput) => string
  /** densable vf.runLiveEditAction — publish path after permissions. */
  runLiveEditAction?: (
    input: LiveEditPermissionInput,
    signal?: AbortSignal,
  ) => Promise<{ data: Record<string, unknown> }>
}

/** densable `vf` — null until product / host binds. */
let vf: ArtifactLiveEditVf | null = null

export function getArtifactLiveEditVf(): ArtifactLiveEditVf | null {
  return vf
}

export function setArtifactLiveEditVf(next: ArtifactLiveEditVf | null): void {
  vf = next
}

export function resetArtifactLiveEditVfForTests(): void {
  vf = null
}

/**
 * densable `twe` portable — no live human consent surface (headless / avoid prompts).
 */
export function planConsentMustDeny(toolUseContext: unknown): boolean {
  const ctx = toolUseContext as ToolUseContext | null
  if (!ctx || typeof ctx.getAppState !== 'function') return false
  try {
    const mode = ctx.getAppState().toolPermissionContext
    if (mode?.shouldAvoidPermissionPrompts === true) return true
  } catch {
    /* densable optional */
  }
  if (ctx.options?.isNonInteractiveSession === true) return true
  return false
}

/**
 * densable `gn` portable — ToolPermissionContext from ToolUseContext.
 */
export function getToolPermissionContextFromToolUse(
  toolUseContext: unknown,
): ToolPermissionContext {
  const ctx = toolUseContext as ToolUseContext
  return ctx.getAppState().toolPermissionContext
}

/**
 * densable vf.checkLiveEditPermissions — plan deny; auto/bypass allow;
 * acceptEdits, default, and dontAsk ask. Outer hasPermissionsToUseTool
 * maps dontAsk ask→deny. acceptEdits is local file edits only — live-edit
 * immediately mutates the published page every viewer sees.
 * Message copy is tip-local (SEA keeps vf=null so official body is not bound here).
 */
export async function checkLiveEditPermissions(
  input: LiveEditPermissionInput,
  toolUseContext: unknown,
  opts: LiveEditPermissionOpts,
): Promise<PermissionResult> {
  const mode = opts.getToolPermissionContext(toolUseContext).mode
  if (mode === 'plan') {
    return {
      behavior: 'deny',
      message:
        'live-edit mutates a published artifact, and plan mode only plans — note the intended edit in the plan and run it when executing.',
      decisionReason: {
        type: 'safetyCheck',
        reason: 'Plan mode never mutates published artifact pages',
        classifierApprovable: false,
      },
    }
  }
  if (mode === 'bypassPermissions' || mode === 'auto') {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'other',
        reason: `Permission mode ${mode} allows live-edit`,
      },
    }
  }
  if (opts.planConsentMustDeny?.(toolUseContext) === true) {
    return {
      behavior: 'deny',
      message:
        'live-edit needs a consent surface, and no one can answer the prompt in this session.',
      decisionReason: {
        type: 'safetyCheck',
        reason: 'No live human consent surface',
        classifierApprovable: false,
      },
    }
  }
  return {
    behavior: 'ask',
    message: `Claude wants to live-edit the published artifact at ${input.url} — the page will update for viewers immediately.`,
    updatedInput: input,
    suppressAlwaysAllowRule: true,
    decisionReason: {
      type: 'other',
      reason: 'Publishing a live-edit requires confirmation',
    },
  }
}

/** densable vf.classifyLiveEdit — short classifier label. */
export function classifyLiveEdit(_input: LiveEditPermissionInput): string {
  return 'live-edit artifact'
}

/** densable vf.runLiveEditAction — tip publishArtifactHtml. */
export async function runLiveEditAction(
  input: LiveEditPermissionInput,
  signal?: AbortSignal,
): Promise<{ data: Record<string, unknown> }> {
  const { parseArtifactUrl } = await import('../../utils/artifactUrl.js')
  const parsed = parseArtifactUrl(input.url)
  const slug = parsed?.slug
  if (!slug) {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        published: false,
        error: 'url is not a recognized artifact address',
      },
    }
  }
  const { publishArtifactHtml } = await import('./edit.js')
  const r = await publishArtifactHtml({
    slug,
    html: input.html,
    signal: signal ?? new AbortController().signal,
  })
  if (!r.ok) {
    return {
      data: {
        id: '',
        url: '',
        expiresAt: '',
        published: false,
        error: r.message,
      },
    }
  }
  return {
    data: {
      id: '',
      url: '',
      expiresAt: '',
      published: true,
      ...(r.ver !== undefined ? { ver: r.ver } : {}),
    },
  }
}

export const artifactLiveEditVf: ArtifactLiveEditVf = {
  checkLiveEditPermissions,
  classifyLiveEdit,
  runLiveEditAction,
}
