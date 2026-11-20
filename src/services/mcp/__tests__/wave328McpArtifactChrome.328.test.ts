import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ARTIFACTS_SWITCHED_OFF_MESSAGE,
  ArtifactTool,
  coerceArtifactPublishInput,
} from '../../../../packages/builtin-tools/src/tools/ArtifactTool/ArtifactTool.js'
import { formatArtifactPublishVisibilityNote } from '../../../../packages/builtin-tools/src/tools/ArtifactTool/mapToolResultSentences.js'
import {
  checkNewArtifactOrgApprovalSurface,
  consumeApprovedPublishSourcePin,
  isNewArtifactApprovedByPerson,
  isOrgNewArtifactApprovalRequired,
  NEW_ARTIFACT_ORG_APPROVAL_ASK_FLAGS,
  publishSourcePinMatches,
  recordApprovedPublishSourcePin,
  resolveNewArtifactApprovalSurface,
  shouldSuppressArtifactPublishAlwaysAllow,
} from '../../../../packages/builtin-tools/src/tools/ArtifactTool/permissions.js'
import { appendCoerceResultNoteToToolResultBlock } from '../../tools/toolExecution.js'
import { getCwdState, setCwdState } from '../../../bootstrap/state.js'
import {
  isInsideClaudeCodeSession,
  MCP_ADD_JSON_STDIN_MAX_BYTES,
  readMcpAddJsonFromStdin,
  readStdinCapped,
} from '../../../cli/handlers/mcp.js'
import {
  chromeFileUploadCredentialDeniedMessage,
  isCredentialFileForChromeUpload,
} from '../../../utils/claudeInChrome/fileUpload.js'
import { normalizePublishedPath } from '../../artifactAutoReact/outDirPaths.js'
import { uploadIdentityMatches } from '../../artifactAutoReact/readPerm/uploadReadGate.js'
import {
  addMcpConfig,
  hasTopLevelServersWithoutMcpServersKey,
  isDeniedByClaudeAiConnectorDisplayName,
  readRawProjectMcpJson,
  removeMcpConfig,
} from '../config.js'
import {
  formatElicitationRequestForLog,
  formatElicitationResponseForLog,
} from '../elicitationHandler.js'
import {
  isMcpHostnameAllowlisted,
  shouldDropInvalidMcpToolSchemas,
  shouldNormalizeMcpRootCombinators,
  shouldUseOffFlagFallbackDefaults,
} from '../mcpToolSchema.js'
import {
  computeSlowReconnectDelayMs,
  isEligibleForSlowBackgroundReconnect,
  isRemoteHttpsHostnameUrl,
  SLOW_RECONNECT_BASE_MS,
  SLOW_RECONNECT_CAP_MS,
  SLOW_RECONNECT_MAX_ATTEMPTS,
} from '../useManageMCPConnections.js'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function bytesStream(text: string | Uint8Array): ReadableStream<Uint8Array> {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 327-328 Group 3 — MCP (8 items)', () => {
  test('#369: claude mcp add-json <name> - reads JSON from stdin, caps at 1 MiB, refuses inside Claude Code session', async () => {
    expect(MCP_ADD_JSON_STDIN_MAX_BYTES).toBe(1048576)
    expect(isInsideClaudeCodeSession({ CLAUDECODE: '1' })).toBe(true)
    expect(isInsideClaudeCodeSession({ CLAUDE_CODE_CHILD_SESSION: '1' })).toBe(
      true,
    )
    expect(isInsideClaudeCodeSession({})).toBe(false)

    // Refuses inside Claude Code session
    await expect(
      readMcpAddJsonFromStdin({
        env: { CLAUDECODE: '1' },
        isTTY: false,
        stream: bytesStream('{"type":"stdio","command":"x"}'),
      }),
    ).rejects.toThrow(/Claude Code session/i)

    // Refuses TTY
    await expect(
      readMcpAddJsonFromStdin({
        env: {},
        isTTY: true,
        stream: bytesStream('{}'),
      }),
    ).rejects.toThrow(/pipe|stdin/i)

    // Refuses empty input
    await expect(
      readMcpAddJsonFromStdin({
        env: {},
        isTTY: false,
        stream: bytesStream('   \n'),
      }),
    ).rejects.toThrow(/no JSON on stdin/i)

    // Reads valid JSON from stdin
    const payload = '{"type":"http","url":"https://api.example.com/mcp"}'
    const read = await readMcpAddJsonFromStdin({
      env: {},
      isTTY: false,
      stream: bytesStream(payload),
    })
    expect(read).toBe(payload)

    // Enforces 1 MiB cap (returns null when exceeding maxBytes)
    const oversized = new Uint8Array(1024 + 10).fill(65)
    expect(await readStdinCapped(1024, bytesStream(oversized))).toBeNull()
  })

  test('#378 & #499: project .mcp.json preserves sibling top-level keys on add/remove and refuses top-level servers without mcpServers key', async () => {
    const dir = makeTempDir('mcp-proj-keys-')
    const mcpJsonPath = join(dir, '.mcp.json')
    writeFileSync(
      mcpJsonPath,
      JSON.stringify(
        {
          $schema: 'https://example.com/mcp.schema.json',
          servers: { otherTool: { command: 'node' } },
          mcpServers: {
            existing: { type: 'stdio', command: 'echo', args: ['hi'] },
          },
        },
        null,
        2,
      ),
    )

    const raw = await readRawProjectMcpJson(dir)
    expect(raw.mcpJson.$schema).toBe('https://example.com/mcp.schema.json')
    expect(hasTopLevelServersWithoutMcpServersKey(raw.mcpJson)).toBe(false)

    // addMcpConfig / removeMcpConfig in project scope preserve $schema & servers
    const prevCwdState = getCwdState()
    setCwdState(dir)
    try {
      await addMcpConfig(
        'added-srv',
        { type: 'stdio', command: 'node', args: ['srv.js'] },
        'project',
      )
      const afterAdd = JSON.parse(readFileSync(mcpJsonPath, 'utf8'))
      expect(afterAdd.$schema).toBe('https://example.com/mcp.schema.json')
      expect(afterAdd.servers).toEqual({ otherTool: { command: 'node' } })
      expect(afterAdd.mcpServers['added-srv']).toBeDefined()
      expect(afterAdd.mcpServers.existing).toBeDefined()

      // removeMcpConfig preserves sibling keys too
      await removeMcpConfig('added-srv', 'project')
      const afterRemove = JSON.parse(readFileSync(mcpJsonPath, 'utf8'))
      expect(afterRemove.$schema).toBe('https://example.com/mcp.schema.json')
      expect(afterRemove.servers).toEqual({ otherTool: { command: 'node' } })
      expect(afterRemove.mcpServers['added-srv']).toBeUndefined()
      expect(afterRemove.mcpServers.existing).toBeDefined()

      // #499: top-level servers with NO mcpServers key is refused instead of overwritten
      const topLevelOnly = {
        myTopLevelServer: { command: 'node', args: ['a.js'] },
      }
      writeFileSync(mcpJsonPath, JSON.stringify(topLevelOnly, null, 2))
      expect(hasTopLevelServersWithoutMcpServersKey(topLevelOnly)).toBe(true)
      await expect(
        addMcpConfig(
          'new-srv',
          { type: 'stdio', command: 'echo', args: ['1'] },
          'project',
        ),
      ).rejects.toThrow(/mcpServers/)
      // Verify file was NOT overwritten
      expect(JSON.parse(readFileSync(mcpJsonPath, 'utf8'))).toEqual(
        topLevelOnly,
      )
    } finally {
      setCwdState(prevCwdState)
    }
  })

  test('#412: slow background reconnect policy retries remote https hostname servers for ~1 day', () => {
    expect(SLOW_RECONNECT_MAX_ATTEMPTS).toBe(69)
    expect(SLOW_RECONNECT_BASE_MS).toBe(15_000)
    expect(SLOW_RECONNECT_CAP_MS).toBe(900_000)

    // Delay starts at 15s (attempt 1) and caps at 15m (with zero jitter)
    expect(computeSlowReconnectDelayMs(1, () => 0)).toBe(15_000)
    expect(computeSlowReconnectDelayMs(2, () => 0)).toBe(30_000)
    expect(computeSlowReconnectDelayMs(10, () => 0)).toBe(900_000)
    // Proportional jitter doubles upper bound
    expect(computeSlowReconnectDelayMs(1, () => 1)).toBe(30_000)

    // Remote HTTPS hostname eligible; localhost / IP / plain HTTP ineligible
    expect(isRemoteHttpsHostnameUrl('https://mcp.example.com/v1')).toBe(true)
    expect(isRemoteHttpsHostnameUrl('http://mcp.example.com/v1')).toBe(false)
    expect(isRemoteHttpsHostnameUrl('https://localhost:8443/mcp')).toBe(false)
    expect(isRemoteHttpsHostnameUrl('https://127.0.0.1/mcp')).toBe(false)
    expect(isRemoteHttpsHostnameUrl('https://10.0.0.5/mcp')).toBe(false)
    expect(isRemoteHttpsHostnameUrl('https://[::1]/mcp')).toBe(false)

    expect(
      isEligibleForSlowBackgroundReconnect({
        type: 'http',
        url: 'https://mcp.remote.example.com/sse',
      } as never),
    ).toBe(true)
    expect(
      isEligibleForSlowBackgroundReconnect({
        type: 'stdio',
        command: 'node',
      } as never),
    ).toBe(false)
  })

  test('#519: MCP elicitation logs record mode, action, and field names only (not secret values)', () => {
    const reqLog = formatElicitationRequestForLog({
      mode: 'form',
      message: 'SECRET_PROMPT_DO_NOT_LOG',
      requestedSchema: {
        type: 'object',
        properties: {
          api_token: { type: 'string' },
          region: { type: 'string' },
        },
      },
    })
    expect(reqLog).toContain('form')
    expect(reqLog).toContain('api_token')
    expect(reqLog).toContain('region')
    expect(reqLog).not.toContain('SECRET_PROMPT_DO_NOT_LOG')

    const respLog = formatElicitationResponseForLog('form', {
      action: 'accept',
      content: {
        api_token: 'sk-super-secret-value-9999',
        region: 'us-east-1',
      },
    })
    expect(respLog).toContain('accept')
    expect(respLog).toContain('api_token')
    expect(respLog).not.toContain('sk-super-secret-value-9999')
    expect(respLog).not.toContain('us-east-1')
  })

  test('#568 & #569: MCP root combinator normalization and invalid tool schema dropping default ON for 3P / flags-off', () => {
    const prevBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
    const prevDisableTel = process.env.DISABLE_TELEMETRY
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.DISABLE_TELEMETRY = '1'
    try {
      expect(shouldUseOffFlagFallbackDefaults()).toBe(true)
      const httpCfg = {
        type: 'http',
        url: 'https://any-server.example.com/mcp',
      }
      expect(
        isMcpHostnameAllowlisted(
          'tengu_mcp_normalize_root_combinators',
          httpCfg,
          ['*'],
        ),
      ).toBe(true)
      expect(shouldNormalizeMcpRootCombinators(httpCfg)).toBe(true)
      expect(shouldDropInvalidMcpToolSchemas(httpCfg)).toBe(true)
    } finally {
      if (prevBedrock === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK
      else process.env.CLAUDE_CODE_USE_BEDROCK = prevBedrock
      if (prevDisableTel === undefined) delete process.env.DISABLE_TELEMETRY
      else process.env.DISABLE_TELEMETRY = prevDisableTel
    }
  })

  test('#666: deniedMcpServers entries of form "claude.ai <displayName>" deny dynamic cloud/runner connectors', () => {
    const connector = {
      type: 'http' as const,
      url: 'https://connectors.claude.ai/slack',
      scope: 'dynamic' as const,
      displayName: 'Slack',
    }
    expect(
      isDeniedByClaudeAiConnectorDisplayName(connector, [
        { serverName: 'claude.ai Slack' },
      ]),
    ).toBe(true)
    expect(
      isDeniedByClaudeAiConnectorDisplayName(connector, [
        { serverName: 'claude.ai Linear' },
      ]),
    ).toBe(false)
    // Non-dynamic scope does not match connector displayName denylist
    expect(
      isDeniedByClaudeAiConnectorDisplayName(
        { ...connector, scope: 'user' as const },
        [{ serverName: 'claude.ai Slack' }],
      ),
    ).toBe(false)
  })
})

