/**
 * densable 2.1.283 leftover gold `ko` @202260269 BODY wrap.
 *
 * Semantic classifier: offerCloudHookEntry / classifyCloudHookEntry.
 * Control flow 1:1 with leftover `ko` (10308 B, next `function yo(`).
 * Wraps existing extraReach `cloudHookEntry*Copy` / `cloudHookAfterEdit*` /
 * `INTERPRETER_*` / `CLOUD_HOOK_ENTRY_REASON`. Seams for Oz, Ti, pe, Ce, pin,
 * realpath. No Far key store, no WS, no Xt fleet. No minify public `ko`.
 */
import {
  CLOUD_HOOK_ENTRY_REASON,
  CLOUD_HOOK_READONLY_TEMPLATES,
  CLOUD_HOOK_SOURCE_COPY,
  INTERPRETER_CANNOT_BE_LOCATED,
  INTERPRETER_HASHBANG_NAMES,
  INTERPRETER_IT_NAMES,
  INTERPRETER_MAY_LOAD_FROM_CHECKOUT,
  INTERPRETER_SANDBOX_WRITE_INLET_COVERS,
  INTERPRETER_UNVOUCHED_RELATIVE_OR_ENV,
  cloudDeviceMarkNotHonouredInCheckoutCopy,
  cloudHookAfterEditNotForwardedCopy,
  cloudHookCannotMoveAfterEditCopy,
  cloudHookCannotReproduceCopy,
  cloudHookConfiguredOnEventsCopy,
  cloudHookEntryDeviceAfterEditCopy,
  cloudHookEntryDeviceScriptChangedCopy,
  cloudHookEntryInReachCopy,
  cloudHookEntryInterpreterUnvouchedCopy,
  cloudHookEntryLoadsFromReachCopy,
  cloudHookEntryPrivateDotdirCopy,
  cloudHookEntryShellPrefixCopy,
  cloudHookEntrySkipCopy,
  cloudHookEntryUnpinnedCommandCopy,
  cloudHookEntryUnreadableAtStartupCopy,
  cloudHookMatcherCloudOnlyCopy,
  cloudHookMatcherRunsOnCopy,
  cloudHookNotRunInCloudAfterEditCopy,
  cloudHookNotRunInCloudCopy,
  cloudHookOlderCopyCloudRunsCopy,
  cloudHookOlderCopyNotRunCopy,
  cloudHookPatternMatcherLocalOnlyCopy,
  cloudHookSourceCopy,
  type CloudHooksEmptyPack,
} from './extraReach.js'

/** leftover `K2` @181717250 — Oz offerable events (`V2`). */
export const OFFERABLE_CLOUD_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PermissionDenied',
] as const

/** leftover `Mm` @176062330 — Ti known events. */
export const KNOWN_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Notification',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PreModelSwitch',
  'PostModelSwitch',
  'PermissionRequest',
  'PermissionDenied',
  'Setup',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
  'DirectoryAdded',
  'MessageDisplay',
] as const

/** leftover `Y2` @181717307 — yEo hold reason. */
export const CLOUD_HOOK_EVENT_HOLD_REASON: Record<string, string> = {
  SessionStart: 'runs_locally',
  SessionEnd: 'runs_locally',
  Notification: 'runs_locally',
  PermissionRequest: 'later',
  Setup: 'low_value',
  PreCompact: 'low_value',
  PostCompact: 'low_value',
  PreModelSwitch: 'later',
  PostModelSwitch: 'later',
  TeammateIdle: 'low_value',
  TaskCreated: 'low_value',
  TaskCompleted: 'low_value',
  Elicitation: 'low_value',
  ElicitationResult: 'low_value',
  ConfigChange: 'container_internal',
  WorktreeCreate: 'container_internal',
  WorktreeRemove: 'container_internal',
  InstructionsLoaded: 'container_internal',
  CwdChanged: 'container_internal',
  FileChanged: 'container_internal',
  DirectoryAdded: 'container_internal',
  MessageDisplay: 'container_internal',
}

