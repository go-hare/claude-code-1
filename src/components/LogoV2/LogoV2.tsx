import * as React from 'react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Box, type DOMElement, Link, Text, useApp } from '@anthropic/ink';
import { getIsNonInteractiveSession } from '../../bootstrap/state.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useAppState } from '../../state/AppState.js';
import type { ToolPermissionContext } from '../../Tool.js';
import { getAntAuthFallbackNotice, getAntAuthLoginStartupLine } from '../../commands/login/getAuthStatus.js';
import {
  filterUnseenSecurityWarnings,
  getGlobalConfig,
  markSecurityWarningsSeen,
  saveGlobalConfig,
} from '../../utils/config.js';
import { formatTokens } from '../../utils/format.js';
import {
  CHANGELOG_DOCS_LABEL,
  CHANGELOG_DOCS_URL,
  getStartupUpdateSummary,
  hasUnseenReleaseVersion,
} from '../../utils/logoV2Utils.js';
import {
  buildUnrecognizedModelNotice,
  MODEL_CONFIG_DOCS_URL,
  MODEL_CONFIG_WINDOW_DOCS_URL,
  sanitizeModelForNotice,
  type UnrecognizedModelNotice,
} from '../../utils/model/unrecognizedModelSignal.js';
import { permissionRuleValueFromString } from '../../utils/permissions/permissionRuleParser.js';
import { Qe, type ScreenSiteNode } from '../../utils/plugins/pluginSiteHold.js';
import { getAgentId } from '../../utils/teammate.js';
import { hasClaudeAiMcpEverConnected, hasClaudeAiMcpSessionConnected } from '../../services/mcp/claudeai.js';
import type { MCPServerConnection } from '../../services/mcp/types.js';
import { countMcpNeedsAuth } from '../../services/mcp/utils.js';
import { CondensedLogo } from './CondensedLogo.js';

/**
 * Official 2.1.325 `y7t` / `QD()` (#2273): indicates whether startup notices
 * rendered inside the header are eligible to record impressions/seen state.
 */
export const StartupNoticeVisibilityContext = createContext<boolean>(true);

export function useStartupNoticeVisible(): boolean {
  return useContext(StartupNoticeVisibilityContext);
}

/**
 * Official 2.1.325 `Aq()` visibility probe (#2273):
 * - returns `null` if the node is not yet laid out (wait for next paint frame)
 * - returns `false` if scrolled out of view (`Qe(node) === null`)
 * - returns `true` if visible inside the scroll viewport (or in non-scroll layout)
 */
export function probeNodeVisibleInViewport(node: ScreenSiteNode | null | undefined): boolean | null {
  if (!node?.yogaNode) return null;
  const onScreen = Qe(node);
  if (onScreen === null) return false;
  return true;
}

/**
 * Official 2.1.325 `Qa` (#2273): mark permission-rule startup warnings seen
 * only when the warning element is actually visible in the viewport.
 */
export function tryMarkPermissionWarningsSeenIfVisible(
  probeVisible: () => boolean | null,
  seenKeys: readonly string[],
  markSeen: (keys: readonly string[]) => void = markSecurityWarningsSeen,
): boolean {
  const visible = probeVisible();
  if (visible === true && seenKeys.length > 0) {
    markSeen(seenKeys);
  }
  return visible !== null;
}

const MCP_NEEDS_AUTH_SEEN_KEY = 'mcp-needs-auth';

export function recordMcpNeedsAuthNoticeSeen(count: number): void {
  if (count <= 0) return;
  saveGlobalConfig(current => {
    const prev = (current as { seenNotifications?: Record<string, number> }).seenNotifications ?? {};
    const nextCount = (prev[MCP_NEEDS_AUTH_SEEN_KEY] ?? 0) + 1;
    return {
      ...current,
      seenNotifications: {
        ...prev,
        [MCP_NEEDS_AUTH_SEEN_KEY]: nextCount,
      },
    } as typeof current;
  });
}

/**
 * Official 2.1.325 `Ka` (#2273): mark the "N MCP servers need authentication"
 * notice as seen only when its rendered container is visible in the viewport.
 */
export function tryMarkMcpNeedsAuthSeenIfVisible(
  probeVisible: () => boolean | null,
  count: number,
  markSeen: (c: number) => void = recordMcpNeedsAuthNoticeSeen,
): boolean {
  const visible = probeVisible();
  if (visible === true && count > 0) {
    markSeen(count);
  }
  return visible !== null;
}

