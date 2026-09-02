/**
 * densable nst / WFl portable — exit from prompt / $To finishExit.
 *
 * Gold: `async function nst(e,t={},r){await WFl(e,t,r),await oc(0,"prompt_input_exit")}`
 * where WFl → Q6e(messages,"process_exit",{responseStreaming},storageV5).
 *
 * Tip: `gracefulShutdown(..., 'prompt_input_exit')` itself runs
 * `cancelQuotaAutoResume('process_exit')` (idempotent). This helper keeps the
 * nst call-shape (messages / responseStreaming slots) for ExitFlow / /exit /
 * wZt. Transcript warning append (K9+jfE) and storageV5 remain invent-ban.
 */
import { gracefulShutdown } from './gracefulShutdown.js'

export type ExitPromptShutdownOptions = {
  /**
   * densable Si.isRunning — when true, gold Q6e skips transcript warning write.
   * Tip has no K9 write; retained for call-shape / future parity.
   */
  responseStreaming?: boolean
  /** densable nst messages arg — accepted for call-shape; unused without K9. */
  messages?: readonly unknown[]
  /**
   * densable Q6e(..., storageV5) — official persist handle. Unused locally;
   * do not invent a v5 backend.
   */
  storageV5?: unknown
}

/** densable nst — process_exit cancel (via gracefulShutdown) then oc. */
export async function exitPromptShutdown(
  options: ExitPromptShutdownOptions = {},
): Promise<void> {
  void options.messages
  void options.responseStreaming
  void options.storageV5
  await gracefulShutdown(0, 'prompt_input_exit')
}
