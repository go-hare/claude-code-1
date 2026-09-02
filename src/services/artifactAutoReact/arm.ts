/**
 * densable aGi / _Wt / Lkm — Artifact live-subscribe arm (2.1.239).
 * Source: gold-aGi-239 / gold-Lkm-239 / gold-aGi-mid-239.
 *
 * Tip: control-plane mint + WS open are injectable. Product hosts call
 * `installDefaultArtifactLiveArmDeps()` (Qem + Cji). Without deps, arm still
 * registers monitor_ws + supervisor when `localArmWithoutSocket` (tests /
 * offline) or returns skipped `no_subscription_token` matching SEA.
 */
import type { SetAppState } from '../../Task.js'
import { Gso, SN } from './gates.js'
import { armCommentMonitorIntent } from './intent.js'
import { interruptLedgerSlug, ensureLedgerHydrated } from './ledger.js'
import { monitorSocketRegistry } from './oF.js'
import {
  bindSupervisorTaskId,
  Dso,
  registerSupervisor,
  setBootingWiredArm,
} from './supervisors.js'
import { un } from './store.js'

/** densable h9 — watch cap (same as WATCH_CAP; avoid frameLive cycle). */
const WATCH_CAP = 5

export type PublishContext =
  | 'interactive'
  | 'sdk'
  | 'bg_session'
  | 'subagent'
  | string

export type ArmSkipReason =
  | 'publish_context'
  | 'stop_latched'
  | 'flag_off'
  | 'remote'
  | 'invalid_slug'
  | 'watch_cap'
  | 'watch_cap_reconnect'
  | 'no_subscription_token'
  | 'boot_failed'
  | 'cancelled'
  | 'not_found'
  | 'not_editor'
  | 'ws_open_error'
  | 'arm_in_flight'
  | 'comments_off'
  | 'not_stopped'
  | 'not_enabled'
  | 'session_disarmed'

export type ArmOutcome =
  | {
      outcome: 'armed'
      taskId: string
      degraded?: string
      connecting?: boolean
    }
  | { outcome: 'already_watching'; taskId?: string }
  | { outcome: 'skipped'; reason: ArmSkipReason }
  | { outcome: 'refused'; reason: ArmSkipReason }

export type AutoReactArmWiring = {
  tool?: unknown
  commentVerbsInSchema?: boolean
  context?: unknown
  title?: string
}

export type MintSubscriptionResult =
  | {
      err: null
      token: string
      ver?: string
      editor?: boolean
      tokenExp?: number
      renewable?: boolean
    }
  | { err: true; status?: number }

export type LiveSocketHandle = { close: () => void }

export type ArmLiveDeps = {
  mintSubscription?: (
    slug: string,
    signal: AbortSignal,
  ) => Promise<MintSubscriptionResult>
  /** densable ttm — renew before falling back to Qem. */
  renewWatchToken?: (
    slug: string,
    signal: AbortSignal,
  ) => Promise<MintSubscriptionResult>
  openLiveSocket?: (input: {
    slug: string
    url: string
    token: string
    signal: AbortSignal
  }) => Promise<LiveSocketHandle>
  /**
   * When true (tests / offline), skip mint+socket and still register
   * monitor_ws + supervisor — densable path after successful mint.
   */
  localArmWithoutSocket?: boolean
  isLiveSubscribeEnabled?: () => boolean
}

let armDeps: ArmLiveDeps = {}

/** Inject mint/socket (tests + product hosts). */
export function setArtifactLiveArmDeps(deps: ArmLiveDeps): void {
  armDeps = { ...deps }
}

export function getArtifactLiveArmDeps(): Readonly<ArmLiveDeps> {
  return armDeps
}

export function resetArtifactLiveArmDepsForTests(): void {
  armDeps = {}
}

export function isArtifactLiveArmDepsInstalled(): boolean {
  return (
    armDeps.mintSubscription !== undefined ||
    armDeps.openLiveSocket !== undefined ||
    armDeps.localArmWithoutSocket === true
  )
}

/** densable Uot */
export function isPublishContextWatchable(ctx: PublishContext): boolean {
  return ctx === 'interactive' || ctx === 'sdk'
}

/** densable cf slug shape (portable). */
export function isValidArtifactSlug(slug: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(slug)
}

