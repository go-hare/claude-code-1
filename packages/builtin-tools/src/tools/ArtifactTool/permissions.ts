/**
 * densable Artifact.checkPermissions portable (2.1.239) — tip-hosted actions.
 * Source: gold-vf-call / gold-Artifact-perm-call / gold-Artifact-rest-actions-239.
 */
import type { ToolUseContext } from 'src/Tool.js'
import type { PermissionResult } from 'src/types/permissions.js'
import {
  beginArtifactConsentCheck,
  Loe,
} from 'src/services/artifactAutoReact/readPerm/consent.js'
import { yt } from 'src/services/artifactAutoReact/readPerm/provenance.js'
import { getClientType } from 'src/bootstrap/state.js'
import { isBgSession } from 'src/utils/concurrentSessions.js'
import { isTeammate } from 'src/utils/teammate.js'
import { isUserDrivenTurn } from 'src/utils/turnTail.js'
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

/**
 * densable upload-ask cover clause (gNe / Wf).
 * `copyFrom` is gold `Q6()`; `untilComments` is gold `Ght && Xqe` (`ar` / `Ee`).
 */
function uploadAskCoverClause(
  coversSession: boolean,
  copyFrom: boolean,
  untilComments: boolean,
): string {
  if (!coversSession) return '; each such upload asks again.'
  const into = copyFrom
    ? "to (and copies of other artifacts' assets into) "
    : 'to '
  const until = untilComments
    ? 'until someone else comments on it again'
    : 'for the rest of this session'
  return `; approving covers further uploads ${into}this artifact ${until}.`
}

/** densable `kce` — reply body cap, in Unicode code points. */
const REPLY_PREVIEW_CODE_POINTS = 4096
const THREAD_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** densable `njn` — stop-latch asks that are not a user-started turn. */
const WATCH_NOT_USER_TURN =
  'this request did not come in a turn this session can verify the user started (a task notification, a wakeup, or a stop receipt started it — or a typed /command, whose origin is not recorded)'

