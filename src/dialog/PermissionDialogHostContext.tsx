/**
 * Host chrome for densable Iiu / tip PermissionRequest inside DialogHost.
 * toolUseConfirm itself is looked up via permissionConfirmRegistry.
 *
 * densable Host renderers do not dequeue (doo W() / opener callbacks do).
 * `dequeue` is tip chrome escape hatch → removeLeaderToolUseConfirm.
 */
import React, { createContext, useContext } from 'react';
import type { ToolUseContext } from '../Tool.js';

export type PermissionDialogHostValue = {
  verbose: boolean;
  /** Fallback toolUseContext if confirm.toolUseContext is stale */
  getToolUseContext: () => ToolUseContext;
  onReject: () => void;
  /** Remove from tip React queue (+ DialogStore mirrorClose) */
  dequeue: (toolUseID: string) => void;
  setStickyFooter?: (jsx: React.ReactNode | null) => void;
};

const PermissionDialogHostContext = createContext<PermissionDialogHostValue | null>(null);

export function PermissionDialogHostProvider({
  value,
  children,
}: {
  value: PermissionDialogHostValue;
  children: React.ReactNode;
}): React.ReactNode {
  return <PermissionDialogHostContext.Provider value={value}>{children}</PermissionDialogHostContext.Provider>;
}

export function usePermissionDialogHost(): PermissionDialogHostValue | null {
  return useContext(PermissionDialogHostContext);
}
