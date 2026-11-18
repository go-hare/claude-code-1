import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, chmodSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getGlobalClaudeFile, resetGlobalClaudeFileForTests } from '../env.js'
import {
  processDisabledFileMentions,
  tryGetPDFReference,
} from '../attachments.js'
import { getMcpInstructionsDelta } from '../mcpInstructionsDelta.js'
import {
  isHostProxyEnvVar,
  isHostTransportSensitiveEnvVar,
} from '../managedEnvConstants.js'
import { RESTRICTED_OPTION_HELP } from '../restricted.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import type { Message } from '../../types/message.js'

describe('v2.1.299-300 env, restricted, attachments, mcpDelta, managedEnvConstants', () => {
  test('#766: RESTRICTED_OPTION_HELP does not name removed REPL tool', () => {
    expect(RESTRICTED_OPTION_HELP).toContain(
      '(Bash, PowerShell and the other code-running tools)',
    )
    expect(RESTRICTED_OPTION_HELP).not.toContain('REPL')
  })

  test('#565: processDisabledFileMentions emits path-only at_mention_reference', () => {
    const atts = processDisabledFileMentions(
      'Please inspect @src/foo.ts and @README.md',
    )
    expect(atts).toHaveLength(1)
    expect(atts[0]).toEqual({
      type: 'at_mention_reference',
      mentions: ['src/foo.ts', 'README.md'],
    })
    expect(processDisabledFileMentions('no mentions here')).toEqual([])
  })

  test('#603: empty read-only .config.json in CLAUDE_CONFIG_DIR does not shadow .claude.json on Linux', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-603-'))
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    try {
      process.env.CLAUDE_CONFIG_DIR = dir
      resetGlobalClaudeFileForTests()
      const legacy = join(dir, '.config.json')
      writeFileSync(legacy, '')
      chmodSync(legacy, 0o444)
      const resolved = getGlobalClaudeFile()
      expect(resolved).toBe(join(dir, '.claude.json'))
    } finally {
      if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      resetGlobalClaudeFileForTests()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#807: tryGetPDFReference sets wholeRefusedByModel and modelReadsByPage for Claude 3 models', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-807-'))
    try {
      const pdfPath = join(dir, 'small.pdf')
      writeFileSync(pdfPath, '%PDF-1.4\n%%EOF\n')
      const claude3Ref = await tryGetPDFReference(
        pdfPath,
        'claude-3-haiku-20240307',
      )
      expect(claude3Ref).not.toBeNull()
      expect(claude3Ref?.wholeRefusedByModel).toBe(true)
      expect(claude3Ref?.modelReadsByPage).toBe(true)

      const claude4Ref = await tryGetPDFReference(pdfPath, 'claude-sonnet-4-6')
      expect(claude4Ref).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#792: getMcpInstructionsDelta holds retraction for pending servers when retractionHoldEnabled is true', () => {
    const priorMessage = {
      type: 'attachment',
      attachment: {
        type: 'mcp_instructions_delta',
        addedNames: ['srvA'],
        addedBlocks: ['## srvA\nhello'],
        removedNames: [],
      },
    } as unknown as Message

    const pendingClients: MCPServerConnection[] = [
      {
        type: 'pending',
        name: 'srvA',
        config: { type: 'stdio', command: 'echo' },
      } as unknown as MCPServerConnection,
    ]

    const held = getMcpInstructionsDelta(pendingClients, [priorMessage], [], {
      retractionHoldEnabled: true,
    })
    expect(held).toBeNull()

    const unheld = getMcpInstructionsDelta(pendingClients, [priorMessage], [], {
      retractionHoldEnabled: false,
    })
    expect(unheld).toEqual({
      addedNames: [],
      addedBlocks: [],
      removedNames: ['srvA'],
    })
  })

  test('#809: HOST_TRANSPORT_SENSITIVE_ENV_VARS & HOST_PROXY_ENV_VARS cover CA-bundle, tool-proxy, git TLS & config vars', () => {
    for (const key of [
      'SSL_CERT_FILE',
      'SSL_CERT_DIR',
      'REQUESTS_CA_BUNDLE',
      'CURL_CA_BUNDLE',
      'GIT_SSL_CAINFO',
      'GIT_SSL_NO_VERIFY',
      'GIT_PROXY_COMMAND',
      'GIT_CONFIG_PARAMETERS',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_0',
    ]) {
      expect(isHostTransportSensitiveEnvVar(key)).toBe(true)
    }
    for (const proxyKey of [
      'ALL_PROXY',
      'CLAUDE_CODE_HTTP_PROXY',
      'NPM_CONFIG_HTTPS_PROXY',
    ]) {
      expect(isHostProxyEnvVar(proxyKey)).toBe(true)
    }
  })
})
