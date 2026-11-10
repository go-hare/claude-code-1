import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Byline, KeyboardShortcutHint, Text, useTheme } from '@anthropic/ink';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../../services/analytics/growthbook.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../../services/analytics/index.js';
import { sanitizeToolNameForAnalytics } from '../../../services/analytics/metadata.js';
import { BashTool } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js';
import {
  getFirstWordPrefix,
  getSimpleCommandPrefix,
} from '@claude-code/builtin-tools/tools/BashTool/bashPermissions.js';
import { getDestructiveCommandWarning } from '@claude-code/builtin-tools/tools/BashTool/destructiveCommandWarning.js';
import { parseSedEditCommand } from '@claude-code/builtin-tools/tools/BashTool/sedEditParser.js';
import { shouldUseSandbox } from '@claude-code/builtin-tools/tools/BashTool/shouldUseSandbox.js';
import { getCompoundCommandPrefixesStatic } from '../../../utils/bash/prefix.js';
import { extractRules } from '../../../utils/permissions/PermissionUpdate.js';
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js';
import { SandboxManager } from '../../../utils/sandbox/sandbox-adapter.js';
import { Select } from '../../CustomSelect/select.js';
import { type UnaryEvent, usePermissionRequestLogging } from '../hooks.js';
import { PermissionDialog } from '../PermissionDialog.js';
import { PermissionOverflowBox } from '../PermissionOverflowBox.js';
import { PermissionPreviewGutter } from '../PermissionPreviewGutter.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';
import { SedEditPermissionRequest } from '../SedEditPermissionRequest/SedEditPermissionRequest.js';
import { useShellPermissionFeedback } from '../useShellPermissionFeedback.js';
import { logUnaryPermissionEvent } from '../utils.js';
import { isBashAlwaysAllowVetoed, isBashCommandWithheld } from '../../../dialog/permissionBash.js';
import {
  BASH_AUTO_MODE_DESCRIPTION,
  BASH_AUTO_MODE_TIP,
  BASH_PERMISSION_PROMPT_UPSELL_TRIGGER,
  isBashAutoModeOfferBlocked,
  shouldShowBashAutoModeOption,
  useWorkflowAutoModeOffer,
  WORKFLOW_PERMISSION_PROMPT_TRIGGER,
} from '../../../dialog/permissionAutoMode.js';
import {
  resolvePermissionRequestSource,
  type PermissionRequestSourceContext,
} from '../../../dialog/permissionRequestSource.js';
import { bashToolUseOptions } from './bashToolUseOptions.js';

export function BashPermissionRequest(props: PermissionRequestProps): React.ReactNode {
  const { toolUseConfirm, toolUseContext, onDone, onReject, verbose, workerBadge } = props;

  const { command, description } = BashTool.inputSchema.parse(toolUseConfirm.input);

  // Detect sed in-place edit commands and delegate to SedEditPermissionRequest
  // This renders sed edits like file edits with a diff view
  const sedInfo = parseSedEditCommand(command);

  if (sedInfo) {
    return (
      <SedEditPermissionRequest
        toolUseConfirm={toolUseConfirm}
        toolUseContext={toolUseContext}
        onDone={onDone}
        onReject={onReject}
        verbose={verbose}
        workerBadge={workerBadge}
        sedInfo={sedInfo}
      />
    );
  }

  // Regular bash command - render with hooks
  return (
    <BashPermissionRequestInner
      toolUseConfirm={toolUseConfirm}
      toolUseContext={toolUseContext}
      onDone={onDone}
      onReject={onReject}
      verbose={verbose}
      workerBadge={workerBadge}
      command={command}
      description={description}
    />
  );
}

