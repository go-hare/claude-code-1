import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildSkillFile, parseFrontmatter } from '../../frontmatterParser.js'
import {
  addSkillDirectories,
  clearDynamicSkills,
  getDynamicSkills,
} from '../../../skills/loadSkillsDir.js'
import { loadMemoryStoreSkillCommands } from '../../memoryStoreSkills.js'
import { getSkillPromptBlocks } from '../../skills/skillPromptHook.js'
import {
  createQueueRecordWriter,
  QUEUE_RECORD_HOOK_TIMEOUT_MS,
  setQueueRecordHookRunner,
  setQueueSessionReadyPromise,
} from '../../messageQueueManager.js'
import {
  applyPendingUiInvalidations,
  evaluateUiRender,
  getPendingUiInvalidations,
  getSurfaceUiRenderCaps,
  runUiHost,
  setLoadedFunctionHooksModules,
} from '../functionHooksModules.js'
import { flushToolUiInvalidations } from '../../../Tool.js'
import { getSystemPrompt } from '../../../constants/prompts.js'
import { clearSystemPromptSections } from '../../../constants/systemPromptSections.js'
import { getSystemPromptSectionCache } from '../../../bootstrap/state.js'

describe('Deep call-chain alignment (#572, #579, #618, #885)', () => {
  describe('#572 loadSkillsDir -> command.skillFile -> skillPromptHook', () => {
    test('parseFrontmatter returns frontmatterAsWritten and asWrittenProblem for non-table or invalid YAML', () => {
      const valid = parseFrontmatter(
        '---\ndescription: hello\n---\nbody',
        '/tmp/a/SKILL.md',
      )
      expect(valid.frontmatterAsWritten).toEqual({ description: 'hello' })
      expect(valid.asWrittenProblem).toBeUndefined()

      const listFm = parseFrontmatter('---\n- item1\n- item2\n---\nbody')
      expect(listFm.frontmatter).toEqual({})
      expect(listFm.frontmatterAsWritten).toEqual({})
      expect(listFm.asWrittenProblem).toBe(
        'is a list or a single value, not a table',
      )

      const invalidYaml = parseFrontmatter('---\n: :\n  - [\n---\nbody')
      expect(invalidYaml.frontmatterAsWritten).toEqual({})
      expect(invalidYaml.asWrittenProblem).toContain('did not parse as YAML')
    })

    test('buildSkillFile (Wme) attaches path only for absolute paths and preserves frontmatterProblem', () => {
      expect(buildSkillFile({ a: 1 }, '/abs/SKILL.md')).toEqual({
        frontmatterAsWritten: { a: 1 },
        path: '/abs/SKILL.md',
      })
      expect(buildSkillFile({ a: 1 }, '<inline:p:c>')).toEqual({
        frontmatterAsWritten: { a: 1 },
      })
      expect(buildSkillFile({}, '/abs/SKILL.md', 'is no table')).toEqual({
        frontmatterAsWritten: {},
        frontmatterProblem: 'is no table',
        path: '/abs/SKILL.md',
      })
    })

    test('loadSkillsDir populates command.skillFile consumed by getSkillPromptBlocks', async () => {
      const root = mkdtempSync(join(tmpdir(), 'skill-572-'))
      try {
        const skillDir = join(root, 'my-skill')
        mkdirSync(skillDir, { recursive: true })
        const skillPath = join(skillDir, 'SKILL.md')
        writeFileSync(
          skillPath,
          '---\ndescription: My 572 skill\nargument-hint: "[arg]"\n---\nSkill body\n',
        )

        clearDynamicSkills()
        await addSkillDirectories([root])
        const loaded = getDynamicSkills()
        expect(loaded.length).toBe(1)
        const cmd = loaded[0]!
        expect(cmd.type).toBe('prompt')
        if (cmd.type === 'prompt') {
          expect(cmd.skillFile).toEqual({
            frontmatterAsWritten: {
              description: 'My 572 skill',
              'argument-hint': '[arg]',
            },
            path: skillPath,
          })

          let capturedEvent: Record<string, unknown> | undefined
          const mod = {
            name: 'test-skill-prompt-572',
            patterns: ['skill.prompt'],
            hooks: [
              {
                pattern: 'skill.prompt',
                hook: async (_ctx: unknown, event: Record<string, unknown>) => {
                  capturedEvent = event
                  return { text: 'hooked' }
                },
              },
            ],
          }
          setLoadedFunctionHooksModules([mod as never])
          try {
            const blocks = await getSkillPromptBlocks(cmd, '', {
              options: {},
            } as never)
            expect(blocks).toEqual([{ type: 'text', text: 'hooked' }])
            expect(capturedEvent?.path).toBe(skillPath)
            expect(capturedEvent?.frontmatter).toEqual({
              description: 'My 572 skill',
              'argument-hint': '[arg]',
            })
          } finally {
            setLoadedFunctionHooksModules([])
          }
        }
      } finally {
        clearDynamicSkills()
        rmSync(root, { recursive: true, force: true })
      }
    })

    test('loadMemoryStoreSkillCommands populates skillFile', async () => {
      const root = mkdtempSync(join(tmpdir(), 'mem-skill-572-'))
      try {
        const skillDir = join(root, 'mem-one')
        mkdirSync(skillDir, { recursive: true })
        const skillPath = join(skillDir, 'SKILL.md')
        writeFileSync(
          skillPath,
          '---\ndescription: Memory skill\n---\nMemory body\n',
        )

        const { commands } = await loadMemoryStoreSkillCommands(root, () => {})
        expect(commands.length).toBe(1)
        const cmd = commands[0]!
        expect(cmd.type).toBe('prompt')
        if (cmd.type === 'prompt') {
          expect(cmd.skillFile).toEqual({
            frontmatterAsWritten: { description: 'Memory skill' },
            path: realpathSync(skillPath),
          })
        }
      } finally {
        clearDynamicSkills()
        rmSync(root, { recursive: true, force: true })
      }
    })
  })

  describe('#579 queue record writer (Qvo) -> session.append { door: "queue" }', () => {
    test('rewrites queue record content in FIFO order and falls back on 1s timeout', async () => {
      expect(QUEUE_RECORD_HOOK_TIMEOUT_MS).toBe(1000)
      const written: Array<{ operation: string; content?: string }> = []
      const writer = createQueueRecordWriter(
        op => {
          written.push({ operation: op.operation, content: op.content })
        },
        { timeoutMs: 40 },
      )

      setQueueRecordHookRunner(async content => {
        if (content === 'slow') {
          await new Promise(resolve => setTimeout(resolve, 120))
          return 'too-late'
        }
        return `[redacted] ${content}`
      })

      try {
        writer({
          type: 'queue-operation',
          operation: 'enqueue',
          timestamp: new Date().toISOString(),
          sessionId: 'sess-1',
          content: 'first',
        })
        writer({
          type: 'queue-operation',
          operation: 'enqueue',
          timestamp: new Date().toISOString(),
          sessionId: 'sess-1',
          content: 'slow',
        })
        writer({
          type: 'queue-operation',
          operation: 'dequeue',
          timestamp: new Date().toISOString(),
          sessionId: 'sess-1',
        })

        await new Promise(resolve => setTimeout(resolve, 100))
        expect(written).toEqual([
          { operation: 'enqueue', content: '[redacted] first' },
          { operation: 'enqueue', content: 'slow' },
          { operation: 'dequeue', content: undefined },
        ])
      } finally {
        setQueueRecordHookRunner(null)
        setQueueSessionReadyPromise(null)
      }
    })

    test('writes synchronously when no session.append { door: "queue" } hook is registered', () => {
      const written: string[] = []
      const writer = createQueueRecordWriter(op => {
        written.push(op.content ?? op.operation)
      })
      writer({
        type: 'queue-operation',
        operation: 'enqueue',
        timestamp: new Date().toISOString(),
        sessionId: 'sess-2',
        content: 'sync-msg',
      })
      expect(written).toEqual(['sync-msg'])
    })
  })

  describe('#618 applyPendingUiInvalidations wired into Tool, prompts, query', () => {
    test('getSystemPrompt flushes pending prompt.section invalidation', async () => {
      clearSystemPromptSections()
      applyPendingUiInvalidations()

      getSystemPromptSectionCache().set('test_618_section', 'v1')
      expect(getSystemPromptSectionCache().has('test_618_section')).toBe(true)

      await runUiHost('ui.invalidate', { event: 'prompt.section' })
      expect(getPendingUiInvalidations().has('prompt.section')).toBe(true)

      const prevSimple = process.env.CLAUDE_CODE_SIMPLE
      process.env.CLAUDE_CODE_SIMPLE = '1'
      try {
        // getSystemPrompt calls applyPendingUiInvalidations({ 'prompt.section': clearSystemPromptSections })
        await getSystemPrompt([], 'claude-sonnet-4-6')
        expect(getPendingUiInvalidations().has('prompt.section')).toBe(false)
        expect(getSystemPromptSectionCache().has('test_618_section')).toBe(
          false,
        )
      } finally {
        if (prevSimple === undefined) {
          delete process.env.CLAUDE_CODE_SIMPLE
        } else {
          process.env.CLAUDE_CODE_SIMPLE = prevSimple
        }
      }
    })

    test('flushToolUiInvalidations flushes pending tool.describe and tool.list invalidations', async () => {
      applyPendingUiInvalidations()
      await runUiHost('ui.invalidate', { event: 'tool.describe' })
      await runUiHost('ui.invalidate', { event: 'tool.list' })

      const flushedCalls: string[] = []
      const flushed = flushToolUiInvalidations({
        'tool.describe': () => flushedCalls.push('tool.describe'),
        'tool.list': () => flushedCalls.push('tool.list'),
      })
      expect(flushed).toEqual(['tool.describe', 'tool.list'])
      expect(flushedCalls).toEqual(['tool.describe', 'tool.list'])
      expect(getPendingUiInvalidations().size).toBe(0)
    })
  })

  describe('#885 ui.render 48/12 row cap (C8s / I0e)', () => {
    test('getSurfaceUiRenderCaps returns 48 for desktop/vscode/mobile and 12 otherwise', () => {
      expect(getSurfaceUiRenderCaps('desktop')).toEqual({
        rowsMax: 48,
        isMarkdownDrawn: true,
      })
      expect(getSurfaceUiRenderCaps('vscode')).toEqual({
        rowsMax: 48,
        isMarkdownDrawn: true,
      })
      expect(getSurfaceUiRenderCaps('mobile')).toEqual({
        rowsMax: 48,
        isMarkdownDrawn: true,
      })
      expect(getSurfaceUiRenderCaps('terminal')).toEqual({
        rowsMax: 12,
        isMarkdownDrawn: false,
      })
      expect(getSurfaceUiRenderCaps(undefined)).toEqual({
        rowsMax: 12,
        isMarkdownDrawn: false,
      })
    })

    test('evaluateUiRender refuses AskUserQuestion trees exceeding 12 rows on terminal and allows up to 48 on desktop', async () => {
      const makeRowsTree = (lineCount: number) => ({
        type: 'Box',
        children: [
          { type: 'engine', ref: { kind: 'ask-user-question' } },
          ...Array.from({ length: lineCount }, (_, i) => ({
            type: 'Text',
            children: [`row ${i}`],
          })),
        ],
      })

      const mod = {
        name: 'test-ui-render-rows-885',
        patterns: ['ui.render'],
        hooks: [
          {
            pattern: 'ui.render',
            hook: async (_ctx: unknown, event: { props?: { rows?: number } }) =>
              makeRowsTree(event.props?.rows ?? 1),
          },
        ],
      }
      setLoadedFunctionHooksModules([mod as never])
      try {
        // 13 rows > 12 on terminal -> refused
        await expect(
          evaluateUiRender({
            component: 'AskUserQuestion',
            requestId: 'req-term-over',
            surface: 'terminal',
            props: { rows: 13 },
          }),
        ).rejects.toThrow('more than 12 rows around the dialog')

        // 20 rows <= 48 on desktop -> accepted
        await expect(
          evaluateUiRender({
            component: 'AskUserQuestion',
            requestId: 'req-desk-ok',
            surface: 'desktop',
            props: { rows: 20 },
          }),
        ).resolves.toBeDefined()

        // 49 rows > 48 on desktop -> refused
        await expect(
          evaluateUiRender({
            component: 'AskUserQuestion',
            requestId: 'req-desk-over',
            surface: 'desktop',
            props: { rows: 49 },
          }),
        ).rejects.toThrow('more than 48 rows around the dialog')
      } finally {
        setLoadedFunctionHooksModules([])
      }
    })
  })
})