/** leftover `q2` / `uT` — write tools for SEo after-edit. */
export const AFTER_EDIT_WRITE_TOOLS = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
] as const

/** leftover `VMe`. */
const PLAIN_MATCHER = /^[a-zA-Z0-9_|, -]+$/
/** leftover `bi` @202257064 — yo matcher cap. */
const MATCHER_CAP = 512
/** leftover `Yt` — relative `..` in an absolute interpreter path. */
const DOTDOT_IN_PATH = /(?:^|\/)\.\.(?:\/|$)/

const OFFERABLE = new Set<string>(OFFERABLE_CLOUD_HOOK_EVENTS)
const KNOWN = new Set<string>(KNOWN_HOOK_EVENTS)
const WRITE_TOOLS = new Set<string>(AFTER_EDIT_WRITE_TOOLS)

export type CloudHookOfferHook = {
  type: string
  cloud?: string
  command?: string
  url?: string
  args?: unknown
  if?: unknown
  async?: unknown
  asyncRewake?: unknown
  once?: unknown
  timeout?: number
}

export type CloudHookOfferEntry = {
  event: string
  matcher?: string
  hook: CloudHookOfferHook
  source: { source: string }
}

export type CloudHookPinnedTarget = {
  path: string
  realPath: string
  sha256: string
}

export type CloudHookPinResult =
  | { kind: 'unverifiable'; rawPath: string }
  | {
      kind: 'script_in_reach' | 'script_outside_reach'
      pinnedTarget: CloudHookPinnedTarget
      site?: { form?: string; slot?: string }
      interpreter?: string | null
      bytes?: Uint8Array
      /** leftover `Ai` result: path or `"unjudgeable"`. */
      shebangInterpreter?: string | 'unjudgeable' | null
      /** leftover `awo` — bun/tsx/lua/Rscript may-load. */
      mayLoadFromCheckout?: boolean
      interpreterUnvouched?: { path: string; why: string }
      loadsFromReach?: string
    }
  | { kind: 'opaque'; reason: string }
  | { kind: string; [k: string]: unknown }

export type CloudHookTemplateHit = {
  template: {
    id: string
    filename: string
    event: string
    matcher?: string
  }
  label: string
}

export type CloudHookOfferSeams = {
  /** leftover `Oz`. */
  isOfferableEvent?: (event: string) => boolean
  /** leftover `Ti`. */
  isKnownEvent?: (event: string) => boolean
  /** leftover `yEo`. */
  eventHoldReason?: (event: string) => string | undefined
  /** leftover `pe`. */
  hookLabel?: (hook: CloudHookOfferHook) => string
  /** leftover `Ce`. */
  sourceCopy?: (source: string) => string | undefined
  /** leftover `SEo`. */
  isAfterEdit?: (event: string, matcher?: string) => boolean
  /** leftover `pn`. */
  pin?: (
    hook: CloudHookOfferHook,
    ctx: CloudHookOfferContext,
  ) => Promise<CloudHookPinResult>
  /** leftover `realpath` / `_t`. */
  realpath?: (path: string) => Promise<string>
  /** leftover `fo`. */
  loadsFromReach?: (
    pin: CloudHookPinResult,
    ctx: CloudHookOfferContext,
  ) => Promise<string | undefined>
  /** leftover `findTemplateByDigest` / `u9r`. */
  findTemplateByDigest?: (sha256: string) => CloudHookTemplateHit | undefined
  /** leftover `yo`. */
  matcherUnderCap?: (matcher: string) => boolean
  /** leftover `G3e`. */
  matcherStar?: (matcher?: string) => boolean
  /** leftover `CUn`. */
  matchersAlign?: (user?: string, template?: string) => boolean
  /** leftover `wo`. */
  commandIsTemplateTwin?: (
    command: string | undefined,
    interpreter: string | null | undefined,
  ) => boolean
}

