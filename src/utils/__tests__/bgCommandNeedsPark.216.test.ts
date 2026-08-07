/**
 * densable 2.1.216 #37 — bg /mcp + /install-github-app park needs-input.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setAttacherCaps } from '../../bootstrap/state.js'
import {
  BG_NO_TERMINAL_INSTALL_GITHUB_APP_MSG,
  BG_NO_TERMINAL_INSTALL_GITHUB_APP_PARKED_MSG,
  BG_NO_TERMINAL_MCP_SETTINGS_MSG,
  BG_NO_TERMINAL_MCP_SETTINGS_PARKED_MSG,
  EMPTY_PROMPT_NEEDS,
  INSTALL_GITHUB_APP_DETAIL,
  INSTALL_GITHUB_APP_NEEDS,
  MCP_SETTINGS_DETAIL,
  MCP_SETTINGS_NEEDS,
  _resetBgCommandNeedsParkForTests,
  clearBgCommandNeedsPark,
  formatMcpNeedsAuthMessage,
  parkBgCommandNeedsInput,
  parkInstallGithubAppNeedsInput,
  parkMcpSettingsNeedsInput,
  writeBgCommandNeedsPark,
} from '../bgCommandNeedsPark.js'

const ROOT = join(import.meta.dir, '../..')

function seedJob(dir: string, short: string): void {
  const jobDir = join(dir, short)
  mkdirSync(jobDir, { recursive: true })
  writeFileSync(
    join(jobDir, 'state.json'),
    JSON.stringify({
      state: 'working',
      detail: '',
      tempo: 'active',
      intent: 'test',
      sessionId: 'sess',
      cwd: '/tmp',
      template: 'default',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  )
}

describe('densable zpd writeBgCommandNeedsPark', () => {
  let tmp = ''
  const prevJob = process.env.CLAUDE_JOB_DIR
  const prevShort = process.env.CLAUDE_BG_SHORT

  afterEach(() => {
    _resetBgCommandNeedsParkForTests()
    if (tmp) rmSync(tmp, { recursive: true, force: true })
    tmp = ''
    if (prevJob === undefined) delete process.env.CLAUDE_JOB_DIR
    else process.env.CLAUDE_JOB_DIR = prevJob
    if (prevShort === undefined) delete process.env.CLAUDE_BG_SHORT
    else process.env.CLAUDE_BG_SHORT = prevShort
    // jobState reads from ~/.claude/jobs — we patch via CLAUDE_JOB_DIR only if
    // write uses env; local writeBgCommandNeedsPark uses getJobDirPath(short)
    // which is under config home. For unit tests of pure zpd logic we exercise
    // write via env short + mock read by using real job dir under tmp with
    // getJobDirPath? It always uses getClaudeConfigHomeDir. So test pure result
    // shapes with refused when no short, and source contracts.
  })

  test('refused without CLAUDE_JOB_DIR/short', async () => {
    delete process.env.CLAUDE_JOB_DIR
    delete process.env.CLAUDE_BG_SHORT
    const r = await writeBgCommandNeedsPark('n', 'd')
    expect(r.kind).toBe('refused')
  })

  test('EMPTY_PROMPT_NEEDS constant is densable Yx', () => {
    expect(EMPTY_PROMPT_NEEDS).toBe('send a prompt to start')
  })
})

describe('densable copy + CUt source contracts', () => {
  test('MCP settings needs/detail + parked/unparked msgs', () => {
    expect(MCP_SETTINGS_NEEDS).toBe('open this session to manage MCP servers')
    expect(MCP_SETTINGS_DETAIL).toBe('MCP settings requested')
    expect(BG_NO_TERMINAL_MCP_SETTINGS_MSG).toContain(
      '`/mcp enable|disable|reconnect <server>`',
    )
    expect(BG_NO_TERMINAL_MCP_SETTINGS_PARKED_MSG).toContain(
      'needs input" in agent view',
    )
    expect(BG_NO_TERMINAL_MCP_SETTINGS_PARKED_MSG).toContain(
      'open it and run /mcp to manage servers',
    )
  })

  test('install-github-app needs/detail + parked/unparked msgs', () => {
    expect(INSTALL_GITHUB_APP_NEEDS).toBe(
      'open this session to finish /install-github-app',
    )
    expect(INSTALL_GITHUB_APP_DETAIL).toBe('/install-github-app requested')
    expect(BG_NO_TERMINAL_INSTALL_GITHUB_APP_MSG).toContain(
      'Attach to it and run the command again',
    )
    expect(BG_NO_TERMINAL_INSTALL_GITHUB_APP_PARKED_MSG).toContain(
      'needs input" in agent view',
    )
  })

  test('mcp.tsx uses parkMcpSettingsNeedsInput', () => {
    const src = readFileSync(join(ROOT, 'commands/mcp/mcp.tsx'), 'utf8')
    expect(src).toContain('parkMcpSettingsNeedsInput')
    expect(src).toContain('bgCommandNeedsPark')
  })

  test('install-github-app uses parkInstallGithubAppNeedsInput', () => {
    const src = readFileSync(
      join(ROOT, 'commands/install-github-app/install-github-app.tsx'),
      'utf8',
    )
    expect(src).toContain('parkInstallGithubAppNeedsInput')
  })

  test('MCPReconnect needs-auth uses formatMcpNeedsAuthMessage', () => {
    const src = readFileSync(
      join(ROOT, 'components/mcp/MCPReconnect.tsx'),
      'utf8',
    )
    expect(src).toContain('formatMcpNeedsAuthMessage')
  })

  test('setAttacherCaps emits subscribeAttacherCaps', () => {
    const src = readFileSync(join(ROOT, 'bootstrap/state.ts'), 'utf8')
    expect(src).toContain('subscribeAttacherCaps')
    expect(src).toContain('attacherCapsListeners')
  })
})

describe('formatMcpNeedsAuthMessage non-bg', () => {
  test('interactive path uses Use /mcp', async () => {
    setAttacherCaps({ colorLevel: 2 })
    // bun:test: isBgSession always false → non-bg path
    const msg = await formatMcpNeedsAuthMessage('myserver')
    expect(msg).toBe(
      'myserver requires authentication. Use /mcp to authenticate.',
    )
  })
})

describe('park helpers return densable unparked when CUt false', () => {
  afterEach(() => {
    _resetBgCommandNeedsParkForTests()
  })

  test('parkMcpSettingsNeedsInput falls back to gOb', async () => {
    // no bg → isBgNoTerminal false → parkBg returns false inside only when called
    // parkMcpSettings always calls park which returns false → gOb
    const msg = await parkMcpSettingsNeedsInput()
    expect(msg).toBe(BG_NO_TERMINAL_MCP_SETTINGS_MSG)
  })

  test('parkInstallGithubAppNeedsInput falls back to attach msg', async () => {
    const msg = await parkInstallGithubAppNeedsInput()
    expect(msg).toBe(BG_NO_TERMINAL_INSTALL_GITHUB_APP_MSG)
  })

  test('parkBgCommandNeedsInput false when not SB', async () => {
    const ok = await parkBgCommandNeedsInput('n', 'd')
    expect(ok).toBe(false)
  })
})
