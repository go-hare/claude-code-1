/**
 * densable 2.1.236 #6 ModelPicker height (`Cot` / `sgM`).
 *
 * Official `LFh=14` is chrome reserve, not max visible. Visible slots:
 * `sgM=Math.max(2,Math.min(10,Math.floor((tgM-LFh-ngM-ogM-igM)/2)))`
 */

/** densable `LFh` */
export const MODEL_PICKER_CHROME_RESERVE = 14
/** densable `sgM` floor */
export const MODEL_PICKER_MIN_VISIBLE = 2
/** densable `sgM` cap */
export const MODEL_PICKER_MAX_VISIBLE = 10

export type ModelPickerVisibleSlotsArgs = {
  /** densable `tgM` — terminal rows from `kg(hn())` */
  rows: number
  /** densable `ngM` — search chrome (`$xe||KFe!==""` → 4). Local has no XKl. */
  searchChrome: boolean
  /** densable `ogM` — fast-mode notice chrome (`r7l` → 3) */
  fastModeNotice: boolean
  /** densable `igM` — session-model banner (`AQi` → 2) */
  sessionModelBanner: boolean
}

/**
 * densable `sgM`. Each Select option is budgeted at 2 rows.
 */
export function computeModelPickerVisibleSlots(
  args: ModelPickerVisibleSlotsArgs,
): number {
  const ngM = args.searchChrome ? 4 : 0
  const ogM = args.fastModeNotice ? 3 : 0
  const igM = args.sessionModelBanner ? 2 : 0
  return Math.max(
    MODEL_PICKER_MIN_VISIBLE,
    Math.min(
      MODEL_PICKER_MAX_VISIBLE,
      Math.floor(
        (args.rows - MODEL_PICKER_CHROME_RESERVE - ngM - ogM - igM) / 2,
      ),
    ),
  )
}

/**
 * densable `r7l = Iu()&&(_do||xz()&&!cje())`.
 * `Iu` = fast mode enabled, `_do` = showFastModeNotice,
 * `xz` = available, `cje` = cooldown.
 */
export function isModelPickerFastModeNoticeChrome(
  fastModeEnabled: boolean,
  showFastModeNotice: boolean | undefined,
  fastModeAvailable: boolean,
  fastModeCooldown: boolean,
): boolean {
  return (
    fastModeEnabled &&
    Boolean(showFastModeNotice || (fastModeAvailable && !fastModeCooldown))
  )
}