export type CloudHookOfferContext = {
  reach?: {
    launchDir?: string
    launchDirReal?: string
    extraReach?: string[]
  }
  deps?: {
    realpath?: (path: string) => Promise<string>
    home?: string
    findTemplateByDigest?: (sha256: string) => CloudHookTemplateHit | undefined
  }
  opts?: {
    launchDir?: string
    optInPins?: Map<string, string>
    refusedTemplateIds?: string[]
    enabledTemplateIds?: readonly string[]
    allowLegacyTemplateDigests?: boolean
  }
  resolved?: unknown
  seams?: CloudHookOfferSeams
}

export type CloudHookOfferResult =
  | { kind: 'held'; reason: string; notice?: string }
  | {
      kind: 'forward'
      event: string
      hook: CloudHookOfferHook
      pinnedTarget?: CloudHookPinnedTarget
      authorOptIn?: true
      cloudDevice?: true
      templateTwinId?: string
      notice?: string
    }
  | {
      kind: 'template'
      entry: unknown
      event: string
      hook: CloudHookOfferHook
      notice?: string
    }

/** leftover `Oz`. */
export function isOfferableCloudHookEvent(event: string): boolean {
  return OFFERABLE.has(event)
}

/** leftover `Ti`. */
export function isKnownHookEvent(event: string): boolean {
  return KNOWN.has(event)
}

/** leftover `yEo`. */
export function cloudHookEventHoldReason(event: string): string | undefined {
  if (isOfferableCloudHookEvent(event)) return undefined
  return CLOUD_HOOK_EVENT_HOLD_REASON[event]
}

/** leftover `G3e`. */
export function isStarMatcher(matcher?: string): boolean {
  return !matcher || matcher === '*' || matcher === '.*'
}

/** leftover `yo` (`bi=512`). */
export function isMatcherUnderCap(matcher: string): boolean {
  return matcher.length <= MATCHER_CAP && !/[\p{Cc}\p{Cf}]/u.test(matcher)
}

/** leftover `VMe`. */
export function isPlainListMatcher(matcher: string): boolean {
  return PLAIN_MATCHER.test(matcher)
}

/** leftover `SEo` without tool-alias fleet: write-tool list on PostToolUse*. */
export function isAfterEditHook(event: string, matcher?: string): boolean {
  if (event !== 'PostToolUse' && event !== 'PostToolUseFailure') return false
  if (!matcher || matcher === '*' || !PLAIN_MATCHER.test(matcher)) return false
  const tools = matcher
    .split(/[|,]/)
    .map(t => t.trim())
    .filter(Boolean)
  return tools.length > 0 && tools.every(t => WRITE_TOOLS.has(t))
}

/** leftover `CUn`. */
export function matchersAlign(user?: string, template?: string): boolean {
  if (user === undefined || isStarMatcher(user)) return true
  if (isStarMatcher(template) || !template) return false
  if (!PLAIN_MATCHER.test(template) || !PLAIN_MATCHER.test(user)) return false
  const allowed = new Set(
    user
      .split(/[|,]/)
      .map(t => t.trim())
      .filter(Boolean),
  )
  const need = template
    .split(/[|,]/)
    .map(t => t.trim())
    .filter(Boolean)
  return need.length > 0 && need.every(t => allowed.has(t))
}

/** leftover `wo`. */
export function commandIsTemplateTwin(
  command: string | undefined,
  interpreter: string | null | undefined,
): boolean {
  if (command === undefined) return false
  const parts = command.trim().split(/ +/)
  if (interpreter === null || interpreter === undefined) return parts.length === 1
  return (interpreter === 'python3' || interpreter === 'python') && parts.length === 2
}

/** leftover `pe` / `po(...,{maxCodeUnits:200})`. */
export function hookEntryLabel(hook: CloudHookOfferHook): string {
  const raw =
    hook.type === 'http'
      ? (hook.url ?? '')
      : hook.args === undefined
        ? (hook.command ?? '')
        : `${hook.command ?? ''} ${JSON.stringify(hook.args)}`
  return raw.length <= 200 ? raw : raw.slice(0, 200)
}

function clip200(path: string): string {
  return path.length <= 200 ? path : path.slice(0, 200)
}