export function PermissionRuleWarningsSeenObserver({ seenKeys }: { seenKeys: readonly string[] }): React.ReactNode {
  const noticeVisible = useStartupNoticeVisible();
  const { subscribeFrames } = useApp();
  const boxRef = useRef<DOMElement | null>(null);

  useEffect(() => {
    if (!noticeVisible || seenKeys.length === 0) return;
    const probe = () => probeNodeVisibleInViewport(boxRef.current as unknown as ScreenSiteNode | null);
    if (tryMarkPermissionWarningsSeenIfVisible(probe, seenKeys)) {
      return;
    }
    if (!subscribeFrames) return;
    const unsubscribe = subscribeFrames(() => {
      if (tryMarkPermissionWarningsSeenIfVisible(probe, seenKeys)) {
        unsubscribe();
      }
    });
    return unsubscribe;
  }, [noticeVisible, seenKeys, subscribeFrames]);

  return <Box ref={boxRef} />;
}

export function McpNeedsAuthSeenObserver({ mcpClients }: { mcpClients: MCPServerConnection[] }): React.ReactNode {
  const noticeVisible = useStartupNoticeVisible();
  const { subscribeFrames } = useApp();
  const boxRef = useRef<DOMElement | null>(null);
  const count = countMcpNeedsAuth(mcpClients, hasClaudeAiMcpEverConnected, hasClaudeAiMcpSessionConnected);

  useEffect(() => {
    if (!noticeVisible || count === 0) return;
    const probe = () => probeNodeVisibleInViewport(boxRef.current as unknown as ScreenSiteNode | null);
    if (tryMarkMcpNeedsAuthSeenIfVisible(probe, count)) {
      return;
    }
    if (!subscribeFrames) return;
    const unsubscribe = subscribeFrames(() => {
      if (tryMarkMcpNeedsAuthSeenIfVisible(probe, count)) {
        unsubscribe();
      }
    });
    return unsubscribe;
  }, [noticeVisible, count, subscribeFrames]);

  return <Box ref={boxRef} />;
}

const RULE_CONTENT_FIELD_BY_TOOL = new Map<string, string>([
  ['Bash', 'command'],
  ['PowerShell', 'command'],
  ['Read', 'path'],
  ['FileRead', 'path'],
  ['Edit', 'path'],
  ['Write', 'path'],
  ['FileEdit', 'path'],
  ['FileWrite', 'path'],
  ['WebFetch', 'domain'],
  ['WebSearch', 'query'],
  ['Glob', 'pattern'],
  ['Grep', 'pattern'],
  ['NotebookEdit', 'notebook_path'],
]);

/**
 * Official 2.1.305 `mja` (#1047): detect deny/ask permission rules that
 * restrict nothing (e.g. `Bash(command:...)` or `Read(path:...)` where the
 * ruleContentField prefix is treated as a literal string and never matches).
 */
export function findNoOpPermissionRuleWarnings(
  ctx: Pick<ToolPermissionContext, 'alwaysDenyRules' | 'alwaysAskRules'>,
): string[] {
  const warnings: string[] = [];
  const checkRules = (rulesBySource: Record<string, readonly string[]>, behaviorLabel: 'Deny' | 'Ask') => {
    for (const [source, rules] of Object.entries(rulesBySource)) {
      if (source === 'session') continue;
      for (const raw of rules) {
        const parsed = permissionRuleValueFromString(raw);
        const { toolName, ruleContent } = parsed;
        const field = RULE_CONTENT_FIELD_BY_TOOL.get(toolName);
        if (field && ruleContent !== undefined) {
          const colonIdx = ruleContent.indexOf(':');
          if (colonIdx > 0 && ruleContent.slice(0, colonIdx).trim() === field) {
            const targetTool =
              toolName === 'FileRead'
                ? 'Read'
                : toolName === 'FileEdit' || toolName === 'FileWrite'
                  ? 'Edit'
                  : toolName;
            warnings.push(
              `${behaviorLabel} rule ${raw} never matches${toolName === 'FileRead' ? '' : ` · use ${targetTool}(…)`}`,
            );
          }
        }
      }
    }
  };
  checkRules(ctx.alwaysDenyRules, 'Deny');
  checkRules(ctx.alwaysAskRules, 'Ask');
  return warnings;
}

