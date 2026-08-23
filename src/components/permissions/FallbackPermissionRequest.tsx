import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { Box, type DOMElement, measureElement, Text, useTheme } from '@anthropic/ink';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { sanitizeToolNameForAnalytics } from '../../services/analytics/metadata.js';
import { env } from '../../utils/env.js';
import { shouldShowAlwaysAllowOptions } from '../../utils/permissions/permissionsLoader.js';
import { shouldShowPersistentAllowOption } from '../../utils/permissions/showAlwaysAllow.js';
import { truncateToLines } from '../../utils/stringUtils.js';
import { logUnaryEvent } from '../../utils/unaryLogging.js';
import {
  dontAskAgainMaxLabelWidthFromTracked,
  initialDontAskAgainSelectWidth,
  renderDontAskAgainLabel,
} from './dontAskAgainLabel.js';
import { type UnaryEvent, usePermissionRequestLogging } from './hooks.js';
import { PermissionDialog } from './PermissionDialog.js';
import { PermissionPrompt, type PermissionPromptOption, type ToolAnalyticsContext } from './PermissionPrompt.js';
import type { PermissionRequestProps } from './PermissionRequest.js';
import { PermissionRuleExplanation } from './PermissionRuleExplanation.js';

type FallbackOptionValue = 'yes' | 'yes-dont-ask-again' | 'no';

export function FallbackPermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  verbose: _verbose,
  workerBadge,
}: PermissionRequestProps): React.ReactNode {
  const [theme] = useTheme();
  // TODO: Avoid these special cases
  const originalUserFacingName = toolUseConfirm.tool.userFacingName(toolUseConfirm.input as never);
  const userFacingName = originalUserFacingName.endsWith(' (MCP)')
    ? originalUserFacingName.slice(0, -6)
    : originalUserFacingName;

  const unaryEvent = useMemo<UnaryEvent>(
    () => ({
      completion_type: 'tool_use_single',
      language_name: 'none',
    }),
    [],
  );

  usePermissionRequestLogging(toolUseConfirm, unaryEvent);

  const handleSelect = useCallback(
    (value: FallbackOptionValue, feedback?: string) => {
      switch (value) {
        case 'yes':
          void logUnaryEvent({
            completion_type: 'tool_use_single',
            event: 'accept',
            metadata: {
              language_name: 'none',
              message_id: toolUseConfirm.assistantMessage.message.id!,
              platform: env.platform,
            },
          });
          toolUseConfirm.onAllow(toolUseConfirm.input, [], feedback);
          onDone();
          break;
        case 'yes-dont-ask-again': {
          void logUnaryEvent({
            completion_type: 'tool_use_single',
            event: 'accept',
            metadata: {
              language_name: 'none',
              message_id: toolUseConfirm.assistantMessage.message.id!,
              platform: env.platform,
            },
          });

          toolUseConfirm.onAllow(toolUseConfirm.input, [
            {
              type: 'addRules',
              rules: [
                {
                  toolName: toolUseConfirm.tool.name,
                },
              ],
              behavior: 'allow',
              destination: 'localSettings',
            },
          ]);
          onDone();
          break;
        }
        case 'no':
          void logUnaryEvent({
            completion_type: 'tool_use_single',
            event: 'reject',
            metadata: {
              language_name: 'none',
              message_id: toolUseConfirm.assistantMessage.message.id!,
              platform: env.platform,
            },
          });
          toolUseConfirm.onReject(feedback);
          onReject();
          onDone();
          break;
      }
    },
    [toolUseConfirm, onDone, onReject],
  );

  const handleCancel = useCallback(() => {
    void logUnaryEvent({
      completion_type: 'tool_use_single',
      event: 'reject',
      metadata: {
        language_name: 'none',
        message_id: toolUseConfirm.assistantMessage.message.id!,
        platform: env.platform,
      },
    });
    toolUseConfirm.onReject();
    onReject();
    onDone();
  }, [toolUseConfirm, onDone, onReject]);

  const originalCwd = getOriginalCwd();
  const { columns } = useTerminalSize();
  // Official isAskCappedByOrg: org ceiling "ask" must not offer permanent allow.
  // densable 2.1.235 #12: also hide when suppressAlwaysAllowRule / tool.suppresses…
  const isAskCappedByOrg = toolUseConfirm.tool.mcpInfo?.effectiveMaxPermission === 'ask';
  const showAlwaysAllowOptions = shouldShowPersistentAllowOption({
    baseAllowed: shouldShowAlwaysAllowOptions(),
    permissionResult: toolUseConfirm.permissionResult,
    tool: toolUseConfirm.tool,
    input: toolUseConfirm.input,
    isAskCappedByOrg,
  });
  // densable sVc: Aa0 initial cap 40, then measureElement(Select) → max(20, width-2).
  const selectRef = useRef<DOMElement>(null);
  const [trackedSelectWidth, setTrackedSelectWidth] = useState(() => initialDontAskAgainSelectWidth(columns));
  useLayoutEffect(() => {
    if (!selectRef.current) return;
    const { width } = measureElement(selectRef.current);
    if (width > 0) {
      setTrackedSelectWidth(Math.max(20, width - 2));
    }
  }, [columns, userFacingName, originalCwd, showAlwaysAllowOptions]);
  const options = useMemo((): PermissionPromptOption<FallbackOptionValue>[] => {
    const result: PermissionPromptOption<FallbackOptionValue>[] = [
      {
        label: 'Yes',
        value: 'yes',
        feedbackConfig: { type: 'accept' },
      },
    ];

    // densable 2.1.238 MYg: width-gate DAA; null → omit option
    if (showAlwaysAllowOptions) {
      const daaLabel = renderDontAskAgainLabel({
        toolName: userFacingName,
        cwd: originalCwd,
        maxLabelWidth: dontAskAgainMaxLabelWidthFromTracked(trackedSelectWidth, columns),
      });
      if (daaLabel !== null) {
        result.push({
          label: daaLabel,
          value: 'yes-dont-ask-again',
        });
      }
    }

    result.push({
      label: 'No',
      value: 'no',
      feedbackConfig: { type: 'reject' },
    });

    return result;
  }, [userFacingName, originalCwd, showAlwaysAllowOptions, columns, trackedSelectWidth]);

  const toolAnalyticsContext = useMemo(
    (): ToolAnalyticsContext => ({
      toolName: sanitizeToolNameForAnalytics(toolUseConfirm.tool.name),
      isMcp: toolUseConfirm.tool.isMcp ?? false,
    }),
    [toolUseConfirm.tool.name, toolUseConfirm.tool.isMcp],
  );

  return (
    <PermissionDialog title="Tool use" workerBadge={workerBadge}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>
          {userFacingName}(
          {toolUseConfirm.tool.renderToolUseMessage(toolUseConfirm.input as never, { theme, verbose: true })})
          {originalUserFacingName.endsWith(' (MCP)') ? <Text dimColor> (MCP)</Text> : ''}
        </Text>
        <Text dimColor>{truncateToLines(toolUseConfirm.description, 3)}</Text>
      </Box>

      <Box flexDirection="column">
        <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="tool" />
        <PermissionPrompt
          options={options}
          onSelect={handleSelect}
          onCancel={handleCancel}
          toolAnalyticsContext={toolAnalyticsContext}
          selectRef={selectRef}
        />
      </Box>
    </PermissionDialog>
  );
}