function sourceLabel(
  source: string,
  seams: CloudHookOfferSeams | undefined,
): string {
  return (
    seams?.sourceCopy?.(source) ??
    cloudHookSourceCopy(source) ??
    CLOUD_HOOK_SOURCE_COPY[source as keyof typeof CLOUD_HOOK_SOURCE_COPY] ??
    source
  )
}

function pathCoveredByReach(path: string, extraReach: string[]): boolean {
  return extraReach.some(root => {
    if (root === '/') return path.startsWith('/')
    const prefix = root.endsWith('/') ? root : `${root}/`
    return path === root || path.startsWith(prefix)
  })
}

/** leftover `ko` interpreter voucher (`Ai` / `awo` / realpath / inlet). */
async function interpreterVoucher(
  command: string | undefined,
  pin: Extract<
    CloudHookPinResult,
    { kind: 'script_in_reach' | 'script_outside_reach' }
  >,
  ctx: CloudHookOfferContext,
): Promise<{ path: string; why: string } | undefined> {
  if (pin.interpreterUnvouched) return pin.interpreterUnvouched
  const candidates: Array<string | 'unjudgeable'> = []
  if (
    pin.site?.form === 'exec' &&
    pin.site.slot === 'arg0' &&
    command?.startsWith('/')
  ) {
    candidates.push(DOTDOT_IN_PATH.test(command) ? 'unjudgeable' : command)
  }
  if (pin.interpreter === null && pin.shebangInterpreter != null) {
    candidates.push(pin.shebangInterpreter)
  }
  const extraReach = ctx.reach?.extraReach ?? []
  const realpath = ctx.seams?.realpath ?? ctx.deps?.realpath
  for (const named of candidates) {
    if (named === 'unjudgeable') {
      return {
        path: INTERPRETER_IT_NAMES,
        why: INTERPRETER_UNVOUCHED_RELATIVE_OR_ENV,
      }
    }
    let located: string | null = null
    if (realpath) {
      located = await realpath(named).catch(() => null)
    }
    if (located === null) {
      return { path: clip200(named), why: INTERPRETER_CANNOT_BE_LOCATED }
    }
    if (
      [named, located].some(spelling => pathCoveredByReach(spelling, extraReach))
    ) {
      return {
        path: clip200(named),
        why: INTERPRETER_SANDBOX_WRITE_INLET_COVERS,
      }
    }
  }
  if (pin.interpreter === null && pin.mayLoadFromCheckout) {
    return {
      path: INTERPRETER_HASHBANG_NAMES,
      why: INTERPRETER_MAY_LOAD_FROM_CHECKOUT,
    }
  }
  return undefined
}

/**
 * leftover `ko` @202260269 — classify one hook entry.
 * `skipPin` = gold `r`; `skipTemplates` = gold `s`.
 */