// Inner component that uses hooks - only called for non-MCP CLI commands
function BashPermissionRequestInner({
  toolUseConfirm,
  toolUseContext,
  onDone,
  onReject,
  verbose: _verbose,
  workerBadge,
  command,
  description,
}: PermissionRequestProps & {
  command: string;
  description?: string;
}): React.ReactNode {
  const [theme] = useTheme();
  const requestSource = resolvePermissionRequestSource(toolUseContext as PermissionRequestSourceContext);
  const { offered, canOfferAutoMode, enableAutoMode } = useWorkflowAutoModeOffer(requestSource);
  const bashOfferPayload = {
    requestId: toolUseConfirm.toolUseID,
    toolName: toolUseConfirm.tool.name,
    permissionResult: toolUseConfirm.permissionResult,
    command,
    input: toolUseConfirm.input,
    isAskCappedByOrg: toolUseConfirm.tool.mcpInfo?.effectiveMaxPermission === 'ask',
    requestSource,
  };
  const showEnableAutoModeOption = shouldShowBashAutoModeOption(
    isBashCommandWithheld(bashOfferPayload),
    isBashAlwaysAllowVetoed(bashOfferPayload),
    canOfferAutoMode,
    isBashAutoModeOfferBlocked(toolUseConfirm.permissionResult),
  );
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

  // GH#11380: For compound commands (cd src && git status && npm test), the
  // backend already computed correct per-subcommand suggestions via tree-sitter
  // split + per-subcommand permission checks. decisionReason.type ===
  // 'subcommandResults' marks this path. The sync prefix heuristics below
  // (getSimpleCommandPrefix/getFirstWordPrefix) operate on the FULL compound
  // string and pick the first two words — producing dead rules like
  // `Bash(cd src *)` or `Bash(./script.sh && npm test)` that never match again.
  // Users accumulate 150+ of these in settings.local.json.
  //
  // When compound with exactly one Bash rule (e.g. `cd src && npm test` where
  // cd is read-only → only npm test needs approval), seed the editable input
  // from the backend rule. When compound with 2+ rules, editablePrefix stays
  // undefined so bashToolUseOptions falls through to yes-apply-suggestions,
  // which saves all per-subcommand rules atomically.
  const isCompound = toolUseConfirm.permissionResult.decisionReason?.type === 'subcommandResults';

  // Editable prefix — initialize synchronously with the best prefix we can
  // extract without tree-sitter, then refine via tree-sitter for compound
  // commands. The sync path matters because TREE_SITTER_BASH is gated
  // ant-only: in external builds the async refinement below always resolves
  // to [] and this initial value is what the user sees.
  //
  // Lazy initializer: this runs regex + split on every render if left in
  // the render body; it's only needed for initial state.
  const [editablePrefix, setEditablePrefix] = useState<string | undefined>(() => {
    if (isCompound) {
      // Backend suggestion is the source of truth for compound commands.
      // Single rule → seed the editable input so the user can refine it.
      // Multiple/zero rules → undefined → yes-apply-suggestions handles it.
      const backendBashRules = extractRules(
        'suggestions' in toolUseConfirm.permissionResult ? toolUseConfirm.permissionResult.suggestions : undefined,
      ).filter(r => r.toolName === BashTool.name && r.ruleContent);
      return backendBashRules.length === 1 ? backendBashRules[0]!.ruleContent : undefined;
    }
    const two = getSimpleCommandPrefix(command);
    if (two) return `${two} *`;
    const one = getFirstWordPrefix(command);
    if (one) return `${one} *`;
    return command;
  });
  const hasUserEditedPrefix = useRef(false);
  const onEditablePrefixChange = useCallback((value: string) => {
    hasUserEditedPrefix.current = true;
    setEditablePrefix(value);
  }, []);
  useEffect(() => {
    // Skip async refinement for compound commands — the backend already ran
    // the full per-subcommand analysis and its suggestion is correct.
    if (isCompound) return;
    let cancelled = false;
    getCompoundCommandPrefixesStatic(command, subcmd => BashTool.isReadOnly({ command: subcmd }))
      .then(prefixes => {
        if (cancelled || hasUserEditedPrefix.current) return;
        if (prefixes.length > 0 && prefixes[0]) {
          setEditablePrefix(`${prefixes[0]} *`);
        }
      })
      .catch(() => {}); // Keep sync prefix on tree-sitter failure
    return () => {
      cancelled = true;
    };
  }, [command, isCompound]);

  const { destructiveWarning, sandboxingEnabled, isSandboxed } = useMemo(() => {
    const destructiveWarning = getFeatureValue_CACHED_MAY_BE_STALE('tengu_destructive_command_warning', false)
      ? getDestructiveCommandWarning(command)
      : null;

    const sandboxingEnabled = SandboxManager.isSandboxingEnabled();
    const isSandboxed = sandboxingEnabled && shouldUseSandbox(toolUseConfirm.input);

    return { destructiveWarning, sandboxingEnabled, isSandboxed };
  }, [command, toolUseConfirm.input]);

  const unaryEvent = useMemo<UnaryEvent>(() => ({ completion_type: 'tool_use_single', language_name: 'none' }), []);

  usePermissionRequestLogging(toolUseConfirm, unaryEvent);

  const options = useMemo(
    () =>
      bashToolUseOptions({
        suggestions:
          toolUseConfirm.permissionResult.behavior === 'ask' ? toolUseConfirm.permissionResult.suggestions : undefined,
        decisionReason: toolUseConfirm.permissionResult.decisionReason,
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
        showEnableAutoModeOption,
        enableAutoModeDescription: offered ? undefined : BASH_AUTO_MODE_DESCRIPTION,
      }),
    [
      toolUseConfirm,
      yesInputMode,
      noInputMode,
      editablePrefix,
      onEditablePrefixChange,
      showEnableAutoModeOption,
      offered,
    ],
  );

  function onSelect(value: string) {
    logEvent('tengu_permission_request_option_selected', {
      option_index: options.findIndex(o => o.value === value) + 1,
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
                toolName: BashTool.name,
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

    if (value === 'yes-enable-auto-mode') {
      enableAutoMode(offered ? WORKFLOW_PERMISSION_PROMPT_TRIGGER : BASH_PERMISSION_PROMPT_UPSELL_TRIGGER);
      const trimmedFeedback = acceptFeedback.trim();
      logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
      toolUseConfirm.onAllow(toolUseConfirm.input, [], trimmedFeedback || undefined);
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

  return (
    <PermissionDialog
      workerBadge={workerBadge}
      title={sandboxingEnabled && !isSandboxed ? 'Bash command (unsandboxed)' : 'Bash command'}
      subtitle={showEnableAutoModeOption ? <Text bold>{BASH_AUTO_MODE_TIP}</Text> : undefined}
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
          <Text>{BashTool.renderToolUseMessage({ command, description }, { theme, verbose: true })}</Text>
        </PermissionPreviewGutter>
      </PermissionOverflowBox>
      <Box flexDirection="column" paddingX={1}>
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
