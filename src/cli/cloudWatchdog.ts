/**
 * densable 2.1.283 leftover gold `HWt` @202291265.
 *
 * Gold body: `function HWt(e){return e?180000:60000}`
 * Gold `class ot` arms `HWt(this.compacting)`; useRemoteSession arms `HWt(Vn.current)`.
 * Warning string already lives on leftoverUnique / cloudSession — do not duplicate.
 */

/** gold `HWt` true branch — 180s */
export const HEADLESS_CLOUD_WATCHDOG_MS_ATTACHED = 180_000
/** gold `HWt` false branch — 60s */
export const HEADLESS_CLOUD_WATCHDOG_MS_UNATTACHED = 60_000

/**
 * gold `HWt` @202291265 — attached/compacting → 180s, else 60s.
 */
export function headlessCloudWatchdogMs(attached: boolean): number {
  return attached
    ? HEADLESS_CLOUD_WATCHDOG_MS_ATTACHED
    : HEADLESS_CLOUD_WATCHDOG_MS_UNATTACHED
}
