/**
 * App-side re-export of the single ModalContext from @anthropic/ink.
 *
 * FullscreenLayout provides ModalContext; Pane/Tabs inside ink read the same
 * createContext instance via their package-local import. Keeping a second
 * createContext here used to break useIsInsideModal() (always false) so Pane
 * drew its own Divider on top of FullscreenLayout's ▔ — double top border on
 * /permissions, /config, etc.
 *
 * Prefer importing from `@anthropic/ink` for new code. This path remains for
 * existing app imports under `src/context/modalContext.js`.
 */
import { useContext } from 'react';
import { ModalContext, type ScrollViewport } from '@anthropic/ink';

/**
 * Official 2.1.328 `Xc` / `Q_` modal context payload including `revealEnd`,
 * which snaps the modal ScrollBox to the bottom and suppresses the top `↑`
 * scroll hint while held at the end.
 */
export type ModalContextValue = {
  rows: number;
  columns: number;
  scrollViewport: ScrollViewport | null;
  claimScrollBox?: ((height: number | null) => void) | null;
  revealEnd?: () => () => void;
};

/**
 * Official 2.1.328 `be(Q_)?.revealEnd`: returns ModalScroller's revealEnd
 * callback from the single `@anthropic/ink` ModalContext instance.
 */
export function useModalRevealEnd(): (() => () => void) | undefined {
  const ctx = useContext(ModalContext) as ModalContextValue | null;
  return ctx?.revealEnd;
}

export {
  ModalContext,
  useIsInsideModal,
  useModalOrTerminalSize,
  useModalScrollViewport,
  useModalClaimScrollBox,
} from '@anthropic/ink';
