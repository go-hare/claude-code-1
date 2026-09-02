/**
 * densable Cmy — permission_bash DialogHost renderer.
 *
 * Gold 2.1.239: jsu `vM(Byr,Cmy)`. Title `"Bash command"` (± unsandboxed).
 * Esc/onCancel → `{behavior:"deny"}`. jNA S3 + Z0s label. $Oo prefix is
 * Xxs(YAe seed, edited). Qgy async seed `YAe(\`${p} *\`)`. IOo +
 * Mut tab-amend footer. destructive GB. m0n workflow auto-mode.
 * Host answer; no dequeue.
 */
import { getDestructiveCommandWarning } from '@claude-code/builtin-tools/tools/BashTool/destructiveCommandWarning.js';
import { BashTool } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js';
import figures from 'figures';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Byline, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { PermissionDialog } from '../../components/permissions/PermissionDialog.js';
import {
  PermissionExplainerContent,
  usePermissionExplainerUI,
} from '../../components/permissions/PermissionExplanation.js';
import { PermissionPrompt, type PermissionPromptOption } from '../../components/permissions/PermissionPrompt.js';
import { PermissionRuleExplanation } from '../../components/permissions/PermissionRuleExplanation.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { getCompoundCommandPrefixesStatic } from '../../utils/bash/prefix.js';
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js';
import type { DialogRendererProps } from '../DialogHost.js';
import { type UrlPreview } from '../permissionBrowser.js';
import { sanitizeEditablePrefix } from '../consentRow.js';
import {
  BASH_PREFIX_PLACEHOLDER,
  bashCommandPreview,
  bashCommandTitle,
  type BashPermissionChoice,
  type BashPermissionPayload,
  bashSuggestionsHaveNonBash,
  buildBashSuggestionsRow,
  resolveBashPermissionAnswer,
  seedBashEditablePrefix,
  shouldShowBashPersistentAllow,
  isBashAlwaysAllowVetoed,
  isBashCommandWithheld,
} from '../permissionBash.js';
import {
  shouldShowWorkflowAutoModeOption,
  useWorkflowAutoModeOffer,
  workflowAutoModeSelectOption,
} from '../permissionAutoMode.js';

function previewNode(preview: UrlPreview): React.ReactNode {
  if (preview.kind === 'withheld') {
    return <Text dimColor>{preview.marker}</Text>;
  }
  return (
    <Box flexDirection={preview.needsGutter ? 'column' : 'row'}>
      <Text>{preview.text}</Text>
    </Box>
  );
}

