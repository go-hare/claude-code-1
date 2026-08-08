/**
 * densable 2.1.218 DaemonHub product shell (LGa/HGa/OGa/mGa) — source + unit.
 *
 * SEA:
 *   title "Claude daemon"
 *   tabs Scheduled / Remote Control
 *   empty `  (no scheduled tasks)` / `  (no remote-control servers)`
 *   `+ Add new scheduled task…` / `+ Add new remote-control server…`
 *   mGa: Enable|Disable, Edit, Remove, Back + Remove task? cancelFirst
 *   service: Uninstall service / Stop
 *   d_T call → hub on bare /daemon
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getSessionCronTasks,
  resetStateForTests,
  setOriginalCwd,
  setProjectRoot,
} from '../../../bootstrap/state.js'
import {
  isCronTaskEnabled,
  readCronTasks,
  toggleCronTaskEnabled,
  upsertCronTask,
  writeCronTasks,
} from '../../../utils/cronTasks.js'
import { parseScheduleInput } from '../../../utils/cron.js'
import { autoScheduledTaskId } from '../ScheduledTaskFormDialog.js'
import {
  DAEMON_HUB_KIND_LABEL,
  DAEMON_HUB_TAB_REMOTE,
  DAEMON_HUB_TAB_SCHEDULED,
  DAEMON_HUB_TITLE,
  DAEMON_SERVICE_STOP,
  DAEMON_SERVICE_UNINSTALL,
} from '../DaemonHubDialog.js'
import {
  formatSchedRemoveSubtitle,
  SCHED_REMOVE_TASK_CANCEL,
  SCHED_REMOVE_TASK_CONFIRM,
  SCHED_REMOVE_TASK_TITLE,
} from '../ScheduledTaskDetailDialog.js'
import {
  cleanupTempDir,
  createTempDir,
} from '../../../../tests/mocks/file-system.js'

const hubSrc = readFileSync(
  join(import.meta.dir, '../DaemonHubDialog.tsx'),
  'utf8',
)
const detailSrc = readFileSync(
  join(import.meta.dir, '../ScheduledTaskDetailDialog.tsx'),
  'utf8',
)
const formSrc = readFileSync(
  join(import.meta.dir, '../ScheduledTaskFormDialog.tsx'),
  'utf8',
)
const daemonCmdSrc = readFileSync(
  join(import.meta.dir, '../../../commands/daemon/daemon.tsx'),
  'utf8',
)
const daemonIdxSrc = readFileSync(
  join(import.meta.dir, '../../../commands/daemon/index.ts'),
  'utf8',
)

describe('densable 2.1.218 DaemonHub shell (source contract)', () => {
  test('hub title + dual tabs densable strings', () => {
    expect(DAEMON_HUB_TITLE).toBe('Claude daemon')
    expect(DAEMON_HUB_TAB_SCHEDULED).toBe('Scheduled')
    expect(DAEMON_HUB_TAB_REMOTE).toBe('Remote Control')
    expect(hubSrc).toContain('Claude daemon')
    expect(hubSrc).toContain('Scheduled')
    expect(hubSrc).toContain('Remote Control')
  })

  test('OGa empty + Add new labels use densable roi map', () => {
    expect(DAEMON_HUB_KIND_LABEL.scheduled).toBe('scheduled task')
    expect(DAEMON_HUB_KIND_LABEL.remoteControl).toBe('remote-control server')
    // biome-ignore lint/suspicious/noTemplateCurlyInString: densable empty template
    expect(hubSrc).toContain('(no ${DAEMON_HUB_KIND_LABEL.scheduled}s)')
    // biome-ignore lint/suspicious/noTemplateCurlyInString: densable empty template
    expect(hubSrc).toContain('(no ${DAEMON_HUB_KIND_LABEL.remoteControl}s)')
    // biome-ignore lint/suspicious/noTemplateCurlyInString: densable add template
    expect(hubSrc).toContain('+ Add new ${DAEMON_HUB_KIND_LABEL.scheduled}')
    // biome-ignore lint/suspicious/noTemplateCurlyInString: densable add template
    expect(hubSrc).toContain('+ Add new ${DAEMON_HUB_KIND_LABEL.remoteControl}')
  })

  test('service footer Uninstall service / Stop', () => {
    expect(DAEMON_SERVICE_UNINSTALL).toBe('Uninstall service')
    expect(DAEMON_SERVICE_STOP).toBe('Stop')
    expect(hubSrc).toContain('Uninstall service')
    expect(hubSrc).toContain("'Stop'")
  })

  test('nav state machine hub | detail-scheduled | detail-remoteControl | new', () => {
    expect(hubSrc).toContain("type: 'hub'")
    expect(hubSrc).toContain("type: 'detail-scheduled'")
    expect(hubSrc).toContain("type: 'detail-remoteControl'")
    expect(hubSrc).toContain("type: 'new'")
    expect(hubSrc).toContain('ScheduledTaskDetailDialog')
    expect(hubSrc).toContain('RemoteControlServerDetailDialog')
    expect(hubSrc).toContain('ScheduledTaskFormDialog')
    expect(hubSrc).toContain('RemoteControlAddServerDialog')
  })

  test('mGa Remove task? cancelFirst densable copy', () => {
    expect(SCHED_REMOVE_TASK_TITLE).toBe('Remove task?')
    expect(SCHED_REMOVE_TASK_CONFIRM).toBe('Yes, remove')
    expect(SCHED_REMOVE_TASK_CANCEL).toBe('No, cancel')
    expect(formatSchedRemoveSubtitle('abc')).toContain(
      "Delete 'abc' from daemon.json",
    )
    expect(formatSchedRemoveSubtitle('abc')).toContain('next reconcile')
    expect(detailSrc).toContain("defaultValue={'no'}")
    // toggle label is dynamic Enable|Disable from enabled state
    expect(detailSrc).toContain("'Disable'")
    expect(detailSrc).toContain("'Enable'")
    expect(detailSrc).toContain("label: 'Edit'")
    expect(detailSrc).toContain("label: 'Remove'")
    expect(detailSrc).toContain("label: 'Back'")
    // cancel before confirm in options
    const block = detailSrc.slice(detailSrc.indexOf('confirm-remove'))
    expect(block.indexOf('SCHED_REMOVE_TASK_CANCEL')).toBeLessThan(
      block.indexOf('SCHED_REMOVE_TASK_CONFIRM'),
    )
  })

  test('hGa form densable Fire a prompt subtitle + Create task', () => {
    expect(formSrc).toContain('Fire a prompt on a recurring schedule')
    expect(formSrc).toContain('New scheduled task')
    expect(formSrc).toContain('Create task')
    expect(formSrc).toContain('Save changes')
  })

  test('/daemon bare opens hub; description densable', () => {
    expect(daemonCmdSrc).toContain('DaemonHubDialog')
    expect(daemonCmdSrc).toContain("sub === 'hub'")
    expect(daemonIdxSrc).toContain('Manage background services and routines')
    expect(daemonIdxSrc).toContain('immediate: true')
  })
})

describe('densable eGe parseScheduleInput + eoi auto id', () => {
  test('relative 5m / 2h / 1d → cron', () => {
    expect(parseScheduleInput('5m')).toEqual({
      cron: '*/5 * * * *',
      human: expect.any(String) as unknown as string,
    })
    const five = parseScheduleInput('5m')
    expect('cron' in five && five.cron).toBe('*/5 * * * *')
    const twoH = parseScheduleInput('2h')
    expect('cron' in twoH && twoH.cron).toBe('0 */2 * * *')
    const oneD = parseScheduleInput('1d')
    expect('cron' in oneD && oneD.cron).toBe('0 0 * * *')
  })

  test('rejects seconds and empty', () => {
    expect(parseScheduleInput('30s')).toMatchObject({
      error: expect.stringMatching(/minute/i),
    })
    expect(parseScheduleInput('')).toMatchObject({ error: 'required' })
  })

  test('passes through 5-field cron', () => {
    const r = parseScheduleInput('*/15 * * * *')
    expect('cron' in r && r.cron).toBe('*/15 * * * *')
  })

  test('autoScheduledTaskId densable eoi', () => {
    expect(autoScheduledTaskId('/Users/me/proj', 'check prs daily')).toMatch(
      /proj-check-prs-daily/,
    )
  })
})

