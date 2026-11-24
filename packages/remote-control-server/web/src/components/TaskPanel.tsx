import type { AutomationState, SessionTaskItem } from '../types';
import { cn } from '../lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';

interface TaskPanelProps {
  tasks?: SessionTaskItem[];
  automationState?: AutomationState | null;
  onClose: () => void;
}

const TASK_STATUS_STYLES: Record<string, string> = {
  completed: 'bg-status-active/15 text-status-active',
  in_progress: 'bg-status-running/15 text-status-running',
  pending: 'bg-surface-3 text-text-secondary',
  failed: 'bg-status-error/15 text-status-error',
  error: 'bg-status-error/15 text-status-error',
};

export function TaskPanel({ tasks = [], automationState = null, onClose }: TaskPanelProps) {
  return (
    <Dialog
      open={true}
      onOpenChange={o => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="fixed inset-y-0 right-0 top-auto left-auto translate-x-0 translate-y-0 w-full sm:w-80 h-full max-w-none max-h-none rounded-none border-l border-border bg-surface-1 p-4 sm:max-w-sm flex flex-col gap-4 overflow-y-auto"
      >
        <DialogHeader className="flex flex-row items-center justify-between space-y-0">
          <DialogTitle className="font-display font-semibold text-text-primary">
            Tasks {tasks.length > 0 ? `(${tasks.length})` : ''}
          </DialogTitle>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text-primary transition-colors"
          >
            Close
          </button>
        </DialogHeader>

        {automationState?.enabled && (
          <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-text-secondary space-y-1">
            <div className="font-medium text-text-primary">Automation</div>
            <div>Phase: {automationState.phase ?? 'active'}</div>
          </div>
        )}

        {tasks.length === 0 ? (
          <div className="text-sm text-text-muted">No active tasks</div>
        ) : (
          <ul className="space-y-2">
            {tasks.map(task => (
              <li key={task.id} className="rounded-lg border border-border bg-surface-2/60 p-3 text-sm space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-text-primary leading-snug">{task.subject}</span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap flex-shrink-0',
                      TASK_STATUS_STYLES[task.status] ?? 'bg-surface-3 text-text-secondary',
                    )}
                  >
                    {task.status}
                  </span>
                </div>
                {task.description && <p className="text-xs text-text-muted leading-relaxed">{task.description}</p>}
                {task.owner && <div className="text-[11px] text-text-muted">Owner: {task.owner}</div>}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