export async function classifyCloudHookEntry(
  entry: CloudHookOfferEntry,
  ctx: CloudHookOfferContext = {},
  skipPin = false,
  skipTemplates = false,
): Promise<CloudHookOfferResult> {
  const seams = ctx.seams ?? {}
  const oz = seams.isOfferableEvent ?? isOfferableCloudHookEvent
  const ti = seams.isKnownEvent ?? isKnownHookEvent
  const yeo = seams.eventHoldReason ?? cloudHookEventHoldReason
  const pe = seams.hookLabel ?? hookEntryLabel
  const seo = seams.isAfterEdit ?? isAfterEditHook
  const yo = seams.matcherUnderCap ?? isMatcherUnderCap
  const g3e = seams.matcherStar ?? isStarMatcher
  const cun = seams.matchersAlign ?? matchersAlign
  const wo = seams.commandIsTemplateTwin ?? commandIsTemplateTwin

  if (!oz(entry.event)) {
    return {
      kind: 'held',
      reason: `event_${(ti(entry.event) ? yeo(entry.event) : null) ?? 'container_internal'}`,
    }
  }

  const hook = entry.hook
  if (hook.type !== 'command' && hook.type !== 'http') {
    return { kind: 'held', reason: CLOUD_HOOK_ENTRY_REASON.kind_unsupported }
  }

  const deviceHonoured =
    hook.cloud === 'device' && entry.source.source !== 'local'
  const checkoutDeviceSuffix =
    hook.cloud === 'device' && entry.source.source === 'local'
      ? cloudDeviceMarkNotHonouredInCheckoutCopy()
      : ''
  const afterEdit = seo(entry.event, entry.matcher)

  if (skipPin) {
    return afterEdit
      ? { kind: 'held', reason: CLOUD_HOOK_ENTRY_REASON.after_edit }
      : { kind: 'forward', event: entry.event, hook }
  }

  if (afterEdit && hook.cloud === 'skip') {
    return { kind: 'held', reason: CLOUD_HOOK_ENTRY_REASON.after_edit }
  }

  const src = sourceLabel(entry.source.source, seams)
  const label = pe(hook)

  if (hook.cloud === 'skip') {
    return {
      kind: 'held',
      reason: CLOUD_HOOK_ENTRY_REASON.author_skip,
      notice: cloudHookEntrySkipCopy(label, src),
    }
  }

  let pinnedTarget: CloudHookPinnedTarget | undefined
  let unverifiable: CloudHookOfferResult | undefined
  let hold: CloudHookOfferResult | undefined
  let pinned = false
  let privateDotdir = false
  let shellPrefix = false
  let authorOptIn = false
  let templateTwinId: string | undefined
  let templateOffer:
    | {
        entry: unknown
        legacyNotice?: string
        narrowNotice?: string
      }
    | undefined
  let afterEditNotice =
    afterEdit && deviceHonoured
      ? cloudHookEntryDeviceAfterEditCopy(label, src)
      : undefined

  if (hook.type === 'command') {
    const pinFn = seams.pin
    const pin: CloudHookPinResult = pinFn
      ? await pinFn(hook, ctx)
      : { kind: 'opaque', reason: 'unpinned' }
    privateDotdir = pin.kind === 'opaque' && pin.reason === 'private_dotdir'
    shellPrefix = pin.kind === 'opaque' && pin.reason === 'shell_prefix'

    if (pin.kind === 'unverifiable') {
      pinned = true
      unverifiable = {
        kind: 'held',
        reason: CLOUD_HOOK_ENTRY_REASON.unverifiable_target,
        notice: cloudHookEntryUnreadableAtStartupCopy(
          clip200(pin.rawPath),
          src,
        ),
      }
    } else if (
      pin.kind === 'script_in_reach' ||
      pin.kind === 'script_outside_reach'
    ) {
      pinned = true
      const inReach = pin.kind === 'script_in_reach'
      pinnedTarget = pin.pinnedTarget
      if (inReach && !deviceHonoured) {
        hold = {
          kind: 'held',
          reason: CLOUD_HOOK_ENTRY_REASON.in_reach,
          notice: cloudHookEntryInReachCopy(label, src, checkoutDeviceSuffix),
        }
      }

      const voucher = await interpreterVoucher(hook.command, pin, ctx)

      if (voucher !== undefined && !inReach) {
        if (deviceHonoured) authorOptIn = true
        else {
          hold = {
            kind: 'held',
            reason: CLOUD_HOOK_ENTRY_REASON.interpreter_unvouched,
            notice: cloudHookEntryInterpreterUnvouchedCopy(
              label,
              src,
              voucher.path,
              voucher.why,
              checkoutDeviceSuffix,
            ),
          }
        }
      }

      authorOptIn = authorOptIn || (inReach && deviceHonoured)

      if (!inReach) {
        const loaded =
          pin.loadsFromReach ??
          (seams.loadsFromReach
            ? await seams.loadsFromReach(pin, ctx)
            : undefined)
        if (loaded !== undefined && !deviceHonoured && hold === undefined) {
          hold = {
            kind: 'held',
            reason: CLOUD_HOOK_ENTRY_REASON.loads_from_reach,
            notice: cloudHookEntryLoadsFromReachCopy(
              label,
              src,
              loaded,
              checkoutDeviceSuffix,
            ),
          }
        } else if (loaded !== undefined && deviceHonoured) {
          authorOptIn = true
        }
      }

      const optInPins = ctx.opts?.optInPins
      if (deviceHonoured && optInPins !== undefined) {
        const stamp = `${pin.pinnedTarget.realPath}\0${pin.pinnedTarget.sha256}`
        const previous = optInPins.get(pin.pinnedTarget.path)
        if (previous === undefined || (!inReach && previous !== stamp)) {
          optInPins.set(pin.pinnedTarget.path, stamp)
        } else if (previous !== stamp) {
          unverifiable = {
            kind: 'held',
            reason: CLOUD_HOOK_ENTRY_REASON.unverifiable_target,
            notice: cloudHookEntryDeviceScriptChangedCopy(label, src),
          }
          pinnedTarget = undefined
          authorOptIn = false
        }
      }

      const findDigest =
        seams.findTemplateByDigest ?? ctx.deps?.findTemplateByDigest
      const digestHit = skipTemplates
        ? undefined
        : findDigest?.(pin.pinnedTarget.sha256)
      const templateForNotice = deviceHonoured && !afterEdit ? undefined : digestHit
      if (
        deviceHonoured &&
        digestHit !== undefined &&
        hook.args === undefined &&
        !hook.if &&
        !hook.async &&
        !hook.asyncRewake &&
        !hook.once &&
        wo(hook.command, pin.interpreter ?? null)
      ) {
        templateTwinId = digestHit.template.id
      }
      if (templateForNotice) {
        const { template, label: digestLabel } = templateForNotice
        const refused = (ctx.opts?.refusedTemplateIds ?? []).includes(template.id)
        const enabled =
          !refused &&
          (ctx.opts?.enabledTemplateIds ?? CLOUD_HOOK_READONLY_TEMPLATES).includes(
            template.id,
          )
        if (refused) {
          afterEditNotice = afterEdit
            ? cloudHookAfterEditNotForwardedCopy(template.filename)
            : undefined
        } else if (!enabled) {
          afterEditNotice = afterEdit
            ? cloudHookNotRunInCloudAfterEditCopy(template.filename)
            : cloudHookNotRunInCloudCopy(template.filename)
        } else if (template.event !== entry.event) {
          afterEditNotice = cloudHookConfiguredOnEventsCopy(
            template.filename,
            entry.event,
            template.event,
          )
        } else if (
          digestLabel === 'legacy' &&
          !ctx.opts?.allowLegacyTemplateDigests
        ) {
          afterEditNotice = cloudHookOlderCopyNotRunCopy(
            template.filename,
            template.id,
          )
        } else if (
          hook.args !== undefined ||
          hook.if ||
          hook.async ||
          hook.asyncRewake ||
          hook.once ||
          !wo(hook.command, pin.interpreter ?? null)
        ) {
          afterEditNotice = cloudHookCannotReproduceCopy(template.filename)
        } else if (
          entry.matcher !== undefined &&
          !g3e(entry.matcher) &&
          (!yo(entry.matcher) || !PLAIN_MATCHER.test(entry.matcher))
        ) {
          afterEditNotice = undefined
        } else if (!cun(entry.matcher, template.matcher)) {
          afterEditNotice = cloudHookMatcherRunsOnCopy(
            template.filename,
            entry.matcher ?? '',
            template.matcher ?? '',
          )
        } else {
          const timeout_s =
            hook.timeout !== undefined && hook.timeout > 0
              ? Math.min(hook.timeout, 600)
              : undefined
          templateOffer = {
            entry: {
              wire: {
                template: template.id,
                digest: pin.pinnedTarget.sha256,
                event: entry.event,
                ...(!g3e(entry.matcher) && { matcher: entry.matcher }),
                ...(timeout_s !== undefined && { timeout_s }),
              },
              local: {
                templateId: template.id,
                label: digestLabel,
                scriptRealPath: pin.pinnedTarget.realPath,
                bytes: pin.bytes,
                userMatcher: entry.matcher,
                source: entry.source.source,
              },
            },
            ...(digestLabel === 'legacy' && {
              legacyNotice: cloudHookOlderCopyCloudRunsCopy(
                template.filename,
                template.id,
              ),
            }),
            ...(entry.matcher !== undefined &&
              !g3e(entry.matcher) &&
              !cun(template.matcher, entry.matcher) && {
                narrowNotice: cloudHookMatcherCloudOnlyCopy(
                  template.filename,
                  entry.matcher,
                  template.matcher ?? '',
                ),
              }),
          }
        }
        if (templateOffer === undefined && afterEdit && enabled) {
          afterEditNotice = cloudHookCannotMoveAfterEditCopy(
            template.filename,
            afterEditNotice,
          )
        }
      }
    }
  }

  if (templateOffer !== undefined) {
    const notice = [templateOffer.legacyNotice, templateOffer.narrowNotice]
      .filter((n): n is string => n !== undefined)
      .join(' ')
    return {
      kind: 'template',
      entry: templateOffer.entry,
      event: entry.event,
      hook,
      ...(notice !== '' && { notice }),
    }
  }

  if (afterEdit) {
    return {
      kind: 'held',
      reason: CLOUD_HOOK_ENTRY_REASON.after_edit,
      ...(afterEditNotice !== undefined && { notice: afterEditNotice }),
    }
  }
  if (unverifiable !== undefined) return unverifiable
  if (entry.matcher !== undefined && !yo(entry.matcher)) {
    return { kind: 'held', reason: 'over_cap' }
  }
  if (
    entry.matcher !== undefined &&
    !g3e(entry.matcher) &&
    !PLAIN_MATCHER.test(entry.matcher)
  ) {
    return {
      kind: 'held',
      reason: 'pattern_matcher',
      notice: cloudHookPatternMatcherLocalOnlyCopy(label, entry.matcher),
    }
  }
  if (hold !== undefined) return hold
  if (hook.type === 'command' && !pinned) {
    if (!deviceHonoured) {
      const notice = shellPrefix
        ? cloudHookEntryShellPrefixCopy(label, src, checkoutDeviceSuffix)
        : privateDotdir
          ? cloudHookEntryPrivateDotdirCopy(label, src, checkoutDeviceSuffix)
          : cloudHookEntryUnpinnedCommandCopy(label, src, checkoutDeviceSuffix)
      return {
        kind: 'held',
        reason: CLOUD_HOOK_ENTRY_REASON.unpinned_command,
        notice,
      }
    }
    authorOptIn = true
  }

  return {
    kind: 'forward',
    event: entry.event,
    hook,
    ...(pinnedTarget !== undefined && { pinnedTarget }),
    ...(authorOptIn && { authorOptIn: true as const }),
    ...(deviceHonoured && { cloudDevice: true as const }),
    ...(templateTwinId !== undefined && { templateTwinId }),
    ...(afterEditNotice !== undefined && { notice: afterEditNotice }),
  }
}

/** leftover `ko` public alias — same BODY, semantic name. */
export const offerCloudHookEntry = classifyCloudHookEntry

/** Fold one leftover-`ko` result into the ySn empty pack. No Xt fleet. */
export function foldCloudHookOffer(
  pack: CloudHooksEmptyPack,
  result: CloudHookOfferResult,
): void {
  if (result.notice !== undefined) pack.notices.push(result.notice)
  if (result.kind === 'held') {
    pack.held.push({ reason: result.reason })
    if (result.reason === CLOUD_HOOK_ENTRY_REASON.after_edit) {
      pack.heldCounts.after_edit += 1
    } else if (result.reason === CLOUD_HOOK_ENTRY_REASON.kind_unsupported) {
      pack.heldCounts.kind_unsupported += 1
    } else {
      pack.heldCounts.other += 1
    }
    return
  }
  if (result.kind === 'template') {
    pack.templates.push(result)
    return
  }
  pack.forwarded.push(result)
}

