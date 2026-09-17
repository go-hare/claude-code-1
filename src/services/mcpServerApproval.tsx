import React from 'react';
import uniq from 'lodash-es/uniq.js';
import { MCPServerApprovalDialog, type McpApprovalPersistResult } from '../components/MCPServerApprovalDialog.js';
import { MCPServerMultiselectDialog } from '../components/MCPServerMultiselectDialog.js';
import type { Root } from '@anthropic/ink';
import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from './analytics/index.js';
import { AppStateProvider } from '../state/AppState.js';
import { getProjectPathForConfig } from '../utils/config.js';
import { logForDebugging } from '../utils/debug.js';
import { isCurrentProjectTrustLatched } from '../utils/permissions/projectGrantsGate.js';
import { getSettingsWithAllErrors } from '../utils/settings/allErrors.js';
import { isLocalSettingsGitTracked } from '../utils/settings/localSettingsGitTracked.js';
import type { ValidationError } from '../utils/settings/validation.js';
import { getMcpConfigsByScope } from './mcp/config.js';
import { getSessionApprovedMcpServers } from './mcp/mcpSessionApprovedServers.js';
import { getProjectMcpServerStatus } from './mcp/utils.js';

export type McpjsonServerApprovalsOpts = {
  /** densable Te/`le` = host.mcpProcessWiring.strictConfig() */
  strictMcpConfig?: boolean;
};

/** densable Te / Jo return — project `.mcp.json` plus plugin MCP names. */
export type PendingMcpApprovals = {
  pendingServers: string[];
  pluginServerNames: Set<string>;
};

/**
 * densable Te/`xe` (2.1.246).
 * `le()` / `strictMcpConfig` → empty. Else project `.mcp.json` names plus
 * enabled-plugin MCP keys (`de`/`ue`), filtered by `fe`=`getProjectMcpServerStatus`.
 */
export async function collectPendingProjectMcpApprovals(
  opts?: McpjsonServerApprovalsOpts,
): Promise<PendingMcpApprovals> {
  if (opts?.strictMcpConfig) {
    return { pendingServers: [], pluginServerNames: new Set() };
  }
  const { servers } = getMcpConfigsByScope('project');
  const serverNames = Object.keys(servers);
  const rootNames = new Set(serverNames);
  const pluginServerNames = new Set<string>();
  const { loadAllPlugins } = await import('../utils/plugins/pluginLoader.js');
  const { loadPluginMcpServers } = await import('../utils/plugins/mcpPluginIntegration.js');
  const { enabled } = await loadAllPlugins();
  for (const plugin of enabled) {
    const pluginServers = await loadPluginMcpServers(plugin, []);
    if (!pluginServers) continue;
    for (const name of Object.keys(pluginServers)) {
      if (rootNames.has(name) || pluginServerNames.has(name)) continue;
      serverNames.push(name);
      pluginServerNames.add(name);
    }
  }
  return {
    pendingServers: serverNames.filter(name => getProjectMcpServerStatus(name) === 'pending'),
    pluginServerNames,
  };
}

/** densable `us` return — REPL `mcpApprovalSkipWarning` / initialNotifications. */
export type McpApprovalSkipWarning = {
  key: string;
  text: string;
};

/** densable `/cd` `Rt` return — Te plus optional `us` skipped notice. */
export type CdPendingMcpApprovals = PendingMcpApprovals & {
  skipNotice?: McpApprovalSkipWarning;
};

/**
 * densable `/cd` `Rt` — Te plus settings-error backstop.
 * Pending + any settings/MCP validation error → no V UI; attach `us`
 * skipped notice so `m` can show it (same doctor/restart sentence).
 */
export async function collectPendingMcpApprovalsForCd(
  opts?: McpjsonServerApprovalsOpts,
): Promise<CdPendingMcpApprovals> {
  try {
    const pending = await collectPendingProjectMcpApprovals(opts);
    const errors = getSettingsWithAllErrors().errors;
    if (pending.pendingServers.length > 0 && errors.length > 0) {
      logForDebugging('/cd: project MCP servers await approval but a settings file has errors; leaving them pending', {
        level: 'warn',
      });
      return {
        pendingServers: [],
        pluginServerNames: new Set(),
        skipNotice: mcpProjectApprovalSkippedNotice(errors),
      };
    }
    return pending;
  } catch (e) {
    logForDebugging(
      `/cd: collecting the new directory's project MCP servers failed (continuing without approvals): ${e}`,
      { level: 'error' },
    );
    return { pendingServers: [], pluginServerNames: new Set() };
  }
}

export type { McpApprovalPersistResult };