export function LogoUnrecognizedModelWarning({ notice }: { notice: UnrecognizedModelNotice }): React.ReactNode {
  return (
    <Text color="warning">
      {`Model "${sanitizeModelForNotice(notice.model)}" isn't recognized`}
      {notice.suggestion === undefined ? (
        <Text dimColor>
          {' · context assumed to be '}
          {formatTokens(notice.window)}
          {' tokens · update Claude Code, or see '}
          <Link url={MODEL_CONFIG_WINDOW_DOCS_URL} fallback={MODEL_CONFIG_DOCS_URL}>
            the docs
          </Link>
        </Text>
      ) : (
        <Text dimColor>{` · did you mean "${notice.suggestion}"?`}</Text>
      )}
    </Text>
  );
}

export function LogoV2(): React.ReactNode {
  const noticeVisible = useStartupNoticeVisible();
  const [suppressed] = useState(() => !noticeVisible || getIsNonInteractiveSession() || getAgentId() !== undefined);
  const [updateSummary] = useState(() => (suppressed || process.env.DEMO_VERSION ? null : getStartupUpdateSummary()));
  const model = useMainLoopModel();
  const toolPermissionContext = useAppState(s => s.toolPermissionContext);
  const mcpClients = useAppState(s => s.mcp.clients);
  const permissionWarningEntries = useMemo(() => {
    if (suppressed || process.env.DEMO_VERSION) return [];
    const keyed = findNoOpPermissionRuleWarnings(toolPermissionContext).map(text => ({
      text,
      seenKey: `noop-perm-rule:${text}`,
    }));
    return filterUnseenSecurityWarnings(keyed);
  }, [suppressed, toolPermissionContext]);
  const permissionWarningSeenKeys = useMemo(
    () => permissionWarningEntries.map(e => e.seenKey),
    [permissionWarningEntries],
  );
  const unknownModelNotice = suppressed || process.env.DEMO_VERSION ? null : buildUnrecognizedModelNotice(model);
  const [antAuthNotice] = useState(() => (suppressed || process.env.DEMO_VERSION ? null : getAntAuthFallbackNotice()));
  const antAuthBillingLine =
    antAuthNotice?.reason === 'no_login'
      ? antAuthNotice.text
      : suppressed || process.env.DEMO_VERSION
        ? null
        : antAuthNotice === null
          ? getAntAuthLoginStartupLine()
          : null;
  const expiredClaudeAiWarning = antAuthNotice?.reason === 'login_ended' ? antAuthNotice.text : null;

  useEffect(() => {
    if (suppressed || !hasUnseenReleaseVersion(getGlobalConfig().lastReleaseNotesSeen)) {
      return;
    }
    saveGlobalConfig(current => {
      if (!hasUnseenReleaseVersion(current.lastReleaseNotesSeen)) return current;
      return { ...current, lastReleaseNotesSeen: MACRO.VERSION };
    });
  }, [suppressed]);

  return (
    <>
      <CondensedLogo oneShotsAllowed={!suppressed} />
      {!suppressed && !process.env.DEMO_VERSION && <McpNeedsAuthSeenObserver mcpClients={mcpClients} />}
      {updateSummary && (
        <Box paddingLeft={2} flexDirection="column">
          <Text bold>{updateSummary}</Text>
          <Text dimColor>
            <Link url={CHANGELOG_DOCS_URL}>{CHANGELOG_DOCS_LABEL}</Link> for details
          </Text>
        </Box>
      )}
      {unknownModelNotice && (
        <Box paddingLeft={2} flexDirection="column">
          <LogoUnrecognizedModelWarning notice={unknownModelNotice} />
        </Box>
      )}
      {expiredClaudeAiWarning && (
        <Box paddingLeft={2} flexDirection="column">
          <Text color="warning">⚠ {expiredClaudeAiWarning}</Text>
        </Box>
      )}
      {antAuthBillingLine && (
        <Box paddingLeft={2} flexDirection="column">
          <Text dimColor>{antAuthBillingLine}</Text>
        </Box>
      )}
      {permissionWarningEntries.length > 0 && (
        <Box paddingLeft={2} flexDirection="column">
          {permissionWarningEntries.map(w => (
            <Text key={w.text} color="warning">
              ⚠ {w.text}
            </Text>
          ))}
          <PermissionRuleWarningsSeenObserver seenKeys={permissionWarningSeenKeys} />
        </Box>
      )}
    </>
  );
}
