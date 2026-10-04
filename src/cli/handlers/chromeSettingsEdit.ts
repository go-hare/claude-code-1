/**
 * densable 2.1.283 `runChromeSettingsEdit` / `l` @205306990.
 */
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import { saveGlobalConfig } from '../../utils/config.js'

const editSchema = lazySchema(() =>
  z.object({
    enabledByDefault: z.boolean(),
  }),
)

export type ChromeSettingsEdit = z.infer<ReturnType<typeof editSchema>>

export type ChromeSettingsEditResult =
  | { ok: true; written: ChromeSettingsEdit }
  | { ok: false; error: string }

export async function runChromeSettingsEdit(
  raw: unknown,
  storageV5?: unknown,
): Promise<ChromeSettingsEditResult> {
  const parsed = editSchema().safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: issue
        ? `Not a Claude in Chrome settings edit (${issue.path.map(String).join('.') || 'edit'}: ${issue.message}).`
        : 'Not a Claude in Chrome settings edit.',
    }
  }
  const written = parsed.data
  let saved = true
  try {
    saveGlobalConfig(current => {
      if (current.claudeInChromeDefaultEnabled === written.enabledByDefault) {
        return current
      }
      return {
        ...current,
        claudeInChromeDefaultEnabled: written.enabledByDefault,
      }
    }, storageV5)
  } catch {
    saved = false
  }
  if (!saved) {
    return {
      ok: false,
      error: 'The Claude in Chrome setting may not have been saved.',
    }
  }
  return { ok: true, written }
}
