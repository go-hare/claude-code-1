/**
 * densable Iiu — permission_prompt DialogHost renderer (workflow → same analog).
 *
 * Gold 2.1.239: jsu `vM(bEt,Iiu)`. Esc/onCancel → `{behavior:"cancelled"}`.
 * Title `"Tool use"`. fiu MCP table + CFn(Kgy=2) + ctrl+o expand.
 * m0n auto-mode: workflow-agent + FKe → DPo("workflow"). Host answer.
 */
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { Box, type DOMElement, KeyboardShortcutHint, measureElement, Text } from '@anthropic/ink';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { PermissionDialog } from '../../components/permissions/PermissionDialog.js';
import {
  dontAskAgainMaxLabelWidthFromTracked,
  initialDontAskAgainSelectWidth,
} from '../../components/permissions/dontAskAgainLabel.js';
import { PermissionPrompt, type PermissionPromptOption } from '../../components/permissions/PermissionPrompt.js';
import { PermissionRuleExplanation } from '../../components/permissions/PermissionRuleExplanation.js';
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js';
import type { DialogRendererProps } from '../DialogHost.js';
import { APPROVAL_WITHHELD_MARKER, previewUrlString } from '../permissionBrowser.js';
import {
  buildMcpParamTable,
  clipWrappedLines,
  isUnrenderableEntry,
  McpParamTable,
  PROMPT_DESCRIPTION_LINE_CAP,
} from '../permissionMcpTable.js';
import {
  buildPromptDontAskAgainRow,
  formatPromptDescription,
  isPromptAlwaysAllowVetoed,
  type PromptPermissionChoice,
  type PromptPermissionPayload,
  resolvePromptPermissionAnswer,
  shouldShowPromptAlwaysAllow,
} from '../permissionPromptIiu.js';
import {
  shouldShowWorkflowAutoModeOption,
  useWorkflowAutoModeOffer,
  workflowAutoModeSelectOption,
} from '../permissionAutoMode.js';

function previewRendered(rendered: unknown): { text: string; withheld: boolean } {
  if (typeof rendered !== 'string') {
    return { text: '', withheld: false };
  }
  const preview = previewUrlString(rendered);
  if (preview === null || preview.kind === 'withheld') {
    return {
      text: preview?.marker ?? APPROVAL_WITHHELD_MARKER,
      withheld: true,
    };
  }
  return { text: preview.text.replace(/\s+/g, ' ').trim(), withheld: false };
}

