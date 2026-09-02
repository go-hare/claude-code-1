/**
 * densable Artifact.checkPermissions portable (2.1.239) — tip-hosted actions.
 * Source: gold-vf-call / gold-Artifact-perm-call / gold-Artifact-rest-actions-239.
 */
import type { ToolUseContext } from 'src/Tool.js'
import type { PermissionResult } from 'src/types/permissions.js'
import {
  artifactViewerUrlFor,
  parseArtifactUrl,
  type ParsedArtifactUrl,
} from 'src/utils/artifactUrl.js'

export type ArtifactActionInput = {
  action?: string
  url?: string
  thread_id?: string
  text?: string
  html?: string
  file_path?: string
  prompt?: string
  limit?: number
  scope?: string
  asset_id?: string
  after?: string
  path?: string
  out_dir?: string
  topic?: string
  data?: unknown
  schema?: unknown
  __outDirPin?: {
    action: 'read_file' | 'read_asset'
    slug: string
    stem: string
    path?: string
    assetId?: string
  }
  __deleteConfirm?: { slug: string }
}

function previewText(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 3)}…` : text
}

function viewerLabel(url: string | undefined): {
  parsed: ParsedArtifactUrl | null
  label: string
} {
  if (typeof url !== 'string') {
    return { parsed: null, label: 'an artifact (unrecognized address)' }
  }
  const parsed = parseArtifactUrl(url)
  if (!parsed) {
    return { parsed: null, label: 'an artifact (unrecognized address)' }
  }
  return { parsed, label: artifactViewerUrlFor(parsed) }
}

function modeAllowsQuietRead(mode: string | undefined): boolean {
  return (
    mode === 'bypassPermissions' || mode === 'acceptEdits' || mode === 'auto'
  )
}

/**
 * densable Artifact.checkPermissions for tip-hosted actions.
 */
export async function checkArtifactActionPermissions(
  input: ArtifactActionInput,
  context: ToolUseContext,
): Promise<PermissionResult> {
  const action = input.action

  if (action === 'live-edit') {
    const {
      getArtifactLiveEditVf,
      planConsentMustDeny,
      getToolPermissionContextFromToolUse,
    } = await import('src/services/artifactAutoReact/liveEditPermissions.js')
    const vf = getArtifactLiveEditVf()
    if (!vf) {
      return {
        behavior: 'deny',
        message: 'live-edit is not available in this build',
        decisionReason: { type: 'other', reason: 'not available' },
      }
    }
    return vf.checkLiveEditPermissions(
      {
        action: 'live-edit',
        url: String(input.url ?? ''),
        html: String(input.html ?? ''),
      },
      context,
      {
        planConsentMustDeny,
        getToolPermissionContext: getToolPermissionContextFromToolUse,
      },
    )
  }

  if (action === 'reply') {
    const threadId = String(input.thread_id ?? '')
    const { label } = viewerLabel(input.url)
    const preview = previewText(String(input.text ?? ''))
    return {
      behavior: 'ask',
      message: `Claude wants to reply to comment thread ${threadId} on ${label} — visible to viewers: "${preview}"`,
      updatedInput: input,
      suppressAlwaysAllowRule: true,
      decisionReason: {
        type: 'other',
        reason: `Posting a reply to comment thread ${threadId}, visible to viewers, requires confirmation`,
      },
    }
  }

  if (action === 'resolve') {
    const mode = context.getAppState().toolPermissionContext.mode
    const threadId = String(input.thread_id ?? '')
    const { label } = viewerLabel(input.url)
    const denyPlan: PermissionResult = {
      behavior: 'deny',
      message:
        'Resolving a comment thread is a write visible to artifact viewers, and plan mode only plans — note the intended resolve in the plan and run it when executing.',
      decisionReason: {
        type: 'safetyCheck',
        reason: 'Plan mode never mutates comment-thread state',
        classifierApprovable: false,
      },
    }
    if (mode === 'plan') return denyPlan
    if (mode === 'bypassPermissions' || mode === 'auto') {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'other',
          reason:
            "Resolving a comment thread is a reversible, server-gated flip under the thread's activation grant",
        },
      }
    }
    return {
      behavior: 'ask',
      message: `Claude wants to resolve comment thread ${threadId} on ${label} — visible to viewers`,
      updatedInput: input,
      suppressAlwaysAllowRule: true,
      decisionReason: {
        type: 'other',
        reason:
          'Resolving a comment thread is visible to viewers and requires confirmation',
      },
    }
  }

  if (action === 'list') {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'other',
        reason:
          input.scope === 'mine'
            ? "Listing the user's own artifacts is a read-only action"
            : 'Listing artifacts published by or shared with the user is a read-only action',
      },
    }
  }

  if (action === 'comments') {
    const parsed =
      typeof input.url === 'string' ? parseArtifactUrl(input.url) : null
    const { Fee } = await import('src/services/artifactAutoReact/ownership.js')
    // densable gb(agentContext): local has no delegatedObservation; skip Fee
    // ask on subagent agentId only (same as ArtifactTool comments census).
    const notice =
      parsed !== null && Fee(parsed.slug) && context.agentId === undefined
    if (parsed !== null && notice) {
      const { label } = viewerLabel(input.url)
      return {
        behavior: 'ask',
        message: `Claude wants to read the comment threads on ${label} — prompted by the new-comments notification; comment text is written by artifact viewers`,
        updatedInput: input,
        suppressAlwaysAllowRule: true,
        decisionReason: {
          type: 'other',
          reason:
            'Notification-triggered comments read requires confirmation outside auto-allow channels',
        },
      }
    }
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'other',
        reason: 'Reading comments is a scoped read of one named artifact',
      },
    }
  }

  if (action === 'watch') {
    const { label, parsed } = viewerLabel(input.url)
    const { un } = await import('src/services/artifactAutoReact/store.js')
    const latches = un().durable.stopLatches
    const stopped = parsed !== null && latches.isStopped(parsed.slug)
    if (stopped && context.toolUseId) {
      latches.noteRelatchAsk(context.toolUseId, parsed!.slug)
    }
    const already =
      parsed !== null &&
      [...un().live.supervisors.values()].some(
        s => s.slug === parsed.slug && !s.stopped,
      )
    if (already && !stopped) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'other',
          reason: 'Already watching this artifact in this session',
        },
      }
    }
    return {
      behavior: 'ask',
      message: stopped
        ? `Claude wants to watch an artifact whose watch was deliberately stopped earlier — ${label}. Approve to clear the stop and re-arm the live socket.`
        : `Claude wants to watch ${label} for new comments (opens a live connection for this session)`,
      updatedInput: input,
      suppressAlwaysAllowRule: true,
      decisionReason: stopped
        ? {
            type: 'safetyCheck',
            reason:
              'Re-watching a stop-latched artifact requires explicit user approval',
            classifierApprovable: false,
          }
        : {
            type: 'other',
            reason: 'Watching an artifact opens a live comment subscription',
          },
    }
  }

  if (action === 'unwatch') {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'other',
        reason: 'Stopping a watch is a local session teardown',
      },
    }
  }

  if (
    action === 'status' ||
    action === 'list_assets' ||
    action === 'list_files'
  ) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'other',
        reason: `Artifact ${action} is a scoped read`,
      },
    }
  }

  if (action === 'read_file') {
    const { resolveFileOutDest, isNetworkOrDevicePath, artifactJweWriteBlock } =
      await import('src/services/artifactAutoReact/outDirPaths.js')
    const destRes = resolveFileOutDest({
      url: input.url,
      path: input.path,
      out_dir: input.out_dir,
    })
    if ('reason' in destRes) {
      return {
        behavior: 'deny',
        message: destRes.reason,
        decisionReason: {
          type: 'other',
          reason:
            'File read input has a missing or malformed path, or an unresolvable out_dir',
        },
      }
    }
    if (isNetworkOrDevicePath(destRes.dest)) {
      return {
        behavior: 'deny',
        message:
          'read_file saves only to local directories — out_dir names a network path',
        decisionReason: {
          type: 'other',
          reason: 'Artifact reads write only local, non-network paths',
        },
      }
    }
    const jwe = artifactJweWriteBlock(destRes.dest, {
      agentId: context.agentId,
      agentWorktree: context.agentWorktree,
    })
    if (jwe) {
      return {
        behavior: 'deny',
        message: jwe,
        decisionReason: {
          type: 'other',
          reason: 'read_file destination blocked by worktree isolation (jwe)',
        },
      }
    }
    const { label, parsed } = viewerLabel(input.url)
    return {
      behavior: 'ask',
      message: `Claude wants to save file ${input.path ?? '(no path)'} of ${label} → ${destRes.dest}`,
      updatedInput: {
        ...input,
        __outDirPin: parsed
          ? {
              action: 'read_file' as const,
              slug: parsed.slug,
              stem: destRes.dest,
              path: input.path,
            }
          : undefined,
      },
      suppressAlwaysAllowRule: true,
      decisionReason: {
        type: 'other',
        reason:
          'Saving a published artifact file to disk requires confirmation',
      },
    }
  }

  if (action === 'read_asset') {
    const {
      resolveAssetOutStem,
      isNetworkOrDevicePath,
      artifactJweWriteBlock,
      ARTIFACT_ASSET_ID_RE,
    } = await import('src/services/artifactAutoReact/outDirPaths.js')
    if (
      typeof input.asset_id !== 'string' ||
      !ARTIFACT_ASSET_ID_RE.test(input.asset_id)
    ) {
      return {
        behavior: 'deny',
        message:
          'read_asset needs a valid asset_id (32 hex characters), and out_dir, when given, must be a resolvable local path',
        decisionReason: {
          type: 'other',
          reason:
            'Asset read input has a missing or malformed asset_id, or an unresolvable out_dir',
        },
      }
    }
    const stem = resolveAssetOutStem({
      url: input.url,
      asset_id: input.asset_id,
      out_dir: input.out_dir,
    })
    if (stem === undefined || isNetworkOrDevicePath(stem)) {
      return {
        behavior: 'deny',
        message:
          'read_asset needs a valid asset_id (32 hex characters), and out_dir, when given, must be a resolvable local path',
        decisionReason: {
          type: 'other',
          reason:
            'Asset read input has a missing or malformed asset_id, or an unresolvable out_dir',
        },
      }
    }
    const jwe = artifactJweWriteBlock(stem, {
      agentId: context.agentId,
      agentWorktree: context.agentWorktree,
    })
    if (jwe) {
      return {
        behavior: 'deny',
        message: jwe,
        decisionReason: {
          type: 'other',
          reason: 'read_asset destination blocked by worktree isolation (jwe)',
        },
      }
    }
    const { label, parsed } = viewerLabel(input.url)
    return {
      behavior: 'ask',
      message: `Claude wants to save asset ${input.asset_id} of ${label} → ${stem}.*`,
      updatedInput: {
        ...input,
        __outDirPin: parsed
          ? {
              action: 'read_asset' as const,
              slug: parsed.slug,
              stem,
              assetId: input.asset_id.toLowerCase(),
            }
          : undefined,
      },
      suppressAlwaysAllowRule: true,
      decisionReason: {
        type: 'other',
        reason: 'Saving an artifact asset to disk requires confirmation',
      },
    }
  }

  if (action === 'read') {
    const { label } = viewerLabel(input.url)
    const mode = context.getAppState().toolPermissionContext.mode
    if (modeAllowsQuietRead(mode)) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'other',
          reason: `Permission mode ${mode} allows artifact ${action}`,
        },
      }
    }
    return {
      behavior: 'ask',
      message: `Claude wants to read ${label} — its content enters this conversation`,
      updatedInput: input,
      suppressAlwaysAllowRule: true,
      decisionReason: {
        type: 'other',
        reason: `Reading an artifact requires confirmation — its content enters the conversation`,
      },
    }
  }

  if (action === 'verify') {
    const { isArtifactVerifyGateOpen } = await import(
      'src/services/artifactAutoReact/restApis.js'
    )
    if (!isArtifactVerifyGateOpen()) {
      return {
        behavior: 'deny',
        message: 'verify is not available in this session.',
        decisionReason: {
          type: 'safetyCheck',
          reason: 'Verify gate closed at schema freeze',
          classifierApprovable: false,
        },
      }
    }
    if (typeof input.url === 'string' && parseArtifactUrl(input.url) === null) {
      return {
        behavior: 'deny',
        message:
          'This is not an artifact url Claude can read diagnostics from. Use the artifact url from the list or publish result.',
        decisionReason: {
          type: 'safetyCheck',
          reason: 'Unparseable artifact url — ownership cannot be probed',
          classifierApprovable: false,
        },
      }
    }
    if (typeof input.url !== 'string') {
      return {
        behavior: 'deny',
        message:
          "Nothing to verify: pass the artifact url, or publish first. Without `url`, verify targets this session's most recent publish.",
        decisionReason: {
          type: 'safetyCheck',
          reason: 'No verify target — no url and no publish this session',
          classifierApprovable: false,
        },
      }
    }
    const parsed = parseArtifactUrl(input.url)!
    const { probeArtifactOwnership, jnt, Fee, ownershipSuffix } = await import(
      'src/services/artifactAutoReact/ownership.js'
    )
    const status = await probeArtifactOwnership(parsed, {
      signal: context.abortController.signal,
      toolUseId: context.toolUseId,
      debugLabel: 'verify',
    })
    const { label } = viewerLabel(input.url)
    const notice = Fee(parsed.slug)
    if (jnt(status)) {
      if (notice) {
        return {
          behavior: 'ask',
          message: `Claude wants to read the runtime diagnostics of ${label} — prompted by the new-comments notification; diagnostics there are captured from artifact viewers' browsers`,
          updatedInput: input,
          suppressAlwaysAllowRule: true,
          decisionReason: {
            type: 'other',
            reason:
              'Notification-triggered diagnostics read requires confirmation outside auto-allow channels',
          },
        }
      }
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'other',
          reason: "Reading runtime diagnostics of the user's own artifact",
        },
      }
    }
    return {
      behavior: 'deny',
      message:
        status?.probeFailed === true
          ? 'Ownership of this artifact could not be confirmed right now, and diagnostics are owner-only. Try again.'
          : `Artifact runtime diagnostics are owner-only: they can be read only for the user's own artifacts.${ownershipSuffix(status)}`,
      decisionReason: {
        type: 'safetyCheck',
        reason: 'Verify reads are owner-only',
        classifierApprovable: false,
      },
    }
  }

  if (action === 'read_page_data') {
    const schema = input.schema
    const {
      VRm,
      CGi,
      listRegisteredInteractionSchemaNames,
      freezeReadPageDataSchemaNames,
      listEnabledInteractionSchemaNames,
    } = await import('src/services/artifactAutoReact/interactionSchemas.js')
    // densable freezes on input-schema build; tip freezes lazily on first check
    // when still undefined (capability open, enabled names — usually empty).
    const { un } = await import('src/services/artifactAutoReact/store.js')
    if (un().frozenReadPageDataSchemaNames === undefined) {
      freezeReadPageDataSchemaNames(true, listEnabledInteractionSchemaNames())
    }
    if (schema === undefined) {
      const frozen = un().frozenReadPageDataSchemaNames
      const hint =
        frozen && frozen.size > 0 ? ` (e.g. "${[...frozen][0]}")` : ''
      return {
        behavior: 'deny',
        message: `action "read_page_data" requires \`schema\` — the registered interaction schema to validate against${hint}.`,
        decisionReason: {
          type: 'safetyCheck',
          reason: 'read_page_data requires schema',
          classifierApprovable: false,
        },
      }
    }
    if (!VRm(schema)) {
      const frozen = un().frozenReadPageDataSchemaNames
      return {
        behavior: 'deny',
        message: `interaction schema "${String(schema)}" is not available in this session. Available schemas: ${[...(frozen ?? [])].join(', ') || '(none)'}.`,
        decisionReason: {
          type: 'safetyCheck',
          reason: 'read_page_data schema not frozen for session',
          classifierApprovable: false,
        },
      }
    }
    const looked = CGi(String(schema))
    if (!looked.ok) {
      return {
        behavior: 'deny',
        message:
          looked.reason === 'unknown'
            ? `unknown interaction schema "${String(schema)}" — registered schemas: ${listRegisteredInteractionSchemaNames().join(', ') || '(none)'}.`
            : `interaction schema "${String(schema)}" failed validation in this build — report this; nothing can be read against it.`,
        decisionReason: {
          type: 'safetyCheck',
          reason: 'read_page_data CGi unavailable',
          classifierApprovable: false,
        },
      }
    }
    // densable continues to ask; tip asks when schema is enabled+frozen
    return {
      behavior: 'ask',
      message: `Read page-data island (${String(schema)}) from artifact?`,
      decisionReason: {
        type: 'safetyCheck',
        reason: 'read_page_data requires confirmation',
        classifierApprovable: false,
      },
    }
  }

  if (action === 'room_send') {
    const mode = context.getAppState().toolPermissionContext.mode
    if (mode === 'plan') {
      return {
        behavior: 'deny',
        message:
          'Live room events cannot be sent from plan mode. Finish planning first; do not retry this room_send while in plan mode.',
        decisionReason: {
          type: 'safetyCheck',
          reason:
            'Plan mode does not broadcast live events to artifact viewers',
          classifierApprovable: false,
        },
      }
    }
    const { getArtifactRoomHost } = await import(
      'src/services/artifactAutoReact/restApis.js'
    )
    if (!getArtifactRoomHost()) {
      return {
        behavior: 'deny',
        message:
          'room_send is not available in this build — no live room host is bound.',
        decisionReason: {
          type: 'safetyCheck',
          reason: 'Artifact room host unbound (densable LEe=null)',
          classifierApprovable: false,
        },
      }
    }
    const { label } = viewerLabel(input.url)
    const topic = String(input.topic ?? '')
    return {
      behavior: 'ask',
      message: `Claude wants to send a live "${topic}" event to everyone currently viewing ${label} (not stored)`,
      updatedInput: input,
      suppressAlwaysAllowRule: true,
      decisionReason: {
        type: 'safetyCheck',
        reason:
          'Sending a live event to everyone currently viewing the artifact can be steered by those viewers',
        classifierApprovable: false,
      },
    }
  }

  if (action === 'delete') {
    const mode = context.getAppState().toolPermissionContext.mode
    if (mode === 'plan') {
      return {
        behavior: 'deny',
        message:
          'Artifacts cannot be deleted from plan mode. Finish planning first; do not retry this delete while in plan mode.',
        decisionReason: {
          type: 'safetyCheck',
          reason: 'Plan mode does not delete Artifacts',
          classifierApprovable: false,
        },
      }
    }
    const { isArtifactDeleteSchemaOpen } = await import(
      'src/services/artifactAutoReact/restApis.js'
    )
    if (!isArtifactDeleteSchemaOpen()) {
      return {
        behavior: 'deny',
        message: 'action "delete" is not available in this session',
        decisionReason: {
          type: 'safetyCheck',
          reason: 'Delete schema gate closed',
          classifierApprovable: false,
        },
      }
    }
    const { label, parsed } = viewerLabel(input.url)
    if (!parsed) {
      return {
        behavior: 'deny',
        message:
          'This is not an Artifact url Claude can delete. Use the Artifact\'s claude.ai link from the publish result or action "list".',
        decisionReason: {
          type: 'safetyCheck',
          reason: 'Unparseable Artifact url',
          classifierApprovable: false,
        },
      }
    }
    const { probeArtifactOwnership, jnt, Tgr } = await import(
      'src/services/artifactAutoReact/ownership.js'
    )
    const status = await probeArtifactOwnership(parsed, {
      signal: context.abortController.signal,
      toolUseId: context.toolUseId,
      debugLabel: 'delete',
    })
    if (!jnt(status)) {
      const foreign =
        Tgr(status) || (status !== undefined && !status.probeFailed)
      const gone =
        status?.probeFailed === true && status.probeErrorCode === 'boot_404'
      return {
        behavior: 'deny',
        message: foreign
          ? `The Artifact at ${label} belongs to someone else, and only its owner can delete it. Nothing was deleted; tell the user.`
          : gone
            ? `There is no Artifact at ${label} — it may already be deleted, the link is wrong, or it isn't one the user can see. Nothing to delete; tell the user.`
            : `Couldn't confirm that the Artifact at ${label} is the user's own, so nothing was deleted. Retry once; if it still fails, delete it from claude.ai.`,
        decisionReason: {
          type: 'safetyCheck',
          reason: foreign
            ? "Only an Artifact's owner can delete it"
            : gone
              ? 'No Artifact at that url that the user can see'
              : 'Artifact ownership could not be confirmed before a delete',
          classifierApprovable: false,
        },
      }
    }
    return {
      behavior: 'ask',
      message: `Claude wants to permanently delete ${label}`,
      updatedInput: {
        ...input,
        // densable Utn confirm pin — tip stamps slug on approval path
        __deleteConfirm: { slug: parsed.slug },
      },
      suppressAlwaysAllowRule: true,
      decisionReason: {
        type: 'safetyCheck',
        reason: 'Artifact deletes require live human confirmation',
        classifierApprovable: false,
      },
    }
  }

  if (action === 'upload_asset' || action === 'delete_asset') {
    const { label } = viewerLabel(input.url)
    return {
      behavior: 'ask',
      message:
        action === 'upload_asset'
          ? `Claude wants to upload an asset to ${label}`
          : `Claude wants to delete asset ${input.asset_id ?? ''} from ${label}`,
      updatedInput: input,
      suppressAlwaysAllowRule: true,
      decisionReason: {
        type: 'other',
        reason: `Artifact ${action} mutates published asset storage`,
      },
    }
  }

  // tip upload (no action) — allow; densable publish has its own path
  if (!action) {
    return {
      behavior: 'allow',
      updatedInput: input,
    }
  }

  return {
    behavior: 'deny',
    message: `Unknown artifact action ${JSON.stringify(action)}`,
    decisionReason: {
      type: 'safetyCheck',
      reason: 'Unrecognized artifact action defaults to deny',
      classifierApprovable: false,
    },
  }
}

/** densable isConcurrencySafe. */
export function isArtifactActionConcurrencySafe(
  input: ArtifactActionInput | undefined,
): boolean {
  const a = input?.action
  return (
    a === 'list' ||
    a === 'read' ||
    a === 'comments' ||
    a === 'status' ||
    a === 'read_page_data' ||
    a === 'verify' ||
    a === 'list_assets' ||
    a === 'list_files'
  )
}

/** densable isReadOnly. */
export function isArtifactActionReadOnly(
  input: ArtifactActionInput | undefined,
): boolean {
  const a = input?.action
  return (
    a === 'list' ||
    a === 'read' ||
    a === 'comments' ||
    a === 'status' ||
    a === 'read_page_data' ||
    a === 'verify' ||
    a === 'list_assets' ||
    a === 'list_files'
  )
}
