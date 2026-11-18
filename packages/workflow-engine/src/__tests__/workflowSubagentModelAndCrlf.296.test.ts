import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveWorkflowSubagentModel } from '../engine/hooks.js'
import { extractMeta } from '../engine/script.js'
import {
  normalizeWorkflowScriptLineEndings,
  readAllowedWorkflowScript,
} from '../engine/workflowScriptRead.js'

const SAVED_ENV = { ...process.env }

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in SAVED_ENV)) delete process.env[key]
  }
  Object.assign(process.env, SAVED_ENV)
})

describe('v2.1.296 #488 CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL', () => {
  test('resolveWorkflowSubagentModel honors model, ignores unset/inherit', () => {
    expect(resolveWorkflowSubagentModel({})).toBeUndefined()
    expect(
      resolveWorkflowSubagentModel({
        CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: 'inherit',
      }),
    ).toBeUndefined()
    expect(
      resolveWorkflowSubagentModel({
        CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: 'INHERIT',
      }),
    ).toBeUndefined()
    expect(
      resolveWorkflowSubagentModel({
        CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: '  claude-haiku-5-5  ',
      }),
    ).toBe('claude-haiku-5-5')
  })
})

describe('v2.1.296 #528 CRLF workflow script normalization', () => {
  test('normalizeWorkflowScriptLineEndings and extractMeta handle CRLF scripts', () => {
    const crlf =
      'export const meta = { name: "crlf-wf", description: "desc" };\r\nreturn "ok";\r\n'
    expect(normalizeWorkflowScriptLineEndings(crlf)).toBe(
      'export const meta = { name: "crlf-wf", description: "desc" };\nreturn "ok";\n',
    )
    const { meta, body } = extractMeta(crlf)
    expect(meta).toEqual({ name: 'crlf-wf', description: 'desc' })
    expect(body).toBe('\nreturn "ok";\n')
  })

  test('readAllowedWorkflowScript normalizes CRLF to LF on disk read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-528-crlf-'))
    try {
      const file = join(dir, 'test.ts')
      writeFileSync(
        file,
        'export const meta = { name: "disk", description: "crlf" }\r\nreturn 1\r\n',
      )
      const res = await readAllowedWorkflowScript(file, dir)
      expect(res.script).not.toContain('\r\n')
      expect(res.script).toBe(
        'export const meta = { name: "disk", description: "crlf" }\nreturn 1\n',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
