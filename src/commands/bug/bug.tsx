import type { LocalJSXCommandContext } from '../../commands.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { callLegacyFeedbackDialog } from '../feedback/feedback.js';

/**
 * densable leftover `n` / `export{n as call}`.
 * `m==="share"?"/share":"/bug"` — no /feedback rename. Local /share stays gist.
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
  m?: string,
): Promise<React.ReactNode> {
  return callLegacyFeedbackDialog(onDone, context, args, m === 'share' ? '/share' : '/bug');
}