/** densable Fkm / Bkm gate subset. */
export function liveSubscribeGateReason(
  slug: string,
  publishContext: PublishContext,
): ArmSkipReason | null {
  if (SN(slug) || un().durable.stopLatches.isStopped(slug))
    return 'stop_latched'
  if (!isPublishContextWatchable(publishContext)) return 'publish_context'
  if (process.env.CLAUDE_CODE_REMOTE) return 'remote'
  const enabled =
    armDeps.isLiveSubscribeEnabled?.() ??
    (Gso() || process.env.CLAUDE_CODE_ARTIFACT_LIVE_SUBSCRIBE === '1')
  if (!enabled) return 'flag_off'
  if (!isValidArtifactSlug(slug)) return 'invalid_slug'
  return null
}

/** densable oGi */
export function isAutoReactGateOpen(): boolean {
  return !un().autoReact.userDisarmed && Gso()
}

export type WtArmInput = {
  slug: string
  url: string
  getKnownVer?: () => unknown
  ownPublishes?: unknown
  context: {
    abortController: AbortController
    taskRegistry?: {
      all: () => Record<
        string,
        {
          type?: string
          status?: string
          frameLive?: { slug?: string }
          id?: string
        }
      >
      update?: (
        id: string,
        fn: (t: Record<string, unknown>) => Record<string, unknown>,
      ) => void
    }
    artifactRegistries?: { ownPublishes?: unknown }
    storageV5?: unknown
    messages?: unknown
  }
  setAppState: SetAppState
  signal?: AbortSignal
  explicit?: boolean
  machineArm?: boolean
  sessionResume?: boolean
  seedKnownVerFromBoot?: boolean
  userResumeWiring?: boolean
  freshPublishWiring?: boolean
  requireEditor?: boolean
  autoReactWiring?: AutoReactArmWiring
  onOpen?: () => void
  onGiveUp?: () => void
  announceArmlessEnd?: boolean
}

function countRunningWatches(
  registry:
    | {
        all: () => Record<
          string,
          { type?: string; status?: string; frameLive?: { slug?: string } }
        >
      }
    | undefined,
): number {
  let n = 0
  for (const t of Object.values(registry?.all() ?? {})) {
    if (
      t.type === 'monitor_ws' &&
      t.status === 'running' &&
      t.frameLive?.slug
    ) {
      n++
    }
  }
  return n + un().live.inFlightSubscribes.size
}

function findRunningTaskId(
  registry: WtArmInput['context']['taskRegistry'],
  slug: string,
): string | undefined {
  for (const t of Object.values(registry?.all() ?? {})) {
    if (
      t.type === 'monitor_ws' &&
      t.status === 'running' &&
      t.frameLive?.slug === slug
    ) {
      return t.id
    }
  }
  return undefined
}

/**
 * densable _Wt — core live-subscribe arm.
 */
