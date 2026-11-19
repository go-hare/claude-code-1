import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getIsInteractive, setIsInteractive } from '../../../bootstrap/state.js'
import { buildHeadersHelperChildEnv } from '../marketplaceHeadersHelper.js'
import {
  clearPluginCommandCache,
  getPluginContentInternSize,
  internPluginContent,
} from '../loadPluginCommands.js'
import { bindPluginDevModsSession, askPluginDevMods } from '../pluginDevMods.js'
import { subscribePluginUiLog } from '../pluginUiLog.js'
import { validateManifest } from '../validatePlugin.js'
import {
  clearInMemorySyncedSkills,
  clearSyncedSkillLandingFailures,
  getInMemorySyncedSkills,
  pruneRemovedSyncedSkillHooks,
  recordFailedSyncedSkillLanding,
  retainInMemorySyncedSkill,
  shouldSkipSyncedSkillDownload,
  SYNCED_SKILL_DOWNLOAD_COOLDOWN_MS,
} from '../../../skills/loadSkillsDir.js'
import {
  claudeCodeBackend,
  clearCompletedWorkflowAgentResults,
  getCompletedWorkflowAgentResult,
  markWorkflowUsageLimitRecovery,
  recordCompletedWorkflowAgentResult,
} from '../../../workflow/backends/claudeCodeBackend.js'

describe('Wave 318 Plugins, Skills & Workflow Alignment', () => {
  afterEach(() => {
    bindPluginDevModsSession(undefined)
    clearPluginCommandCache()
    clearInMemorySyncedSkills()
    clearSyncedSkillLandingFailures()
    clearCompletedWorkflowAgentResults()
  })

  test('#1495: buildHeadersHelperChildEnv skips truthy/falsy toggle values from secrets and preserves cwd', () => {
    const prevToken = process.env.MY_AUTH_TOKEN
    process.env.MY_AUTH_TOKEN = '1'
    try {
      const env = buildHeadersHelperChildEnv({
        scrubCredentialEnv: true,
        cwd: '/tmp/plugin-1',
        env: {
          CLAUDE_PLUGIN_ROOT: '/tmp/plugin-1',
          CLAUDE_CODE_MCP_SERVER_URL: 'https://example.com/v1/mcp',
        },
      })
      expect(env.CLAUDE_PLUGIN_ROOT).toBe('/tmp/plugin-1')
      expect(env.CLAUDE_CODE_MCP_SERVER_URL).toBe('https://example.com/v1/mcp')
    } finally {
      if (prevToken === undefined) delete process.env.MY_AUTH_TOKEN
      else process.env.MY_AUTH_TOKEN = prevToken
    }
  })

  test('#1563: internPluginContent deduplicates strings and clears with cache', () => {
    const a = internPluginContent('/p/a.md', 'hello world')
    const b = internPluginContent('/p/a.md', 'hello' + ' world')
    expect(a).toBe(b)
    expect(getPluginContentInternSize()).toBe(1)
    clearPluginCommandCache()
    expect(getPluginContentInternSize()).toBe(0)
  })

  test('#1615: askPluginDevMods records user answer in display rows and terminal UI log', async () => {
    const prevInteractive = getIsInteractive()
    setIsInteractive(true)
    const rowsSent: unknown[][] = []
    const uiLogs: Array<{ plugin: string; text: string }> = []
    const unsub = subscribePluginUiLog(entry => uiLogs.push(entry))
    try {
      bindPluginDevModsSession({
        canUseTool: async (_tool, input) => {
          const inp = input as {
            questions: Array<{ question: string }>
          } & Record<string, unknown>
          return {
            behavior: 'allow',
            updatedInput: {
              ...inp,
              answers: {
                [inp.questions[0]!.question]: 'Not now',
              },
            },
          }
        },
        toolContext: abort =>
          ({
            abortController: abort,
            getAppState: () => ({
              toolPermissionContext: { mode: 'default' },
            }),
          }) as never,
        sendDisplayRows: rows => rowsSent.push(rows),
        surface: 'terminal',
      })
      const res = await askPluginDevMods('/tmp/mods')
      expect(res).toBe('decline')
      expect(rowsSent.length).toBe(1)
      expect(rowsSent[0]?.length).toBe(2)
      expect(
        uiLogs.some(l => l.plugin === 'Mods' && l.text.includes('Not now')),
      ).toBe(true)
    } finally {
      unsub()
      setIsInteractive(prevInteractive)
    }
  })

  test('#1627: validateManifest unknown filename matches marketplace.json heuristic with BOM and marketplace-only keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'validate-unknown-'))
    try {
      const file = join(dir, 'custom-manifest.json')
      writeFileSync(
        file,
        '\uFEFF' +
          JSON.stringify({
            name: 'my-mkt',
            owner: { name: 'Team' },
            plugins: [],
          }),
        'utf8',
      )
      const res = await validateManifest(file)
      expect(res.fileType).toBe('marketplace')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#1547: synced skills memory retention, 10m cooldown, and skill_gone hook pruning', () => {
    retainInMemorySyncedSkill('sk_1', {
      type: 'prompt',
      name: 'cloud-skill',
      description: 'desc',
      loadedFrom: 'syncedSkills',
    } as never)
    expect(getInMemorySyncedSkills().map(s => s.name)).toEqual(['cloud-skill'])

    const t0 = 1_000_000
    recordFailedSyncedSkillLanding('sk_1', 'v1', t0)
    expect(shouldSkipSyncedSkillDownload('sk_1', 'v1', t0 + 1000)).toBe(true)
    expect(
      shouldSkipSyncedSkillDownload(
        'sk_1',
        'v1',
        t0 + SYNCED_SKILL_DOWNLOAD_COOLDOWN_MS,
      ),
    ).toBe(false)
    expect(shouldSkipSyncedSkillDownload('sk_1', 'v2', t0 + 1000)).toBe(false)

    const removed = pruneRemovedSyncedSkillHooks(
      new Set(['/tmp/synced/sk_1']),
      'skill_gone',
      roots => roots.size,
    )
    expect(removed).toBe(1)
  })

  test('#1648: claudeCodeBackend skips re-running already-completed agent on recovery', async () => {
    const okResult = {
      kind: 'ok' as const,
      output: 'done-once',
      usage: { outputTokens: 10 },
      model: 'claude-sonnet-4-6',
      toolCount: 1,
      tokenCount: 100,
    }
    recordCompletedWorkflowAgentResult('run-1', 0, okResult)
    markWorkflowUsageLimitRecovery('run-1')
    expect(getCompletedWorkflowAgentResult('run-1', 0)).toEqual(okResult)

    const host = {
      // Minimal stub; should return before reading host bundle
      __brand: 'stub',
    }
    const res = await claudeCodeBackend.run(
      { prompt: 'hi' } as never,
      { runId: 'run-1', agentId: 0, host } as never,
    )
    expect(res).toEqual(okResult)

    clearCompletedWorkflowAgentResults('run-1')
    expect(getCompletedWorkflowAgentResult('run-1', 0)).toBeUndefined()
  })
})
