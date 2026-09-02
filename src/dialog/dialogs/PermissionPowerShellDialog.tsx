/**
 * densable tyy — permission_powershell DialogHost renderer.
 *
 * Gold 2.1.239: jsu `vM($no,tyy)`. Title `"PowerShell command"` (± unsandboxed).
 * Esc/onCancel → `{behavior:"deny"}`. lUA S3 + Z0s. EMs prefix is
 * Xxs(YAe seed, edited). Qgy async `YAe(\`${p} *\`)`. IOo + Mut
 * tab-amend footer. destructive GB. Host answer; no dequeue.
 */
import { getDestructiveCommandWarning } from '@claude-code/builtin-tools/tools/PowerShellTool/destructiveCommandWarning.js';
import { isAllowlistedCommand } from '@claude-code/builtin-tools/tools/PowerShellTool/readOnlyValidation.js';
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
import { getCompoundCommandPrefixesStatic } from '../../utils/powershell/staticPrefix.js';
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js';
import type { DialogRendererProps } from '../DialogHost.js';
import { type UrlPreview } from '../permissionBrowser.js';
import { sanitizeEditablePrefix } from '../consentRow.js';
import {
  buildPowerShellSuggestionsRow,
  POWERSHELL_PREFIX_PLACEHOLDER,
  type PowerShellPermissionChoice,
  type PowerShellPermissionPayload,
  powerShellCommandPreview,
  powerShellCommandTitle,
  powerShellSuggestionsHaveNonShell,
  resolvePowerShellPermissionAnswer,
  seedPowerShellEditablePrefix,
  shouldShowPowerShellPersistentAllow,
} from '../permissionPowerShell.js';

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

export function PermissionPowerShellDialog({ payload, answer }: DialogRendererProps): React.ReactNode {
  const p = payload as PowerShellPermissionPayload;
  const row = shouldShowPowerShellPersistentAllow(p) ? buildPowerShellSuggestionsRow(p) : null;
  const preview = powerShellCommandPreview(p);
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
  const [editablePrefix, setEditablePrefix] = useState<string | undefined>(() => seedPowerShellEditablePrefix(p));
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
  useEffect(() => {
    let cancelled = false;
    getCompoundCommandPrefixesStatic(command, element => isAllowlistedCommand(element, element.text))
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
  }, [command]);

  const options: PermissionPromptOption<PowerShellPermissionChoice>[] = [
    { label: 'Yes', value: 'yes', feedbackConfig: { type: 'accept' } },
  ];
  if (row !== null) {
    const suggestions = row.applies;
    const canEditPrefix = editablePrefix !== undefined && !powerShellSuggestionsHaveNonShell(suggestions);
    if (canEditPrefix) {
      options.push({
        label: 'Yes, and don’t ask again for',
        value: 'yes-prefix-edited',
        inputConfig: {
          placeholder: POWERSHELL_PREFIX_PLACEHOLDER,
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
  options.push({
    label: 'No',
    value: 'no',
    feedbackConfig: { type: 'reject' },
  });

  return (
    <PermissionDialog title={powerShellCommandTitle(p)} requestSource={p.requestSource}>
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
            <Text color="warning">{destructiveWarning}</Text>
          </Box>
        ) : null}
        <Text>Do you want to proceed?</Text>
        <PermissionPrompt
          hostChrome
          onAmendHintChange={setShowAmendHint}
          options={options}
          onSelect={(choice, feedback) => {
            answer(
              resolvePowerShellPermissionAnswer(choice, p, row, {
                feedback,
                editablePrefix,
                editablePrefixSeed: prefixSeedRef.current,
              }),
            );
          }}
          onCancel={() => {
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