export function PermissionPromptDialog({ payload, answer }: DialogRendererProps): React.ReactNode {
  const p = payload as PromptPermissionPayload;
  const userFacingName =
    typeof p.userFacingName === 'string' && p.userFacingName !== '' ? p.userFacingName : p.toolName;
  const isMcp = p.isMcp === true;
  const { text: renderedText, withheld: previewWithheld } = previewRendered(p.renderedToolUseMessage);
  const { columns } = useTerminalSize();
  const contentRef = useRef<DOMElement>(null);
  const [trackedWidth, setTrackedWidth] = useState(() => initialDontAskAgainSelectWidth(columns));
  const nut = Math.min(trackedWidth, Math.max(20, columns - 6));
  const mcpRows = useMemo(
    () => (isMcp ? buildMcpParamTable(p.input, p.paramFormatHints, nut) : null),
    [isMcp, p.input, p.paramFormatHints, nut],
  );
  const mcpUnrenderable = mcpRows?.some(isUnrenderableEntry) ?? false;
  const withheld = mcpUnrenderable || p.toolUseRenderFailed === true || previewWithheld;
  const { offered, enableAutoMode } = useWorkflowAutoModeOffer(p.requestSource);
  const autoModeRow = shouldShowWorkflowAutoModeOption(offered, withheld, isPromptAlwaysAllowVetoed(p))
    ? workflowAutoModeSelectOption()
    : null;
  const prepared = formatPromptDescription(p.description);
  const descWidth = isMcp ? Math.max(10, nut - 2) : nut;
  const collapsed = clipWrappedLines(prepared, descWidth, PROMPT_DESCRIPTION_LINE_CAP);
  const expandedText = clipWrappedLines(prepared, descWidth, Number.MAX_SAFE_INTEGER);
  const canExpand = expandedText !== collapsed;
  const [expanded, setExpanded] = useState(false);
  const toggleDescription = useCallback(() => {
    setExpanded(current => !current);
  }, []);
  const expandShortcut = useShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o');
  const cwd = getOriginalCwd();

  useLayoutEffect(() => {
    if (!contentRef.current) return;
    const { width } = measureElement(contentRef.current);
    if (width > 0) {
      setTrackedWidth(Math.max(20, width - 2));
    }
  }, [columns, userFacingName, cwd, withheld]);

  const row = useMemo(() => {
    if (!shouldShowPromptAlwaysAllow(p) || withheld) return null;
    return buildPromptDontAskAgainRow(p, {
      cwd,
      maxLabelWidth: dontAskAgainMaxLabelWidthFromTracked(trackedWidth, columns),
    });
  }, [p, withheld, cwd, trackedWidth, columns]);

  const options: PermissionPromptOption<PromptPermissionChoice>[] = [
    { label: 'Yes', value: 'yes', feedbackConfig: { type: 'accept' } },
  ];
  if (row !== null && typeof row.node === 'string') {
    options.push({
      label: row.node,
      value: 'yes-dont-ask-again',
    });
  }
  if (autoModeRow !== null) {
    options.push(autoModeRow);
  }
  options.push({
    label: 'No',
    value: 'no',
    feedbackConfig: { type: 'reject' },
  });

  const description = expanded ? expandedText : collapsed;
  const header = isMcp ? (
    <Box flexDirection="row">
      <Text wrap="truncate-end">
        <Text bold>{userFacingName} Tool:</Text>
      </Text>
      {p.hasMcpSuffix === true ? (
        <Box flexShrink={0}>
          <Text dimColor> (MCP)</Text>
        </Box>
      ) : null}
    </Box>
  ) : withheld ? (
    <Text dimColor>{renderedText || APPROVAL_WITHHELD_MARKER}</Text>
  ) : (
    <Text>
      {userFacingName}
      {renderedText !== '' ? `(${renderedText})` : null}
      {p.hasMcpSuffix === true ? <Text dimColor> (MCP)</Text> : null}
    </Text>
  );

  return (
    <IiuTranscriptToggleScope active={canExpand} onToggle={toggleDescription}>
      <PermissionDialog title="Tool use" requestSource={p.requestSource}>
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          {header}
          <Box ref={contentRef} width="100%" flexDirection="column">
            {mcpRows !== null ? <McpParamTable entries={mcpRows} contentColumns={nut} /> : null}
            {description !== '' ? (
              <Box width="100%" flexDirection="column" marginTop={isMcp ? 1 : 0}>
                {isMcp ? (
                  <Text italic wrap="truncate-end">
                    About the <Text bold>{userFacingName}</Text> Tool:
                  </Text>
                ) : null}
                <Box
                  borderStyle="single"
                  borderLeft
                  borderRight={false}
                  borderTop={false}
                  borderBottom={false}
                  borderDimColor
                  paddingLeft={1}
                >
                  <Text dimColor italic={isMcp}>
                    {description}
                  </Text>
                </Box>
                {canExpand ? (
                  <Text dimColor>
                    <KeyboardShortcutHint
                      shortcut={expandShortcut}
                      action={expanded ? 'collapse description' : 'expand description'}
                      parens
                    />
                  </Text>
                ) : null}
              </Box>
            ) : null}
          </Box>
        </Box>
        <Box flexDirection="column">
          <PermissionRuleExplanation permissionResult={p.permissionResult as PermissionDecision} toolType="tool" />
          <PermissionPrompt
            options={options}
            onSelect={(choice, feedback) => {
              if (choice === 'yes-enable-auto-mode') enableAutoMode();
              answer(resolvePromptPermissionAnswer(choice, p, row, feedback));
            }}
            onCancel={() => {
              answer({ behavior: 'cancelled' });
            }}
            toolAnalyticsContext={{
              toolName: p.toolName,
              isMcp,
            }}
          />
        </Box>
      </PermissionDialog>
    </IiuTranscriptToggleScope>
  );
}

/**
 * DualInk analog of Iiu `uSt({bindings:[{action:"app:toggleTranscript",run}], active:iLo})`.
 * Ink Box has no keybindingScope/onAction; prepend consumes before Global transcript.
 */
function IiuTranscriptToggleScope({
  active,
  onToggle,
  children,
}: {
  active: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.ReactNode {
  useKeybinding('app:toggleTranscript', onToggle, {
    context: 'Confirmation',
    isActive: active,
    prepend: true,
  });
  return <Box flexDirection="column">{children}</Box>;
}
