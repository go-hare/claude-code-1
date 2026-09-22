/**
 * densable 2.1.248 #29 — SEA a9 `Vr((Ci)=>Ci.show?{show:!1}:Ci)`.
 * Shift-Tab (chat:cycleMode) must drop the armed Ctrl-C "press again to
 * exit" hint so the permission-mode indicator is not hidden behind it.
 */
export function dismissExitHintIfShowing<T extends { show: boolean }>(
  prev: T,
): T | { show: false } {
  return prev.show ? { show: false } : prev
}
