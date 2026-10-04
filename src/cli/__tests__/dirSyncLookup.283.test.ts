/**
 * densable 2.1.283 leftover dir-sync LOOKUP wrap.
 * Gold SEA `/tmp/official-283/package/claude`:
 * - ito @196030082 / ato @196030166
 * - q9 @196031203
 * - gC @196032132
 * - R @196040117
 * - M @196041459
 * - ee @196047200
 * - W/x/B @196047325
 * - Ie @196047583
 * - Ue @196048448
 * - te/re @196048705
 * - hn @202412591 / fn @202412770
 *
 * No laptop FS pull engine / container_sync compositor.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { attachLaptopDirSyncSession } from '../cloudSession.js'
import {
  createDirSyncNoticeBus,
  createStoppedLaptopDirSyncSession,
  DIR_SYNC_ELSEWHERE_LINE,
  DIR_SYNC_NOTICE_BACKLOG_CAP,
  dirSyncEngineConsent,
  dirSyncWoodGate,
  lookupDirSyncBaseElsewhere,
  readDirSyncV5,
} from '../dirSyncLookup.js'
import { DIR_SYNC_ENGINE_DECLINED_LINE } from '../cloudSession.js'

const body = readFileSync(join(import.meta.dir, '../dirSyncLookup.ts'), 'utf8')

describe('dirSync lookup leftover 283 gold strings', () => {
  test('source-locks named leftover wrap', () => {
    expect(body).toContain('gold `ito` @196030082')
    expect(body).toContain('gold `ato` @196030166')
    expect(body).toContain('gold `q9` @196031203')
    expect(body).toContain('gold `gC` @196032132')
    expect(body).toContain('gold `R` @196040117')
    expect(body).toContain('gold `TBn` @182125118 / `M` @196041459')
    expect(body).toContain('TBn()==="on"?"given":"switched_off"')
    expect(body).toContain('gold `aLe` / `ee` @196047200')
    expect(body).toContain('gold `W` @196047325')
    expect(body).toContain('gold `Ie` @196047583')
    expect(body).toContain('{kind:"unknown", why:"not_looked"}')
    expect(body).toContain('gold `Ue` @196048448')
    expect(body).toContain(
      'File sync for this session was set up from another directory on this ',
    )
    expect(body).toContain(
      "machine, not ${cwd}: edits here are not uploaded, and Claude's changes are not written here. Attaching from that directory resumes it if sync is still on there.",
    )
    expect(body).toContain('gold `te` @196048705')
    expect(body).toContain('[dirSync] looki')
    expect(body).toContain('gold `hn` @202412591')
    expect(body).toContain('gold `fn` @202412770')
    expect(body).toContain('takeDirSync')
    expect(body).toContain('releaseDirSync')
    expect(body).toContain(
      '[headlessCloud] directory-sync handle unavailable:',
    )
    expect(body).toContain(
      '[headlessCloud] directory-sync handle not released:',
    )
    expect(body).toContain(
      "[dirSync] looking for this session's base elsewhere failed:",
    )
    expect(body).toContain('settings.read')
    expect(body).toContain('missing v5 → null')
    expect(body).toContain('engine_declined')
    expect(body).not.toContain('openLaptopGitSync')
    expect(body).not.toContain('openFolderGitSync')
    expect(body).not.toContain('tengu_violin_amati')
    expect(body).not.toContain('settings.set(')
  })

  test('Ue FULL string; ito missing v5 is null; q9 backlog 50; R git→declined; Ie !es not_looked', async () => {
    expect(DIR_SYNC_ELSEWHERE_LINE('/tmp/here')).toBe(
      "File sync for this session was set up from another directory on this machine, not /tmp/here: edits here are not uploaded, and Claude's changes are not written here. Attaching from that directory resumes it if sync is still on there.",
    )
    expect(await readDirSyncV5('/nope.json', 'cse_1')).toBe(null)
    expect(DIR_SYNC_NOTICE_BACKLOG_CAP).toBe(50)
    const bus = createDirSyncNoticeBus()
    bus.publish('a', 'info')
    bus.publish('b', 'warning')
    expect(bus.takeBacklog().map(n => n.line)).toEqual(['a', 'b'])
    expect(bus.takeBacklog()).toEqual([])
    const live: string[] = []
    const off = bus.subscribe(n => live.push(n.line))
    bus.publish('c', 'info')
    expect(live).toEqual(['c'])
    off()
    const tbn = await dirSyncWoodGate()
    expect(tbn === 'on' || tbn === 'switched_off').toBe(true)
    expect(await dirSyncEngineConsent()).toBe(
      tbn === 'on' ? 'given' : 'switched_off',
    )
    const stopped = createStoppedLaptopDirSyncSession({
      sessionId: 'session_abc',
      gitRoot: '/tmp',
      engine: { kind: 'git' },
    })
    expect(stopped.sync.state()).toEqual({
      state: 'stopped',
      reason: 'engine_declined',
      message: DIR_SYNC_ENGINE_DECLINED_LINE,
    })
    expect(
      await attachLaptopDirSyncSession({
        sessionId: 'x',
        boundToThisMachine: false,
        woodOn: false,
      }),
    ).toBeUndefined()
    expect(await lookupDirSyncBaseElsewhere('cse_1')).toEqual({
      kind: 'unknown',
      why: 'not_looked',
    })
  })
})