describe('cronTasks enabled toggle (mGa IBt)', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await createTempDir('daemon-hub-cron-')
    resetStateForTests()
    setOriginalCwd(tempDir)
    setProjectRoot(tempDir)
  })

  afterEach(async () => {
    resetStateForTests()
    if (tempDir) await cleanupTempDir(tempDir)
  })

  test('upsert + toggle enabled persists and isCronTaskEnabled', async () => {
    await upsertCronTask({
      id: 't1',
      cron: '*/5 * * * *',
      prompt: 'hello',
      recurring: true,
    })
    let tasks = await readCronTasks()
    expect(tasks).toHaveLength(1)
    expect(isCronTaskEnabled(tasks[0]!)).toBe(true)

    const next = await toggleCronTaskEnabled('t1')
    expect(next).toBe(false)
    tasks = await readCronTasks()
    expect(tasks[0]!.enabled).toBe(false)
    expect(isCronTaskEnabled(tasks[0]!)).toBe(false)

    const back = await toggleCronTaskEnabled('t1')
    expect(back).toBe(true)
    tasks = await readCronTasks()
    expect(tasks[0]!.enabled).toBeUndefined()
    expect(isCronTaskEnabled(tasks[0]!)).toBe(true)
  })

  test('writeCronTasks round-trips enabled:false', async () => {
    await writeCronTasks([
      {
        id: 'x',
        cron: '0 * * * *',
        prompt: 'p',
        createdAt: Date.now(),
        recurring: true,
        enabled: false,
      },
    ])
    const tasks = await readCronTasks()
    expect(tasks[0]!.enabled).toBe(false)
    expect(getSessionCronTasks()).toHaveLength(0)
  })
})
