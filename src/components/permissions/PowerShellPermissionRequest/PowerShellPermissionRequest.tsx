import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Byline, KeyboardShortcutHint, Text, useTheme } from '@anthropic/ink';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../../services/analytics/growthbook.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../../services/analytics/index.js';
import { sanitizeToolNameForAnalytics } from '../../../services/analytics/metadata.js';
import { shouldUseSandbox } from '@claude-code/builtin-tools/tools/BashTool/shouldUseSandbox.js';
import { getDestructiveCommandWarning } from '@claude-code/builtin-tools/tools/PowerShellTool/destructiveCommandWarning.js';
import { PowerShellTool } from '@claude-code/builtin-tools/tools/PowerShellTool/PowerShellTool.js';
import { isAllowlistedCommand } from '@claude-code/builtin-tools/tools/PowerShellTool/readOnlyValidation.js';
import {
  resolvePermissionRequestSource,
  type PermissionRequestSourceContext,
} from '../../../dialog/permissionRequestSource.js';
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js';
import { getCompoundCommandPrefixesStatic } from '../../../utils/powershell/staticPrefix.js';
import { SandboxManager } from '../../../utils/sandbox/sandbox-adapter.js';
import { Select } from '../../CustomSelect/select.js';
import { type UnaryEvent, usePermissionRequestLogging } from '../hooks.js';
import { PermissionDialog } from '../PermissionDialog.js';
import { PermissionOverflowBox } from '../PermissionOverflowBox.js';
import { PermissionPreviewGutter } from '../PermissionPreviewGutter.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';
import { useShellPermissionFeedback } from '../useShellPermissionFeedback.js';
import { logUnaryPermissionEvent } from '../utils.js';
import { powershellToolUseOptions } from './powershellToolUseOptions.js';

