/**
 * densable 2.1.246 HAVE #41 — Notification hook during sandbox prompt.
 *
 * Official contract is NOT FRr→Usu.
 *   yte @230788424 = Usu map: still no qh (sandbox_network_access).
 *   ivt[qh.kind]="sandbox request" is waitingFor only.
 *   re() @228274949 is tool-permission permission_prompt, not sandbox.
 *   td @230180097 = useNotifyAfterTimeout (idle then Rm notify).
 *   Call site m_ @230227629: sandbox dialog itself
 *     td("Claude needs your permission","permission_prompt")
 *
 * Land: SandboxPermissionRequest calls td 1:1.
 * Invent-ban: do not add FRr to Usu.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { DIALOG_NOTIFICATIONS_FOR_TEST } from '../DialogHost.js'
import { SANDBOX_NETWORK_ACCESS_KIND } from '../specs/jsuKinds.js'

const dialog = join(import.meta.dir, '..')
const host = readFileSync(join(dialog, 'DialogHost.tsx'), 'utf8')
const sandboxUi = readFileSync(
  join(dialog, '../components/permissions/SandboxPermissionRequest.tsx'),
  'utf8',
)

describe('HAVE #41 notify during sandbox (2.1.246)', () => {
  test('official Usu still excludes FRr — do not invent Usu key', () => {
    expect(
      DIALOG_NOTIFICATIONS_FOR_TEST[SANDBOX_NETWORK_ACCESS_KIND],
    ).toBeUndefined()
    expect(host).toContain('Not in Usu (gold)')
    expect(host).toContain('FRr')
    expect(host).toContain(
      "useNotifyAfterTimeout(message, 'permission_prompt')",
    )
  })

  test('sandbox dialog calls official m_ td()', () => {
    expect(sandboxUi).toContain('Network request outside of sandbox')
    expect(sandboxUi).toContain(
      "useNotifyAfterTimeout('Claude needs your permission', 'permission_prompt')",
    )
  })
})
