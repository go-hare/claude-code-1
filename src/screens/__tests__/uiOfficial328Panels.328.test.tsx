import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiagnosticInfo } from '../../utils/doctorDiagnostic.js';
import type { LogOption } from '../../types/logs.js';
import type { ValidationError } from '../../utils/settings/validation.js';
import {
  formatDoctorDiagnosticSections,
  formatDoctorSummaryLines,
  formatOrgPolicyDoctorStatus,
  formatRemoteControlDoctorLines,
  formatRemoteSettingsDoctorStatus,
  partitionDoctorSettingsErrors,
} from '../../cli/handlers/util.js';
import {
  buildLogMetadata,
  getSessionArchiveFilePath,
  readSessionArchivedState,
  writeSessionArchivedState,
} from '../../components/LogSelector.js';
import { buildServerItemProps, getScopeHeading } from '../../components/mcp/MCPListPanel.js';
import type { ServerInfo } from '../../components/mcp/types.js';
import { formatShortNotifChannel, NOTIF_CHANNEL_OPTIONS } from '../../components/Settings/Config.js';
import { AGENT_VIEW_EMPTY_HEADING, AGENT_VIEW_EMPTY_SUBTITLE } from '../AgentView.js';
import { buildFleetFooterHints, fleetDeleteActionForBackend } from '../fleetView/helpers.js';

const SRC = join(import.meta.dir, '../..');
const readSrc = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI SGR sequences in test output
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function makeServer(overrides: {
  name?: string;
  scope?: ServerInfo['scope'];
  transport?: ServerInfo['transport'];
  client: Record<string, unknown>;
  config?: Record<string, unknown>;
}): ServerInfo {
  const scope = overrides.scope ?? 'project';
  const transport = overrides.transport ?? 'stdio';
  const config =
    overrides.config ??
    (transport === 'claudeai-proxy'
      ? { type: 'claudeai-proxy', url: 'https://claude.ai/mcp', id: 'proxy-1', enterpriseManaged: true }
      : { type: 'stdio', command: 'node', args: [] });
  return {
    name: overrides.name ?? 'demo-mcp',
    scope,
    transport,
    config,
    client: {
      name: overrides.name ?? 'demo-mcp',
      config: { ...config, scope },
      ...overrides.client,
    },
  } as unknown as ServerInfo;
}

