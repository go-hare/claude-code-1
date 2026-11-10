/**
 * densable tyy / g8e — permission_powershell DialogHost renderer.
 *
 * Gold 2.1.289 g8e (replaces 2.1.239 tyy usePermissionExplainerUI / explainerState.chord):
 * Title `"PowerShell command"` (± unsandboxed). Esc/onCancel → `{behavior:"deny"}`.
 * lUA S3 + Z0s (brr directory grant when !classifierApprovable). EMs prefix is
 * Xxs(YAe seed, edited). Qgy async `YAe(\`${p} *\`)`. IOo + Mut
 * tab-amend footer. Gold `$e` Select (not o5). destructive GB.
 * Host answer; no dequeue.
 */
import { getDestructiveCommandWarning } from '@claude-code/builtin-tools/tools/PowerShellTool/destructiveCommandWarning.js';
import { isAllowlistedCommand } from '@claude-code/builtin-tools/tools/PowerShellTool/readOnlyValidation.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Byline, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { PermissionDialog } from '../../components/permissions/PermissionDialog.js';
import { PermissionOverflowBox } from '../../components/permissions/PermissionOverflowBox.js';
import { PermissionPreviewGutter } from '../../components/permissions/PermissionPreviewGutter.js';
import { type OptionWithDescription, Select } from '../../components/CustomSelect/select.js';
import { PermissionRuleExplanation } from '../../components/permissions/PermissionRuleExplanation.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { logEvent } from '../../services/analytics/index.js';
import { getCompoundCommandPrefixesStatic } from '../../utils/powershell/staticPrefix.js';
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js';
import type { DialogRendererProps } from '../DialogHost.js';
import { sanitizeEditablePrefix } from '../consentRow.js';
import { usePermissionSelectFeedback } from '../permissionSelectFeedback.js';
import {
  buildPowerShellSuggestionsRow,
  isPowerShellAlwaysAllowVetoed,
  isPowerShellCommandWithheld,
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

const MAX_DISPLAYED_NETWORK_HOSTS = 8;
const MAX_NETWORK_HOSTS_CHARS = 160;

function renderNetworkAllowHosts(hosts: readonly string[] | undefined): React.ReactNode {
  if (hosts === undefined || hosts.length === 0) return null;
  const first = hosts[0]!;
  const firstTrimmed =
    first.length > MAX_NETWORK_HOSTS_CHARS ? `…${first.slice(first.length - (MAX_NETWORK_HOSTS_CHARS - 1))}` : first;
  const shown = [firstTrimmed];
  let used = Math.min(shown[0]!.length + 2, MAX_NETWORK_HOSTS_CHARS / 2);
  for (const host of hosts.slice(1)) {
    if (shown.length >= MAX_DISPLAYED_NETWORK_HOSTS) break;
    if (used + host.length > MAX_NETWORK_HOSTS_CHARS) continue;
    shown.push(host);
    used += host.length + 2;
  }
  const remaining = hosts.length - shown.length;
  const more = remaining > 0 ? ` (+${remaining} more, ${hosts.length} in all)` : '';
  return (
    <Box marginBottom={1}>
      <Text>
        Also lets this command reach, beyond the sandbox allowlist: <Text bold>{shown.join(', ')}</Text>
        {more}
      </Text>
    </Box>
  );
}

export function PermissionPowerShellDialog({ payload, answer }: DialogRendererProps): React.ReactNode {
  const p = payload as PowerShellPermissionPayload & { networkAllowHosts?: readonly string[] };
  const row = shouldShowPowerShellPersistentAllow(p) ? buildPowerShellSuggestionsRow(p) : null;
  const withheld = isPowerShellCommandWithheld(p);
  const vetoed = isPowerShellAlwaysAllowVetoed(p);
  const preview = powerShellCommandPreview(p);
  const description = typeof p.description === 'string' ? p.description : '';
  const command =
    typeof (p.input as { command?: unknown } | undefined)?.command === 'string'
      ? (p.input as { command: string }).command
      : p.command;
  const destructiveWarning =
    !withheld && getFeatureValue_CACHED_MAY_BE_STALE('tengu_destructive_command_warning', false)
      ? getDestructiveCommandWarning(command)
      : null;
  const {
    acceptFeedback,
    rejectFeedback,
    setAcceptFeedback,
    setRejectFeedback,
    yesInputMode,
    noInputMode,
    showAmendHint,
    handleInputModeToggle,
    handleFocus,
    logSubmitted,
    logEscape,
  } = usePermissionSelectFeedback({
    toolName: p.toolName,
    isMcp: p.isMcp === true,
  });
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

  const options: OptionWithDescription<PowerShellPermissionChoice>[] = [];
  if (yesInputMode) {
    options.push({
      type: 'input',
      label: 'Yes',
      value: 'yes',
      placeholder: 'and tell Claude what to do next',
      onChange: setAcceptFeedback,
      allowEmptySubmitToCancel: true,
    });
  } else {
    options.push({ label: 'Yes', value: 'yes' });
  }
  if (row !== null) {
    const suggestions = row.applies;
    const canEditPrefix = !vetoed && editablePrefix !== undefined && !powerShellSuggestionsHaveNonShell(suggestions);
    if (canEditPrefix) {
      options.push({
        type: 'input',
        label: 'Yes, and don’t ask again for',
        value: 'yes-prefix-edited',
        placeholder: POWERSHELL_PREFIX_PLACEHOLDER,
        initialValue: editablePrefix,
        onChange: onEditablePrefixChange,
        allowEmptySubmitToCancel: true,
        showLabelWithValue: true,
        labelValueSeparator: ': ',
        resetCursorOnUpdate: true,
      });
    } else {
      options.push({
        label: row.node,
        value: 'yes-apply-suggestions',
      });
    }
  }
  if (noInputMode) {
    options.push({
      type: 'input',
      label: 'No',
      value: 'no',
      placeholder: 'and tell Claude what to do differently',
      onChange: setRejectFeedback,
      allowEmptySubmitToCancel: true,
    });
  } else {
    options.push({ label: 'No', value: 'no' });
  }

  return (
    <PermissionDialog title={powerShellCommandTitle(p)} requestSource={p.requestSource} innerPaddingX={0}>
      {description !== '' ? (
        <Box flexDirection="column" paddingX={1}>
          <PermissionPreviewGutter multiline={description.includes('\n')}>
            <Text dimColor>{description}</Text>
          </PermissionPreviewGutter>
        </Box>
      ) : null}
      <PermissionOverflowBox paddingX={1}>
        <PermissionPreviewGutter multiline={preview.kind === 'full' && preview.needsGutter}>
          {preview.kind === 'withheld' ? <Text dimColor>{preview.marker}</Text> : <Text>{preview.text}</Text>}
        </PermissionPreviewGutter>
      </PermissionOverflowBox>
      <Box flexDirection="column" paddingX={1}>
        {renderNetworkAllowHosts(p.networkAllowHosts)}
        <PermissionRuleExplanation permissionResult={p.permissionResult as PermissionDecision} toolType="command" />
        {destructiveWarning ? (
          <Box marginBottom={1}>
            <Text color="warning">{destructiveWarning}</Text>
          </Box>
        ) : null}
        <Text>Do you want to proceed?</Text>
        <Select
          options={options}
          inlineDescriptions
          onChange={choice => {
            logEvent('tengu_permission_request_option_selected', {
              option_index: options.findIndex(o => o.value === choice) + 1,
            });
            if (choice === 'yes') {
              const feedback = acceptFeedback.trim();
              logSubmitted('accept', feedback);
              answer(
                resolvePowerShellPermissionAnswer(choice, p, row, {
                  feedback: feedback || undefined,
                  editablePrefix,
                  editablePrefixSeed: prefixSeedRef.current,
                }),
              );
              return;
            }
            if (choice === 'no') {
              const feedback = rejectFeedback.trim();
              logSubmitted('reject', feedback);
              answer(
                resolvePowerShellPermissionAnswer(choice, p, row, {
                  feedback: feedback || undefined,
                }),
              );
              return;
            }
            answer(
              resolvePowerShellPermissionAnswer(choice, p, row, {
                editablePrefix,
                editablePrefixSeed: prefixSeedRef.current,
              }),
            );
          }}
          onCancel={() => {
            logEscape();
            answer({ behavior: 'deny' });
          }}
          onFocus={handleFocus}
          onInputModeToggle={handleInputModeToggle}
        />
      </Box>
      <Box justifyContent="space-between" marginTop={1} paddingX={1}>
        <Text dimColor>
          <Byline>
            <KeyboardShortcutHint shortcut="escape" action="cancel" />
            {showAmendHint ? <KeyboardShortcutHint shortcut="tab" action="amend" /> : null}
          </Byline>
        </Text>
      </Box>
    </PermissionDialog>
  );
}
