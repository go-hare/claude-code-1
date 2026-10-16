/**
 * densable Artifact.checkPermissions portable (2.1.239) — tip-hosted actions.
 * Source: gold-vf-call / gold-Artifact-perm-call / gold-Artifact-rest-actions-239.
 */
import type { ToolUseContext } from 'src/Tool.js'
import type { PermissionResult } from 'src/types/permissions.js'
import { beginArtifactConsentCheck } from 'src/services/artifactAutoReact/readPerm/consent.js'
import {
  checkArtifactReadPermissions,
  isArtifactReadAction,
} from './readPermissions.js'
import {
  artifactViewerUrlFor,
  parseArtifactUrlAnyCase,
  type ParsedArtifactUrl,
} from 'src/utils/artifactUrl.js'
import {
  getAgentContext,
  isDelegatedObservation,
} from 'src/utils/agentContext.js'

export type ArtifactActionInput = {
  action?: string
  url?: string
  thread_id?: string
  text?: string
  html?: string
  file_path?: string
  file_paths?: string[]
  prompt?: string
  page?: unknown
  limit?: number
  scope?: string
  asset_id?: string
  after?: string
  path?: string
  out_dir?: string
  topic?: string
  data?: unknown
  schema?: unknown
  paths?: unknown
}

/** Gold `Tat` — stamped on updatedInput in checkPermissions, not on tT(). */
export const ARTIFACT_DELETE_PIN = '__artifactDeletePin'
/** Gold `Rat` @199726181 — delete ask/dD target pin. */
export const Rat = '__artifactDeleteTarget'

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
  const parsed = parseArtifactUrlAnyCase(url)
  if (!parsed) {
    return { parsed: null, label: 'an artifact (unrecognized address)' }
  }
  return { parsed, label: artifactViewerUrlFor(parsed) }
}

/** Gold `Tu` then `AE` — other-org deny after a hosted ownership probe. */
async function probeThenOtherOrgDeny(
  parsed: ParsedArtifactUrl,
  context: ToolUseContext,
  action: string,
  nothingMsg: string,
  opts?: { readBack?: boolean },
): Promise<PermissionResult | null> {
  const { AE, Tu } = await import(
    'src/services/artifactAutoReact/readPerm/provenance.js'
  )
  await Tu(
    parsed,
    context,
    action,
    opts?.readBack === true ? { readBack: true } : undefined,
  )
  return AE(parsed, nothingMsg)
}

/**
 * densable Artifact.checkPermissions for tip-hosted actions.
 */
