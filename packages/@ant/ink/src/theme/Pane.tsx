import React, { createContext, useContext } from 'react';
import { useIsInsideModal } from './modalContext.js';
import { Box } from '../index.js';
import type { Theme } from './theme-types.js';
import { Divider } from './Divider.js';

/** Official 2.1.328 `Fk = 0` (@308177712) — Pane paddingX when inside modal or nested Pane */
export const PANE_PADDING_X_MODAL = 0;
/** Official 2.1.328 `gm = 2` (@308177712) — Pane paddingX when inline (not modal) */
export const PANE_PADDING_X_INLINE = 2;
/**
 * Official 2.1.328 `vQ = 2` (@308177712) — extra urlOutdent when inside modal.
 * Equals FullscreenLayout / ModalScroller horizontal paddingX.
 */
export const MODAL_LAYOUT_PADDING_X = 2;

/**
 * Official 2.1.328 `Ccn` (@308177712) — tracks whether rendering inside an
 * outer inline `<Pane>` so nested `<Pane>` components omit redundant divider
 * and horizontal padding.
 */
const NestedPaneContext = createContext(false);

type PaneProps = {
  children: React.ReactNode;
  /**
   * Theme color for the top border line.
   */
  color?: keyof Theme;
  /**
   * Official 2.1.328 `Ig.insetX` — optional horizontal padding override.
   */
  insetX?: number;
};

/**
 * A pane — a region of the terminal that appears below the REPL prompt,
 * bounded by a colored top line with a one-row gap above and horizontal
 * padding. Used by all slash-command screens: /config, /help, /plugins,
 * /sandbox, /stats, /permissions.
 *
 * For confirm/cancel dialogs (Esc to dismiss, Enter to confirm), use
 * `<Dialog>` instead — it registers its own keybindings. For a full
 * rounded-border card, use `<Panel>`.
 *
 * Submenus rendered inside a Pane should use `hideBorder` on their Dialog
 * so the Pane's border remains the single frame.
 *
 * @example
 * <Pane color="permission">
 *   <Tabs title="Sandbox:">...</Tabs>
 * </Pane>
 */
export function Pane({ children, color, insetX }: PaneProps): React.ReactNode {
  const isNested = useContext(NestedPaneContext);
  // When rendered inside FullscreenLayout's modal slot (its ▔ divider IS
  // the frame) or nested inside another Pane, skip our own Divider (would
  // double-frame) and the extra top/horizontal padding. Fullscreen modals get
  // 2 cols/side total from ModalScroller (`vQ = 2`) + `PANE_PADDING_X_MODAL = 0`.
  if (useIsInsideModal() || isNested) {
    // flexShrink=0: the modal slot's absolute Box has no explicit height
    // (grows to fit, maxHeight cap). With flexGrow=1, re-renders cause
    // yoga to resolve this Box's height to 0 against the undetermined
    // parent — /permissions body blanks on Down arrow. See #23592.
    // densable 2.1.216 #23: minWidth=0 so dialog children clamp to the
    // modal panel width (FullscreenLayout paddingX=2) instead of stretching
    // past the right-hand edge.
    const paddingX = insetX ?? PANE_PADDING_X_MODAL;
    return (
      <Box flexDirection="column" paddingX={paddingX} flexShrink={0} minWidth={0} width="100%">
        {children}
      </Box>
    );
  }
  const paddingX = insetX ?? PANE_PADDING_X_INLINE;
  return (
    <Box flexDirection="column" paddingTop={1} minWidth={0} width="100%">
      <Divider color={color} />
      <Box flexDirection="column" paddingX={paddingX} minWidth={0} width="100%">
        <NestedPaneContext.Provider value={true}>{children}</NestedPaneContext.Provider>
      </Box>
    </Box>
  );
}
