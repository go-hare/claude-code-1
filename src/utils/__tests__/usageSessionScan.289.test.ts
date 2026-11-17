import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  BEHAVIOR_PCT_MIN,
  behaviorsOverMin,
  modelTier,
  recordCostUsd,
  scanUsageTranscripts,
  USAGE_TRANSCRIPT_SCAN_HIPAA_REASON,
  USAGE_TRANSCRIPT_SCAN_POLICY,
  usageTranscriptScanPermission,
  windowHasNamedRows,
  type UsageScanWindow,
} from '../usageSessionScan.js'
import { leftoverPolicyLimitsHost } from '../../cli/leftoverTulip.js'

function emptyWindow(over: Partial<UsageScanWindow> = {}): UsageScanWindow {
  return {
    totalCost: 0,
    requestCount: 0,
    sessionCount: 0,
    behaviors: [],
    agents: [],
    skills: [],
    plugins: [],
    mcpServers: [],
    loops: [],
    ...over,
  }
}

describe('densable Q5e/iws usage transcript scan helpers', () => {
  test('filesystem scan ignores root files and non-directory subagents while reading valid sessions', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'usage-scan-289-'))
    const previous = process.env.CLAUDE_CONFIG_DIR
    try {
      process.env.CLAUDE_CONFIG_DIR = configDir
      const projects = join(configDir, 'projects')
      const project = join(projects, 'project')
      await mkdir(join(project, 'session'), { recursive: true })
      await writeFile(join(projects, '.DS_Store'), 'metadata')
      await writeFile(join(projects, 'stray.jsonl'), 'not a project')
      await writeFile(join(project, 'session', 'subagents'), 'not a directory')
      await writeFile(
        join(project, 'session.jsonl'),
        JSON.stringify({
          type: 'assistant',
          timestamp: new Date().toISOString(),
          sessionId: 'filesystem-session',
          uuid: 'filesystem-record',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, output_tokens: 20 },
        }) + '\n',
      )
      const result = await scanUsageTranscripts(null)
      expect(result.day.requestCount).toBe(1)
      expect(result.week.requestCount).toBe(1)
      expect(result.week.sessionCount).toBe(1)
      expect(result.week.totalCost).toBeGreaterThan(0)

      await rm(projects, { recursive: true })
      await writeFile(projects, 'replaced during scan')
      const missing = await scanUsageTranscripts(null)
      expect(missing.week.requestCount).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = previous
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test('filesystem scan preserves a JSONL record spanning multiple 4MiB chunks', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'usage-long-line-'))
    const previous = process.env.CLAUDE_CONFIG_DIR
    try {
      process.env.CLAUDE_CONFIG_DIR = configDir
      const project = join(configDir, 'projects', 'project')
      await mkdir(project, { recursive: true })
      const record = (uuid: string, padding: string) =>
        JSON.stringify({
          type: 'assistant',
          timestamp: new Date().toISOString(),
          sessionId: 'long-lines',
          uuid,
          model: 'claude-sonnet-4-6',
          padding,
          usage: { input_tokens: 100, output_tokens: 20 },
        })
      await writeFile(
        join(project, 'session.jsonl'),
        record('oversized', 'x'.repeat(9 * 1024 * 1024)) +
          '\n' +
          record('tail', ''),
      )
      const result = await scanUsageTranscripts(null)
      expect(result.day.requestCount).toBe(2)
      expect(result.week.requestCount).toBe(2)
      expect(result.week.sessionCount).toBe(1)
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = previous
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test('Nt model tiers match leftover', () => {
    expect(modelTier(undefined)).toBe(3)
    expect(modelTier('claude-haiku-4')).toBe(1)
    expect(modelTier('claude-opus-4-7')).toBe(5)
    expect(modelTier('fable-5')).toBe(10)
    expect(modelTier('claude-sonnet-4')).toBe(3)
  })

  test('xuo cost formula', () => {
    expect(
      recordCostUsd({
        cached: 1,
        uncached: 1,
        cacheCreate: 1,
        output: 1,
        modelTier: 1,
      }),
    ).toBe(1 + 10 + 12.5 + 50)
  })

  test('Po filter is 10 percent of totalCost', () => {
    expect(BEHAVIOR_PCT_MIN).toBe(10)
    const window = emptyWindow({
      totalCost: 100,
      behaviors: [
        { key: 'cache_miss', cost: 11, count: 1 },
        { key: 'cron', cost: 9, count: 1 },
      ],
    })
    expect(behaviorsOverMin(window).map(b => b.key)).toEqual(['cache_miss'])
  })

  test('$t named-row gate', () => {
    expect(windowHasNamedRows(emptyWindow())).toBe(false)
    expect(
      windowHasNamedRows(emptyWindow({ skills: [{ name: 's', pct: 12 }] })),
    ).toBe(true)
  })

  test('policy key is allow_usage_transcript_scan and v(Oe) distinguishes hipaa vs dp', () => {
    expect(USAGE_TRANSCRIPT_SCAN_POLICY).toBe('allow_usage_transcript_scan')
    const host = leftoverPolicyLimitsHost()
    const prevSessionCache = host.sessionCache
    const prevTaints = [...host.complianceTaints]
    const prevServer = host.sessionFromServerFetch
    const prevApiKey = process.env.ANTHROPIC_API_KEY
    const prevBaseUrl = process.env.ANTHROPIC_BASE_URL
    const prevOpenAi = process.env.CLAUDE_CODE_USE_OPENAI
    const prevGemini = process.env.CLAUDE_CODE_USE_GEMINI
    const prevGrok = process.env.CLAUDE_CODE_USE_GROK
    try {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test-key'
      delete process.env.ANTHROPIC_BASE_URL
      delete process.env.CLAUDE_CODE_USE_OPENAI
      delete process.env.CLAUDE_CODE_USE_GEMINI
      delete process.env.CLAUDE_CODE_USE_GROK
      const denied = {
        allow_usage_transcript_scan: { allowed: false },
      }
      host.sessionCache = denied
      host.complianceTaints = ['hipaa']
      host.sessionFromServerFetch = true
      expect(usageTranscriptScanPermission()).toEqual({
        allowed: false,
        reason: USAGE_TRANSCRIPT_SCAN_HIPAA_REASON,
      })

      host.complianceTaints = []
      const nonHipaa = usageTranscriptScanPermission()
      expect(nonHipaa.allowed).toBe(false)
      if (!nonHipaa.allowed) {
        expect(nonHipaa.reason).toContain('Usage patterns are')
      }
    } finally {
      if (prevApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = prevApiKey
      if (prevBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
      else process.env.ANTHROPIC_BASE_URL = prevBaseUrl
      if (prevOpenAi === undefined) delete process.env.CLAUDE_CODE_USE_OPENAI
      else process.env.CLAUDE_CODE_USE_OPENAI = prevOpenAi
      if (prevGemini === undefined) delete process.env.CLAUDE_CODE_USE_GEMINI
      else process.env.CLAUDE_CODE_USE_GEMINI = prevGemini
      if (prevGrok === undefined) delete process.env.CLAUDE_CODE_USE_GROK
      else process.env.CLAUDE_CODE_USE_GROK = prevGrok
      host.sessionCache = prevSessionCache
      host.complianceTaints = prevTaints
      host.sessionFromServerFetch = prevServer
    }
  })

  test('v5 Ln arm reads transcript entries and splits shared loop turns via loopShares', async () => {
    const nowIso = new Date().toISOString()
    const lines = [
      JSON.stringify({
        subtype: 'scheduled_task_fire',
        timestamp: nowIso,
        uuid: 'f1',
        taskId: 't1',
        prompt: 'loop-alpha',
        cron: '*/5 * * * *',
        taskKind: 'loop',
      }),
      JSON.stringify({
        type: 'user',
        timestamp: nowIso,
        scheduledTaskId: 't1',
        message: { content: 'run alpha' },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: nowIso,
        isMeta: true,
        promptSource: 'cron',
        message: { content: 'also queued non-human turn' },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: nowIso,
        sessionId: 's1',
        uuid: 'a1',
        model: 'claude-sonnet-4-6',
        attributionSkill: 'my-skill',
        usage: {
          input_tokens: 100,
          output_tokens: 100,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }),
    ].join('\n')
    const payload = new TextEncoder().encode(lines)
    const fakeV5 = {
      async listEntries(scope: Record<string, unknown>) {
        if (!('projectKey' in scope)) {
          return {
            ok: true as const,
            value: {
              items: [
                {
                  kind: 'scope',
                  scope: { namespace: 'transcript', projectKey: 'proj1' },
                },
              ],
            },
          }
        }
        return {
          ok: true as const,
          value: {
            items: [
              {
                kind: 'key',
                key: {
                  namespace: 'transcript',
                  projectKey: 'proj1',
                  sessionId: 's1',
                },
                size: payload.byteLength,
                mtimeMs: Date.now(),
              },
            ],
          },
        }
      },
      async read() {
        return {
          ok: true as const,
          value: {
            items: [
              {
                found: true,
                value: payload,
                totalBytes: payload.byteLength,
              },
            ],
          },
        }
      },
    }

    const res = await scanUsageTranscripts(fakeV5)
    expect(res.day.requestCount).toBe(1)
    expect(res.day.skills).toEqual([{ name: 'my-skill', pct: 100 }])
    expect(res.day.loops).toHaveLength(1)
    expect(res.day.loops[0]!.prompt).toBe('loop-alpha')
    expect(res.day.loops[0]!.runs).toBe(1)
    // Shared between 1 loop fire and 1 human user message => 200 * 0.5 = 100 tokens
    expect(res.day.loops[0]!.tokens).toBe(100)
  })

  test('subagents directory JSONLs count toward subagent_heavy and behaviors emit strictly the 5 official keys', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'usage-subagent-289-'))
    const previous = process.env.CLAUDE_CONFIG_DIR
    try {
      process.env.CLAUDE_CONFIG_DIR = configDir
      const project = join(configDir, 'projects', 'project')
      const subagentsDir = join(project, 'sess-1', 'subagents')
      await mkdir(subagentsDir, { recursive: true })
      const nowIso = new Date().toISOString()
      await writeFile(
        join(project, 'sess-1.jsonl'),
        JSON.stringify({
          type: 'assistant',
          timestamp: nowIso,
          sessionId: 'sess-1',
          uuid: 'main-1',
          model: 'claude-opus-4-7',
          effort: 'max',
          usage: { input_tokens: 10, output_tokens: 10 },
        }) + '\n',
      )
      await writeFile(
        join(subagentsDir, 'agent-1.jsonl'),
        [1, 2, 3]
          .map(i =>
            JSON.stringify({
              type: 'assistant',
              timestamp: nowIso,
              sessionId: 'sess-1',
              uuid: `sub-${i}`,
              model: 'claude-sonnet-4-6',
              usage: { input_tokens: 50, output_tokens: 50 },
            }),
          )
          .join('\n') + '\n',
      )
      const res = await scanUsageTranscripts(null)
      expect(res.day.behaviors.map(b => b.key).sort()).toEqual([
        'cache_miss',
        'cron',
        'high_parallel',
        'long_context',
        'subagent_heavy',
      ])
      expect(behaviorsOverMin(res.day).map(b => b.key)).toEqual([
        'subagent_heavy',
      ])
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = previous
      await rm(configDir, { recursive: true, force: true })
    }
  })
})
