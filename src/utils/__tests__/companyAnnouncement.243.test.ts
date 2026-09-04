import { afterEach, describe, expect, test } from 'bun:test'
import {
  hasCompanyAnnouncements,
  pickCompanyAnnouncementFromList,
  resetCompanyAnnouncementForTest,
} from '../companyAnnouncement.js'
import { getSessionNoticeStore } from '../sessionNoticeStore.js'

describe('densable 2.1.243 #25 companyAnnouncements si/rf/ut', () => {
  afterEach(() => {
    resetCompanyAnnouncementForTest()
  })

  test('rf is false and si does not persist when the list is empty', () => {
    expect(hasCompanyAnnouncements([])).toBe(false)
    expect(pickCompanyAnnouncementFromList([], 2, true)).toBeNull()
    expect(getSessionNoticeStore().companyAnnouncement).toBeNull()
    expect(hasCompanyAnnouncements(['Hello from org'])).toBe(true)
    expect(pickCompanyAnnouncementFromList(['Hello from org'], 2, true)).toBe(
      'Hello from org',
    )
    expect(getSessionNoticeStore().companyAnnouncement).toBe('Hello from org')
  })

  test('first startup (numStartups===1) picks the first announcement', () => {
    expect(pickCompanyAnnouncementFromList(['first', 'second'], 1, true)).toBe(
      'first',
    )
    // persisted on ut() — later list changes do not re-roll
    expect(pickCompanyAnnouncementFromList(['other'], 1, true)).toBe('first')
  })

  test('si(false) peeks without writing ut().companyAnnouncement', () => {
    expect(pickCompanyAnnouncementFromList(['first'], 1, false)).toBe('first')
    expect(getSessionNoticeStore().companyAnnouncement).toBeNull()
    expect(pickCompanyAnnouncementFromList(['other'], 1, true)).toBe('other')
    expect(getSessionNoticeStore().companyAnnouncement).toBe('other')
  })
})
