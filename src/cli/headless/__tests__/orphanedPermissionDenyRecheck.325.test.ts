import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { SDKControlResponse } from 'src/entrypoints/sdk/controlTypes.js'
import type { MCPServerConnection } from 'src/services/mcp/types.js'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolPermissionContext,
} from 'src/Tool.js'
import { getCwd } from 'src/utils/cwd.js'
import {
  handleOrphanedPermissionResponse,
  recheckOrphanedPermissionAgainstDenyRules,
} from '../HeadlessControlPlane.js'

function makeContext(denyRules: string[]): ToolPermissionContext {
  return {
    ...getEmptyToolPermissionContext(),
    alwaysDenyRules: {
      userSettings: denyRules,
    },
  }
}

function makeAssistantMessage(
  toolUseID: string,
  name: string,
  input: Record<string, unknown>,
) {
  return {
    message: {
      id: 'msg-1',
      content: [
        {
          type: 'tool_use',
          id: toolUseID,
          name,
          input,
        },
      ],
    },
  }
}

describe('#2323 recheckOrphanedPermissionAgainstDenyRules uses real permission engine', () => {
  test('denies path/glob Read, Edit, Write, NotebookEdit, Glob, and Grep rules', () => {
    const cwd = getCwd()
    const envPath = join(cwd, 'nested', '.env')
    const notebookPath = join(cwd, 'nested', 'secret.ipynb')
    const secretsDir = join(cwd, 'secrets')
    const safePath = join(cwd, 'src', 'index.ts')

    const readCtx = makeContext(['Read(**/.env)', 'Read(secrets/**)'])
    const readRes = recheckOrphanedPermissionAgainstDenyRules(
      {
        behavior: 'allow',
        updatedInput: { file_path: envPath },
        toolUseID: 'tu-1',
      },
      makeAssistantMessage('tu-1', 'Read', { file_path: envPath }),
      readCtx,
    )
    expect(readRes.behavior).toBe('deny')

    const safeReadRes = recheckOrphanedPermissionAgainstDenyRules(
      {
        behavior: 'allow',
        updatedInput: { file_path: safePath },
        toolUseID: 'tu-2',
      },
      makeAssistantMessage('tu-2', 'Read', { file_path: safePath }),
      readCtx,
    )
    expect(safeReadRes.behavior).toBe('allow')

    const globRes = recheckOrphanedPermissionAgainstDenyRules(
      {
        behavior: 'allow',
        updatedInput: { path: join(secretsDir, 'keys.json'), pattern: '*' },
        toolUseID: 'tu-3',
      },
      makeAssistantMessage('tu-3', 'Glob', {
        path: join(secretsDir, 'keys.json'),
        pattern: '*',
      }),
      readCtx,
    )
    expect(globRes.behavior).toBe('deny')

    const grepRes = recheckOrphanedPermissionAgainstDenyRules(
      {
        behavior: 'allow',
        updatedInput: { path: join(secretsDir, 'app.env'), pattern: 'SECRET' },
        toolUseID: 'tu-4',
      },
      makeAssistantMessage('tu-4', 'Grep', {
        path: join(secretsDir, 'app.env'),
        pattern: 'SECRET',
      }),
      readCtx,
    )
    expect(grepRes.behavior).toBe('deny')

    const editCtx = makeContext(['Edit(**/.env)', 'Edit(**/*.ipynb)'])
    for (const toolName of ['Edit', 'Write'] as const) {
      const res = recheckOrphanedPermissionAgainstDenyRules(
        {
          behavior: 'allow',
          updatedInput: { file_path: envPath },
          toolUseID: 'tu-5',
        },
        makeAssistantMessage('tu-5', toolName, { file_path: envPath }),
        editCtx,
      )
      expect(res.behavior).toBe('deny')
    }

    const nbRes = recheckOrphanedPermissionAgainstDenyRules(
      {
        behavior: 'allow',
        updatedInput: { notebook_path: notebookPath },
        toolUseID: 'tu-6',
      },
      makeAssistantMessage('tu-6', 'NotebookEdit', {
        notebook_path: notebookPath,
      }),
      editCtx,
    )
    expect(nbRes.behavior).toBe('deny')

    // Rewritten updatedInput pointing to a denied file is also caught
    const rewrittenRes = recheckOrphanedPermissionAgainstDenyRules(
      {
        behavior: 'allow',
        updatedInput: { file_path: envPath },
        toolUseID: 'tu-7',
      },
      makeAssistantMessage('tu-7', 'Read', { file_path: safePath }),
      readCtx,
    )
    expect(rewrittenRes.behavior).toBe('deny')
  })

  test('denies compound Bash commands, sh -c scripts, and PowerShell compound commands', () => {
    const bashCtx = makeContext(['Bash(rm -rf:*)'])

    const compoundRes = recheckOrphanedPermissionAgainstDenyRules(
      {
        behavior: 'allow',
        updatedInput: { command: 'echo ok && rm -rf /' },
        toolUseID: 'tu-b1',
      },
      makeAssistantMessage('tu-b1', 'Bash', { command: 'echo ok && rm -rf /' }),
      bashCtx,
    )
    expect(compoundRes.behavior).toBe('deny')

    const dashCRes = recheckOrphanedPermissionAgainstDenyRules(
      {
        behavior: 'allow',
        updatedInput: { command: 'sh -c "echo ok && rm -rf /tmp/foo"' },
        toolUseID: 'tu-b2',
      },
      makeAssistantMessage('tu-b2', 'Bash', {
        command: 'sh -c "echo ok && rm -rf /tmp/foo"',
      }),
      bashCtx,
    )
    expect(dashCRes.behavior).toBe('deny')

    const safeBashRes = recheckOrphanedPermissionAgainstDenyRules(
      {
        behavior: 'allow',
        updatedInput: { command: 'echo ok' },
        toolUseID: 'tu-b3',
      },
      makeAssistantMessage('tu-b3', 'Bash', { command: 'echo ok' }),
      bashCtx,
    )
    expect(safeBashRes.behavior).toBe('allow')

    const psCtx = makeContext(['PowerShell(Remove-Item:*)'])
    const psCompoundRes = recheckOrphanedPermissionAgainstDenyRules(
      {
        behavior: 'allow',
        updatedInput: {
          command: 'Write-Host ok; Remove-Item -Recurse -Force C:\\secret',
        },
        toolUseID: 'tu-ps1',
      },
      makeAssistantMessage('tu-ps1', 'PowerShell', {
        command: 'Write-Host ok; Remove-Item -Recurse -Force C:\\secret',
      }),
      psCtx,
    )
    expect(psCompoundRes.behavior).toBe('deny')
  })

  test('denies WebFetch domain rules', () => {
    const ctx = makeContext(['WebFetch(domain:evil.com)'])

    const denied = recheckOrphanedPermissionAgainstDenyRules(
      {
        behavior: 'allow',
        updatedInput: { url: 'https://evil.com/data?a=1', prompt: 'read' },
        toolUseID: 'tu-wf1',
      },
      makeAssistantMessage('tu-wf1', 'WebFetch', {
        url: 'https://evil.com/data?a=1',
        prompt: 'read',
      }),
      ctx,
    )
    expect(denied.behavior).toBe('deny')

    const deniedUpper = recheckOrphanedPermissionAgainstDenyRules(
      {
        behavior: 'allow',
        updatedInput: { url: 'https://EVIL.COM/secret', prompt: 'read' },
        toolUseID: 'tu-wf2',
      },
      makeAssistantMessage('tu-wf2', 'WebFetch', {
        url: 'https://EVIL.COM/secret',
        prompt: 'read',
      }),
      ctx,
    )
    expect(deniedUpper.behavior).toBe('deny')

    const allowed = recheckOrphanedPermissionAgainstDenyRules(
      {
        behavior: 'allow',
        updatedInput: { url: 'https://good.com/docs', prompt: 'read' },
        toolUseID: 'tu-wf3',
      },
      makeAssistantMessage('tu-wf3', 'WebFetch', {
        url: 'https://good.com/docs',
        prompt: 'read',
      }),
      ctx,
    )
    expect(allowed.behavior).toBe('allow')
  })

  test('denies MCP plugin case-insensitive glob, Artifact stand-in, connector alias, and Agent rules', () => {
    // Case-insensitive mcp__plugin_*_ rule (#2322)
    const pluginCtx = makeContext(['mcp__plugin_*_bar__*'])
    const pluginRes = recheckOrphanedPermissionAgainstDenyRules(
      { behavior: 'allow', updatedInput: {}, toolUseID: 'tu-m1' },
      makeAssistantMessage('tu-m1', 'mcp__plugin_Foo_BAR__run', {}),
      pluginCtx,
    )
    expect(pluginRes.behavior).toBe('deny')

    // Artifact stand-in MCP tool (#2313)
    const artifactCtx = makeContext(['Artifact'])
    const standinTool = {
      name: 'mcp__custom_ui__render',
      mcpInfo: {
        serverName: 'custom_ui',
        toolName: 'render',
        standsInForBuiltIn: true,
      },
    } as unknown as Tool
    const artifactRes = recheckOrphanedPermissionAgainstDenyRules(
      { behavior: 'allow', updatedInput: {}, toolUseID: 'tu-m2' },
      makeAssistantMessage('tu-m2', 'mcp__custom_ui__render', {}),
      artifactCtx,
      { tools: [standinTool] },
    )
    expect(artifactRes.behavior).toBe('deny')

    const artifactNamedRes = recheckOrphanedPermissionAgainstDenyRules(
      { behavior: 'allow', updatedInput: {}, toolUseID: 'tu-m3' },
      makeAssistantMessage('tu-m3', 'mcp__artifacts__create_artifact', {}),
      artifactCtx,
    )
    expect(artifactNamedRes.behavior).toBe('deny')

    // Connector alias deny rule (#1779)
    const connectorClients = [
      {
        type: 'connected',
        name: 'claude.ai Slack',
        config: {
          type: 'claudeai-proxy',
          id: 'slack-conn',
          url: 'https://example.com',
        },
      },
    ] as unknown as MCPServerConnection[]
    const connectorCtx = makeContext(['mcp__claude_ai_Slack'])
    const connectorRes = recheckOrphanedPermissionAgainstDenyRules(
      { behavior: 'allow', updatedInput: {}, toolUseID: 'tu-m4' },
      makeAssistantMessage('tu-m4', 'mcp__claude_ai_Slack__post_message', {}),
      connectorCtx,
      { mcpClients: connectorClients },
    )
    expect(connectorRes.behavior).toBe('deny')

    // Agent(Explore) deny rule
    const agentCtx = makeContext(['Agent(Explore)'])
    const agentRes = recheckOrphanedPermissionAgainstDenyRules(
      {
        behavior: 'allow',
        updatedInput: { subagent_type: 'Explore', prompt: 'search' },
        toolUseID: 'tu-a1',
      },
      makeAssistantMessage('tu-a1', 'Agent', {
        subagent_type: 'Explore',
        prompt: 'search',
      }),
      agentCtx,
    )
    expect(agentRes.behavior).toBe('deny')
  })

  test('handleOrphanedPermissionResponse overrides delayed allow when current deny rules match', async () => {
    const enqueued: unknown[] = []
    const handled = await handleOrphanedPermissionResponse({
      message: {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'req-1',
          response: {
            behavior: 'allow',
            updatedInput: { command: 'echo ok && rm -rf /' },
            toolUseID: 'tu-orphan-1',
          },
        },
      } as unknown as SDKControlResponse,
      setAppState: () => {},
      getAppState: () =>
        ({
          toolPermissionContext: makeContext(['Bash(rm -rf:*)']),
          mcp: { clients: [], tools: [] },
        }) as never,
      handledToolUseIds: new Set(),
      findUnresolvedToolUseFn: async () =>
        makeAssistantMessage('tu-orphan-1', 'Bash', {
          command: 'echo ok && rm -rf /',
        }) as never,
      enqueueFn: item => {
        enqueued.push(item)
      },
    })

    expect(handled).toBe(true)
    expect(enqueued).toHaveLength(1)
    const entry = enqueued[0] as {
      orphanedPermission: { permissionResult: { behavior: string } }
    }
    expect(entry.orphanedPermission.permissionResult.behavior).toBe('deny')
  })
})
