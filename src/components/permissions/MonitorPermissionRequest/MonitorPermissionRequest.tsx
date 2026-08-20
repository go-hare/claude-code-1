import React, { useCallback, useMemo } from 'react';
import { Box, Text, useTheme } from '@anthropic/ink';
import { getTheme } from '../../../utils/theme.js';
import { env } from '../../../utils/env.js';
import { shouldShowAlwaysAllowOptions } from '../../../utils/permissions/permissionsLoader.js';
import { shouldShowPersistentAllowOption } from '../../../utils/permissions/showAlwaysAllow.js';
import { truncateToLines } from '../../../utils/stringUtils.js';
import { logUnaryEvent } from '../../../utils/unaryLogging.js';
import { replaceHiddenControlChars } from '../../../utils/controlChars.js';
import { PermissionDialog } from '../PermissionDialog.js';
import { PermissionPrompt, type PermissionPromptOption } from '../PermissionPrompt.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';

type OptionValue = 'yes' | 'yes-dont-ask-again' | 'no';

/**
 * Permission request UI for the MonitorTool. Asks the user to confirm
 * starting a long-running background monitor process.
 * Follows the FallbackPermissionRequest pattern.
 */
export function MonitorPermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  workerBadge,
}: PermissionRequestProps): React.ReactNode {
  const [themeName] = useTheme();
  const theme = getTheme(themeName);

  const input = toolUseConfirm.input as {
    command: string;
    description: string;
  };

  // Official isAskCappedByOrg: org ceiling "ask" must not offer permanent allow.
  // densable 2.1.235 #12: also honor suppressAlwaysAllowRule / tool.suppresses…
  const isAskCappedByOrg = toolUseConfirm.tool.mcpInfo?.effectiveMaxPermission === 'ask';
  const showAlwaysAllowOptions = useMemo(
    () =>
      shouldShowPersistentAllowOption({
        baseAllowed: shouldShowAlwaysAllowOptions(),
        permissionResult: toolUseConfirm.permissionResult,
        tool: toolUseConfirm.tool,
        input: toolUseConfirm.input,
        isAskCappedByOrg,
      }),
    [isAskCappedByOrg, toolUseConfirm.permissionResult, toolUseConfirm.tool, toolUseConfirm.input],
  );

  const options: PermissionPromptOption<OptionValue>[] = useMemo(() => {
    const opts: PermissionPromptOption<OptionValue>[] = [
      {
        label: 'Yes',
        value: 'yes',
        feedbackConfig: { type: 'accept' as const },
      },
    ];
    if (showAlwaysAllowOptions) {
      opts.push({
        label: (
          <Text>
            Yes, and don{'\u2019'}t ask again for <Text bold>{toolUseConfirm.tool.name}</Text> commands
          </Text>
        ),
        value: 'yes-dont-ask-again',
      });
    }
    opts.push({
      label: 'No',
      value: 'no',
      feedbackConfig: { type: 'reject' as const },
    });
    return opts;
  }, [showAlwaysAllowOptions, toolUseConfirm.tool.name]);

  const handleSelect = useCallback(
    (value: OptionValue, feedback?: string) => {
      switch (value) {
        case 'yes':
          logUnaryEvent({
            completion_type: 'tool_use_single',
            event: 'accept',
            metadata: {
              language_name: 'none',
              message_id: toolUseConfirm.assistantMessage.message.id ?? '',
              platform: env.platform,
            },
          });
          toolUseConfirm.onAllow(toolUseConfirm.input, [], feedback);
          onDone();
          break;
        case 'yes-dont-ask-again':
          logUnaryEvent({
            completion_type: 'tool_use_single',
            event: 'accept',
            metadata: {
              language_name: 'none',
              message_id: toolUseConfirm.assistantMessage.message.id ?? '',
              platform: env.platform,
            },
          });
          toolUseConfirm.onAllow(toolUseConfirm.input, [
            {
              type: 'addRules',
              rules: [{ toolName: toolUseConfirm.tool.name }],
              behavior: 'allow',
              destination: 'localSettings',
            },
          ]);
          onDone();
          break;
        case 'no':
          logUnaryEvent({
            completion_type: 'tool_use_single',
            event: 'reject',
            metadata: {
              language_name: 'none',
              message_id: toolUseConfirm.assistantMessage.message.id ?? '',
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
    logUnaryEvent({
      completion_type: 'tool_use_single',
      event: 'reject',
      metadata: {
        language_name: 'none',
        message_id: toolUseConfirm.assistantMessage.message.id ?? '',
        platform: env.platform,
      },
    });
    toolUseConfirm.onReject();
    onReject();
    onDone();
  }, [toolUseConfirm, onDone, onReject]);

  return (
    <PermissionDialog title="Monitor" workerBadge={workerBadge}>
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold color={theme.permission as any}>
            {input.description}
          </Text>
          {/* densable 2.1.223 #5 — Jg display so TAB/invisibles cannot hide the command */}
          <Text dimColor>{truncateToLines(replaceHiddenControlChars(input.command), 5)}</Text>
        </Box>
        <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="command" />
        <PermissionPrompt<OptionValue> options={options} onSelect={handleSelect} onCancel={handleCancel} />
      </Box>
    </PermissionDialog>
  );
}