/** densable `e0t` + `wst` — fold whitespace and quotes, then cap code points. */
function replyPreview(text: string): string {
  if (text === '') return ''
  const folded = text
    .replace(/[\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/"/g, "'")
    .trim()
  if (Array.from(text).length <= REPLY_PREVIEW_CODE_POINTS) return folded
  return `${Array.from(folded).slice(0, REPLY_PREVIEW_CODE_POINTS).join('')}\u2026`
}

function replyThreadId(threadId: string): string {
  return THREAD_ID_RE.test(threadId) ? threadId : '(invalid)'
}

/** densable `BCo` / `EF` — audience follows the artifact share status. */
function replyAudience(parsed: ParsedArtifactUrl | null): string {
  if (parsed === null) {
    return 'viewers of this artifact (share status could not be confirmed)'
  }
  const status = yt(parsed.slug)
  if (status === undefined || status.probeFailed === true) {
    return 'viewers of this artifact (share status could not be confirmed)'
  }
  if (status.mode === 'owner') {
    return 'viewers of this artifact (not currently shared)'
  }
  const who =
    status.external === true && status.mode === 'users'
      ? 'specific users in another organization'
      : Loe(status.mode)
  return `${who} (the artifact is shared)`
}

/**
 * densable `Pat` / `q6` — remote, or a publish context that can hold the
 * live socket (interactive, sdk, bg_session). Sub-agent, teammate, and print
 * cannot re-arm a stopped watch.
 */
function watchSessionCanRearm(context: ToolUseContext): boolean {
  if (process.env.CLAUDE_CODE_REMOTE) return true
  const agent = getAgentContext()
  const client = getClientType()
  const interactive =
    context.options.isNonInteractiveSession !== true ||
    client === 'claude-vscode'
  const kind =
    agent?.agentType === 'teammate' || isTeammate()
      ? 'teammate'
      : context.agentId !== undefined
        ? 'subagent'
        : isBgSession()
          ? 'bg_session'
          : client === 'sdk-ts' || client === 'sdk-py'
            ? 'sdk'
            : interactive
              ? 'interactive'
              : 'print'
  return kind === 'interactive' || kind === 'sdk' || kind === 'bg_session'
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

const WATCH_REPLIES_AGAIN =
  '. If you can edit it and gave its link, approving also lets comments sent to Claude reach this session again, where Claude may answer them unattended — unless its auto-replies were stopped (those stay stopped until you ask to resume them; auto-replies only paused by an interrupt — Ctrl+C or Stop — do resume)'
const WATCH_REPLIES_CLOUD =
  ' and, if you can edit it and gave its link, lets comments sent to Claude reach this session again, where Claude may answer them unattended — unless its auto-replies were stopped (those stay stopped until you ask to resume them; auto-replies only paused by an interrupt — Ctrl+C or Stop — do resume)'
const WATCH_FIRST_REPLIES =
  '. If you can edit it and gave its link, comments on it sent to Claude reach this session and Claude may answer them unattended'
const WATCH_FIRST_COVERS =
  '. Approving covers watching artifacts for the rest of this session'
const WATCH_FIRST_COVERS_AGAIN =
  ' (turning on auto-replies for another artifact asks again)'
const WATCH_DECISION_REPLIES =
  ', and will automatically reply to comments on it that are sent to Claude'
const WATCH_DECISION_COMMENT_WAKE =
  ', and when a comment on any watched artifact is sent to Claude'
const WATCH_DECISION_COVERS_SESSION =
  " Claude won't ask again to watch other artifacts for the rest of this session."
const WATCH_ALREADY_REPLIES =
  'Claude wants this session to also answer comments sent to Claude on this artifact (only if you can edit it; Claude may answer them unattended, for the rest of this session). Watching it is already approved.'

/**
 * densable `JBn(commentsOn, repliesCanResume, isLive)` — stopped-watch ask
 * copy after the em dash. Not the viewer URL.
 */
export function JBn(
  commentsOn: boolean,
  repliesCanResume: boolean,
  isLive: boolean,
): string {
  if (isLive) {
    return `approving resumes keeping track of new versions of it published elsewhere for the rest of this session; a new version starts no turn and sends no notification${repliesCanResume ? WATCH_REPLIES_AGAIN : ''}`
  }
  return `approving resumes republish notifications${
    commentsOn
      ? ' (and, in a cloud session, the wake when a comment on it is sent to Claude, which Claude may then read and answer)'
      : ''
  } for the rest of this session${repliesCanResume ? WATCH_REPLIES_CLOUD : ''}; republish notifications carry no content`
}

/**
 * densable `YBn(commentsOn, repliesCanResume, isLive)` — first watch ask copy
 * after the em dash.
 */
export function YBn(
  commentsOn: boolean,
  repliesCanResume: boolean,
  isLive: boolean,
): string {
  if (isLive) {
    return `this session keeps track of new versions of it published elsewhere (another session, or someone saving from the page) over a live background connection; a new version starts no turn and sends no notification${repliesCanResume ? WATCH_FIRST_REPLIES : ''}${WATCH_FIRST_COVERS}${repliesCanResume ? WATCH_FIRST_COVERS_AGAIN : ''}`
  }
  return `this session is notified when it is republished elsewhere (another session, or someone saving from the page)${repliesCanResume ? ` and, if you can edit it and gave its link, comments on it sent to Claude reach this session and Claude may answer them unattended` : ''}. A local session holds a live background connection; a cloud session is woken with a new turn${
    commentsOn
      ? ', also when a comment on any watched artifact is sent to Claude, which Claude may then read and answer'
      : ''
  }${WATCH_FIRST_COVERS}${repliesCanResume ? WATCH_FIRST_COVERS_AGAIN : ''}; republish notifications carry no content`
}

function watchDecisionCopy(
  head: string,
  opts: {
    replies: boolean
    commentWake: boolean
    coversSession: boolean
  },
): string {
  return `${head}${opts.replies ? WATCH_DECISION_REPLIES : ''}${opts.commentWake ? WATCH_DECISION_COMMENT_WAKE : ''}.${opts.coversSession ? WATCH_DECISION_COVERS_SESSION : ''}`
}

/** densable `sxr` — stopped-watch decisionReason. */
export function sxr(opts: {
  live: boolean
  replies: boolean
  commentWake: boolean
  coversSession: boolean
}): string {
  return watchDecisionCopy(
    opts.live
      ? 'Watching this artifact was stopped earlier this session. Claude will again keep track of new versions of it published elsewhere'
      : "Watching this artifact was stopped earlier this session. Claude will be notified again when it's republished",
    opts,
  )
}

/** densable `XBn` — first-watch decisionReason. */
export function XBn(opts: {
  live: boolean
  replies: boolean
  commentWake: boolean
  coversSession: boolean
}): string {
  return watchDecisionCopy(
    opts.live
      ? 'Claude will keep track of new versions of this artifact published elsewhere'
      : 'Claude will be notified when this artifact is republished',
    opts,
  )
}

/** densable `oxr` — first-watch replies-on-already-approved. */
export function oxr(coversSession: boolean): string {
  return `Claude will also automatically reply to comments on this artifact that are sent to Claude.${coversSession ? WATCH_DECISION_COVERS_SESSION : ''}`
}

function gbCached(name: string, fallback: boolean): boolean {
  // Lazy: permissions ↔ growthbook cycle at module init.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getFeatureValue_CACHED_MAY_BE_STALE } =
    require('src/services/analytics/growthbook.js') as typeof import('src/services/analytics/growthbook.js')
  return getFeatureValue_CACHED_MAY_BE_STALE(name, fallback) === true
}

/** densable `Sne` / `JR` — `CLAUDE_CODE_ARTIFACT_COMMENTS ?? tengu_teal_corbel`. */
export function JR(): boolean {
  const raw = process.env.CLAUDE_CODE_ARTIFACT_COMMENTS
  if (raw !== undefined) return Boolean(raw)
  return gbCached('tengu_teal_corbel', false)
}

/** densable `Pne` — `k("tengu_slate_lantern", false)`. */
function Pne(): boolean {
  return gbCached('tengu_slate_lantern', false)
}

/** densable `z5` — REMOTE durable; lantern live; else none. */
export function z5(): 'durable' | 'live' | 'none' {
  if (process.env.CLAUDE_CODE_REMOTE) return 'durable'
  return Pne() ? 'live' : 'none'
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
    const preview = replyPreview(String(input.text ?? ''))
    const audience = replyAudience(parsed)
    const tid = replyThreadId(threadId)
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
        : `comment thread ${tid}`
    return {
      behavior: 'ask',
      message: `Claude wants to reply to ${threadNoun} on ${label} — visible to ${audience}: "${preview}"`,
      updatedInput: input,
      suppressAlwaysAllowRule: true,
      decisionReason: {
        type: 'other',
        reason:
          target !== undefined
            ? `Posting a reply, visible to ${audience}, to ${formatCommentTargetAsk(target)} requires confirmation`
            : `Posting a reply to comment thread ${tid}, visible to ${audience}, requires confirmation`,
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
    const { parsed } = viewerLabel(input.url)
    const { un } = await import('src/services/artifactAutoReact/store.js')
    const { hasAskClassArtifactRemembered, md, _U } = await import(
      'src/services/artifactAutoReact/readPerm/consent.js'
    )
    const { mI } = await import('src/services/artifactAutoReact/gates.js')
    const latches = un().durable.stopLatches
    const stopped = parsed !== null && latches.isStopped(parsed.slug)
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
    if (stopped && !watchSessionCanRearm(context)) {
      return {
        behavior: 'deny',
        message:
          'Not watching: watching this artifact was stopped earlier in this session, and re-arming it needs the session that holds the live watch — this session type (a sub-agent, teammate or print session) cannot hold one. Nothing here needs approval; the user can ask for it from the main conversation. Do not reply to its comments yourself in this turn either — list them for the user.',
        decisionReason: {
          type: 'other',
          reason:
            'This session shape cannot hold the live socket a re-watch re-arms — clearing the stop here would arm nothing',
        },
      }
    }
    if (stopped && !isUserDrivenTurn(context.messages)) {
      return {
        behavior: 'deny',
        message: `Not watching: watching this artifact was stopped earlier in this session, and ${WATCH_NOT_USER_TURN}. Raise it with the user; if they want it watched again, their own next message can ask for it. Do not reply to its comments yourself in this turn either — list them for the user.`,
        decisionReason: {
          type: 'safetyCheck',
          reason:
            'Re-watching an artifact whose watch was stopped this session — only a request made in a turn the user started may ask for it',
          classifierApprovable: false,
        },
      }
    }
    // densable `z5` / `Pne` / `Sne`/`JR`: REMOTE → durable; tengu_slate_lantern
    // → live; else none. commentsOn = CLAUDE_CODE_ARTIFACT_COMMENTS ?? teal_corbel.
    const watchRail = z5()
    const commentsOn = JR()
    const replyDeclined =
      parsed !== null && un().live.repliesConsent.declined.has(parsed.slug)
    // densable third deny: durable && JR() && declined && !_U("standing_job").
    if (
      watchRail === 'durable' &&
      commentsOn &&
      parsed !== null &&
      replyDeclined &&
      !_U('standing_job', parsed.slug)
    ) {
      return {
        behavior: 'deny',
        message:
          "Not starting a watch: an earlier ask in this session, to let Claude reply to this artifact's comments, wasn't approved. If the user wants it watched, their own next message with its link can ask again.",
        decisionReason: {
          type: 'safetyCheck',
          reason:
            "Watching an artifact whose comment-replies ask went unapproved this session — only the user's own new message with its link may ask again",
          classifierApprovable: false,
        },
      }
    }
    if (stopped && context.toolUseId) {
      latches.noteRelatchAsk(context.toolUseId, parsed!.slug)
    }
    if (standingRemembered) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'other',
          reason:
            'Standing-job consent for this artifact was already remembered',
        },
      }
    }
    // densable `(w||h)&&!F&&(!Z||U.approved)` — already-watching allow only
    // when this call is not also arming replies (Z / `_a()&&!declined`).
    const isLive = watchRail === 'live'
    const repliesCanResume = isLive && commentsOn && mI() && !replyDeclined
    if (already && !stopped && !repliesCanResume) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'other',
          reason: 'Already watching this artifact in this session',
        },
      }
    }
    // densable `V=!h` — `h` is AppState.artifactWatchApproved===true (KEEP, not
    // hosted). Unset → coversSession true.
    const coversSession = true
    const commentWake = watchRail === 'durable' && commentsOn
    const decisionOpts = {
      live: isLive,
      replies: repliesCanResume,
      commentWake,
      coversSession,
    }
    // densable `le=Z&&(w||h)` — replies ask while already watching.
    const repliesOnAlready = repliesCanResume && already && !stopped
    return {
      behavior: 'ask',
      message: stopped
        ? `Claude wants to watch an artifact whose watch was deliberately stopped earlier this session — ${JBn(commentsOn, repliesCanResume, isLive)}`
        : repliesOnAlready
          ? WATCH_ALREADY_REPLIES
          : `Claude wants to watch an artifact — ${YBn(commentsOn, repliesCanResume, isLive)}`,
      updatedInput: input,
      suppressAlwaysAllowRule: true,
      localDisplayOnly: true,
      decisionReason: stopped
        ? {
            type: 'safetyCheck',
            reason: sxr(decisionOpts),
            classifierApprovable: true,
          }
        : repliesCanResume
          ? {
              type: 'safetyCheck',
              reason: repliesOnAlready
                ? oxr(coversSession)
                : XBn({
                    live: isLive,
                    replies: true,
                    commentWake,
                    coversSession,
                  }),
              classifierApprovable: true,
            }
          : {
              type: 'other',
              reason: XBn(decisionOpts),
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
    const {
      Gqe,
      resolveUploadSource,
      uploadArn,
      uploadNeedsOwnApproval,
      uploadOwnApprovalReason,
    } = await import(
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
    const judged: Array<{
      written: string
      spelled: string
      arn: boolean
      gate: Exclude<ReturnType<typeof Gqe>, { refused: PermissionResult }>
    }> = []
    const readDenied = (written: string): PermissionResult | null => {
      const spelled = expandPath(written)
      const source = resolveUploadSource(spelled)
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
        { file_path: spelled },
        spelled,
        source,
        perms,
        undefined,
        'Uploading an asset reads file contents',
      )
      if (gate.refused !== undefined) return gate.refused
      uploadPins.push(gate.sourcePin ?? { real: spelled, identity: null })
      judged.push({
        written,
        spelled,
        arn: uploadArn(spelled, source),
        gate,
      })
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
        const blocked = readDenied(path)
        if (blocked !== null) return blocked
      }
    } else if (input.file_path !== undefined) {
      const blocked = readDenied(input.file_path)
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
    const { hasOtherCommentSightings, latestOtherCommentSeq } = await import(
      'src/services/artifactAutoReact/store.js'
    )
    const { md } = await import(
      'src/services/artifactAutoReact/readPerm/consent.js'
    )
    const { isStrictHumanTurnTail } = await import('src/utils/turnTail.js')
    const { ip, YBe } = await import(
      'src/services/artifactAutoReact/ownership.js'
    )
    const { isArtifactCopyFromOn } = await import(
      'src/services/artifactAutoReact/readPerm/surfaces.js'
    )
    // densable gt(ln,wn) — ask stamps zht; session allow omits seq.
    const gNePin = (seq?: number) =>
      batchPaths !== undefined
        ? {
            [gNe]: {
              slug: parsed.slug,
              batch: uploadPins,
              ...(seq !== undefined ? { otherCommentSeq: seq } : {}),
            },
          }
        : {
            [gNe]: {
              slug: parsed.slug,
              ...(uploadPins[0] ?? {
                real: expandPath(input.file_path ?? ''),
                identity: null,
              }),
              ...(seq !== undefined ? { otherCommentSeq: seq } : {}),
            },
          }
    const uploadPin = gNePin()
    const askPin = gNePin(latestOtherCommentSeq(parsed.slug))
    const mode = perms.mode
    // densable cNn / coversSession — auto never covers; own-approval files don't.
    const coversSession =
      mode !== 'auto' &&
      judged.every(row => !uploadNeedsOwnApproval(row.gate, row.arn))
    // densable Wf — a file_paths list is all-or-nothing before any ask.
    if (batchPaths !== undefined) {
      const own = judged.flatMap((row, index) => {
        const reason = uploadOwnApprovalReason(
          row.spelled,
          row.gate,
          row.arn,
          perms,
        )
        if (reason === undefined) return []
        const base = row.written.split(/[/\\]/).pop()
        const label = base !== undefined && base.length > 0 ? base : row.written
        return [`file_paths[${index}] ${label} (${reason})`]
      })
      if (own.length > 0) {
        const one = own.length === 1
        return {
          behavior: 'deny',
          message: `${one ? 'One file' : `${own.length} files`} in \`file_paths\` ${one ? 'needs' : 'need'} an approval of ${one ? 'its' : 'their'} own, so nothing was uploaded: ${own.join('; ')}. Upload ${one ? 'it' : 'each of those'} in its own call with \`file_path\`; the other files can go together in one \`file_paths\` call.`,
          decisionReason: {
            type: 'other',
            reason:
              'An upload list carries only files that need no approval of their own',
          },
        }
      }
    }
    // Gold session allow: coversSession && !Ght && (!md || !oO || plan) && Xqe.
    // nke is true in this build, so the plan disjunct is mode === 'plan'.
    const fiveClassHuman =
      md() && isStrictHumanTurnTail(context.messages) && mode !== 'plan'
    if (
      coversSession &&
      !hasOtherCommentSightings(parsed.slug) &&
      !fiveClassHuman &&
      hasArtifactAssetUploadConsent(context, parsed.slug)
    ) {
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
        : `Claude wants to upload the local file "${
            uploadPins[0]?.real ??
            (input.file_path !== undefined ? expandPath(input.file_path) : '')
          }" into the asset store of ${label} — everyone who can open the artifact can load it`
    const untilComments =
      hasOtherCommentSightings(parsed.slug) &&
      hasArtifactAssetUploadConsent(context, parsed.slug)
    return {
      behavior: 'ask',
      message: `${askLead}${uploadAskCoverClause(
        coversSession,
        isArtifactCopyFromOn(),
        untilComments,
      )}${ownership}`,
      updatedInput: {
        ...input,
        ...askPin,
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