export function PermissionBashDialog({ payload, answer }: DialogRendererProps): React.ReactNode {
  const p = payload as BashPermissionPayload;
  const row = shouldShowBashPersistentAllow(p) ? buildBashSuggestionsRow(p) : null;
  const { offered, enableAutoMode } = useWorkflowAutoModeOffer(p.requestSource);
  const autoModeRow = shouldShowWorkflowAutoModeOption(offered, isBashCommandWithheld(p), isBashAlwaysAllowVetoed(p))
    ? workflowAutoModeSelectOption()
    : null;
  const preview = bashCommandPreview(p);
  const description = typeof p.description === 'string' ? p.description : '';
  const command =
    typeof (p.input as { command?: unknown } | undefined)?.command === 'string'
      ? (p.input as { command: string }).command
      : p.command;
  const explainerState = usePermissionExplainerUI({
    toolName: p.toolName,
    toolInput: p.input,
    toolDescription: p.description,
    messages: [],
  });
  const destructiveWarning = getFeatureValue_CACHED_MAY_BE_STALE('tengu_destructive_command_warning', false)
    ? getDestructiveCommandWarning(command)
    : null;
  const [showAmendHint, setShowAmendHint] = useState(false);
  const [editablePrefix, setEditablePrefix] = useState<string | undefined>(() => seedBashEditablePrefix(p));
  const prefixSeedRef = useRef<string | undefined>(undefined);
  const seedPaintedRef = useRef(false);
  if (!seedPaintedRef.current) {
    seedPaintedRef.current = true;
    prefixSeedRef.current = sanitizeEditablePrefix(editablePrefix);
  }
  const hasUserEditedPrefix = useRef(false);
  const onEditablePrefixChange = useCallback((value: string) => {
    hasUserEditedPrefix.current = true;
    setEditablePrefix(value);
  }, []);
  const isCompound =
    (p.permissionResult as { decisionReason?: { type?: string } } | null)?.decisionReason?.type === 'subcommandResults';
  useEffect(() => {
    if (isCompound) return;
    let cancelled = false;
    getCompoundCommandPrefixesStatic(command, subcmd => BashTool.isReadOnly({ command: subcmd }))
      .then(prefixes => {
        if (cancelled || hasUserEditedPrefix.current) return;
        if (prefixes.length === 0 || !prefixes[0]) return;
        const next = sanitizeEditablePrefix(`${prefixes[0]} *`);
        if (next !== undefined) {
          prefixSeedRef.current = next;
          setEditablePrefix(next);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [command, isCompound]);

  const classifierState = p.classifierState;
  const classifierApproved = classifierState === 'approved';
  const classifierChecking = classifierState === 'checking';
  const classifierSubtitle = classifierApproved ? (
    <Text>
      <Text color="success">{figures.tick} Auto-approved</Text>
    </Text>
  ) : classifierChecking ? (
    <Text dimColor>Attempting to auto-approve{'\u2026'}</Text>
  ) : undefined;

  const options: PermissionPromptOption<BashPermissionChoice>[] = [
    { label: 'Yes', value: 'yes', feedbackConfig: { type: 'accept' } },
  ];
  if (row !== null) {
    const suggestions = row.applies;
    const canEditPrefix =
      editablePrefix !== undefined && !bashSuggestionsHaveNonBash(suggestions) && suggestions.length > 0;
    if (canEditPrefix) {
      options.push({
        label: 'Yes, and don’t ask again for',
        value: 'yes-prefix-edited',
        inputConfig: {
          placeholder: BASH_PREFIX_PLACEHOLDER,
          initialValue: editablePrefix,
          onChange: onEditablePrefixChange,
          allowEmptySubmitToCancel: true,
          showLabelWithValue: true,
          labelValueSeparator: ': ',
          resetCursorOnUpdate: true,
        },
      });
    } else {
      options.push({
        label: row.node,
        value: 'yes-apply-suggestions',
      });
    }
  }
  if (autoModeRow !== null) {
    options.push(autoModeRow);
  }
  options.push({
    label: 'No',
    value: 'no',
    feedbackConfig: { type: 'reject' },
  });

  return (
    <PermissionDialog title={bashCommandTitle(p)} subtitle={classifierSubtitle} requestSource={p.requestSource}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box flexDirection={preview.kind === 'withheld' || preview.needsGutter ? 'column' : 'row'}>
          {explainerState.visible ? (
            <Text dimColor>{preview.kind === 'withheld' ? preview.marker : preview.text}</Text>
          ) : (
            previewNode(preview)
          )}
        </Box>
        {!explainerState.visible && description !== '' ? <Text dimColor>{description}</Text> : null}
        <PermissionExplainerContent visible={explainerState.visible} promise={explainerState.promise} />
      </Box>
      <Box flexDirection="column">
        <PermissionRuleExplanation permissionResult={p.permissionResult as PermissionDecision} toolType="command" />
        {destructiveWarning ? (
          <Box marginBottom={1}>
            <Text color="warning" dimColor={classifierApproved}>
              {destructiveWarning}
            </Text>
          </Box>
        ) : null}
        <Text dimColor={classifierApproved}>Do you want to proceed?</Text>
        <PermissionPrompt
          hostChrome
          isDisabled={classifierApproved}
          onAmendHintChange={setShowAmendHint}
          options={options}
          onSelect={(choice, feedback) => {
            if (classifierApproved) return;
            if (choice === 'yes-enable-auto-mode') enableAutoMode();
            answer(
              resolveBashPermissionAnswer(choice, p, row, {
                feedback,
                editablePrefix,
                editablePrefixSeed: prefixSeedRef.current,
              }),
            );
          }}
          onCancel={() => {
            if (classifierApproved) return;
            answer({ behavior: 'deny' });
          }}
          toolAnalyticsContext={{
            toolName: p.toolName,
            isMcp: p.isMcp === true,
          }}
        />
      </Box>
      <Box justifyContent="space-between" marginTop={1}>
        <Text dimColor>
          <Byline>
            <KeyboardShortcutHint shortcut="escape" action="cancel" />
            {showAmendHint ? <KeyboardShortcutHint shortcut="tab" action="amend" /> : null}
            {explainerState.enabled ? (
              <KeyboardShortcutHint
                shortcut={explainerState.chord}
                action={explainerState.visible ? 'hide' : 'explain'}
              />
            ) : null}
          </Byline>
        </Text>
      </Box>
    </PermissionDialog>
  );
}
