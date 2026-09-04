import { getGlobalConfig } from './config.js'
import { getInitialSettings } from './settings/settings.js'
import { getSessionNoticeStore } from './sessionNoticeStore.js'

/**
 * densable 2.1.243 #25 `si` / `tT` / `rf` / `Cc`.
 *
 * Official caches the chosen announcement on the session store (`ut()`).
 * `si(false)` peeks; `si(true)` persists. Empty settings do not persist, so a
 * later remote-settings refresh can pick once announcements arrive (login
 * after `/logout`).
 */

export function hasCompanyAnnouncements(
  announcements:
    | readonly (string | undefined | null)[]
    | undefined = getInitialSettings().companyAnnouncements,
): boolean {
  return !!announcements && announcements.some(item => Boolean(item))
}

export function pickCompanyAnnouncementFromList(
  announcements: readonly (string | undefined | null)[] | undefined,
  numStartups: number,
  persist: boolean,
): string | null {
  const store = getSessionNoticeStore()
  if (store.companyAnnouncement !== null) {
    return store.companyAnnouncement
  }
  const available = (announcements ?? []).filter((item): item is string =>
    Boolean(item),
  )
  if (available.length === 0) {
    return null
  }
  const chosen =
    numStartups === 1
      ? available[0]
      : available[Math.floor(Math.random() * available.length)]
  if (!chosen) {
    return null
  }
  if (persist) {
    store.companyAnnouncement = chosen
  }
  return chosen
}

export function pickCompanyAnnouncement(persist: boolean): string | null {
  return pickCompanyAnnouncementFromList(
    getInitialSettings().companyAnnouncements,
    getGlobalConfig().numStartups ?? 0,
    persist,
  )
}

/** Official `tT` — peek without persisting. */
export function peekCompanyAnnouncement(): string | null {
  return pickCompanyAnnouncement(false)
}

/** Test-only: official store `reset()` so a later `si(true)` can re-roll. */
export function resetCompanyAnnouncementForTest(): void {
  getSessionNoticeStore().reset()
}