export function PowerShellPermissionRequest(props: PermissionRequestProps): React.ReactNode {
  const { toolUseConfirm, toolUseContext, onDone, onReject, workerBadge } = props;

  const { command, description } = PowerShellTool.inputSchema.parse(toolUseConfirm.input);

  const [theme] = useTheme();
  const {
    yesInputMode,
    noInputMode,
    yesFeedbackModeEntered,
    noFeedbackModeEntered,
    acceptFeedback,
    rejectFeedback,
    setAcceptFeedback,
    setRejectFeedback,
    focusedOption,
    handleInputModeToggle,
    handleReject,
    handleFocus,
  } = useShellPermissionFeedback({
    toolUseConfirm,
    onDone,
    onReject,
    explainerVisible: false,
  });
  const requestSource = useMemo(
    () => resolvePermissionRequestSource(toolUseContext as unknown as PermissionRequestSourceContext),
    [toolUseContext],
  );
  const { destructiveWarning, sandboxingEnabled, isSandboxed } = useMemo(() => {
    const destructiveWarning = getFeatureValue_CACHED_MAY_BE_STALE('tengu_destructive_command_warning', false)
      ? getDestructiveCommandWarning(command)
      : null;
    const sandboxingEnabled = SandboxManager.isSandboxingEnabled();
    const dangerouslyDisableSandbox =
      (toolUseConfirm.input as { dangerouslyDisableSandbox?: unknown } | undefined)?.dangerouslyDisableSandbox === true;
    const isSandboxed =
      sandboxingEnabled &&
      requestSource?.type !== 'remote-agent' &&
      shouldUseSandbox({
        command,
        dangerouslyDisableSandbox,
        shellType: 'powershell',
      });
    return { destructiveWarning, sandboxingEnabled, isSandboxed };
  }, [command, toolUseConfirm.input, requestSource]);

  // Editable prefix — compute static prefix locally (no LLM call).
  // Initialize synchronously to the raw command for single-line commands so
  // the editable input renders immediately, then refine to the extracted prefix
  // once the AST parser resolves. Multiline commands (`# comment\n...`,
  // foreach loops) get undefined → powershellToolUseOptions:64 hides the
  // "don't ask again" option — those literals are one-time-use (settings
  // corpus shows 14 multiline rules, zero match twice). For compound commands,
  // computes a prefix per subcommand, excluding subcommands that are already
  // auto-allowed (read-only).
  const [editablePrefix, setEditablePrefix] = useState<string | undefined>(
    command.includes('\n') ? undefined : command,
  );
  const hasUserEditedPrefix = useRef(false);
  useEffect(() => {
    let cancelled = false;
    // Filter receives ParsedCommandElement — isAllowlistedCommand works from
    // element.name/nameType/args directly. isReadOnlyCommand(text) would need
    // to reparse (pwsh.exe spawn per subcommand) and returns false without the
    // full parsed AST, making the filter a no-op.
    getCompoundCommandPrefixesStatic(command, element => isAllowlistedCommand(element, element.text))
      .then(prefixes => {
        if (cancelled || hasUserEditedPrefix.current) return;
        if (prefixes.length > 0) {
          setEditablePrefix(`${prefixes[0]} *`);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  const onEditablePrefixChange = useCallback((value: string) => {
    hasUserEditedPrefix.current = true;
    setEditablePrefix(value);
  }, []);

  const unaryEvent = useMemo<UnaryEvent>(() => ({ completion_type: 'tool_use_single', language_name: 'none' }), []);

  usePermissionRequestLogging(toolUseConfirm, unaryEvent);

  const options = useMemo(
    () =>
      powershellToolUseOptions({
        suggestions:
          toolUseConfirm.permissionResult.behavior === 'ask' ? toolUseConfirm.permissionResult.suggestions : undefined,
        onRejectFeedbackChange: setRejectFeedback,
        onAcceptFeedbackChange: setAcceptFeedback,
        yesInputMode,
        noInputMode,
        editablePrefix,
        onEditablePrefixChange,
        permissionResult: toolUseConfirm.permissionResult,
        tool: toolUseConfirm.tool,
        input: toolUseConfirm.input,
        isAskCappedByOrg: toolUseConfirm.tool.mcpInfo?.effectiveMaxPermission === 'ask',
      }),
    [toolUseConfirm, yesInputMode, noInputMode, editablePrefix, onEditablePrefixChange],
  );

  function onSelect(value: string) {
    // Map options to numeric values for analytics (strings not allowed in logEvent)
    const optionIndex: Record<string, number> = {
      yes: 1,
      'yes-apply-suggestions': 2,
      'yes-prefix-edited': 2,
      no: 3,
    };
    logEvent('tengu_permission_request_option_selected', {
      option_index: optionIndex[value],
    });

    const toolNameForAnalytics = sanitizeToolNameForAnalytics(
      toolUseConfirm.tool.name,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;

    if (value === 'yes-prefix-edited') {
      const trimmedPrefix = (editablePrefix ?? '').trim();
      logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
      if (!trimmedPrefix) {
        toolUseConfirm.onAllow(toolUseConfirm.input, []);
      } else {
        const prefixUpdates: PermissionUpdate[] = [
          {
            type: 'addRules',
            rules: [
              {
                toolName: PowerShellTool.name,
                ruleContent: trimmedPrefix,
              },
            ],
            behavior: 'allow',
            destination: 'localSettings',
          },
        ];
        toolUseConfirm.onAllow(toolUseConfirm.input, prefixUpdates);
      }
      onDone();
      return;
    }

    switch (value) {
      case 'yes': {
        const trimmedFeedback = acceptFeedback.trim();
        logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
        logEvent('tengu_accept_submitted', {
          toolName: toolNameForAnalytics,
          isMcp: toolUseConfirm.tool.isMcp ?? false,
          has_instructions: !!trimmedFeedback,
          instructions_length: trimmedFeedback.length,
          entered_feedback_mode: yesFeedbackModeEntered,
        });
        toolUseConfirm.onAllow(toolUseConfirm.input, [], trimmedFeedback || undefined);
        onDone();
        break;
      }
      case 'yes-apply-suggestions': {
        logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
        const permissionUpdates =
          'suggestions' in toolUseConfirm.permissionResult ? toolUseConfirm.permissionResult.suggestions || [] : [];
        toolUseConfirm.onAllow(toolUseConfirm.input, permissionUpdates);
        onDone();
        break;
      }
      case 'no': {
        const trimmedFeedback = rejectFeedback.trim();
        logEvent('tengu_reject_submitted', {
          toolName: toolNameForAnalytics,
          isMcp: toolUseConfirm.tool.isMcp ?? false,
          has_instructions: !!trimmedFeedback,
          instructions_length: trimmedFeedback.length,
          entered_feedback_mode: noFeedbackModeEntered,
        });
        handleReject(trimmedFeedback || undefined);
        break;
      }
    }
  }

  const networkAllowHosts = (toolUseConfirm as { networkAllowHosts?: readonly string[] }).networkAllowHosts;

  return (
    <PermissionDialog
      workerBadge={workerBadge}
      requestSource={requestSource}
      title={sandboxingEnabled && !isSandboxed ? 'PowerShell command (unsandboxed)' : 'PowerShell command'}
      innerPaddingX={0}
    >
      {toolUseConfirm.description ? (
        <Box flexDirection="column" paddingX={1}>
          <PermissionPreviewGutter multiline={toolUseConfirm.description.includes('\n')}>
            <Text dimColor>{toolUseConfirm.description}</Text>
          </PermissionPreviewGutter>
        </Box>
      ) : null}
      <PermissionOverflowBox paddingX={1}>
        <PermissionPreviewGutter multiline={command.includes('\n')}>
          <Text>{PowerShellTool.renderToolUseMessage({ command, description }, { theme, verbose: true })}</Text>
        </PermissionPreviewGutter>
      </PermissionOverflowBox>
      <Box flexDirection="column" paddingX={1}>
        {networkAllowHosts !== undefined && networkAllowHosts.length > 0 ? (
          <Box marginBottom={1}>
            <Text>
              Also lets this command reach, beyond the sandbox allowlist:{' '}
              <Text bold>{networkAllowHosts.slice(0, 8).join(', ')}</Text>
              {networkAllowHosts.length > 8
                ? ` (+${networkAllowHosts.length - 8} more, ${networkAllowHosts.length} in all)`
                : ''}
            </Text>
          </Box>
        ) : null}
        <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="command" />
        {destructiveWarning && (
          <Box marginBottom={1}>
            <Text color="warning">{destructiveWarning}</Text>
          </Box>
        )}
        <Text>Do you want to proceed?</Text>
        <Select
          options={options}
          inlineDescriptions
          onChange={onSelect}
          onCancel={() => handleReject()}
          onFocus={handleFocus}
          onInputModeToggle={handleInputModeToggle}
        />
      </Box>
      <Box justifyContent="space-between" marginTop={1} paddingX={1}>
        <Text dimColor>
          <Byline>
            <KeyboardShortcutHint shortcut="escape" action="cancel" />
            {(focusedOption === 'yes' && !yesInputMode) || (focusedOption === 'no' && !noInputMode) ? (
              <KeyboardShortcutHint shortcut="tab" action="amend" />
            ) : null}
          </Byline>
        </Text>
      </Box>
    </PermissionDialog>
  );
}