describe('Wave 327-328 Group 3 — Claude in Chrome (1 item)', () => {
  test('#513: Claude in Chrome refuses credential files while allowing normal & .example files', () => {
    expect(isCredentialFileForChromeUpload('/Users/dev/project/.env')).toBe(
      true,
    )
    expect(
      isCredentialFileForChromeUpload('/Users/dev/project/.env.production'),
    ).toBe(true)
    expect(isCredentialFileForChromeUpload('/Users/dev/.ssh/id_rsa')).toBe(true)
    expect(isCredentialFileForChromeUpload('/Users/dev/.aws/credentials')).toBe(
      true,
    )
    expect(
      isCredentialFileForChromeUpload('/Users/dev/.config/gh/hosts.yml'),
    ).toBe(true)
    expect(
      isCredentialFileForChromeUpload('/Users/dev/infra/terraform.tfstate'),
    ).toBe(true)
    expect(isCredentialFileForChromeUpload('/Users/dev/secrets/cert.pem')).toBe(
      true,
    )

    // Safe examples & regular files are allowed
    expect(
      isCredentialFileForChromeUpload('/Users/dev/project/.env.example'),
    ).toBe(false)
    expect(
      isCredentialFileForChromeUpload('/Users/dev/project/screenshot.png'),
    ).toBe(false)

    // Symlink pointing to a credential file is also caught via realPath
    expect(
      isCredentialFileForChromeUpload(
        '/tmp/harmless-name.txt',
        '/Users/dev/project/.env',
      ),
    ).toBe(true)

    const msg = chromeFileUploadCredentialDeniedMessage('/Users/dev/.env')
    expect(msg).toContain('attach')
  })
})

