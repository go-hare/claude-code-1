/**
 * densable $y0 — interactive /auto-mode-setup (local-jsx).
 * Gold: gold-wide-$y0.txt
 */
import React from 'react';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import type { RequestDialog } from '../../dialog/requestDialog.js';
import { findRunningAutoModeScan } from '../../tasks/AutoModeScanTask/AutoModeScanTask.js';
import { isAutoModeSetupWrappingUp, runBackgroundAutoModeSetup } from '../../services/autoModeSetup/background.js';
import { hasExistingAutoModeConfig } from '../../services/autoModeSetup/existing.js';
import { proposeAutoModeSetup } from '../../services/autoModeSetup/propose.js';
import { createAutoModeSetupWizardState } from '../../services/autoModeSetup/wizardState.js';
import { proposalToAutoModeWrite, saveAutoModeSetup } from '../../services/autoModeSetup/write.js';
import { AutoModeSetupWizard } from './AutoModeSetupWizard.js';

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  if (args.trim() !== '') {
    onDone(
      '/auto-mode-setup doesn’t take arguments — run it on its own to open the setup dialog. In non-interactive mode, use --propose / --apply-file.',
      { display: 'system' },
    );
    return null;
  }

  const tasks = context.getAppState().tasks ?? {};
  const running = findRunningAutoModeScan(tasks);
  if (isAutoModeSetupWrappingUp() || running) {
    onDone(
      running
        ? 'An auto-mode setup is already in progress — the proposal review will pop up when the scan finishes. (The scan shows in the background tasks list.)'
        : 'An auto-mode setup is already wrapping up — if its proposal review hasn’t popped up, answer it when it does; if you just stopped the scan, it’s winding down — try again in a moment.',
      { display: 'system' },
    );
    return null;
  }

  const done = (result?: string, options?: { display?: 'skip' | 'system' | 'user' }): void => {
    onDone(result, options);
  };

  const abort = new AbortController();
  const state = createAutoModeSetupWizardState(hasExistingAutoModeConfig());
  const requestDialog = context.requestDialog as RequestDialog | undefined;
  const permissionContext = context.getAppState().toolPermissionContext;

  return (
    <AutoModeSetupWizard
      state={state}
      onBackgroundStart={
        requestDialog
          ? answers => {
              void runBackgroundAutoModeSetup({
                answers,
                mode: state.mode,
                permissionContext,
                setAppState: context.setAppState,
                requestDialog,
                appendSystemMessage: context.appendSystemMessage
                  ? msg => {
                      // ToolUseContext Exclude<> currently collapses to never under tsc.
                      (context.appendSystemMessage as ((m: typeof msg) => void) | undefined)?.(msg);
                    }
                  : undefined,
              }).catch(() => {
                // llg already logs + appends; swallow so the fire-and-forget
                // path never surfaces an unhandled rejection.
              });
            }
          : undefined
      }
      propose={answers =>
        proposeAutoModeSetup(
          answers,
          permissionContext,
          AbortSignal.any([context.abortController.signal, abort.signal]),
        )
      }
      abort={() => abort.abort()}
      write={(proposal, mode) =>
        saveAutoModeSetup({
          mode,
          autoMode: proposalToAutoModeWrite(proposal),
        })
      }
      writeRemoval={rules => saveAutoModeSetup({ removeFromPermissionsAllow: rules })}
      onCancel={() => {
        done(undefined, { display: 'skip' });
      }}
      onDone={message => {
        done(message, { display: 'system' });
      }}
    />
  );
}