export async function armLiveSubscribe(input: WtArmInput): Promise<ArmOutcome> {
  ensureLedgerHydrated()
  const e = un().live
  const r = input.slug
  const n = input.url
  const u = input.signal ?? input.context.abortController.signal
  const publishCtx: PublishContext = input.sessionResume
    ? 'interactive'
    : 'interactive'

  if (!isValidArtifactSlug(r)) {
    return { outcome: 'skipped', reason: 'invalid_slug' }
  }

  e.endAll ??= () => {
    for (const slug of [...e.supervisors.keys()]) {
      interruptLedgerSlug(slug)
    }
  }

  const armedVia = input.userResumeWiring
    ? 'resume'
    : input.explicit
      ? 'watch'
      : input.sessionResume
        ? 'session_resume'
        : input.seedKnownVerFromBoot
          ? 'attach'
          : 'publish'

  if (un().durable.stopLatches.isStopped(r)) {
    return { outcome: 'skipped', reason: 'stop_latched' }
  }

  const gate = liveSubscribeGateReason(r, publishCtx)
  if (gate === 'stop_latched' || gate === 'remote' || gate === 'flag_off') {
    return { outcome: 'skipped', reason: gate }
  }

  const existingTaskId = findRunningTaskId(input.context.taskRegistry, r)
  const existingSup = e.supervisors.get(r)
  if (
    (existingTaskId !== undefined ||
      (existingSup !== undefined && !existingSup.stopped)) &&
    !input.userResumeWiring
  ) {
    if (
      input.autoReactWiring !== undefined &&
      input.autoReactWiring.commentVerbsInSchema &&
      !input.requireEditor
    ) {
      e.inFlightWiredIntent.add(r)
      if (input.freshPublishWiring === true && Gso()) {
        setBootingWiredArm(r, {
          title: input.autoReactWiring.title,
          freshPublish: true,
        })
      }
    }
    return {
      outcome: 'already_watching',
      ...(existingTaskId !== undefined ? { taskId: existingTaskId } : {}),
    }
  }

  const running = countRunningWatches(input.context.taskRegistry)
  if (!input.machineArm && running >= WATCH_CAP) {
    return { outcome: 'skipped', reason: 'watch_cap' }
  }

  e.inFlightSubscribes.add(r)
  if (input.autoReactWiring !== undefined) e.inFlightWiredIntent.add(r)

  try {
    if (u.aborted) return { outcome: 'skipped', reason: 'cancelled' }

    let token: string | undefined
    let mintMeta: {
      renewable?: boolean
      ver?: string
      editor?: boolean
    } = {}
    if (armDeps.localArmWithoutSocket && !armDeps.mintSubscription) {
      token = 'local'
    } else if (armDeps.mintSubscription) {
      const existingSup = e.supervisors.get(r)
      let minted: MintSubscriptionResult | undefined
      if (
        existingSup?.renewable === true &&
        armDeps.renewWatchToken &&
        input.machineArm === true
      ) {
        const renewed = await armDeps.renewWatchToken(r, u)
        if (renewed.err === null) {
          minted = renewed
        } else if (existingSup !== undefined) {
          delete existingSup.renewable
        }
      }
      if (!minted) {
        minted = await armDeps.mintSubscription(r, u)
      }
      if (minted.err !== null) {
        return {
          outcome: 'skipped',
          reason: minted.status === 404 ? 'not_found' : 'boot_failed',
        }
      }
      if (input.requireEditor === true && !minted.editor) {
        return { outcome: 'skipped', reason: 'not_editor' }
      }
      token = minted.token
      mintMeta = {
        renewable: minted.renewable,
        ver: minted.ver,
        editor: minted.editor,
      }
    } else if (process.env.CLAUDE_CODE_ARTIFACT_LIVE_TOKEN) {
      token = process.env.CLAUDE_CODE_ARTIFACT_LIVE_TOKEN
    }

    if (!token) {
      return { outcome: 'skipped', reason: 'no_subscription_token' }
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { registerMonitorWsTask } =
      require('../../tasks/MonitorWsTask/MonitorWsTask.js') as typeof import('../../tasks/MonitorWsTask/MonitorWsTask.js')

    const wiring = input.autoReactWiring
    const supervisor = registerSupervisor({
      slug: r,
      url: n,
      explicit: input.explicit === true,
      armedVia,
      autoReactWiring:
        wiring !== undefined
          ? { title: wiring.title ?? r, ...wiring }
          : { title: r },
    })
    if (mintMeta.renewable === true) supervisor.renewable = true
    if (mintMeta.ver !== undefined) supervisor.carriedVer = mintMeta.ver

    const taskId = registerMonitorWsTask(input.setAppState, {
      description: `Artifact comment monitor · ${wiring?.title ?? r}`,
      url: n,
      slug: r,
      title: wiring?.title,
      explicit: input.explicit,
      armedVia,
      ambient: true,
      autoReactArmed: wiring !== undefined,
      autoReactWiring:
        wiring !== undefined ? { title: wiring.title ?? r } : undefined,
    })
    bindSupervisorTaskId(supervisor, r, taskId)

    if (armDeps.openLiveSocket) {
      try {
        const sock = await armDeps.openLiveSocket({
          slug: r,
          url: n,
          token,
          signal: u,
        })
        monitorSocketRegistry.set(taskId, sock)
      } catch {
        // Gold aGi is mint+WS+task as one unit. A failed open must not leave
        // a running monitor_ws / supervisor (retry would already_watching).
        // Do not oF: that latches stop. Roll back task + supervisor only.
        Dso([r])
        input.setAppState(prev => {
          if (!(taskId in prev.tasks)) return prev
          const { [taskId]: _dropped, ...rest } = prev.tasks
          return { ...prev, tasks: rest }
        })
        return { outcome: 'skipped', reason: 'ws_open_error' }
      }
    } else if (armDeps.localArmWithoutSocket) {
      monitorSocketRegistry.set(taskId, { close: () => {} })
    }

    if (
      wiring?.commentVerbsInSchema === true &&
      !input.requireEditor &&
      !input.machineArm &&
      input.userResumeWiring !== true &&
      Gso()
    ) {
      setBootingWiredArm(r, {
        title: wiring.title,
        freshPublish: input.freshPublishWiring === true,
      })
    }

    input.onOpen?.()
    return { outcome: 'armed', taskId }
  } finally {
    e.inFlightSubscribes.delete(r)
  }
}

export type AGiInput = {
  slug: string
  url: string
  version?: string
  publishContext: PublishContext
  getKnownVer?: () => unknown
  tool?: unknown
  commentVerbsInSchema?: boolean
  title?: string
  context: WtArmInput['context']
  setAppState: SetAppState
  onOpen?: () => void
  onGiveUp?: () => void
  seedKnownVerFromBoot?: boolean
  resumedPublishConsent?: boolean
  carriedPublishConsent?: boolean
  sessionResume?: boolean
  announceArmlessEnd?: boolean
  chainPublish?: boolean
}

/** densable aGi */
export async function aGi(input: AGiInput): Promise<ArmOutcome> {
  const { slug: t, url: r, version: n, publishContext: o, context: c } = input
  const d = un().live
  if (n !== undefined) {
    const m = d.supervisors.get(t)
    if (m !== undefined && !m.stopped) m.lastActivityAt = Date.now()
    if (isPublishContextWatchable(o)) d.mostRecentPublishSlug = t
  }
  if (
    !isPublishContextWatchable(o) &&
    !(input.carriedPublishConsent === true && o === 'bg_session')
  ) {
    return { outcome: 'skipped', reason: 'publish_context' }
  }

  const p = input.tool !== undefined && input.commentVerbsInSchema === true
  const f = await armLiveSubscribe({
    slug: t,
    url: r,
    getKnownVer: input.getKnownVer,
    ownPublishes: c.artifactRegistries?.ownPublishes,
    context: c,
    setAppState: input.setAppState,
    signal: c.abortController.signal,
    ...(input.onOpen !== undefined &&
      input.onGiveUp !== undefined && {
        onOpen: input.onOpen,
        onGiveUp: input.onGiveUp,
      }),
    ...(input.seedKnownVerFromBoot === true && { seedKnownVerFromBoot: true }),
    ...((input.resumedPublishConsent === true ||
      input.carriedPublishConsent === true) && { requireEditor: true }),
    ...(input.sessionResume === true && { sessionResume: true }),
    ...(input.announceArmlessEnd === true && { announceArmlessEnd: true }),
    ...(p && {
      autoReactWiring: {
        tool: input.tool,
        commentVerbsInSchema: input.commentVerbsInSchema,
        context: c,
        title: input.title,
      },
      ...(input.carriedPublishConsent !== true &&
        input.resumedPublishConsent !== true &&
        input.chainPublish !== true && { freshPublishWiring: true }),
    }),
  })

  if (
    p &&
    f.outcome !== 'skipped' &&
    !(
      f.outcome === 'already_watching' &&
      (input.resumedPublishConsent === true ||
        input.carriedPublishConsent === true)
    ) &&
    !(f.outcome === 'armed' && f.degraded !== undefined) &&
    isAutoReactGateOpen()
  ) {
    armCommentMonitorIntent(t, {
      title: input.title,
      storageV5: c.storageV5,
    })
  }
  return f
}

/** densable Lkm — session-resume attach (no autoReact wiring required). */
export async function Lkm(input: {
  slug: string
  url: string
  publishContext: PublishContext
  getKnownVer?: () => unknown
  context: WtArmInput['context']
  setAppState: SetAppState
}): Promise<ArmOutcome> {
  if (!isPublishContextWatchable(input.publishContext)) {
    return { outcome: 'skipped', reason: 'publish_context' }
  }
  return armLiveSubscribe({
    slug: input.slug,
    url: input.url,
    getKnownVer: input.getKnownVer,
    ownPublishes: input.context.artifactRegistries?.ownPublishes,
    context: input.context,
    setAppState: input.setAppState,
    signal: input.context.abortController.signal,
    sessionResume: true,
  })
}

/** densable Dtn — human skip reason (subset). */
export function describeArmSkipReason(reason: ArmSkipReason): string | null {
  switch (reason) {
    case 'flag_off':
      return "the live-subscribe feature flag is off in this session's cached config, so you will not be notified here when this artifact is republished elsewhere"
    case 'publish_context':
      return 'only an interactive or SDK main-loop session holds the watch (not a subagent, teammate, background, or print session)'
    case 'stop_latched':
      return 'watching this artifact was stopped earlier in this session; do not retry on your own. If the user asks you to resume watching it, call the watch action (in permission modes that prompt, they confirm it there)'
    case 'remote':
      return 'remote sessions do not hold the watch'
    case 'no_subscription_token':
      return 'the control plane minted no live-channel credential for this artifact'
    case 'watch_cap':
      return `this session already holds its maximum of ${WATCH_CAP} artifact watches and none could make room`
    case 'invalid_slug':
      return 'that is not an artifact this session can name'
    case 'cancelled':
      return 'the request was cancelled before the connection opened'
    case 'ws_open_error':
      return 'the live connection could not be opened from this environment'
    case 'not_enabled':
      return 'auto-react is not enabled'
    case 'session_disarmed':
      return 'auto-react was disarmed for this session'
    default:
      return null
  }
}
