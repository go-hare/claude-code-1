import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Box, Link, Text } from '@anthropic/ink';
import { getIsNonInteractiveSession } from '../../bootstrap/state.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useAppState } from '../../state/AppState.js';
import type { ToolPermissionContext } from '../../Tool.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
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
import { getAgentId } from '../../utils/teammate.js';
import { CondensedLogo } from './CondensedLogo.js';

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
  const [suppressed] = useState(() => getIsNonInteractiveSession() || getAgentId() !== undefined);
  const [updateSummary] = useState(() => (suppressed || process.env.DEMO_VERSION ? null : getStartupUpdateSummary()));
  const model = useMainLoopModel();
  const toolPermissionContext = useAppState(s => s.toolPermissionContext);
  const permissionWarnings = useMemo(
    () => (suppressed || process.env.DEMO_VERSION ? [] : findNoOpPermissionRuleWarnings(toolPermissionContext)),
    [suppressed, toolPermissionContext],
  );
  const unknownModelNotice = suppressed || process.env.DEMO_VERSION ? null : buildUnrecognizedModelNotice(model);

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
      {permissionWarnings.length > 0 && (
        <Box paddingLeft={2} flexDirection="column">
          {permissionWarnings.map(w => (
            <Text key={w} color="warning">
              ⚠ {w}
            </Text>
          ))}
        </Box>
      )}
    </>
  );
}
