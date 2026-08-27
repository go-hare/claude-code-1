/**
 * densable GSn / s_A / sXg — managed_settings_security dialog spec + REPL install.
 */
import { z } from 'zod/v4'
import {
  installManagedSettingsRequester,
  type ManagedSettingsConsentResult,
} from '../../services/remoteManagedSettings/consentRequester.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { defineDialogSpec, type RequestDialog } from '../requestDialog.js'

export const MANAGED_SETTINGS_SECURITY_KIND =
  'managed_settings_security' as const

export type ManagedSettingsSecurityPayload = {
  settings: SettingsJson
}

export type ManagedSettingsSecurityResult =
  | 'approved'
  | 'rejected'
  | 'deferred_no_consent_surface'

/** densable GSn */
export const managedSettingsSecuritySpec = defineDialogSpec({
  kind: MANAGED_SETTINGS_SECURITY_KIND,
  payload: () =>
    z.object({
      settings: z.custom<SettingsJson>(
        (v): v is SettingsJson => typeof v === 'object' && v !== null,
      ),
    }),
  result: () => z.enum(['approved', 'rejected', 'deferred_no_consent_surface']),
  default: 'deferred_no_consent_surface' as const,
})

/** densable s_A */
export async function* managedSettingsSecurityUpdates(
  settings: SettingsJson,
  updates: AsyncIterable<SettingsJson>,
): AsyncGenerator<ManagedSettingsSecurityPayload> {
  yield { settings }
  for await (const next of updates) {
    yield { settings: next }
  }
}

/**
 * densable sXg(Gm) — register cMl requester that routes through Bgp+GSn+queueBehind.
 * Returns disposer (() => cMl(null)).
 */
export function installManagedSettingsSxg(
  requestDialog: RequestDialog,
): () => void {
  return installManagedSettingsRequester((settings, updates) => {
    return requestDialog(
      managedSettingsSecuritySpec,
      managedSettingsSecurityUpdates(settings, updates),
      { queueBehind: true },
    ) as Promise<ManagedSettingsConsentResult>
  })
}
