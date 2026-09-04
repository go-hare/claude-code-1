/**
 * densable 2.1.243 session-notice store (`jP` / `ut`).
 *
 * Official chunk:
 *   class t { announcementSlotWinner; …; companyAnnouncement; …; reset() }
 *   function m(){ return r.of(e()) }   // e = Hh = current session
 *   r = new Oe(() => new t)
 *
 * `Oe.of(session)` is WeakMap-keyed by `session.root`. `/clear` updates the
 * same session object, so the pick survives regenerate. Local CLI has one
 * process session object (`PROCESS_SESSION`); that is the `L` / `Hh()` twin.
 */

export type SessionNoticeRoot = { readonly root: object }

class SessionRootHolder<T> {
  #factory: () => T
  #byRoot = new WeakMap<object, T>()

  constructor(factory: () => T) {
    this.#factory = factory
  }

  peek(session: SessionNoticeRoot): T | undefined {
    return this.#byRoot.get(session.root)
  }

  of(session: SessionNoticeRoot): T {
    const root = session.root
    const existing = this.#byRoot.get(root)
    if (existing !== undefined) return existing
    const created = this.#factory()
    this.#byRoot.set(root, created)
    return created
  }
}

/** densable `t` — startup notice fields on the session store. */
export class SessionNoticeStore {
  announcementSlotWinner: unknown = null
  announcementSlotGovernance: unknown = null
  countedNoticeImpressions = new Set<string>()
  startupAnnouncementPick: unknown = undefined
  companyAnnouncement: string | null = null
  fotwContent: unknown = null
  ccCeMigrateGroup: unknown = undefined

  reset(): void {
    this.announcementSlotWinner = null
    this.announcementSlotGovernance = null
    this.countedNoticeImpressions.clear()
    this.startupAnnouncementPick = undefined
    this.companyAnnouncement = null
    this.fotwContent = null
    this.ccCeMigrateGroup = undefined
  }
}

const PROCESS_SESSION_ROOT: object = {}
const PROCESS_SESSION: SessionNoticeRoot = { root: PROCESS_SESSION_ROOT }

const sessionNoticeHolder = new SessionRootHolder(
  () => new SessionNoticeStore(),
)

/** Official `ut` / `jP` — session-scoped notice store. */
export function getSessionNoticeStore(
  session: SessionNoticeRoot = PROCESS_SESSION,
): SessionNoticeStore {
  return sessionNoticeHolder.of(session)
}

/** Test-only: official `reset()` on the process session store. */
export function resetSessionNoticeStoreForTest(): void {
  sessionNoticeHolder.peek(PROCESS_SESSION)?.reset()
}
