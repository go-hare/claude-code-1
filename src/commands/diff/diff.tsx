import type { LocalJSXCommandCall } from '../../types/command.js';
import { resolveDiffPresentation } from '../../utils/willowCrate.js';

/**
 * densable 2.1.283 `/diff` `call`:
 *   G0t(l.presentation, l.dispatchedAsImmediate)==="fullscreen"
 *     → toggleDiffPanel toast (null JSX)
 *     else DiffDialog
 */
export const call: LocalJSXCommandCall = async (onDone, context) => {
  const requested = context.presentation === 'fullscreen' ? 'fullscreen' : 'inline';
  if (resolveDiffPresentation(requested, context.dispatchedAsImmediate) === 'fullscreen') {
    const text = context.toggleDiffPanel
      ? await context.toggleDiffPanel()
      : (await import('../../utils/replDiffTab.js')).DIFF_PANEL_UNAVAILABLE_MESSAGE;
    onDone(text, { display: 'system' });
    return null;
  }
  const { DiffDialog } = await import('../../components/diff/DiffDialog.js');
  return <DiffDialog messages={context.messages} onDone={onDone} />;
};
