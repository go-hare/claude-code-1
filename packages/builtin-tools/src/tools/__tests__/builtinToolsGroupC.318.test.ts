import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  getMacOsBash32HeredocNote,
  shouldTeachHeredocOnStdin,
} from '../BashTool/prompt.js'
import {
  summarizeCreatedMcpConnections,
  summarizeTriggerResponse,
} from '../RemoteTriggerTool/RemoteTriggerTool.js'
import {
  ARTIFACT_DB_ACCESS_TIERS,
  ARTIFACT_DB_RULE_PATH_RE,
  formatDbAccessRulesSummary,
} from '../ArtifactTool/mapToolResultSentences.js'
import { ArtifactTool } from '../ArtifactTool/ArtifactTool.js'
import {
  _resetPushNotificationDedupForTesting,
  PushNotificationTool,
} from '../PushNotificationTool/PushNotificationTool.js'
import { ScheduleWakeupTool } from '../ScheduleWakeupTool/ScheduleWakeupTool.js'
import { isCronManagementEnabled } from '../ScheduleCronTool/prompt.js'
import { SendUserFileTool } from '../SendUserFileTool/SendUserFileTool.js'

describe('Wave 316-318 Group C (builtin-tools)', () => {
  test('#1664 BashTool/prompt.ts teaches heredoc-on-stdin on macOS /bin/bash', async () => {
    expect(await shouldTeachHeredocOnStdin('/bin/bash', 'darwin')).toBe(true)
    expect(await shouldTeachHeredocOnStdin('/bin/zsh', 'darwin')).toBe(false)
    expect(await shouldTeachHeredocOnStdin('/bin/bash', 'linux')).toBe(false)
    const note = await getMacOsBash32HeredocNote(true, '/bin/bash', 'darwin')
    expect(note).toContain("macOS's /bin/bash (version 3.2)")
    expect(note).toContain('git commit -F -')
  })

  test('#1672 BashTool.tsx wires subagentCapMs', () => {
    const src = readFileSync(
      join(__dirname, '../BashTool/BashTool.tsx'),
      'utf8',
    )
    expect(src).toContain('resolveSubagentAutoBackgroundCapMs')
    expect(src).toContain('subagentCapMs')
  })

  test('#1570 GrepTool.ts wires rejectOnPartial', () => {
    const src = readFileSync(join(__dirname, '../GrepTool/GrepTool.ts'), 'utf8')
    expect(src).toContain('rejectOnPartial: true')
    expect(src).toContain('RipgrepTimeoutError')
  })

  test('#1488 SendUserFileTool.ts blocks outside working dir in restricted session', async () => {
    const { isRestrictedSession, setRestrictedSessionFlag } = await import(
      'src/utils/restricted.js'
    )
    const prev = isRestrictedSession()
    setRestrictedSessionFlag(true)
    try {
      const res = await SendUserFileTool.call({ file_path: '/etc/passwd' }, {
        getAppState: () => ({
          toolPermissionContext: {
            additionalWorkingDirectories: new Map(),
          },
        }),
      } as any)
      expect(res.data.sent).toBe(false)
      expect(res.data.error).toContain('restricted session')
    } finally {
      setRestrictedSessionFlag(prev)
    }
  })

  test('#1497 ArtifactTool supports self tier DB rules and dropped rules republish echo', () => {
    expect(ARTIFACT_DB_ACCESS_TIERS.has('self')).toBe(true)
    expect(ARTIFACT_DB_RULE_PATH_RE.test('users/{self}/profile')).toBe(true)
    const summary = formatDbAccessRulesSummary(
      [{ path: 'users/{self}', read: 'self', write: 'self' }],
      [{ path: 'legacy/items', read: 'view' }],
    )
    expect(summary).toContain('users/{self}: read=self, write=self')
    expect(summary).toContain('1 database access rule was dropped on republish')
  })

  test('#1546 ArtifactTool toAutoClassifierInput & checkPermissions exempt upload/write_db in auto mode', () => {
    const input = ArtifactTool.toAutoClassifierInput({
      file_path: '/tmp/out.html',
    } as any)
    expect(input).toEqual({ action: 'upload', file_path: '/tmp/out.html' })
    const src = readFileSync(
      join(__dirname, '../ArtifactTool/ArtifactTool.ts'),
      'utf8',
    )
    expect(src).toContain("mode === 'auto'")
    expect(src).toContain("actionName === 'write_db'")
  })

  test('#1528 & #1548 RemoteTriggerTool summarizes schedule links and unexpected mcp_connections', () => {
    const summary = summarizeTriggerResponse(
      {
        id: 'trig_123',
        enabled: true,
        next_run_at: '2026-12-01T10:00:00Z',
        cron_expression: '0 10 * * *',
      },
      'https://claude.ai',
    )
    expect(summary).toContain('→ Scheduled: next run (cron 0 10 * * *)')
    expect(summary).toContain(
      '→ View/manage: https://claude.ai/code/routines/trig_123',
    )

    const mcpNote = summarizeCreatedMcpConnections(
      { mcp_connections: [{ name: 'slack' }] },
      {},
    )
    expect(mcpNote).toContain('{"clear_mcp_connections": true}')
    expect(mcpNote).toContain('slack')
  })

  test('#1545 ScheduleWakeupTool call does not require noop', async () => {
    const res = await ScheduleWakeupTool.call({
      delaySeconds: 60,
      reason: 'wait for build',
      prompt: 'check build',
    } as any)
    expect(res.data.clampedDelaySeconds).toBe(60)
  })

  test('#1557 CronListTool and CronDeleteTool use isCronManagementEnabled', () => {
    expect(typeof isCronManagementEnabled()).toBe('boolean')
    const listSrc = readFileSync(
      join(__dirname, '../ScheduleCronTool/CronListTool.ts'),
      'utf8',
    )
    const delSrc = readFileSync(
      join(__dirname, '../ScheduleCronTool/CronDeleteTool.ts'),
      'utf8',
    )
    expect(listSrc).toContain('isCronManagementEnabled()')
    expect(delSrc).toContain('isCronManagementEnabled()')
  })

  test('#1650 PushNotificationTool supports status (proactive/normal) and dedup', () => {
    _resetPushNotificationDedupForTesting()
    const parsed = PushNotificationTool.inputSchema.safeParse({
      title: 'Done',
      body: 'Ready',
      status: 'proactive',
    })
    expect(parsed.success).toBe(true)
    const src = readFileSync(
      join(__dirname, '../PushNotificationTool/PushNotificationTool.ts'),
      'utf8',
    )
    expect(src).toContain('recentPushByKey')
    expect(src).toContain(".enum(['proactive', 'normal'])")
  })

  test('#1549 AgentTool/UI.tsx integrates isScreenReaderModeEnabled', () => {
    const src = readFileSync(join(__dirname, '../AgentTool/UI.tsx'), 'utf8')
    expect(src).toContain('isScreenReaderModeEnabled()')
  })
})
