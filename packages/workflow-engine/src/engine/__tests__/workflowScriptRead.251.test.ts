import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  readAllowedWorkflowScript,
  workflowScriptPathIsReadable,
  workflowScriptPathPermissionAllows,
  workflowScriptReadableSetAllows,
  workflowScriptReadRefusal,
  workflowScriptToolsReadableSet,
  workflowToolsAreDenyOnly,
  workflowToolsFromToolUseContext,
} from '../workflowScriptRead.js'

describe('densable 2.1.251 #9 workflow scriptPath', () => {
  test('refuses a path outside cwd before opening it', async () => {
    const cwd = join(tmpdir(), `wf-read-${Date.now()}`)
    mkdirSync(cwd, { recursive: true })
    const outside = join(tmpdir(), `wf-outside-${Date.now()}.js`)
    writeFileSync(outside, 'export const meta = { name: "x" }\n')
    expect(workflowScriptPathIsReadable(outside, cwd)).toBe(false)
    await expect(readAllowedWorkflowScript(outside, cwd)).rejects.toThrow(
      workflowScriptReadRefusal(outside),
    )
  })

  test('reads a file inside an added directory', async () => {
    const cwd = join(tmpdir(), `wf-cwd-${Date.now()}`)
    const extra = join(tmpdir(), `wf-extra-${Date.now()}`)
    mkdirSync(cwd, { recursive: true })
    mkdirSync(extra, { recursive: true })
    const file = join(extra, 'step.js')
    writeFileSync(file, 'export const meta = { name: "step" }\n')
    const read = await readAllowedWorkflowScript(file, cwd, [extra])
    expect(read.script).toContain('name: "step"')
  })

  test('Oo: nonempty tools without Read/Write is not a readable set', async () => {
    const cwd = join(tmpdir(), `wf-oo-${Date.now()}`)
    mkdirSync(cwd, { recursive: true })
    const file = join(cwd, 'in.js')
    writeFileSync(file, 'export const meta = { name: "in" }\n')
    const denyOnly = { tools: [{ name: 'Bash' }] }
    expect(workflowScriptPathIsReadable(file, cwd, [], denyOnly)).toBe(false)
    await expect(
      readAllowedWorkflowScript(file, cwd, [], denyOnly),
    ).rejects.toThrow(workflowScriptReadRefusal(file))
  })

  test('Oo: Read or Write on the tools list may proceed to Ryr', () => {
    const cwd = join(tmpdir(), `wf-rw-${Date.now()}`)
    const file = join(cwd, 'in.js')
    expect(
      workflowScriptPathIsReadable(file, cwd, [], {
        tools: [{ name: 'Read' }],
      }),
    ).toBe(true)
    expect(
      workflowScriptPathIsReadable(file, cwd, [], {
        tools: [{ name: 'Write' }],
      }),
    ).toBe(true)
    expect(
      workflowScriptPathIsReadable(file, cwd, [], {
        tools: [{ name: 'FileReadTool', aliases: ['Read'] }],
      }),
    ).toBe(true)
  })

  test('zl: probe present without Read/Write is deny-only', () => {
    expect(workflowToolsAreDenyOnly('Workflow', [{ name: 'Workflow' }])).toBe(
      true,
    )
    expect(
      workflowToolsAreDenyOnly('Workflow', [
        { name: 'Workflow' },
        { name: 'Read' },
      ]),
    ).toBe(false)
    expect(workflowToolsAreDenyOnly('Read', [{ name: 'Read' }])).toBe(false)
  })

  test('iJ: zl blocks even when the path is under cwd', () => {
    const cwd = join(tmpdir(), `wf-ij-${Date.now()}`)
    const file = resolve(cwd, 'in.js')
    expect(
      workflowScriptReadableSetAllows('Workflow', file, cwd, [], {
        tools: [{ name: 'Workflow' }],
      }),
    ).toBe(false)
    expect(
      workflowScriptReadableSetAllows('Workflow', file, cwd, [], {
        tools: [{ name: 'Workflow' }, { name: 'Write' }],
      }),
    ).toBe(true)
  })

  test('Ryr: ys/Wg non-null deny; ow allow/ask/bypass', () => {
    const cwd = join(tmpdir(), `wf-ryr-${Date.now()}`)
    const file = resolve(cwd, 'in.js')
    expect(
      workflowScriptPathPermissionAllows(file, cwd, [], {
        readToolDenyRule: { ruleBehavior: 'deny' },
      }),
    ).toBe(false)
    expect(
      workflowScriptPathPermissionAllows(file, cwd, [], {
        readToolAskRule: { ruleBehavior: 'ask' },
      }),
    ).toBe(false)
    expect(
      workflowScriptPathPermissionAllows(file, cwd, [], {
        pathDecision: { behavior: 'allow' },
      }),
    ).toBe(true)
    expect(
      workflowScriptPathPermissionAllows(file, cwd, [], {
        pathDecision: { behavior: 'deny' },
      }),
    ).toBe(false)
    expect(
      workflowScriptPathPermissionAllows(file, cwd, [], {
        pathDecision: { behavior: 'ask' },
      }),
    ).toBe(false)
    expect(
      workflowScriptPathPermissionAllows(file, cwd, [], {
        pathDecision: { behavior: 'ask' },
        permissionMode: 'bypassPermissions',
      }),
    ).toBe(true)
    expect(
      workflowScriptPathPermissionAllows(file, cwd, [], {
        pathDecision: {
          behavior: 'ask',
          decisionReason: {
            type: 'rule',
            rule: { ruleBehavior: 'ask' },
          },
        },
        permissionMode: 'bypassPermissions',
      }),
    ).toBe(false)
  })

  test('Oo first check is not rescued by an in-cwd pathDecision allow', () => {
    const cwd = join(tmpdir(), `wf-norecue-${Date.now()}`)
    const file = resolve(cwd, 'in.js')
    expect(
      workflowScriptToolsReadableSet(file, cwd, [], {
        tools: [{ name: 'Bash' }],
        pathDecision: { behavior: 'allow' },
      }),
    ).toBe(false)
  })

  test('workflowToolsFromToolUseContext reads i.options.tools', () => {
    expect(workflowToolsFromToolUseContext(undefined)).toEqual([])
    expect(
      workflowToolsFromToolUseContext({
        options: { tools: [{ name: 'Read' }, { name: 'Bash' }] },
      }),
    ).toEqual([{ name: 'Read' }, { name: 'Bash' }])
  })

  test('qhn: UNC / NT-namespace paths are not readable', () => {
    const cwd = join(tmpdir(), `wf-unc-${Date.now()}`)
    expect(workflowScriptPathIsReadable('\\\\server\\share\\x.js', cwd)).toBe(
      false,
    )
    expect(workflowScriptPathIsReadable('/??/C:/Windows/x.js', cwd)).toBe(false)
  })
})
