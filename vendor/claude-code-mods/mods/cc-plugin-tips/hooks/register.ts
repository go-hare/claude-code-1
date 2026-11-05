// @ts-nocheck — SourceTextModule evaluates this as JS; no TypeScript syntax.
/**
 * densable 2.1.289 `cc-plugin-tips` hooksModule (`u` / `C` / `z`).
 */
export const COMMAND_CHECK_THREW_MESSAGE = 'tip advertisedCommand check threw'
export const CONTENT_THREW_MESSAGE = 'tip content threw'
export const INTERNAL_USER_TYPE = 'ant'
export const PICK_FAILED_MESSAGE = 'spinner tip failed'
export const RELEVANCE_THREW_MESSAGE = 'tip isRelevant threw'

export async function contentSafe(host, tip) {
  try {
    return await tip.content()
  } catch (err) {
    host.markFailed(tip.id)
    host.report(err, CONTENT_THREW_MESSAGE)
    return ''
  }
}

async function isCommandOfferedSafe(host, tip) {
  if (tip.advertisedCommand === void 0) return !0
  try {
    return await host.isCommandOffered(tip.advertisedCommand)
  } catch (err) {
    host.markFailed(tip.id)
    host.report(err, COMMAND_CHECK_THREW_MESSAGE)
    return !1
  }
}

export async function isRelevantSafe(host, tip) {
  if (!(await isCommandOfferedSafe(host, tip))) return !1
  try {
    return await tip.isRelevant()
  } catch (err) {
    host.markFailed(tip.id)
    host.report(err, RELEVANCE_THREW_MESSAGE)
    return !1
  }
}

export async function pickGatesOf(reads) {
  const settings = await reads.settings()
  const forced =
    (await reads.userType()) === INTERNAL_USER_TYPE
      ? await reads.forcedTipId()
      : void 0
  return {
    isEnabled: settings.spinnerTipsEnabled !== !1,
    forcedId: forced === void 0 || forced === '' ? void 0 : forced,
  }
}

export async function relevantTipsOf(host, forcedId) {
  const candidates = await host.candidates()
  const forced =
    forcedId === void 0 ? void 0 : candidates.find(tip => tip.id === forcedId)
  if (forced !== void 0) return [forced]
  const org = await host.orgTips()
  const orgReady = org.tips.filter(
    tip => host.sessionsSinceShown(tip.id) >= tip.cooldownSessions,
  )
  if (org.trustedCount > 0 && host.isDefaultSuppressed()) return orgReady
  const unfailed = candidates.filter(tip => !host.hasFailed(tip.id))
  const backendEligible = host.isFirstPartyBackend()
    ? unfailed
    : unfailed.filter(tip => tip.providerAgnostic)
  const relevantFlags = await Promise.all(
    backendEligible.map(tip => isRelevantSafe(host, tip)),
  )
  return [
    ...backendEligible
      .filter((_tip, idx) => relevantFlags[idx] === !0)
      .filter(tip => host.sessionsSinceShown(tip.id) >= tip.cooldownSessions)
      .filter(
        tip =>
          tip.maxLifetimeShows === void 0 ||
          host.lifetimeShown(tip.id) < tip.maxLifetimeShows,
      ),
    ...orgReady,
  ]
}

export function selectLongestUnshown(host, tips) {
  if (tips.length <= 1) return tips[0]
  return tips
    .map(tip => ({ tip, sessions: host.sessionsSinceShown(tip.id) }))
    .toSorted((a, b) =>
      a.sessions === b.sessions
        ? (b.tip.priority ?? 0) - (a.tip.priority ?? 0)
        : a.sessions - b.sessions,
    )[0]?.tip
}

export const pickOf = async (host, gates) =>
  gates.isEnabled
    ? selectLongestUnshown(host, await relevantTipsOf(host, gates.forcedId))
    : void 0

export async function showNextTip(host, reads) {
  try {
    const picked = await pickOf(host, await pickGatesOf(reads))
    const text = picked === void 0 ? '' : await contentSafe(host, picked)
    if (picked === void 0 || text === '') {
      host.show(void 0)
      return
    }
    host.show({ text, label: picked.label })
    host.record(picked.id)
  } catch (err) {
    host.show(void 0)
    host.report(err, PICK_FAILED_MESSAGE)
  }
}

export function registerHooks(on, tipHost) {
  if (tipHost === void 0) return
  on('session.start', (api, event, next) => {
    if (event.isInteractive) {
      tipHost.install(seated => {
        showNextTip(seated, {
          settings: () => api.settings.read(),
          userType: () => api.env.get('USER_TYPE'),
          forcedTipId: () => api.env.get('CLAUDE_CODE_FORCE_TIP_ID'),
        })
      })
    }
    return next(event)
  })
}

export function register(on) {
  registerHooks(on, void 0)
}

export default {
  COMMAND_CHECK_THREW_MESSAGE,
  CONTENT_THREW_MESSAGE,
  INTERNAL_USER_TYPE,
  PICK_FAILED_MESSAGE,
  RELEVANCE_THREW_MESSAGE,
  contentSafe,
  isRelevantSafe,
  pickGatesOf,
  pickOf,
  register,
  registerHooks,
  relevantTipsOf,
  selectLongestUnshown,
  showNextTip,
}
