/**
 * densable 2.1.218 B8a single-server manage + Remove server? cancelFirst.
 *
 * SEA ~240782285 / ~240783609:
 *   options: Restart ${zb()}, Remove, Back
 *   ba cancelFirst focus cancel: Yes, remove / No, cancel
 *   subtitle: Stop serving ${dir} to claude.ai. The ${zb()} will stop the worker…
 *   restart message: picks up config changes automatically — no restart needed
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const detailSrc = readFileSync(
  join(import.meta.dir, '../RemoteControlServerDetailDialog.tsx'),
  'utf8',
)
const manageSrc = readFileSync(
  join(import.meta.dir, '../RemoteControlServersManageDialog.tsx'),
  'utf8',
)
const bridgeSrc = readFileSync(
  join(import.meta.dir, '../../bridge/remoteControlServers.ts'),
  'utf8',
)

describe('densable 2.1.218 B8a Remote Control server detail', () => {
  test('detail options Restart / Remove / Back present', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: assert densable source template
    expect(detailSrc).toContain('Restart ${service}')
    expect(detailSrc).toContain("label: 'Remove'")
    expect(detailSrc).toContain("label: 'Back'")
  })

  test('Remove server? cancelFirst: No before Yes + defaultValue no', () => {
    expect(detailSrc).toContain("RC_REMOVE_SERVER_TITLE = 'Remove server?'")
    expect(detailSrc).toContain("RC_REMOVE_SERVER_CONFIRM = 'Yes, remove'")
    expect(detailSrc).toContain("RC_REMOVE_SERVER_CANCEL = 'No, cancel'")
    expect(detailSrc).toContain("defaultValue={'no'}")
    const cancelIdx = detailSrc.indexOf('RC_REMOVE_SERVER_CANCEL')
    const confirmIdx = detailSrc.indexOf('RC_REMOVE_SERVER_CONFIRM')
    // constants declared cancel then confirm; trust options use CANCEL first
    expect(cancelIdx).toBeGreaterThan(-1)
    expect(confirmIdx).toBeGreaterThan(-1)
    // options array: CANCEL label before CONFIRM label in confirm-remove phase
    const optionsBlock = detailSrc.slice(detailSrc.indexOf('confirm-remove'))
    const optCancel = optionsBlock.indexOf('RC_REMOVE_SERVER_CANCEL')
    const optConfirm = optionsBlock.indexOf('RC_REMOVE_SERVER_CONFIRM')
    expect(optCancel).toBeGreaterThan(-1)
    expect(optConfirm).toBeGreaterThan(-1)
    expect(optCancel).toBeLessThan(optConfirm)
  })

  test('remove subtitle densable Stop serving copy', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: assert densable source template
    expect(detailSrc).toContain('Stop serving ${dir} to claude.ai')
    expect(detailSrc).toContain('will stop the worker on its next reconcile')
  })

  test('restart is noop densable message (no hard restart)', () => {
    expect(detailSrc).toContain(
      'The background server picks up config changes automatically — no restart needed.',
    )
  })

  test('status running / not running densable labels', () => {
    expect(detailSrc).toContain("'running'")
    expect(detailSrc).toContain("'not running'")
    expect(detailSrc).toContain('Directory {server.dir}')
    expect(detailSrc).toContain('Spawn mode {server.spawnMode}')
  })

  test('manage list wires detail + add + empty remoteControls', () => {
    expect(manageSrc).toContain('RemoteControlServerDetailDialog')
    expect(manageSrc).toContain('RemoteControlAddServerDialog')
    expect(manageSrc).toContain('(no remoteControls)')
    expect(manageSrc).toContain('+ Add new remoteControl…')
  })

  test('bridge $Lf + zb helpers present', () => {
    expect(bridgeSrc).toContain('listRemoteControlServersWithStatus')
    expect(bridgeSrc).toContain('backgroundServiceLabel')
    expect(bridgeSrc).toContain("return 'daemon'")
    expect(bridgeSrc).toContain("return 'background service'")
  })
})
