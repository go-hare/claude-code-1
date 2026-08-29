/**
 * densable Srs / EK / wrs / KUe / cEr — DialogStore React context + hooks.
 */
import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { createDialogStore, type DialogStore, type OpenDialogEntry } from './dialogStore.js';
import { nhtHidesPromptInput } from './nhtPrompt.js';
import { isSoftNmsDialogKind } from './specs/jsuKinds.js';

export const DialogStoreContext = createContext<DialogStore | null>(null);

type Props = {
  children: React.ReactNode;
  /** Test injection; production AppStateProvider uses useState(createDialogStore). */
  store?: DialogStore;
};

/** densable: useState(bGl) + Srs.Provider */
export function DialogStoreProvider({ children, store: injected }: Props): React.ReactNode {
  const [owned] = React.useState(createDialogStore);
  const store = injected ?? owned;
  return <DialogStoreContext.Provider value={store}>{children}</DialogStoreContext.Provider>;
}

/** densable EK */
export function useDialogStore(): DialogStore {
  const store = useContext(DialogStoreContext);
  if (!store) {
    throw new ReferenceError(
      'useDialogStore cannot be called outside of a DialogStoreContext provider (mounted by <AppStateProvider />)',
    );
  }
  return store;
}

/** densable wrs — top of open stack */
export function useTopDialog(): OpenDialogEntry | null {
  const store = useDialogStore();
  const get = () => store.getState().open.at(-1) ?? null;
  return useSyncExternalStore(store.subscribe, get, get);
}

/** densable KUe */
export function useHasOpenDialogs(): boolean {
  const store = useDialogStore();
  const get = () => store.getState().open.length > 0;
  return useSyncExternalStore(store.subscribe, get, get);
}

/** densable nHt — `open.some(d => !i_y.has(d.kind))`. */
export function useHasBlockingOpenDialogs(): boolean {
  const store = useDialogStore();
  const get = () => store.getState().open.some(d => !isSoftNmsDialogKind(d.kind));
  return useSyncExternalStore(store.subscribe, get, get);
}

/**
 * Tip PromptInput hide — subscribed open-stack scan (not gold nHt / yMe).
 * Soft / permission / managed stay open; other kinds hide the draft.
 */
export function useNhtHidesPromptInput(): boolean {
  const store = useDialogStore();
  const get = () => nhtHidesPromptInput(store.getState().open);
  return useSyncExternalStore(store.subscribe, get, get);
}

/** densable cEr */
export function useTopDialogKind(): string | undefined {
  const store = useDialogStore();
  const get = () => store.getState().open.at(-1)?.kind;
  return useSyncExternalStore(store.subscribe, get, get);
}
