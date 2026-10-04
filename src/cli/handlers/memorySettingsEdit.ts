/**
 * densable 2.1.283 `runMemorySettingsEdit` / `l` @205261921.
 */
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import { persistSettingsForSource } from '../../utils/settings/settings.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { logEventAsync } from '../../services/analytics/index.js'

const editSchema = lazySchema(() =>
  z
    .object({
      autoMemoryEnabled: z.boolean().optional(),
      autoDreamEnabled: z.boolean().optional(),
    })
    .refine(
      value =>
        value.autoMemoryEnabled !== undefined ||
        value.autoDreamEnabled !== undefined,
      {
        error:
          'Nothing to change: neither autoMemoryEnabled nor autoDreamEnabled was given.',
      },
    ),
)

export type MemorySettingsEdit = z.infer<ReturnType<typeof editSchema>>

export type MemorySettingsEditResult =
  | { ok: true; written: MemorySettingsEdit }
  | { ok: false; error: string }

export async function runMemorySettingsEdit(
  raw: unknown,
  storageV5?: unknown,
): Promise<MemorySettingsEditResult> {
  const parsed = editSchema().safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: issue
        ? `Not a memory settings edit (${issue.path.map(String).join('.') || 'edit'}: ${issue.message}).`
        : 'Not a memory settings edit.',
    }
  }
  const written = parsed.data
  const isFirstDreamEnable =
    written.autoDreamEnabled === true &&
    getInitialSettings().autoDreamEnabled === undefined
  const result = await persistSettingsForSource(
    'userSettings',
    written,
    undefined,
    storageV5,
  )
  if (result.error) {
    return { ok: false, error: result.error.message }
  }
  if (typeof written.autoMemoryEnabled === 'boolean') {
    await logEventAsync('tengu_auto_memory_toggled', {
      enabled: written.autoMemoryEnabled,
    })
  }
  if (typeof written.autoDreamEnabled === 'boolean') {
    await logEventAsync('tengu_auto_dream_toggled', {
      enabled: written.autoDreamEnabled,
      is_first_enable: isFirstDreamEnable,
    })
  }
  return { ok: true, written }
}
