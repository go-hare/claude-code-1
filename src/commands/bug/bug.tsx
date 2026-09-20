import type { LocalJSXCommandContext } from '../../commands.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { callLegacyFeedbackDialog } from '../feedback/feedback.js';

/** densable leftover en / callLegacyFeedbackDialog — never sr */
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode> {
  return callLegacyFeedbackDialog(onDone, context, args);
}
