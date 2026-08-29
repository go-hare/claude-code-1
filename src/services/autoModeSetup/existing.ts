/**
 * densable ulg — hasExistingAutoModeConfig.
 * Gold: gold-wide-hmn.txt / gold-wide-llg.txt
 * `Ytr().safeParse(yn("userSettings")?.autoMode)` — fail → false.
 */
import { getSettingsForSource } from '../../utils/settings/settings.js'
import { autoModeBlockSchema } from './write.js'

/** densable ulg */
export function hasExistingAutoModeConfig(): boolean {
  const parsed = autoModeBlockSchema.safeParse(
    getSettingsForSource('userSettings')?.autoMode,
  )
  if (!parsed.success) return false
  const t = parsed.data
  return (
    (t.environment?.length ?? 0) > 0 ||
    (t.allow?.length ?? 0) > 0 ||
    (t.soft_deny?.length ?? 0) > 0 ||
    (t.hard_deny?.length ?? 0) > 0
  )
}
