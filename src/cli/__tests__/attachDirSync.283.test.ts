/**
 * densable 2.1.283 leftover `_e` startAttachSync wrap.
 * Gold SEA `/tmp/official-283/package/claude`:
 * - `_e` @211912012 sync (not async); flagOff → undefined
 * - `Kje` = isHostedServeDialogsEnabled (wood∧chinrest). Not soundpost.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  askAttachDirSyncConsent,
  DIR_SYNC_ATTACH_ON_LINE,
  DIR_SYNC_ATTACH_PREPARE_READY_LINE,
  startAttachSync,
} from '../attachDirSync.js'
import { CLOUD_SYNC_CONSENT_KIND } from '../cloudSession.js'

const body = readFileSync(join(import.meta.dir, '../attachDirSync.ts'), 'utf8')

describe('startAttachSync leftover 283', () => {
  test('source-locks gold wrap; no tengu_violin_soundpost', () => {
    expect(body).toContain('gold `_e`')
    expect(body).toContain('isHostedServeDialogsEnabled')
    expect(body).toContain('tengu_dir_sync_attach_prepare')
    expect(body).toContain('DIR_SYNC_ATTACH_PREPARE_READY_LINE')
    expect(body).toContain('DIR_SYNC_ATTACH_ON_LINE')
    expect(body).toContain('ATTACH_SYNC_COMPLIANCE_LINE')
    expect(body).toContain('isDirSyncEngineOn')
    expect(body).toContain("['none', 'off', '0', 'false', 'no']")
    expect(body).not.toContain('tengu_violin_soundpost')
    expect(body).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(body).not.toContain('settings.set(')
  })

  test('gold READY/ON line strings 1:1', () => {
    expect(DIR_SYNC_ATTACH_PREPARE_READY_LINE).toBe(
      'This folder is set to stay in sync with the cloud session. File sync starts the next time Claude runs something on this computer, if the session can sync.',
    )
    expect(DIR_SYNC_ATTACH_ON_LINE).toBe(
      "File sync is on for this session: your changes in this folder are copied into the session's checkout and Claude's changes there are copied here, each time Claude runs something on this computer and when its turn ends.",
    )
  })

  test('flagOff → undefined', () => {
    expect(
      startAttachSync({
        sessionId: 'session_off',
        boundToThisMachine: false,
        seams: { flagOn: () => false },
      }),
    ).toBeUndefined()
  })

  test('flagOn → handle.sessionId', () => {
    const handle = startAttachSync({
      sessionId: 'session_on',
      boundToThisMachine: false,
      seams: { flagOn: () => true, launchDirectory: () => '/tmp' },
    })
    expect(handle?.sessionId).toBe('session_on')
  })

  test('askAttachDirSyncConsent no dialogs → unasked', async () => {
    expect(
      await askAttachDirSyncConsent({
        gitRoot: '/tmp',
        servedFolder: '/tmp',
      }),
    ).toBe('unasked')
  })

  test('kinds has cloud_sync_consent → request', async () => {
    let requested = 0
    await askAttachDirSyncConsent({
      gitRoot: '/tmp',
      servedFolder: '/tmp',
      dialogs: {
        kinds: new Set([CLOUD_SYNC_CONSENT_KIND]),
        request: async () => {
          requested += 1
          return { answer: 'not_now', answered: true }
        },
      },
    })
    expect(requested).toBe(1)
  })
})
