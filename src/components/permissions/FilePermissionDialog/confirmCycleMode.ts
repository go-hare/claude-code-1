/**
 * densable 2.1.235 #5 — SEA `ERg` / confirm:cycleMode while permission dialog open.
 *
 * Gold (SEA):
 *   E=()=>{
 *     if(u){ p("yes"); return }   // yes comment open → collapse field, do NOT accept-session
 *     if(d){ p("no"); return }    // no comment open → collapse field
 *     let A=S.find(accept-session); if(A) v(A.option)
 *   }
 *
 * Official changelog: Shift+Tab in the comment field was incorrectly approving
 * the edit session-wide; it must close the field instead.
 */
export type ConfirmCycleModeAction =
  | 'collapse-yes'
  | 'collapse-no'
  | 'accept-session'

export function resolveConfirmCycleModeAction({
  yesInputMode,
  noInputMode,
}: {
  yesInputMode: boolean
  noInputMode: boolean
}): ConfirmCycleModeAction {
  if (yesInputMode) return 'collapse-yes'
  if (noInputMode) return 'collapse-no'
  return 'accept-session'
}