/**
 * densable `/cd` `V` — single vs multi approval dialog.
 * Threads `isPluginServer` / `pluginServerNames` into UKc/`v` labels.
 */
export function CdPendingMcpApproval({
  pending,
  onComplete,
}: {
  pending: PendingMcpApprovals;
  onComplete: (result: McpApprovalPersistResult) => void;
}): React.ReactNode {
  const [first, ...rest] = pending.pendingServers;
  if (first !== undefined && rest.length === 0) {
    return (
      <MCPServerApprovalDialog
        serverName={first}
        isPluginServer={pending.pluginServerNames.has(first)}
        onDone={onComplete}
      />
    );
  }
  return (
    <MCPServerMultiselectDialog
      serverNames={pending.pendingServers}
      pluginServerNames={pending.pluginServerNames}
      onDone={onComplete}
    />
  );
}

const FEATURE_MCP_PROJECT_APPROVAL =
  'mcp_project_approval_dialog' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;

function logMcpApprovalFeature(kind: 'ok' | 'bad' | 'sad', errorCode?: string): void {
  const feature_name = FEATURE_MCP_PROJECT_APPROVAL;
  if (kind === 'ok') {
    logEvent('tengu_feature_ok', { feature_name });
    return;
  }
  logEvent(kind === 'bad' ? 'tengu_feature_bad' : 'tengu_feature_sad', {
    feature_name,
    error_code: errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  });
}

/**
 * densable `us` after-dialog / settings-error arms (`Y`/`B`/`Eo`).
 * Persist-failed wins; else gated (session approved + !se + Hte tracked);
 * else feature_ok and no banner.
 */
export function finishMcpProjectApprovalStartup(persist: McpApprovalPersistResult): McpApprovalSkipWarning | null {
  if (persist.persistFailed) {
    logMcpApprovalFeature('bad', 'mcp_approval_persist_failed');
    return {
      key: 'mcp-approval-persist-failed',
      text: 'one or more of your MCP server choices could not be saved (check permissions on .claude/settings.local.json) \u00b7 you will be asked again next startup',
    };
  }
  const workspaceKey = getProjectPathForConfig();
  if (
    getSessionApprovedMcpServers().some(row => row.workspaceKey === workspaceKey) &&
    !isCurrentProjectTrustLatched() &&
    isLocalSettingsGitTracked({ onIndeterminate: 'tracked' })
  ) {
    logMcpApprovalFeature('sad', 'mcp_approval_persist_gated');
    return {
      key: 'mcp-approval-persist-gated',
      text: 'your MCP server choices apply to this session only (workspace not explicitly trusted; .claude/settings.local.json is gated) \u00b7 to persist, add them to enabledMcpjsonServers in ~/.claude/settings.json',
    };
  }
  logMcpApprovalFeature('ok');
  return null;
}

/** densable `us` settings-error arm — skip dialog + doctor banner. */
export function mcpProjectApprovalSkippedNotice(errors: Pick<ValidationError, 'file'>[]): McpApprovalSkipWarning {
  logMcpApprovalFeature('sad', 'mcp_project_approval_skipped_settings_errors');
  const files = uniq(errors.map(e => e.file).filter((f): f is string => typeof f === 'string')).join(', ');
  return {
    key: 'mcp-approval-skipped',
    text: `skipping .mcp.json server approval (settings errors${files ? ` in ${files}` : ''}) \u00b7 run \`claude doctor\` to list them, fix them, then restart`,
  };
}

/**
 * densable `us` — startup MCP approval + persist/gated/skipped banner.
 * #43: `--strict-mcp-config` / empty Te → null (no dialog).
 */
export async function handleMcpjsonServerApprovals(
  root: Root,
  opts?: McpjsonServerApprovalsOpts,
): Promise<McpApprovalSkipWarning | null> {
  const pending = await collectPendingProjectMcpApprovals(opts);
  if (pending.pendingServers.length === 0) {
    return null;
  }
  const errors = getSettingsWithAllErrors().errors;
  if (errors.length > 0) {
    return mcpProjectApprovalSkippedNotice(errors);
  }
  let persist: McpApprovalPersistResult;
  try {
    persist = await new Promise<McpApprovalPersistResult>(resolve => {
      root.render(
        <AppStateProvider>
          <KeybindingSetup>
            <CdPendingMcpApproval pending={pending} onComplete={resolve} />
          </KeybindingSetup>
        </AppStateProvider>,
      );
    });
  } catch (e) {
    logMcpApprovalFeature('bad', 'mcp_project_approval_dialog_threw');
    throw e;
  }
  return finishMcpProjectApprovalStartup(persist);
}