describe('Official 2.1.328 Interactive Panels & CLI Alignment (U5)', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // 1. /mcp (MCPListPanel.tsx)
  // -------------------------------------------------------------------------
  describe('1. /mcp MCPListPanel 2.1.328 alignment', () => {
    test('scope headings include managed and active agent frontmatter groupings', () => {
      expect(getScopeHeading('managed')).toEqual({
        label: 'Managed MCPs',
        path: 'provided by your organization',
      });
      expect(getScopeHeading('agent', 'reviewer')).toEqual({
        label: 'Active agent MCPs',
        path: '@reviewer frontmatter',
      });
      expect(getScopeHeading('agent', '')).toEqual({
        label: 'Active agent MCPs',
        path: 'agent frontmatter',
      });
      expect(getScopeHeading('dynamic')).toEqual({
        label: 'Built-in MCPs',
        path: 'always available',
      });
    });

    test('buildServerItemProps matches official 2.1.328 status copy and badges', () => {
      const needsAuth = buildServerItemProps(makeServer({ client: { type: 'needs-auth' } }), undefined);
      expect(needsAuth.facts).toEqual(['needs sign-in']);

      const toolsErr = buildServerItemProps(
        makeServer({
          client: {
            type: 'connected',
            capabilities: { tools: {} },
            toolsListError: 'boom',
            droppedTools: [{ toolName: 'bad', reason: 'invalid schema' }],
          },
        }),
        0,
      );
      expect(toolsErr.facts).toEqual(["couldn't load tools", 'connected']);

      const withDropped = buildServerItemProps(
        makeServer({
          client: {
            type: 'connected',
            capabilities: { tools: {} },
            droppedTools: [
              { toolName: 't1', reason: 'bad' },
              { toolName: 't2', reason: 'bad' },
            ],
          },
        }),
        5,
      );
      expect(withDropped.facts).toEqual(['5 tools', '2 tools left out']);

      const heldDisabled = buildServerItemProps(
        makeServer({ client: { type: 'disabled', heldBy: 'other-session' } }),
        undefined,
      );
      expect(heldDisabled.facts).toEqual(['held by other-session']);

      const cached = buildServerItemProps(
        makeServer({
          client: {
            type: 'cached',
            cacheSavedAt: Date.now() - 120_000,
          },
        }),
        3,
      );
      expect(cached.facts[0]).toMatch(/^cached /);
      expect(cached.facts.slice(1)).toEqual(['connects on first use', '3 tools']);

      const unconfigured = buildServerItemProps(
        makeServer({ client: { type: 'failed', errorCode: 'UNCONFIGURED' } }),
        undefined,
        false,
      );
      expect(unconfigured.facts).toEqual(['not configured']);

      const unconfiguredSr = buildServerItemProps(
        makeServer({ client: { type: 'failed', errorCode: 'UNCONFIGURED' } }),
        undefined,
        true,
      );
      expect(unconfiguredSr.facts).toEqual(['']);

      const invalidCfg = buildServerItemProps(
        makeServer({ client: { type: 'failed', errorCode: 'INVALID_CONFIG' } }),
        undefined,
      );
      expect(invalidCfg.facts).toEqual(['config issue']);

      const retrying = buildServerItemProps(
        makeServer({ client: { type: 'failed', retriesInBackground: true } }),
        undefined,
      );
      expect(retrying.facts).toEqual(['retrying']);

      const managedConnector = buildServerItemProps(
        makeServer({
          scope: 'claudeai',
          transport: 'claudeai-proxy',
          client: { type: 'connected', capabilities: { tools: {} } },
        }),
        2,
      );
      expect(managedConnector.facts).toEqual(['2 tools', 'managed']);
    });

    test('MCPListPanel uses official title, Dialog inputGuide, and drops stale --debug error footer', () => {
      const src = readSrc('components/mcp/MCPListPanel.tsx');
      expect(src).toContain('title="MCP servers"');
      expect(src).not.toContain('title="Manage MCP servers"');
      expect(src).toContain('inputGuide={');
      expect(src).toContain('action="view"');
      expect(src).toContain('description="close"');
      expect(src).not.toContain('hideInputGuide');
      expect(src).not.toContain('Run claude --debug to see error logs');
      expect(src).toContain("['project', 'local', 'user', 'enterprise', 'managed', 'agent']");
    });
  });

  // -------------------------------------------------------------------------
  // 2. /resume (LogSelector.tsx)
  // -------------------------------------------------------------------------
  describe('2. /resume LogSelector 2.1.328 alignment', () => {
    test('session archive sidecar read/write round-trips cleanly and buildLogMetadata marks archived rows', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'cc-u5-archive-'));
      tmpDirs.push(dir);
      const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const fullPath = join(dir, `${sessionId}.jsonl`);

      expect(getSessionArchiveFilePath(fullPath, sessionId)).toBe(join(dir, sessionId, 'archived.json'));
      expect(await readSessionArchivedState(fullPath, sessionId)).toBeUndefined();

      expect(await writeSessionArchivedState(fullPath, sessionId, true)).toBe(true);
      expect(await readSessionArchivedState(fullPath, sessionId)).toBe(true);

      expect(await writeSessionArchivedState(fullPath, sessionId, false)).toBe(true);
      expect(await readSessionArchivedState(fullPath, sessionId)).toBe(false);

      const sampleLog = {
        date: '2026-11-24',
        messages: [],
        firstPrompt: 'hello',
        messageCount: 4,
        created: new Date('2026-11-24T00:00:00Z'),
        modified: new Date('2026-11-24T00:00:00Z'),
      } as unknown as LogOption;
      expect(buildLogMetadata(sampleLog, { isArchived: true })).toContain(' · archived');
      expect(buildLogMetadata(sampleLog, { isArchived: false })).not.toContain(' · archived');
    });

    test('LogSelector uses permission color, Ctrl+E archive, Refreshing/searching details, and italic footer', () => {
      const src = readSrc('components/LogSelector.tsx');
      expect(src).toContain('<Pane color="permission">');
      expect(src).toContain('<Text bold color="permission">');
      expect(src).not.toContain('<Pane color="suggestion">');
      expect(src).toContain(' · Refreshing…');
      expect(src).toContain(' · searching…');
      expect(src).toContain('Searching older sessions…');
      expect(src).toContain('Archived sessions are hidden.');
      expect(src).toContain("showAllProjects ? 'No sessions yet' : 'No sessions in this project yet'");
      expect(src).not.toContain('No conversations found');
      expect(src).toContain('<Text bold>New session name</Text>');
      expect(src).not.toContain('Rename session:');
      expect(src).toContain('<Text dimColor italic>');
      expect(src).toContain('shortcut="ctrl+e"');
      expect(src).toContain("archivedLogs.has(focusedLog) ? 'unarchive' : 'archive'");
      expect(src).toContain('shortcut="ctrl+s"');
      expect(src).toContain('innerPaneWidth >= 60');
      expect(src).toContain('shortcut="enter" action="resume"');
      expect(src).toContain('description="close"');
    });
  });

  // -------------------------------------------------------------------------
  // 3. AgentView.tsx & fleetView/helpers.ts
  // -------------------------------------------------------------------------
  describe('3. AgentView & fleetView/helpers 2.1.328 alignment', () => {
    test('AgentView empty state copy, logged-out warning, l login key, and 3 dim tips', () => {
      expect(AGENT_VIEW_EMPTY_HEADING).toBe('Nothing running in the background.');
      expect(AGENT_VIEW_EMPTY_SUBTITLE).toBe(
        'Hand off a task and it keeps working while you do something else — even if you close this terminal.',
      );

      const src = readSrc('screens/AgentView.tsx');
      expect(src).toContain('Not signed in. Press');
      expect(src).toContain('to sign in, or run');
      expect(src).toContain('claude /login');
      expect(src).toContain('+ new session');
      expect(src).toContain('claude --bg "task"');
      expect(src).toContain('/fork');
      expect(src).toContain("input === 'l' && !key.ctrl && !key.meta && !hasCredentials");
      expect(src).toContain("onAction?.({ type: 'login' })");
    });

    test('buildFleetFooterHints aligns help/delete/back/esc hints with official 2.1.328', () => {
      expect(fleetDeleteActionForBackend('daemon')).toBe('remove');
      expect(fleetDeleteActionForBackend('remote')).toBe('remove');

      const helpSimple = buildFleetFooterHints({
        focusArea: 'list',
        viewMode: 'list',
        deletePending: false,
        ungroupPending: false,
        canPin: true,
        canGroup: false,
        canRename: true,
        canDelete: 'remove',
        canGoBack: true,
        canSwitchViews: false,
        openSlots: 2,
        exitArmed: false,
        runningCount: 1,
        helpOpen: true,
      });
      expect(helpSimple).toContain('ctrl+x to remove');
      expect(helpSimple).toContain('← to go back');
      expect(helpSimple).toContain('esc to close · esc again to quit');
      expect(helpSimple).not.toContain('esc again quits');

      const deleteStop = buildFleetFooterHints({
        focusArea: 'list',
        viewMode: 'list',
        deletePending: true,
        ungroupPending: false,
        justKilled: true,
        backend: 'daemon',
        canPin: false,
        canGroup: false,
        canRename: false,
        openSlots: 0,
        exitArmed: false,
        runningCount: 0,
        helpOpen: false,
      });
      expect(deleteStop).toBe('stopped · ctrl+x again to remove · esc to keep');

      const deleteCustom = buildFleetFooterHints({
        focusArea: 'list',
        viewMode: 'list',
        deletePending: true,
        ungroupPending: false,
        justKilled: false,
        deleteAction: 'archive',
        canPin: false,
        canGroup: false,
        canRename: false,
        openSlots: 0,
        exitArmed: false,
        runningCount: 0,
        helpOpen: false,
      });
      expect(deleteCustom).toBe('ctrl+x again to archive · esc to keep');
    });
  });

  // -------------------------------------------------------------------------
  // 4. /config (Config.tsx)
  // -------------------------------------------------------------------------
  describe('4. /config Config.tsx 2.1.328 alignment', () => {
    test('formatShortNotifChannel matches official pLo mapping', () => {
      expect(NOTIF_CHANNEL_OPTIONS).toContain('terminal_bell');
      expect(formatShortNotifChannel('terminal_bell')).toBe('bell');
      expect(formatShortNotifChannel('iterm2_with_bell')).toBe('iterm2+bell');
      expect(formatShortNotifChannel('notifications_disabled')).toBe('none');
      expect(formatShortNotifChannel('auto')).toBe('auto');
      expect(formatShortNotifChannel('iterm2')).toBe('iterm2');
    });

    test('Config.tsx aligns labels, thinking warning, notification labels, Notifications submenu, and italic footers', () => {
      const src = readSrc('components/Settings/Config.tsx');
      expect(src).toContain("label: 'Open agents view by default'");
      expect(src).not.toContain("label: 'Start in agent view'");
      expect(src).toContain("label: 'Skip the /copy picker'");
      expect(src).not.toContain("label: 'Always copy full response (skip /copy picker)'");
      expect(src).toContain("label: 'Default view'");
      expect(src).not.toContain("label: 'What you see by default'");
      expect(src).toContain("label: 'Push when actions required'");
      expect(src).not.toContain("label: 'Push when input needed'");
      expect(src).toContain('Changing thinking mode mid-conversation slows responses and may lower quality.');
      expect(src).not.toContain('will increase latency and may reduce quality.');
      expect(src).toContain('Terminal bell <Text dimColor>(\\a)</Text>');
      expect(src).toContain("return 'iTerm2 with bell';");
      expect(src).not.toContain("return 'iTerm2 w/ Bell';");
      expect(src).toContain("showSubmenu === 'Notifications'");
      expect(src).toContain('title="Notifications"');
      expect(src).toContain("label: 'Notify when Claude needs you'");
      expect(src).toContain("label: 'Notify when Claude is done'");
      expect(src).toContain('<ItemList');
      expect(src).toContain('<Text dimColor italic wrap="truncate-end">');
      // Preserves saveModelAsDefaultRef wiring
      expect(src).toMatch(/onSetDefault=\{\(\) => \{\s*saveModelAsDefaultRef\.current = true;/);
    });
  });

  // -------------------------------------------------------------------------
  // 5. /plugin (PluginSettings.tsx)
  // -------------------------------------------------------------------------
  describe('5. /plugin PluginSettings.tsx 2.1.328 alignment', () => {
    test('uses permission theme color on Pane/Tabs and official SkillDoctorRedirectBanner copy', () => {
      const src = readSrc('commands/plugin/PluginSettings.tsx');
      expect(src).toContain('<Pane color="permission">');
      expect(src).toContain('color="permission"');
      expect(src).not.toContain('<Pane color="suggestion">');
      expect(src).toContain('/skill-doctor moved. Skill usage and context costs are in this Stats tab.');
      expect(src).not.toContain('/skill-doctor moved — skill usage and context costs now live in this Stats tab.');
    });
  });

  // -------------------------------------------------------------------------
  // 6. claude doctor CLI output (src/cli/handlers/util.tsx)
  // -------------------------------------------------------------------------
  describe('6. claude doctor CLI output 2.1.328 alignment', () => {
    const baseDiagnostic: DiagnosticInfo = {
      installationType: 'native',
      version: '2.1.328',
      installationPath: '/usr/local/bin/claude',
      invokedBinary: '/usr/local/bin/claude',
      configInstallMethod: 'native',
      autoUpdates: 'enabled',
      hasUpdatePermissions: true,
      lastUpdateResult: null,
      multipleInstallations: [
        { type: 'native', path: '/usr/local/bin/claude' },
        { type: 'npm-global', path: '/opt/node/bin/claude' },
      ],
      warnings: [],
      ripgrepStatus: {
        working: true,
        mode: 'embedded',
        systemPath: null,
        note: null,
      },
    };

    test('formatDoctorSummaryLines emits Commit line when gitSha is present', () => {
      const withSha = formatDoctorSummaryLines(baseDiagnostic, 'rc', 'e96a84ee7f68e91a62663957e57e2ae3c6cc1e5f');
      expect(withSha).toContain('Commit: e96a84ee7f68');
      expect(withSha).toContain('Auto-update channel: slow');

      const withoutSha = formatDoctorSummaryLines(baseDiagnostic, 'latest', '');
      expect(withoutSha.some(l => l.startsWith('Commit:'))).toBe(false);
    });

    test('partitionDoctorSettingsErrors splits statusOnly notices from invalid entries and excludes MCP errors', () => {
      const errors = [
        { file: 'settings.json', path: 'foo', message: 'bad field' },
        { file: 'settings.json', path: 'bar', message: 'status notice text', statusOnly: true },
        { file: '.mcp.json', path: '', message: 'mcp err', mcpErrorMetadata: { serverName: 's', scope: 'project' } },
      ] as unknown as ValidationError[];

      const { statusNotices, invalidEntries } = partitionDoctorSettingsErrors(errors);
      expect(invalidEntries.map(e => e.message)).toEqual(['bad field']);
      expect(statusNotices.map(e => e.message)).toEqual(['status notice text']);
    });

    test('formatRemoteSettingsDoctorStatus and formatOrgPolicyDoctorStatus match official copy', () => {
      expect(formatRemoteSettingsDoctorStatus({ state: 'ok', hasSettings: true })).toBe('loaded');
      expect(formatRemoteSettingsDoctorStatus({ state: 'ok', hasSettings: false })).toBe(
        'none configured for this organization',
      );
      expect(formatRemoteSettingsDoctorStatus(undefined, { fetchInProgress: true })).toBe(
        'checking… (fetch in progress; re-run in a moment)',
      );
      expect(formatRemoteSettingsDoctorStatus(undefined, { provider: 'bedrock' })).toContain(
        'not available on Bedrock/Vertex/third-party providers',
      );

      expect(formatOrgPolicyDoctorStatus({ provider: 'vertex' })).toContain(
        "doesn't connect to the Anthropic API directly",
      );
      expect(
        formatOrgPolicyDoctorStatus({
          provider: 'firstParty',
          isFirstPartyBaseUrl: true,
          lastFetchOutcome: { success: true },
        }),
      ).toBe('Loaded from api.anthropic.com');
      expect(
        formatOrgPolicyDoctorStatus({
          provider: 'firstParty',
          isFirstPartyBaseUrl: true,
          lastFetchOutcome: null,
          hasSessionCache: true,
          sessionFromServerFetch: false,
          eligible: true,
        }),
      ).toBe('Using the copy on disk · not refreshed yet this session');
    });

    test('formatRemoteControlDoctorLines handles cloud session and local checks', () => {
      const cloud = formatRemoteControlDoctorLines({
        inRemoteSession: true,
        disabledReason: null,
        checks: [],
      });
      expect(cloud).toEqual([
        '',
        'Remote Control',
        'Inside a cloud session — Remote Control is unavailable here. Use it from the local session instead.',
      ]);

      const local = formatRemoteControlDoctorLines({
        inRemoteSession: false,
        disabledReason: null,
        checks: [
          { label: 'Signed in to claude.ai', ok: true },
          { label: 'Org policy does not allow Remote Control (allow_remote_control)', ok: false, detail: 'policy' },
        ],
      });
      expect(local).toEqual([
        '',
        'Remote Control',
        'Control this session from claude.ai/code or the Claude mobile app',
        '- Org policy does not allow Remote Control (allow_remote_control) (policy)',
      ]);
    });

    test('formatDoctorDiagnosticSections emits official warning prefixes, notices, permission rules, and Remote Control block', () => {
      const lines = formatDoctorDiagnosticSections({
        diagnostic: baseDiagnostic,
        channel: 'latest',
        gitSha: 'e96a84ee7f68e91a',
        remoteSettingsLine: 'loaded',
        orgPolicyLine: 'Loaded from api.anthropic.com',
        settingsErrors: [
          { file: 'settings.json', path: 'hooks', message: 'invalid hook entry' },
          { file: 'settings.json', path: '', message: 'Managed settings notice', statusOnly: true },
        ] as unknown as ValidationError[],
        permissionRuleAdvisories: ['Permission deny rule "BogusTool" matches no known tool — check for typos.'],
        linkWarnings: [
          [
            '/etc/claude-code/managed-settings.json: managed-settings.json is reached through a link',
            'Suggested fix: replace link',
          ],
        ],
        envIssues: [{ name: 'BASH_MAX_OUTPUT_LENGTH', status: 'capped', message: 'capped to 150000' }],
        remoteControl: {
          inRemoteSession: false,
          disabledReason: null,
          checks: [{ label: 'Not signed in to claude.ai', ok: false }],
        },
        interactiveTty: true,
      }).map(stripAnsi);

      expect(lines).toContain('Commit: e96a84ee7f68');
      expect(lines).toContain('Managed settings (remote): loaded');
      expect(lines).toContain('Organization policy: Loaded from api.anthropic.com');
      expect(lines.some(l => l.includes('Invalid settings') && l !== 'Invalid settings')).toBe(true);
      expect(lines).toContain('- Managed settings notice');
      expect(
        lines.some(
          l =>
            l.includes('Permission rules that may not work as written') &&
            l !== 'Permission rules that may not work as written',
        ),
      ).toBe(true);
      expect(lines).toContain('- Permission deny rule "BogusTool" matches no known tool — check for typos.');
      expect(lines.some(l => l.includes('Suggested fix: replace link'))).toBe(true);
      expect(lines.some(l => l.includes('Environment variables') && l !== 'Environment variables')).toBe(true);
      expect(lines.some(l => l.includes('Multiple installations found') && l !== 'Multiple installations found')).toBe(
        true,
      );
      expect(lines).toContain('Remote Control');
      expect(lines).toContain('Control this session from claude.ai/code or the Claude mobile app');
      expect(lines).toContain('- Not signed in to claude.ai');
    });
  });
});