describe('Wave 327-328 Group 3 — Artifact Tool (10 items)', () => {
  test('#419: mtimeNs-only drift ignored when sha256/heldSha256 digest is pinned', () => {
    const basePin = {
      kind: 'file' as const,
      dev: 1n,
      ino: 42n,
      sizeBytes: 128n,
      mtimeNs: 1000n,
      leafWasLink: false,
    }
    const driftedPin = { ...basePin, mtimeNs: 9999n }

    // With sha256 pinned, mtimeNs drift is accepted
    expect(
      publishSourcePinMatches({ pin: basePin, sha256: 'abc123' }, driftedPin),
    ).toBe(true)
    expect(
      publishSourcePinMatches(
        { pin: basePin, heldSha256: 'abc123' },
        driftedPin,
      ),
    ).toBe(true)
    // Without digest pinned, mtimeNs drift fails
    expect(publishSourcePinMatches({ pin: basePin }, driftedPin)).toBe(false)
    // Size change still fails even with sha256 pinned
    expect(
      publishSourcePinMatches(
        { pin: basePin, sha256: 'abc123' },
        { ...driftedPin, sizeBytes: 256n },
      ),
    ).toBe(false)

    // Upload read gate identity matcher also ignores mtimeNs when digest matches
    expect(uploadIdentityMatches('1:42:128:9999', '1:42:128:1000', true)).toBe(
      true,
    )
    expect(uploadIdentityMatches('1:42:128:9999', '1:42:128:1000', false)).toBe(
      false,
    )
    expect(uploadIdentityMatches('1:42:256:9999', '1:42:128:1000', true)).toBe(
      false,
    )
  })

  test('#420, #421, #514, #515: org-required new-artifact approval surfaces, plugin-only refusal, and nobody-to-ask refusal', () => {
    expect(NEW_ARTIFACT_ORG_APPROVAL_ASK_FLAGS.personOnly).toBe(true)
    expect(NEW_ARTIFACT_ORG_APPROVAL_ASK_FLAGS.suppressAlwaysAllowRule).toBe(
      true,
    )

    // #420: cloud scheduled task with user channel gets 'to_this_call'
    expect(
      resolveNewArtifactApprovalSurface({
        cloudScheduledTaskWithUserChannel: true,
      }),
    ).toBe('to_this_call')
    expect(
      checkNewArtifactOrgApprovalSurface({
        orgRequiresNewArtifactApproval: true,
        isNewArtifact: true,
        cloudScheduledTaskWithUserChannel: true,
      }),
    ).toBeNull()

    // #421: Agent SDK app with permission callback gets 'to_this_call' (main thread)
    expect(
      resolveNewArtifactApprovalSurface({
        agentSdkWithPermissionCallback: true,
      }),
    ).toBe('to_this_call')
    expect(
      isNewArtifactApprovedByPerson({
        toolUseId: 'tu_1',
        surface: 'to_this_call',
        allowGivenBy: { toolUseId: 'tu_1', approver: 'user' },
      }),
    ).toBe(true)

    // #514: plugin-only creation or plugin-hook approval is refused
    expect(
      isNewArtifactApprovedByPerson({
        toolUseId: 'tu_2',
        surface: 'any',
        pluginOnly: true,
      }),
    ).toBe(false)
    expect(
      isNewArtifactApprovedByPerson({
        toolUseId: 'tu_3',
        surface: 'to_this_call',
        allowGivenBy: { toolUseId: 'tu_3', approver: 'plugin' },
      }),
    ).toBe(false)
    expect(
      isNewArtifactApprovedByPerson({
        toolUseId: 'tu_4',
        surface: 'any',
        permissionPipelineResult: {
          behavior: 'allow',
          decisionReason: { type: 'hook', hookSource: 'plugin:my-mod' },
        },
      }),
    ).toBe(false)

    // #515: nobody-to-ask sessions refuse immediately with deny + classifierApprovable: false
    const deniedDontAsk = checkNewArtifactOrgApprovalSurface({
      orgRequiresNewArtifactApproval: true,
      isNewArtifact: true,
      mode: 'dontAsk',
    })
    expect(deniedDontAsk?.behavior).toBe('deny')
    const deniedNoSurface = checkNewArtifactOrgApprovalSurface({
      orgRequiresNewArtifactApproval: true,
      isNewArtifact: true,
    })
    expect(deniedNoSurface?.behavior).toBe('deny')
  })

  test('#492 & #493: _blob/<32-hex> normalization + upload read guidance + ignoring unused prompt/limit/label', () => {
    const assetHex = '0123456789abcdef0123456789abcdef'

    // #492: action: 'read' with path: '_blob/<32-hex>' converts to read_asset with asset_id
    const coercedRead = coerceArtifactPublishInput({
      action: 'read',
      path: `/_blob/${assetHex}`,
    })
    expect(coercedRead?.input).toMatchObject({
      action: 'read_asset',
      asset_id: assetHex,
    })

    // #492: non-hex _blob path in normalizePublishedPath gives clear upload-by-id guidance
    const badBlob = normalizePublishedPath('_blob/not-an-id')
    expect('errMsg' in badBlob).toBe(true)
    if ('errMsg' in badBlob) {
      expect(badBlob.errMsg.toLowerCase()).toContain('one per call')
    }

    // #493: unused prompt/limit/label stripped cleanly instead of failing
    const stripPrompt = coerceArtifactPublishInput({
      action: 'read_file',
      path: 'index.html',
      prompt: 'summarize it',
    })
    expect(
      (stripPrompt?.input as Record<string, unknown> | undefined)?.prompt,
    ).toBeUndefined()
    expect(stripPrompt?.resultNote).toContain('prompt')

    const stripLimit = coerceArtifactPublishInput({
      action: 'list_files',
      limit: 50,
    })
    expect(
      (stripLimit?.input as Record<string, unknown> | undefined)?.limit,
    ).toBeUndefined()
    expect(stripLimit?.resultNote).toContain('limit')

    const stripLabel = coerceArtifactPublishInput({
      action: 'upload_asset',
      file_path: '/tmp/a.png',
      label: 'hero',
    })
    expect(
      (stripLabel?.input as Record<string, unknown> | undefined)?.label,
    ).toBeUndefined()
    expect(stripLabel?.resultNote).toContain('label')
  })

  test('#516: ARTIFACTS_SWITCHED_OFF_MESSAGE is exported and ArtifactTool refuses when Artifacts disabled', async () => {
    expect(ARTIFACTS_SWITCHED_OFF_MESSAGE).toContain('Artifacts')
    const prev = process.env.CLAUDE_CODE_DISABLE_ARTIFACT
    process.env.CLAUDE_CODE_DISABLE_ARTIFACT = '1'
    try {
      const validation = await ArtifactTool.validateInput?.({
        action: 'list_files',
        url: 'https://claude.ai/artifacts/abc',
      } as never)
      expect(validation?.result).toBe(false)
      if (validation && !validation.result) {
        expect(validation.message).toContain('Artifacts')
      }
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_DISABLE_ARTIFACT
      else process.env.CLAUDE_CODE_DISABLE_ARTIFACT = prev
    }
  })

  test('#517: shouldSuppressArtifactPublishAlwaysAllow triggers in subagents and after background tasks, external messages, or compaction', () => {
    expect(shouldSuppressArtifactPublishAlwaysAllow({ agentId: 'sub-1' })).toBe(
      true,
    )
    expect(
      shouldSuppressArtifactPublishAlwaysAllow({
        messages: [{ type: 'system', subtype: 'compact_boundary' }],
      }),
    ).toBe(true)
    expect(
      shouldSuppressArtifactPublishAlwaysAllow({
        messages: [
          {
            type: 'attachment',
            attachment: {
              type: 'queued_command',
              commandMode: 'task-notification',
            },
          },
        ],
      }),
    ).toBe(true)
    expect(
      shouldSuppressArtifactPublishAlwaysAllow({
        messages: [{ type: 'user', verifiedSlackHumanTurn: true }],
      }),
    ).toBe(true)
    expect(
      shouldSuppressArtifactPublishAlwaysAllow({
        messages: [{ type: 'user' }],
      }),
    ).toBe(false)
  })

  test('#621: formatArtifactPublishVisibilityNote accurately describes shared folder, other_org, and named users + folder access', () => {
    const namedUsers = formatArtifactPublishVisibilityNote('users')
    expect(namedUsers).toContain("unless a folder it's in gives them access")

    const sharedFolderOwner = formatArtifactPublishVisibilityNote(
      'owner',
      'others',
    )
    expect(sharedFolderOwner).toContain('folder')
    expect(sharedFolderOwner).not.toContain('This artifact is private')

    const otherOrg = formatArtifactPublishVisibilityNote('other_org')
    expect(otherOrg).toContain('another organization')
    expect(otherOrg).toContain('do not call it private')

    const otherOrgPublic =
      formatArtifactPublishVisibilityNote('other_org_public')
    expect(otherOrgPublic).toContain('Anyone with the link')
  })

  test('#493 regression: appendCoerceResultNoteToToolResultBlock attaches Artifact resultNote to tool_result', () => {
    const coerced = coerceArtifactPublishInput({
      action: 'read_file',
      url: 'https://claude.ai/artifacts/abc',
      path: 'index.html',
      prompt: 'summarize',
    })
    expect(coerced?.resultNote).toBeDefined()

    const strBlock = appendCoerceResultNoteToToolResultBlock(
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'Saved file.' },
      coerced?.resultNote,
    )
    expect(typeof strBlock.content).toBe('string')
    expect(strBlock.content as string).toContain('Saved file.')
    expect(strBlock.content as string).toContain('`prompt` was ignored')

    const arrBlock = appendCoerceResultNoteToToolResultBlock(
      {
        type: 'tool_result',
        tool_use_id: 'tu_2',
        content: [{ type: 'text', text: 'Saved file.' }],
      },
      coerced?.resultNote,
    )
    expect(Array.isArray(arrBlock.content)).toBe(true)
    expect(JSON.stringify(arrBlock.content)).toContain('`prompt` was ignored')
  })

  test('#419/#420 regression: approved source pin store and org-approval requirement helper', () => {
    const pin = {
      kind: 'file' as const,
      dev: 1n,
      ino: 2n,
      sizeBytes: 100n,
      mtimeNs: 1000n,
      leafWasLink: false,
    }
    recordApprovedPublishSourcePin('tu-pin-1', { pin, sha256: 'deadbeef' })
    const consumed = consumeApprovedPublishSourcePin('tu-pin-1')
    expect(consumed).toBeDefined()
    expect(consumeApprovedPublishSourcePin('tu-pin-1')).toBeUndefined()
    expect(publishSourcePinMatches(consumed!, { ...pin, mtimeNs: 9999n })).toBe(
      true,
    )

    expect(
      isOrgNewArtifactApprovalRequired({
        orgRequiresNewArtifactApproval: true,
      }),
    ).toBe(true)
    expect(
      isOrgNewArtifactApprovalRequired({
        orgRequiresNewArtifactApproval: false,
      }),
    ).toBe(false)
  })
})
