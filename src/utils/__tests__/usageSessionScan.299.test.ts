import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  scanUsageTranscripts,
  warningBehaviorsOverMin,
} from '../usageSessionScan.js'

describe('2.1.299 #581 usageSessionScan warningBehaviors', () => {
  test('detects max_effort, workflow, always_on_context, large_tool_results, and peakParallel', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'usage-299-'))
    const prevConfig = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmp
    try {
      const projDir = join(tmp, 'projects', 'proj-a')
      const workflowDir = join(projDir, 'sess-1', 'subagents', 'workflows')
      mkdirSync(workflowDir, { recursive: true })

      const now = Date.now()
      const ts1 = new Date(now - 60_000).toISOString()
      const ts2 = new Date(now - 50_000).toISOString()
      const ts3 = new Date(now - 40_000).toISOString()

      // Main session: first turn with high always-on context (>40k), max effort, and a large tool_result (>25k bytes)
      const mainLines = [
        JSON.stringify({
          type: 'user',
          timestamp: ts1,
          uuid: 'u1',
          message: { role: 'user', content: 'hi' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: ts1,
          sessionId: 'sess-1',
          requestId: 'req-1',
          effort: 'max',
          message: {
            model: 'claude-sonnet-4-6',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 50_000,
            },
          },
        }),
        JSON.stringify({
          type: 'user',
          timestamp: ts2,
          uuid: 'u2',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu-1',
                content: 'x'.repeat(30_000),
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: ts2,
          sessionId: 'sess-1',
          requestId: 'req-2',
          message: {
            model: 'claude-sonnet-4-6',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_creation_input_tokens: 12_000,
              cache_read_input_tokens: 50_000,
            },
          },
        }),
      ]
      writeFileSync(join(projDir, 'sess-1.jsonl'), mainLines.join('\n') + '\n')

      // Workflow subagent transcript
      const wfLine = JSON.stringify({
        type: 'assistant',
        timestamp: ts3,
        sessionId: 'sess-2',
        requestId: 'req-wf',
        message: {
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 10_000,
          },
        },
      })
      writeFileSync(join(workflowDir, 'agent-1.jsonl'), wfLine + '\n')

      const res = await scanUsageTranscripts(null)
      expect(res.day.peakParallel).toBe(2)

      const byKey = new Map(
        (res.day.warningBehaviors ?? []).map(b => [b.key, b]),
      )
      expect(byKey.get('max_effort')?.count).toBe(1)
      expect(byKey.get('workflow')?.count).toBe(1)
      expect(byKey.get('always_on_context')?.count).toBe(2)
      expect(byKey.get('large_tool_results')?.count).toBe(1)

      const over = warningBehaviorsOverMin(res.day)
      expect(over.length).toBeGreaterThan(0)
      expect(over.map(b => b.key)).toContain('always_on_context')
    } finally {
      if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfig
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
