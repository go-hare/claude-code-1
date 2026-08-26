import { getIsRemoteMode } from '../../bootstrap/state.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { isWillowCrateEnabled } from '../../utils/willowCrate.js';

/**
 * densable `uH0`:
 *   !wa() && Vs() && (P6e() || dispatchedAsImmediate) → h0c
 *   else DiffDialog
 */
export const call: LocalJSXCommandCall = async (onDone, context) => {
  if (!getIsRemoteMode() && isFullscreenEnvEnabled() && (isWillowCrateEnabled() || context.dispatchedAsImmediate)) {
    const { ToggleDiffSidebar } = await import('../../components/diff/ToggleDiffSidebar.js');
    return <ToggleDiffSidebar onDone={onDone} />;
  }
  const { DiffDialog } = await import('../../components/diff/DiffDialog.js');
  return <DiffDialog messages={context.messages} onDone={onDone} />;
};