export async function checkArtifactActionPermissions(
  input: ArtifactActionInput,
  context: ToolUseContext,
): Promise<PermissionResult> {
  const action = input.action
  beginArtifactConsentCheck(context)

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
    const { label, parsed } = viewerLabel(input.url)
    if (parsed) {
      const { Jr } = await import(
        'src/services/artifactAutoReact/readPerm/commentCaps.js'
      )
      const otherOrg = await probeThenOtherOrgDeny(
        parsed,
        context,
        'reply',
        'Nothing was posted',
        Jr(),
      )
      if (otherOrg !== null) return otherOrg
      const { Ijn, bc } = await import(
        'src/services/artifactAutoReact/readPerm/commentCaps.js'
      )
      if (Ijn(parsed.slug)) return bc('reply')
    }
    const { $A, dD, Izr, md, vm, zen } = await import(
      'src/services/artifactAutoReact/readPerm/consent.js'
    )
    const { Oat, yt } = await import(
      'src/services/artifactAutoReact/readPerm/provenance.js'
    )
    const { getToolPermissionContext } = await import(
      'src/services/artifactAutoReact/readPerm/rules.js'
    )
    const { isStrictHumanTurnTail } = await import('src/utils/turnTail.js')
    const perms = getToolPermissionContext(context)
    const replyAllow = zen(perms, parsed, ['reply'])
    if (replyAllow !== null) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: { type: 'rule', rule: replyAllow },
      }
    }
    // Gold nke=!0 @199734563 so v() = md() && oO(messages) && !plan.
    const nke = true
    const fiveClassWrite =
      md() &&
      isStrictHumanTurnTail(context.messages) &&
      !(nke && perms.mode === 'plan')
    if (fiveClassWrite && parsed !== null) {
      return dD({
        ruling: Izr(
          $A('write', parsed, context, yt(parsed.slug), {
            networkOff: Oat(parsed),
            turnStartedByHuman: true,
          }),
        ),
        input,
        context,
        slug: parsed.slug,
        display: vm(parsed, context),
        action: 'write',
      })
    }
    const preview = previewText(String(input.text ?? ''))
    // Gold jAr @194348914 / eAo / WAr — thread opening preview when hosted.
    const target =
      parsed !== null && threadId !== ''
        ? await (
            await import('src/services/artifactAutoReact/threadPreview.js')
          ).jAr(parsed, threadId, context)
        : undefined
    const { formatCommentTargetAsk, formatCommentThreadAsk } = await import(
      'src/services/artifactAutoReact/threadPreview.js'
    )
    const threadNoun =
      target !== undefined
        ? formatCommentThreadAsk(target)
        : `comment thread ${threadId}`
    return {
      behavior: 'ask',
      message: `Claude wants to reply to ${threadNoun} on ${label} — visible to viewers: "${preview}"`,
      updatedInput: input,
      suppressAlwaysAllowRule: true,
      decisionReason: {
        type: 'other',
        reason:
          target !== undefined
            ? `Posting a reply, visible to viewers, to ${formatCommentTargetAsk(target)} requires confirmation`
            : `Posting a reply to comment thread ${threadId}, visible to viewers, requires confirmation`,
      },
    }
  }

  if (action === 'resolve') {
    const mode = context.getAppState().toolPermissionContext.mode
    const { parsed } = viewerLabel(input.url)
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
    // Gold @210875200 — plan denies; else Tu+AE then allow (no ask).
    if (mode === 'plan') return denyPlan
    if (parsed) {
      const { Jr } = await import(
        'src/services/artifactAutoReact/readPerm/commentCaps.js'
      )
      const otherOrg = await probeThenOtherOrgDeny(
        parsed,
        context,
        'resolve',
        'Nothing was resolved',
        Jr(),
      )
      if (otherOrg !== null) return otherOrg
      const { Ijn, bc } = await import(
        'src/services/artifactAutoReact/readPerm/commentCaps.js'
      )
      if (Ijn(parsed.slug)) return bc('resolve')
    }
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
      typeof input.url === 'string' ? parseArtifactUrlAnyCase(input.url) : null
    const { Fee } = await import('src/services/artifactAutoReact/ownership.js')
    const { $A, dD, K_, k7, md, Sb, T7, vm, Xle, zen } = await import(
      'src/services/artifactAutoReact/readPerm/consent.js'
    )
    const { AE, Oat, Tu, isRemoteCoworkContentHostDenied, yt, zl } =
      await import('src/services/artifactAutoReact/readPerm/provenance.js')
    const { Bte, a_, de, Ow, qR } = await import(
      'src/services/artifactAutoReact/readPerm/rules.js'
    )
    const { isPlanModeArtifactAsk } = await import(
      'src/services/artifactAutoReact/readPerm/surfaces.js'
    )
    const { isStrictHumanTurnTail } = await import('src/utils/turnTail.js')
    // Gold h @210871292: Gf(slug)&&!Xo(s.agentContext). Tip reads ALS.
    const notice =
      parsed !== null &&
      Fee(parsed.slug) &&
      !isDelegatedObservation(getAgentContext())
    const fiveClass = md()
    const ruleOpts = { action: 'comments' as const }
    const pin = K_('comments', parsed)
    const denyByUrl =
      parsed === null
        ? null
        : a_(de(context), parsed, input.url, 'deny', ruleOpts)
    if (denyByUrl !== null) return qR(denyByUrl)
    const { Jr } = await import(
      'src/services/artifactAutoReact/readPerm/commentCaps.js'
    )
    if (fiveClass && notice && parsed !== null) {
      await Tu(parsed, context, 'comments', Jr())
    }
    if (parsed !== null && !notice) {
      k7('comments', context, parsed.slug, false)
    }
    if (parsed !== null && notice) {
      const otherOrg = AE(parsed, 'Nothing was read')
      if (otherOrg !== null) return otherOrg
      const perms = de(context)
      const denyByCall = Ow(perms, parsed, input.url, 'deny', ruleOpts)
      if (denyByCall !== null) return qR(denyByCall)
      const askByUrl = a_(perms, parsed, input.url, 'ask', ruleOpts)
      k7('comments', context, parsed.slug, true, askByUrl !== null)
      const replyAllow = zen(perms, parsed)
      if (replyAllow !== null && askByUrl === null) {
        return {
          behavior: 'allow',
          updatedInput: { ...input, ...pin },
          decisionReason: { type: 'rule', rule: replyAllow },
        }
      }
      if (fiveClass && askByUrl === null && !zl(yt(parsed.slug))) {
        const foreign = Xle(
          context,
          'Nothing was read',
          isRemoteCoworkContentHostDenied(parsed),
        )
        if (foreign !== null) return foreign
      }
      const { label } = viewerLabel(input.url)
      const feeAsk = `Claude wants to read the comment threads on ${label} — prompted by the new-comments notification; comment text is written by artifact viewers`
      if (askByUrl === null) {
        const noSurface = T7(context, 'Nothing was read', feeAsk)
        if (noSurface !== null) return noSurface
      }
      const threadId =
        typeof input.thread_id === 'string' ? input.thread_id : undefined
      const { formatCommentTargetAsk, jAr } = await import(
        'src/services/artifactAutoReact/threadPreview.js'
      )
      const opening =
        threadId !== undefined
          ? await jAr(parsed, threadId, context)
          : undefined
      const displayTitle = vm(parsed, context).title
      return {
        behavior: 'ask',
        message: feeAsk,
        updatedInput: { ...input, ...pin },
        suppressAlwaysAllowRule: true,
        decisionReason:
          askByUrl !== null
            ? { type: 'rule', rule: askByUrl }
            : {
                type: 'other',
                reason:
                  opening !== undefined
                    ? `${displayTitle ? `the artifact "${displayTitle}"` : feeAsk} The thread starts with ${formatCommentTargetAsk(opening)}.`
                    : 'Notification-triggered comments read requires confirmation outside auto-allow channels',
              },
      }
    }
    const askByUrl =
      parsed === null
        ? null
        : a_(de(context), parsed, input.url, 'ask', ruleOpts)
    if (askByUrl !== null && parsed !== null) {
      const { label } = viewerLabel(input.url)
      return {
        behavior: 'ask',
        message: `Claude wants to read the comment threads on ${label}${Bte(askByUrl)}; comment text is written by artifact viewers`,
        updatedInput: { ...input, ...pin },
        suppressAlwaysAllowRule: true,
        decisionReason: { type: 'rule', rule: askByUrl },
      }
    }
    if (fiveClass && parsed !== null) {
      await Tu(parsed, context, 'comments', Jr())
      const otherOrg = AE(parsed, 'Nothing was read')
      if (otherOrg !== null) return otherOrg
      const perms = de(context)
      const denyByCall = Ow(perms, parsed, input.url, 'deny', ruleOpts)
      if (denyByCall !== null) return qR(denyByCall)
      const askAgain = a_(perms, parsed, input.url, 'ask', ruleOpts)
      if (askAgain !== null) {
        const { label } = viewerLabel(input.url)
        return {
          behavior: 'ask',
          message: `Claude wants to read the comment threads on ${label}${Bte(askAgain)}; comment text is written by artifact viewers`,
          updatedInput: { ...input, ...pin },
          suppressAlwaysAllowRule: true,
          decisionReason: { type: 'rule', rule: askAgain },
        }
      }
      const ruling = Sb(
        $A('read', parsed, context, yt(parsed.slug), {
          networkOff: Oat(parsed),
          turnStartedByHuman: isStrictHumanTurnTail(context.messages),
        }),
      )
      return dD({
        ruling:
          ruling.ask && isPlanModeArtifactAsk(context)
            ? { ...ruling, remember: 'this_call' }
            : ruling,
        input: { ...input, ...pin },
        context,
        slug: parsed.slug,
        display: vm(parsed, context),
        action: 'comments',
        userOnly: isRemoteCoworkContentHostDenied(parsed),
      })
    }
    return {
      behavior: 'allow',
      updatedInput: { ...input, ...pin },
      decisionReason: {
        type: 'other',
        reason: 'Reading comments is a scoped read of one named artifact',
      },
    }
  }

  if (action === 'watch') {
    const { label, parsed } = viewerLabel(input.url)
    const { un } = await import('src/services/artifactAutoReact/store.js')
    const { hasAskClassArtifactRemembered, md } = await import(
      'src/services/artifactAutoReact/readPerm/consent.js'
    )
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
    // densable: md()&&IAr(s,"standing_job",slug) — remembered standing-job yes.
    const standingRemembered =
      parsed !== null &&
      md() &&
      hasAskClassArtifactRemembered(context, 'standing_job', parsed.slug)
    if ((already && !stopped) || standingRemembered) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'other',
          reason: standingRemembered
            ? 'Standing-job consent for this artifact was already remembered'
            : 'Already watching this artifact in this session',
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
      localDisplayOnly: true,
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

  if (action === 'quickstart') {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'other',
        reason:
          'Quickstart reads the type catalog and guidance this session may already read without asking',
      },
    }
  }

  if (isArtifactReadAction(action)) {
    return checkArtifactReadPermissions({ ...input, action }, context)
  }

  if (action === 'status') {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'other',
        reason: `Artifact ${action} is a scoped read`,
      },
    }
  }

  if (action === 'read') {
    const parsed =
      typeof input.url === 'string' ? parseArtifactUrlAnyCase(input.url) : null
    if (parsed === null) {
      return {
        behavior: 'deny',
        message:
          'This is not an artifact url Claude can read. Use the artifact url from the list or publish result.',
        decisionReason: {
          type: 'safetyCheck',
          reason: 'Unparseable artifact url — ownership cannot be probed',
          classifierApprovable: false,
        },
      }
    }
    const {
      Wu,
      T7,
      Xle,
      dD,
      vm,
      E7,
      md,
      Yw,
      qm,
      OP,
      TE,
      Ltn,
      hp,
      pp,
      k7,
      Im,
      Bjt,
      Gtn,
      planConsentMustDeny,
    } = await import('src/services/artifactAutoReact/readPerm/consent.js')
    const {
      Tu,
      AE,
      yt,
      zl,
      jD,
      Pbe,
      Sh,
      xct,
      fq,
      G0,
      Oat,
      attestedGoneTypeRead,
    } = await import('src/services/artifactAutoReact/readPerm/provenance.js')
    const { de, Ow, M1n, SAr, qR, _r, cn, Aat } = await import(
      'src/services/artifactAutoReact/readPerm/rules.js'
    )
    const { Fee, ownershipSuffix } = await import(
      'src/services/artifactAutoReact/ownership.js'
    )
    const { getAgentContext, isDelegatedObservation } = await import(
      'src/utils/agentContext.js'
    )
    const { isStrictHumanTurnTail } = await import('src/utils/turnTail.js')
    const readOpts = { prompt: input.prompt, page: input.page }
    const webFetchDeny = M1n(de(context), parsed, input.url, 'deny', readOpts)
    if (webFetchDeny !== null) return qR(webFetchDeny)
    const pageDeny = SAr(de(context), parsed, input.url, 'deny', readOpts)
    if (pageDeny !== null) return qR(pageDeny)
    await Tu(parsed, context, 'read', { readBack: true })
    const otherOrg = AE(parsed, 'Nothing was read')
    if (otherOrg !== null) return otherOrg
    const perms = de(context)
    const callDeny = Ow(perms, parsed, input.url, 'deny', {
      action: 'read',
      read: readOpts,
    })
    if (callDeny !== null) return qR(callDeny)
    const webFetchAsk = M1n(perms, parsed, input.url, 'ask', readOpts)
    const pageAsk = SAr(perms, parsed, input.url, 'ask', readOpts)
    const askRule = webFetchAsk ?? pageAsk
    const status = yt(parsed.slug)
    const isOwn = zl(status)
    const delegated = isDelegatedObservation(getAgentContext())
    const notice = Fee(parsed.slug) && !delegated
    const fiveClass =
      !notice && askRule === null && md() && perms.mode !== 'plan'
        ? E7(parsed, context, {
            status,
            networkOff: Oat(parsed),
            turnStartedByHuman: isStrictHumanTurnTail(context.messages),
            attested:
              fq(context, parsed.slug) ||
              attestedGoneTypeRead(context, parsed.slug),
          })
        : null
    k7('read', context, parsed.slug, notice, askRule !== null)
    const Rn = { [Ltn]: { action: 'read', slug: parsed.slug } }
    const nn = { [Wu]: false, [qm]: false, [OP]: false }
    const userOnly = Pbe(isOwn, parsed)
    const ir = perms.mode === 'plan'
    const qn = !isOwn && !ir && (perms.mode !== 'auto' || userOnly)
    const display = vm(parsed, context)
    const viewer = artifactViewerUrlFor(parsed)
    // densable Aat = jjt && Otn.
    if (!isOwn && Aat(context, parsed, input.url, readOpts)) {
      return {
        behavior: 'allow',
        updatedInput: { ...input, ...nn, ...Rn },
        decisionReason: {
          type: 'other',
          reason:
            'Read of this shared artifact already approved this conversation',
        },
      }
    }
    // densable Er = lt||!fq ? void 0 : Sh; then Er&&!St&&gt===null&&!md().
    const attested =
      isOwn || !fq(context, parsed.slug) ? undefined : Sh(parsed.slug)
    if (attested !== undefined && !notice && askRule === null && !md()) {
      const label = xct(attested)
      if (label !== undefined) {
        return {
          behavior: 'allow',
          updatedInput: { ...input, ...nn, ...Rn },
          decisionReason: {
            type: 'other',
            reason: `Reading ${label} needs no approval`,
          },
        }
      }
    }
    if (fiveClass !== null) {
      const stampWu =
        !isOwn &&
        Bjt(fiveClass) &&
        fiveClass.about !== 'outside_org' &&
        (perms.mode !== 'auto' || userOnly) &&
        Im(context)
      const decided = dD({
        ruling: fiveClass,
        input: { ...input, ...nn, ...Rn },
        context,
        slug: parsed.slug,
        display,
        action: 'read',
        userOnly,
        ...(stampWu && { consentHeld: false }),
      })
      if (decided.behavior === 'ask' && stampWu) {
        const rs = `${decided.message} Its content enters this conversation ${hp}; ${pp}.`
        return {
          ...decided,
          message: rs,
          updatedInput: { ...decided.updatedInput, [Wu]: true },
          decisionReason:
            decided.decisionReason?.type === 'safetyCheck'
              ? { ...decided.decisionReason, reason: rs }
              : decided.decisionReason,
        }
      }
      return decided
    }
    if (isOwn && !notice && askRule === null) {
      return {
        behavior: 'allow',
        updatedInput: { ...input, ...nn, ...Rn },
        decisionReason: {
          type: 'other',
          reason: "Reading the user's own artifact",
        },
      }
    }
    if (!isOwn && planConsentMustDeny(context)) {
      return {
        behavior: 'deny',
        message:
          "Reading someone else's artifact from plan mode needs a consent surface, and no one can answer the prompt in this session. Keep planning in the plan file and raise the read with the user in chat; do not retry this read in this session.",
        decisionReason: {
          type: 'safetyCheck',
          reason:
            "Plan-mode reads of someone else's artifact require a live human consent surface",
          classifierApprovable: false,
        },
      }
    }
    const noAnswer =
      !isOwn && askRule === null
        ? Xle(context, 'Nothing was read', userOnly)
        : null
    if (noAnswer !== null) return noAnswer
    const noticeAsk = `Claude wants to read ${viewer} — prompted by the new-comments notification${ownershipSuffix(status)}`
    if (notice && askRule === null) {
      const noticeDeny = T7(context, 'Nothing was read', noticeAsk)
      if (noticeDeny !== null) return noticeDeny
    }
    const hs = isOwn
      ? 'the artifact'
      : jD(status)
        ? "someone else's artifact"
        : "an artifact whose ownership couldn't be confirmed"
    const or = qn && !notice && askRule === null
    const ps = or ? `; ${pp}` : ''
    const ownAsk =
      webFetchAsk !== null
        ? `Claude wants to read your artifact at ${viewer} — your ${_r} ask rule covers artifact reads`
        : pageAsk?.ruleValue.ruleContent?.startsWith('url:')
          ? `Claude wants to read your artifact at ${viewer} — your ${cn} ask rule covers this url`
          : `Claude wants to read your artifact at ${viewer} — your ${cn} ask rule covers artifact reads`
    const message = notice
      ? noticeAsk
      : isOwn
        ? ownAsk
        : `Claude wants to read ${hs} at ${viewer} — its content enters this conversation${
            jD(status) ? ` ${hp}` : ''
          }${ps}${G0(status) ? `. ${Gtn}` : ''}`
    const reason = notice
      ? 'Notification-triggered artifact read requires confirmation outside auto-allow channels'
      : `Reading ${hs} requires confirmation — its content enters the conversation${
          or
            ? '; approval covers re-reads of this artifact for the rest of the conversation'
            : ''
        }`
    return {
      behavior: 'ask',
      message,
      updatedInput: {
        ...input,
        ...Rn,
        [Wu]: or && Im(context),
        [qm]: false,
        [OP]:
          Yw() && !isOwn && (userOnly || ir || askRule !== null) && Im(context),
        [TE]: display,
      },
      suppressAlwaysAllowRule: true,
      decisionReason:
        ir && !isOwn
          ? {
              type: 'safetyCheck',
              reason: `Reading ${hs} in plan mode admits third-party content into the conversation — approval must come from the user, not the auto-permission classifier`,
              classifierApprovable: false,
            }
          : askRule !== null
            ? { type: 'rule', rule: askRule }
            : userOnly
              ? { type: 'safetyCheck', reason, classifierApprovable: false }
              : { type: 'other', reason },
      localDisplayOnly: true,
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
    if (
      typeof input.url === 'string' &&
      parseArtifactUrlAnyCase(input.url) === null
    ) {
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
    const parsed = parseArtifactUrlAnyCase(input.url)!
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
          reason:
            'Unparseable Artifact url — the delete cannot be addressed or probed for ownership',
          classifierApprovable: false,
        },
      }
    }
    const { probeArtifactOwnership, jnt, Tgr } = await import(
      'src/services/artifactAutoReact/ownership.js'
    )
    const { AE } = await import(
      'src/services/artifactAutoReact/readPerm/provenance.js'
    )
    const status = await probeArtifactOwnership(parsed, {
      signal: context.abortController.signal,
      toolUseId: context.toolUseId,
      debugLabel: 'delete',
    })
    const otherOrg = AE(parsed, 'Nothing was deleted')
    if (otherOrg !== null) return otherOrg
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
    // Gold @211246851 — Jrs audience + mp publishedThisSession + Rat stamp.
    const { $A, dD, Jrs, md, mp, Sb, vm } = await import(
      'src/services/artifactAutoReact/readPerm/consent.js'
    )
    const { Oat } = await import(
      'src/services/artifactAutoReact/readPerm/provenance.js'
    )
    const { isStrictHumanTurnTail } = await import('src/utils/turnTail.js')
    const display = vm(parsed, context, status?.title)
    const published = mp(context.getAppState().frameUrls, parsed.slug)
    const audience = Jrs(status)
    const named = display.title
      ? `the artifact "${display.title}"`
      : `the artifact at ${label}`
    const publishedNote =
      published !== undefined ? '' : ' This conversation did not publish it.'
    const message = `Claude wants to permanently delete ${named} (${audience}). Its link will stop working for everyone, its comments and version history are deleted too, and this can't be undone.${publishedNote}`
    const rat = {
      url: display.url,
      ...(display.title !== undefined ? { title: display.title } : {}),
      audience,
      shareMode: status?.mode ?? 'unknown',
      publishedThisSession: published !== undefined,
    }
    const stamped = {
      ...input,
      [ARTIFACT_DELETE_PIN]: { slug: parsed.slug },
      [Rat]: rat,
    }
    if (md()) {
      return dD({
        ruling: Sb(
          $A('delete', parsed, context, status, {
            networkOff: Oat(parsed),
            turnStartedByHuman: isStrictHumanTurnTail(context.messages),
          }),
        ),
        input: stamped,
        context,
        slug: parsed.slug,
        display,
        action: 'delete',
      })
    }
    return {
      behavior: 'ask',
      message,
      updatedInput: stamped,
      suppressAlwaysAllowRule: true,
      localDisplayOnly: true,
      decisionReason: {
        type: 'safetyCheck',
        reason: message,
        classifierApprovable: false,
      },
    }
  }

  if (action === 'upload_asset') {
    const { label, parsed } = viewerLabel(input.url)
    if (!parsed) {
      return {
        behavior: 'deny',
        message:
          'This is not an artifact url Claude can upload an asset to. Use the artifact url from the list or publish result.',
        decisionReason: {
          type: 'safetyCheck',
          reason:
            'Unparseable artifact url — the asset upload cannot be addressed or probed for ownership',
          classifierApprovable: false,
        },
      }
    }
    if (input.file_path !== undefined && input.file_paths !== undefined) {
      return {
        behavior: 'deny',
        message:
          'action "upload_asset" takes `file_path` (one file) or `file_paths` (several), not both.',
        decisionReason: {
          type: 'other',
          reason:
            'Asset upload input names its files in both fields, or in a list that cannot be read',
        },
      }
    }
    const batchPaths = input.file_paths
    if (input.file_path === undefined && batchPaths === undefined) {
      return {
        behavior: 'deny',
        message: 'file_path is required to upload an asset',
        decisionReason: {
          type: 'other',
          reason: 'Asset upload input missing file_path',
        },
      }
    }
    const { expandPath } = await import('src/utils/path.js')
    const { FileReadTool } = await import('../FileReadTool/FileReadTool.js')
    const { Gqe, resolveUploadSource } = await import(
      'src/services/artifactAutoReact/readPerm/uploadReadGate.js'
    )
    const { gNe, Wu, qm, arePermissionPromptsUnavailable } = await import(
      'src/services/artifactAutoReact/readPerm/consent.js'
    )
    const { de } = await import(
      'src/services/artifactAutoReact/readPerm/rules.js'
    )
    const perms = de(context)
    const uploadPins: Array<{
      real: string
      identity: string | null
      linked?: boolean
    }> = []
    const readDenied = (filePath: string): PermissionResult | null => {
      const source = resolveUploadSource(filePath)
      if (source.kind === 'network') {
        return {
          behavior: 'deny',
          message: 'Asset uploads read only local, non-network paths',
          decisionReason: {
            type: 'other',
            reason: 'Asset uploads read only local, non-network paths',
          },
        }
      }
      const gate = Gqe(
        FileReadTool,
        { file_path: filePath },
        filePath,
        source,
        perms,
        undefined,
      )
      if (gate.refused !== undefined) return gate.refused
      uploadPins.push(gate.sourcePin ?? { real: filePath, identity: null })
      return null
    }
    if (batchPaths !== undefined) {
      if (batchPaths.length === 0) {
        return {
          behavior: 'deny',
          message:
            'action "upload_asset" takes `file_path` (one file) or `file_paths` (several), not both.',
          decisionReason: {
            type: 'other',
            reason: 'Asset upload list cannot be read',
          },
        }
      }
      for (const path of batchPaths) {
        const blocked = readDenied(expandPath(path))
        if (blocked !== null) return blocked
      }
    } else if (input.file_path !== undefined) {
      const blocked = readDenied(expandPath(input.file_path))
      if (blocked !== null) return blocked
    }
    // Gold @211226481 — Tu + AE before Xqe/ask.
    const otherOrg = await probeThenOtherOrgDeny(
      parsed,
      context,
      'upload_asset',
      'Nothing was uploaded',
    )
    if (otherOrg !== null) return otherOrg
    const { hasArtifactAssetUploadConsent } = await import(
      'src/services/artifactAutoReact/readPerm/grants.js'
    )
    const { ip, YBe } = await import(
      'src/services/artifactAutoReact/ownership.js'
    )
    const uploadPin =
      batchPaths !== undefined
        ? {
            [gNe]: {
              slug: parsed.slug,
              batch: uploadPins,
            },
          }
        : {
            [gNe]: {
              slug: parsed.slug,
              ...(uploadPins[0] ?? {
                real: expandPath(input.file_path ?? ''),
                identity: null,
              }),
            },
          }
    // Gold Xqe @210614011 / @211226914 — already approved this session.
    if (hasArtifactAssetUploadConsent(context, parsed.slug)) {
      return {
        behavior: 'allow',
        updatedInput: { ...input, ...uploadPin, [Wu]: false, [qm]: false },
        decisionReason: {
          type: 'other',
          reason:
            'Asset uploads to this artifact already approved this session',
        },
      }
    }
    const mode = perms.mode
    // Gold b_(n) @211228000 — plan with no consent surface.
    if (mode === 'plan' && arePermissionPromptsUnavailable(context)) {
      return {
        behavior: 'deny',
        message:
          'Asset uploads from plan mode need a consent surface, and no one can answer the prompt in this session. Keep planning in the plan file and raise the upload with the user in chat; do not retry this upload in this session.',
        decisionReason: {
          type: 'safetyCheck',
          reason:
            'Plan-mode artifact asset uploads require a live human consent surface',
          classifierApprovable: false,
        },
      }
    }
    const { getIsInteractive } = await import('src/bootstrap/state.js')
    const canReachUser =
      mode !== 'bypassPermissions' &&
      !(
        mode === 'plan' &&
        context.getAppState().toolPermissionContext
          .isBypassPermissionsModeAvailable === true &&
        getIsInteractive()
      )
    const coversSession = mode !== 'auto'
    const ownership = YBe(ip(parsed.slug), 'their artifact')
    const listed =
      batchPaths !== undefined
        ? batchPaths.map(path => `"${path}"`).join(', ')
        : undefined
    const askLead =
      listed !== undefined
        ? `Claude wants to upload ${batchPaths!.length} local ${
            batchPaths!.length === 1 ? 'file' : 'files'
          } into the asset store of ${label}: ${listed} — everyone who can open the artifact can load them`
        : `Claude wants to upload an asset to ${label} — everyone who can open the artifact can load it`
    return {
      behavior: 'ask',
      message: `${askLead}${
        coversSession
          ? '; approving covers further uploads to this artifact for the rest of this session.'
          : '; each such upload asks again.'
      }${ownership}`,
      updatedInput: {
        ...input,
        ...uploadPin,
        [Wu]: coversSession && canReachUser,
        [qm]: mode === 'plan',
      },
      suppressAlwaysAllowRule: true,
      localDisplayOnly: true,
      decisionReason:
        mode === 'plan'
          ? {
              type: 'safetyCheck',
              reason: `Artifact ${action} mutates published asset storage`,
              classifierApprovable: false,
            }
          : {
              type: 'other',
              reason: `Artifact ${action} mutates published asset storage`,
            },
    }
  }

  if (action === 'delete_asset') {
    const { label, parsed } = viewerLabel(input.url)
    const { ARTIFACT_ASSET_ID_RE } = await import(
      'src/services/artifactAutoReact/outDirPaths.js'
    )
    const { eH, Wu, qm, arePermissionPromptsUnavailable } = await import(
      'src/services/artifactAutoReact/readPerm/consent.js'
    )
    const { de } = await import(
      'src/services/artifactAutoReact/readPerm/rules.js'
    )
    const assetId =
      typeof input.asset_id === 'string' ? input.asset_id : undefined
    if (
      parsed === null ||
      assetId === undefined ||
      !ARTIFACT_ASSET_ID_RE.test(assetId)
    ) {
      return {
        behavior: 'deny',
        message:
          parsed === null
            ? 'This is not an artifact url Claude can delete an asset from. Use the artifact url from the list or publish result.'
            : 'asset_id (32 hex characters) is required to delete an asset',
        decisionReason: {
          type: 'safetyCheck',
          reason:
            'Unparseable artifact url or asset id — the delete cannot be addressed or probed for ownership',
          classifierApprovable: false,
        },
      }
    }
    // Gold b_(n)||l0(n) — l0 KEEP; hosted uses the no-surface half.
    if (arePermissionPromptsUnavailable(context)) {
      return {
        behavior: 'deny',
        message:
          'Deleting an artifact asset needs a consent surface, and no one can answer the prompt in this session. Do not retry the delete in this session.',
        decisionReason: {
          type: 'safetyCheck',
          reason: 'Artifact asset deletes require a live human consent surface',
          classifierApprovable: false,
        },
      }
    }
    const mode = de(context).mode
    // Gold mt: plan || servedCall || (!owned && _b). servedCall/_b KEEP.
    const userOnly = mode === 'plan'
    return {
      behavior: 'ask',
      message: `Claude wants to permanently delete asset ${assetId} from the asset store of ${label} — any page or database row that references it will break, and this cannot be undone; each delete asks separately.`,
      updatedInput: {
        ...input,
        // Gold eH @211244084 — {action, slug, assetId}; Wu/qm false (no remember).
        [eH]: { action: 'delete_asset', slug: parsed.slug, assetId },
        [Wu]: false,
        [qm]: false,
      },
      suppressAlwaysAllowRule: true,
      localDisplayOnly: true,
      decisionReason: {
        type: 'safetyCheck',
        reason: `Claude wants to permanently delete asset ${assetId} from ${label}${
          userOnly
            ? ' — approval must come from the user, not the auto-permission classifier'
            : ''
        }`,
        classifierApprovable: !userOnly,
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
    a === 'list_files' ||
    a === 'quickstart'
  )
}

/** densable isDestructive — delete / delete_asset only. */
export function isArtifactActionDestructive(
  input: ArtifactActionInput | undefined,
): boolean {
  const a = input?.action
  return a === 'delete' || a === 'delete_asset'
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
    a === 'list_files' ||
    a === 'quickstart'
  )
}
