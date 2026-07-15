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
export {
  ModalContext,
  useIsInsideModal,
  useModalOrTerminalSize,
  useModalScrollRef,
} from '@anthropic/ink';
