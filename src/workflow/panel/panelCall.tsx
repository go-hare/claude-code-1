import React from 'react';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { SentryErrorBoundary } from '../../components/SentryErrorBoundary.js';
import { BackgroundTasksDialog } from '../../components/tasks/BackgroundTasksDialog.js';
import { WorkflowHistoryDialog } from './WorkflowHistoryDialog.js';

/**
 * densable /workflows (GsK): browse dynamic workflow history (running + completed).
 * Live phase/agent monitor is Shift+Down Tasks → WorkflowDetailDialog (fv_).
 * Enter on a live history row swaps into BackgroundTasksDialog(initialDetailTaskId).
 */
export const call: LocalJSXCommandCall = async (onDone, context, _args) => {
  type View = { kind: 'history' } | { kind: 'liveDetail'; taskId: string };

  function Host({ initial }: { initial: View }): React.ReactNode {
    const [view, setView] = React.useState<View>(initial);

    if (view.kind === 'liveDetail') {
      return (
        <SentryErrorBoundary name="WorkflowLiveDetail">
          <BackgroundTasksDialog
            toolUseContext={context}
            initialDetailTaskId={view.taskId}
            onDone={msg => {
              if (msg) onDone(msg, { display: 'system' });
              else onDone();
            }}
          />
        </SentryErrorBoundary>
      );
    }

    return (
      <SentryErrorBoundary name="WorkflowHistoryDialog">
        <WorkflowHistoryDialog
          onDone={msg => {
            if (msg) onDone(msg, { display: 'system' });
            else onDone();
          }}
          onOpenLiveDetail={taskId => {
            setView({ kind: 'liveDetail', taskId });
          }}
        />
      </SentryErrorBoundary>
    );
  }

  return <Host initial={{ kind: 'history' }} />;
};
