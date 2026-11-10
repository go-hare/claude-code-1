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
import { PermissionOverflowBox } from '../../components/permissions/PermissionOverflowBox.js';
import { PermissionPreviewGutter } from '../../components/permissions/PermissionPreviewGutter.js';
import {
  dontAskAgainMaxLabelWidthFromTracked,
  initialDontAskAgainSelectWidth,
} from '../../components/permissions/dontAskAgainLabel.js';
import {
  PermissionPrompt as BasePermissionPrompt,
  type PermissionPromptOption,
  type PermissionPromptProps,
} from '../../components/permissions/PermissionPrompt.js';
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

const PROMPT_DESCRIPTION_ROOMY_MAX_LINES = 16;
const PROMPT_DESCRIPTION_ROOMY_ROW_OVERHEAD = 24;
const PROMPT_DESCRIPTION_ROOMY_MIN_COLUMNS = 80;

const PermissionPrompt = BasePermissionPrompt as React.ComponentType<
  PermissionPromptProps<PromptPermissionChoice> & {
    defaultFocusValue?: PromptPermissionChoice;
    hideIndexes?: boolean;
  }
>;

function getPromptDescriptionLineCap(roomyDescription: boolean, size: { columns: number; rows: number }): number {
  return roomyDescription && size.columns >= PROMPT_DESCRIPTION_ROOMY_MIN_COLUMNS
    ? Math.max(
        PROMPT_DESCRIPTION_LINE_CAP,
        Math.min(PROMPT_DESCRIPTION_ROOMY_MAX_LINES, size.rows - PROMPT_DESCRIPTION_ROOMY_ROW_OVERHEAD),
      )
    : PROMPT_DESCRIPTION_LINE_CAP;
}

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
  const p = payload as PromptPermissionPayload & { roomyDescription?: boolean };
  const userFacingName =
    typeof p.userFacingName === 'string' && p.userFacingName !== '' ? p.userFacingName : p.toolName;
  const isMcp = p.isMcp === true;
  const { text: renderedText, withheld: previewWithheld } = previewRendered(p.renderedToolUseMessage);
  const { columns, rows } = useTerminalSize();
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
  const defaultToNo = (p.permissionResult as { defaultToNo?: boolean } | null | undefined)?.defaultToNo === true;
  const roomyDescription = p.roomyDescription === true;
  const lineCap = getPromptDescriptionLineCap(roomyDescription, { columns, rows });
  const prepared = formatPromptDescription(p.description);
  const descWidth = isMcp ? Math.max(10, nut - 2) : nut;
  const collapsed = clipWrappedLines(prepared, descWidth, lineCap);
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
  }, [columns, rows, userFacingName, cwd, withheld]);

  const row = useMemo(() => {
    if (!shouldShowPromptAlwaysAllow(p) || withheld) return null;
    return buildPromptDontAskAgainRow(p, {
      cwd,
      maxLabelWidth: dontAskAgainMaxLabelWidthFromTracked(trackedWidth, columns),
    });
  }, [p, withheld, cwd, trackedWidth, columns]);

  const yesOption: PermissionPromptOption<PromptPermissionChoice> = {
    label: 'Yes',
    value: 'yes',
    feedbackConfig: { type: 'accept' },
  };
  const noOption: PermissionPromptOption<PromptPermissionChoice> = {
    label: 'No',
    value: 'no',
    feedbackConfig: { type: 'reject' },
  };
  const options: PermissionPromptOption<PromptPermissionChoice>[] = defaultToNo ? [noOption, yesOption] : [yesOption];
  if (row !== null && typeof row.node === 'string') {
    options.push({
      label: row.node,
      value: 'yes-dont-ask-again',
    });
  }
  if (autoModeRow !== null) {
    options.push(autoModeRow);
  }
  if (!defaultToNo) {
    options.push(noOption);
  }

  const description = expanded ? expandedText : collapsed;
  const descriptionNode =
    description !== '' ? (
      <Box
        width="100%"
        flexDirection="column"
        paddingX={1}
        marginTop={mcpRows?.length === 0 ? 1 : 0}
        marginBottom={isMcp ? 1 : 0}
      >
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
    ) : null;

  const topNode = isMcp ? (
    <Box flexDirection="row" paddingX={1} marginBottom={mcpRows?.length === 0 && collapsed === '' ? 1 : 0}>
      <Text wrap="truncate-end">
        <Text bold>{userFacingName} Tool:</Text>
      </Text>
      {p.hasMcpSuffix === true ? (
        <Box flexShrink={0}>
          <Text dimColor> (MCP)</Text>
        </Box>
      ) : null}
    </Box>
  ) : (
    descriptionNode
  );

  const previewNode =
    mcpRows === null || mcpRows.length > 0 ? (
      <PermissionOverflowBox>
        {mcpRows !== null ? (
          <McpParamTable entries={mcpRows} contentColumns={nut} />
        ) : (
          <PermissionPreviewGutter
            multiline={!withheld && renderedText !== '' && `${userFacingName}(${renderedText})`.includes('\n')}
          >
            {withheld ? (
              <Text dimColor>{renderedText || APPROVAL_WITHHELD_MARKER}</Text>
            ) : (
              <Text>
                {userFacingName}
                {renderedText !== '' ? `(${renderedText})` : null}
                {p.hasMcpSuffix === true ? <Text dimColor> (MCP)</Text> : null}
              </Text>
            )}
          </PermissionPreviewGutter>
        )}
      </PermissionOverflowBox>
    ) : null;

  return (
    <IiuTranscriptToggleScope active={canExpand} onToggle={toggleDescription}>
      <PermissionDialog title="Tool use" innerPaddingX={0} requestSource={p.requestSource}>
        <Box ref={contentRef} width="100%" flexDirection="column">
          {topNode}
          {previewNode}
          {isMcp ? descriptionNode : null}
        </Box>
        <Box flexDirection="column" paddingX={1}>
          <PermissionRuleExplanation permissionResult={p.permissionResult as PermissionDecision} toolType="tool" />
          <PermissionPrompt
            options={options}
            defaultFocusValue={defaultToNo ? 'no' : undefined}
            hideIndexes={defaultToNo}
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
