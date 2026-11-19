import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  cleanupExpiredSessionTempDirs,
  recordUnreadableDirectoryError,
} from '../../cleanup.js'
import { updateLatestDebugLogSymlinkForPath } from '../../debug.js'
import { parseOtelResourceAttributesDetailed } from '../../telemetryAttributes.js'
import {
  formatUserPromptForOTel,
  isBackgroundAgentReplyOrigin,
} from '../events.js'
import {
  DEFAULT_OTLP_PROTOCOL,
  resolveOtlpProtocol,
} from '../instrumentation.js'
import { createOtlpHttpAgentFactory, OtlpProxyAgent } from '../otlpHttpAgent.js'
import {
  buildOTelAttributionAttributes,
  sanitizeAttributionForOTel,
} from '../pluginTelemetry.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 323 Group 2 — Telemetry, Debug Symlink, Cleanup', () => {
  test('#2057: cleanupExpiredSessionTempDirs removes temp dirs across changed-cwd project slugs', async () => {
    const tempRoot = makeTempDir('w323-temp-root-')
    const expiredId = '11111111-1111-4111-8111-111111111111'
    const liveId = '22222222-2222-4222-8222-222222222222'
    const currentId = '33333333-3333-4333-8333-333333333333'

    const otherProjectExpired = join(tempRoot, '-other-cwd-project', expiredId)
    const otherProjectLive = join(tempRoot, '-other-cwd-project', liveId)
    const otherProjectCurrent = join(tempRoot, '-third-cwd-project', currentId)
    mkdirSync(otherProjectExpired, { recursive: true })
    mkdirSync(otherProjectLive, { recursive: true })
    mkdirSync(otherProjectCurrent, { recursive: true })
    writeFileSync(join(otherProjectExpired, 'task.output'), 'stale')
    writeFileSync(join(otherProjectLive, 'task.output'), 'live')
    writeFileSync(join(otherProjectCurrent, 'task.output'), 'current')

    const result = await cleanupExpiredSessionTempDirs(
      [expiredId, liveId, currentId],
      {
        tempRoot,
        currentSessionId: currentId,
        liveSessionIds: new Set([liveId]),
      },
    )
    expect(result.messages).toBe(1)
    expect(result.errors).toBe(0)
    expect(existsSync(otherProjectExpired)).toBe(false)
    expect(existsSync(otherProjectLive)).toBe(true)
    expect(existsSync(otherProjectCurrent)).toBe(true)
  })

  test('#2086: updateLatestDebugLogSymlinkForPath preserves a regular file named latest', async () => {
    const dir = makeTempDir('w323-debug-latest-')
    const latestPath = join(dir, 'latest')
    writeFileSync(latestPath, 'user-important-file')

    const logPath = join(dir, 'session.txt')
    writeFileSync(logPath, 'debug output')

    // Must not overwrite regular file named `latest`
    const updated = await updateLatestDebugLogSymlinkForPath(logPath)
    expect(updated).toBe(false)
    expect(lstatSync(latestPath).isSymbolicLink()).toBe(false)
    expect(readFileSync(latestPath, 'utf8')).toBe('user-important-file')

    // Must not touch `latest` when logPath itself is named `latest`
    expect(await updateLatestDebugLogSymlinkForPath(latestPath)).toBe(false)

    // When `latest` does not exist, symlink is created cleanly
    const dir2 = makeTempDir('w323-debug-latest-ok-')
    const log2 = join(dir2, 'session2.txt')
    writeFileSync(log2, 'debug 2')
    expect(await updateLatestDebugLogSymlinkForPath(log2)).toBe(true)
    expect(readlinkSync(join(dir2, 'latest'))).toBe(log2)
  })

  test('#2121: resolveOtlpProtocol defaults to http/protobuf when endpoint is set without protocol', () => {
    expect(
      resolveOtlpProtocol('metrics', {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example.com:4318',
      }),
    ).toBe(DEFAULT_OTLP_PROTOCOL)

    expect(
      resolveOtlpProtocol('logs', {
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://localhost:4318/v1/logs',
      }),
    ).toBe('http/protobuf')

    // Explicit protocol still takes precedence
    expect(
      resolveOtlpProtocol('traces', {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example.com:4318',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      }),
    ).toBe('http/json')

    // No endpoint & no protocol -> undefined
    expect(resolveOtlpProtocol('metrics', {})).toBeUndefined()
  })

  test('#2122: createOtlpHttpAgentFactory bypasses proxy for unset endpoint (defaults to localhost:4318)', () => {
    const prevProxy = process.env.HTTPS_PROXY
    try {
      process.env.HTTPS_PROXY = 'http://proxy.corp.example:8080'
      const defaultFactory = createOtlpHttpAgentFactory(undefined)
      const defaultAgent = defaultFactory('http:')
      expect(defaultAgent instanceof OtlpProxyAgent).toBe(false)

      const remoteFactory = createOtlpHttpAgentFactory(
        'https://collector.example.com:4318',
      )
      const remoteAgent = remoteFactory('https:')
      expect(remoteAgent instanceof OtlpProxyAgent).toBe(true)
    } finally {
      if (prevProxy === undefined) delete process.env.HTTPS_PROXY
      else process.env.HTTPS_PROXY = prevProxy
    }
  })

  test('#2123: parseOtelResourceAttributesDetailed keeps valid entries when one entry is malformed', () => {
    const res = parseOtelResourceAttributesDetailed(
      'env=prod,broken_entry_no_equals,team=platform',
      true,
      { logWarnings: false },
    )
    expect(res.isEveryEntryRead).toBe(false)
    expect(res.attributes).toEqual({ env: 'prod', team: 'platform' })
    expect(res.droppedEntries).toHaveLength(1)
    expect(res.droppedEntries[0]?.index).toBe(2)
    expect(res.notices.some(n => n.includes('Entry 2 of 3'))).toBe(true)
  })

  test('#2124: formatUserPromptForOTel redacts background agent replies when OTEL_LOG_ASSISTANT_RESPONSES=0', () => {
    expect(
      isBackgroundAgentReplyOrigin({
        kind: 'task-notification',
        producer: 'session-task',
      }),
    ).toBe(true)
    expect(
      isBackgroundAgentReplyOrigin({ kind: 'peer', senderTaskId: 't-1' }),
    ).toBe(true)
    expect(isBackgroundAgentReplyOrigin({ kind: 'observer' })).toBe(true)
    expect(isBackgroundAgentReplyOrigin({ kind: 'human' })).toBe(false)

    const env: NodeJS.ProcessEnv = {
      OTEL_LOG_USER_PROMPTS: '1',
      OTEL_LOG_ASSISTANT_RESPONSES: '0',
    }
    expect(
      formatUserPromptForOTel(
        'background agent secret output',
        { kind: 'task-notification', producer: 'session-task' },
        env,
      ).prompt,
    ).toBe('<REDACTED>')

    expect(
      formatUserPromptForOTel('normal human prompt', { kind: 'human' }, env)
        .prompt,
    ).toBe('normal human prompt')
  })

  test('#2126: user-defined subagent launched by official plugin skill reports agent.name=custom', () => {
    const firstParty = new Map([['official-plugin', 'claude-plugins-official']])

    const userSubagent = buildOTelAttributionAttributes(
      'agent:custom:my-private-agent',
      {
        attributionAgent: 'my-private-agent',
        attributionSkill: 'official-plugin:review',
        attributionPlugin: 'official-plugin',
      },
      firstParty,
    )
    expect(userSubagent['agent.name']).toBe('custom')
    expect(userSubagent['plugin.name']).toBe('official-plugin')
    expect(userSubagent['skill.name']).toBe('official-plugin:review')

    // Builtin subagent keeps its builtin name
    const builtin = sanitizeAttributionForOTel(
      'agent:builtin:Explore',
      {
        attributionAgent: 'Explore',
        attributionPlugin: 'official-plugin',
      },
      firstParty,
    )
    expect(builtin.attributionAgent).toBe('Explore')

    // First-party plugin's own subagent keeps its name
    const officialAgent = sanitizeAttributionForOTel(
      'agent:custom:official-plugin:helper',
      {
        attributionAgent: 'official-plugin:helper',
        attributionPlugin: 'official-plugin',
      },
      firstParty,
    )
    expect(officialAgent.attributionAgent).toBe('official-plugin:helper')
  })

  test('#2158: recordUnreadableDirectoryError counts EACCES/EPERM as errors, ignores ENOENT', () => {
    const result = {
      messages: 0,
      errors: 0,
      filesRetainedFresh: 0,
      filesPastCutoff: 0,
    }
    recordUnreadableDirectoryError(
      Object.assign(new Error('not found'), { code: 'ENOENT' }),
      '/missing',
      result,
    )
    expect(result.errors).toBe(0)

    recordUnreadableDirectoryError(
      Object.assign(new Error('permission denied'), { code: 'EACCES' }),
      '/unreadable',
      result,
    )
    expect(result.errors).toBe(1)
  })
})
