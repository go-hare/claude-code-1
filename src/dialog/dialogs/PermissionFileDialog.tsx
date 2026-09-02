/**
 * densable Mhy — permission_file DialogHost renderer.
 *
 * Gold 2.1.239: jsu `vM(S4t,Mhy)`. yhy + E$A standing mint. Y$A
 * minted applies. X$A bold fileName. J$A notebook verbose/120 +
 * `_ou` remoteOldContent/skipLocalRead. Th symlink. Esc/onCancel →
 * reject → deny. showingDiffInIDE doo KEEP. confirm:cycleMode
 * PermissionPrompt. Mut footer hint outside Cm. Host answer; no dequeue.
 */
import { relative } from 'path';
import React, { isValidElement, useCallback, useState } from 'react';
import { Box, Byline, KeyboardShortcutHint, Text } from '@anthropic/ink';
import { FileEditToolDiff } from '../../components/FileEditToolDiff.js';
import { PermissionDialog } from '../../components/permissions/PermissionDialog.js';
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js';
import { toTildePath } from '../../components/permissions/dontAskAgainLabel.js';
import { FileWriteToolDiff } from '../../components/permissions/FileWritePermissionRequest/FileWriteToolDiff.js';
import { NotebookEditToolDiff } from '../../components/permissions/NotebookEditPermissionRequest/NotebookEditToolDiff.js';
import { PermissionPrompt, type PermissionPromptOption } from '../../components/permissions/PermissionPrompt.js';
import { useAppState } from '../../state/AppState.js';
import type { NotebookCellType } from '../../types/notebook.js';
import { getCwd } from '../../utils/cwd.js';
import { isSupportedVSCodeTerminal } from '../../utils/ide.js';
import type { DialogRendererProps } from '../DialogHost.js';
import type { FilePermissionContent } from '../filePermissionPreview.js';
import {
  type FilePermissionChoice,
  type FilePermissionPayload,
  filePermissionDialogTitle,
  filePermissionQuestionNode,
  isFileStandingRowVetoed,
  mintFileStandingRow,
  resolveFilePermissionAnswer,
} from '../permissionFile.js';

function notebookCellType(raw: string | undefined): NotebookCellType | undefined {
  if (raw === 'code' || raw === 'markdown' || raw === 'raw') {
    return raw;
  }
  return undefined;
}

function withheldMessage(content: FilePermissionContent): string {
  return content.kind === 'no-changes' ? content.message : 'Proposed edits withheld';
}

function contentPreview(
  content: FilePermissionContent,
  withheld: boolean,
  payload: FilePermissionPayload,
): React.ReactNode {
  if (withheld) {
    return (
      <Box paddingX={1} marginBottom={1}>
        <Text dimColor>{withheldMessage(content)}</Text>
      </Box>
    );
  }
  switch (content.kind) {
    case 'no-changes':
      return (
        <Box paddingX={1} marginBottom={1}>
          <Text dimColor>{content.message}</Text>
        </Box>
      );
    case 'file-edit-diff':
      return (
        <FileEditToolDiff
          file_path={content.filePath}
          edits={content.edits}
          remoteOldContent={content.remoteOldContent}
          skipLocalRead={content.skipLocalRead}
        />
      );
    case 'file-write-diff':
      return (
        <FileWriteToolDiff
          file_path={content.filePath}
          content={content.content}
          fileExists={content.fileExists}
          oldContent={content.oldContent}
        />
      );
    case 'notebook-edit-diff':
      return (
        <NotebookEditToolDiff
          notebook_path={content.notebookPath}
          cell_id={content.cellId}
          new_source={content.newSource ?? ''}
          cell_type={notebookCellType(content.cellType)}
          edit_mode={content.editMode}
          verbose={true}
          width={120}
          oldCellSource={content.oldCellSource}
          remoteOldContent={content.remoteOldContent}
          skipLocalRead={content.skipLocalRead}
        />
      );
    case 'tool-use-line': {
      const name = typeof payload.userFacingName === 'string' ? payload.userFacingName : '';
      const rendered = payload.renderedToolUseMessage;
      const inner = typeof rendered === 'string' || isValidElement(rendered) ? rendered : '';
      return (
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          <Text>
            {name}({inner})
          </Text>
        </Box>
      );
    }
  }
}

function symlinkWarning(target: string | null): React.ReactNode {
  if (!target) return null;
  const outside = relative(getCwd(), target).startsWith('..');
  return (
    <Box paddingX={1} marginBottom={1}>
      <Text color="warning">
        {outside
          ? `This will modify ${toTildePath(target)} (outside working directory) via a symlink`
          : `Symlink target: ${toTildePath(target)}`}
      </Text>
    </Box>
  );
}

export function PermissionFileDialog({ payload, answer }: DialogRendererProps): React.ReactNode {
  const p = payload as FilePermissionPayload;
  const [showAmendHint, setShowAmendHint] = useState(false);
  const toolPermissionContext = useAppState(s => s.toolPermissionContext);
  const standingRowVetoed = isFileStandingRowVetoed(p);
  const standing = standingRowVetoed ? null : mintFileStandingRow(p.filePath, p.operationType, toolPermissionContext);
  const cycleShortcut = getShortcutDisplay('confirm:cycleMode', 'Confirmation', 'shift+tab');
  const standingLabel =
    standing === null ? null : standing.value === 'yes-session' && p.operationType !== 'read' ? (
      <Text>
        {standing.row.node} <Text bold>({cycleShortcut})</Text>
      </Text>
    ) : (
      standing.row.node
    );

  const options: PermissionPromptOption<FilePermissionChoice>[] = [
    { label: 'Yes', value: 'yes', feedbackConfig: { type: 'accept' } },
    ...(standing !== null && standingLabel !== null ? [{ label: standingLabel, value: standing.value }] : []),
    { label: 'No', value: 'no', feedbackConfig: { type: 'reject' } },
  ];

  const showingDiffInIDE = p.showingDiffInIDE === true;

  const cycleModeAction = useCallback(() => {
    if (standing === null) return;
    answer(resolveFilePermissionAnswer(standing.value, p, standing));
  }, [standing, answer, p]);

  return (
    <>
      <PermissionDialog
        title={filePermissionDialogTitle(p)}
        subtitle={p.subtitle}
        innerPaddingX={0}
        requestSource={p.requestSource}
      >
        {symlinkWarning(p.symlinkTarget)}
        {showingDiffInIDE
          ? isSupportedVSCodeTerminal() && (
              <Box paddingX={1} marginBottom={1}>
                <Text dimColor>Save file to continue…</Text>
              </Box>
            )
          : contentPreview(p.content, p.contentWithheld, p)}
        <Box flexDirection="column" paddingX={1}>
          <PermissionPrompt
            hostChrome
            onAmendHintChange={setShowAmendHint}
            options={options}
            question={filePermissionQuestionNode(p.question)}
            onSelect={(choice, feedback) => {
              answer(resolveFilePermissionAnswer(choice, p, standing, feedback));
            }}
            onCancel={() => {
              answer({ behavior: 'deny' });
            }}
            toolAnalyticsContext={{
              toolName: p.toolName,
              isMcp: p.isMcp === true,
            }}
            cycleModeAction={cycleModeAction}
          />
        </Box>
      </PermissionDialog>
      <Box paddingX={1} marginTop={1}>
        <Text dimColor>
          <Byline>
            <KeyboardShortcutHint shortcut="escape" action="cancel" />
            {showAmendHint ? <KeyboardShortcutHint shortcut="tab" action="amend" /> : null}
          </Byline>
        </Text>
      </Box>
    </>
  );
}
