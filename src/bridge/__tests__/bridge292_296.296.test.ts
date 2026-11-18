import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { forwardParentToolUseSdkFrame } from '../subagentSdkFrames.js'
import {
  formatApiKeyOverrideReason,
  formatOrgPolicy404Error,
  formatOrgPolicyLoadError,
} from '../bridgeEnabled.js'

describe('bridge 2.1.292-2.1.296 alignment', () => {
  test('#218 forwards background_tasks_changed and task lifecycle frames to bridge SDK handle', () => {
    const written: unknown[][] = []
    const handle = {
      writeSdkMessages: (msgs: unknown[]) => written.push(msgs),
    }

    forwardParentToolUseSdkFrame(handle, {
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [
        {
          task_id: 't1',
          task_type: 'local_agent',
          subagent_type: 'Explore',
          description: 'Search files',
        },
      ],
    } as never)

    forwardParentToolUseSdkFrame(handle, {
      type: 'system',
      subtype: 'task_started',
      task_id: 't1',
    } as never)

    expect(written).toHaveLength(2)
    expect((written[0]![0] as { subtype: string }).subtype).toBe(
      'background_tasks_changed',
    )
    expect((written[1]![0] as { subtype: string }).subtype).toBe('task_started')
  })

  test('#303 remoteBridgeCore does not reset initialFlushDone on credential recovery', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'remoteBridgeCore.ts'),
      'utf8',
    )
    const idx = src.indexOf('if (isRemoteCredentials(result))')
    expect(idx).toBeGreaterThan(-1)
    const slice = src.slice(idx, idx + 450)
    expect(slice).not.toContain('initialFlushDone = false')
  })

  test('#539 formats org policy load failures and API key / apiKeyHelper override reasons', () => {
    expect(formatOrgPolicy404Error('Remote Control')).toContain(
      '/api/claude_code/organizations/policy got a 404',
    )
    expect(
      formatOrgPolicyLoadError('Remote Control', 'is', {
        errorCode: 'parse_failed',
        host: 'api.anthropic.com',
        httpStatus: 200,
      }),
    ).toContain("couldn't read the reply when it asked api.anthropic.com")

    expect(
      formatApiKeyOverrideReason({
        prefix: 'Remote Control requires claude.ai subscription auth.',
        suffix: 'to use Remote Control.',
        env: { ANTHROPIC_API_KEY: 'sk-ant-123' },
        apiKeySource: { key: 'sk-ant-123', source: 'ANTHROPIC_API_KEY' },
      }),
    ).toContain('ANTHROPIC_API_KEY is set')

    expect(
      formatApiKeyOverrideReason({
        prefix: 'Remote Control requires claude.ai subscription auth.',
        suffix: 'to use Remote Control.',
        env: {},
        apiKeySource: { key: null, source: 'apiKeyHelper' },
      }),
    ).toContain('apiKeyHelper is configured')

    expect(
      formatApiKeyOverrideReason({
        prefix: 'Remote Control requires claude.ai subscription auth.',
        suffix: 'to use Remote Control.',
        env: { ANTHROPIC_AUTH_TOKEN: 'tok' },
        apiKeySource: { key: null, source: 'none' },
      }),
    ).toContain('ANTHROPIC_AUTH_TOKEN is set')
  })
})
