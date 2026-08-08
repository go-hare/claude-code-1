/**
 * densable 2.1.218 #28 multi-env trust gate UI contract (SEA ~240788539).
 *
 * densable:
 *   ba({ cancelFirst:!0, focus:"cancel",
 *        confirmLabel:"Yes, trust and add server",
 *        cancelLabel:"No, go back" })
 *   rr({ title:"Trust this directory?", subtitle:BLf })
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dialogSrc = readFileSync(
  join(import.meta.dir, '../RemoteControlAddServerDialog.tsx'),
  'utf8',
)
const copySrc = readFileSync(
  join(import.meta.dir, '../TrustDialog/trustDialogCopy.ts'),
  'utf8',
)

describe('densable 2.1.218 #28 RC Add-server trust UI', () => {
  test('trust copy matches densable SEA strings', () => {
    expect(copySrc).toContain('Trust this directory?')
    expect(copySrc).toContain('Yes, trust and add server')
    expect(copySrc).toContain('No, go back')
    expect(copySrc).toContain("hasn't been trusted yet.")
    expect(copySrc).toContain(
      'Trusting allows Claude to read and execute files there.',
    )
  })

  test('trust Select cancelFirst: No option before Yes + defaultValue no', () => {
    // densable ba cancelFirst:!0 focus:"cancel"
    expect(dialogSrc).toContain("defaultValue={'no'}")
    // cancel option appears before confirm in trustOptions array
    const cancelIdx = dialogSrc.indexOf('RC_ADD_SERVER_TRUST_CANCEL')
    const confirmIdx = dialogSrc.indexOf('RC_ADD_SERVER_TRUST_CONFIRM')
    // first CANCEL in trust phase must precede first CONFIRM in that block
    // (form phase may not use these constants)
    expect(cancelIdx).toBeGreaterThan(-1)
    expect(confirmIdx).toBeGreaterThan(-1)
    expect(cancelIdx).toBeLessThan(confirmIdx)
  })

  test('trust body passed as PermissionDialog subtitle (densable rr.subtitle)', () => {
    expect(dialogSrc).toContain('subtitle={trustBody}')
    expect(dialogSrc).toContain('RC_ADD_SERVER_TRUST_TITLE')
  })

  test('free-text Directory/Name densable form fields present', () => {
    expect(dialogSrc).toContain("phase === 'edit-dir'")
    expect(dialogSrc).toContain("phase === 'edit-name'")
    expect(dialogSrc).toContain('Directory')
    expect(dialogSrc).toContain('Spawn mode')
    expect(dialogSrc).toContain('same-dir')
    expect(dialogSrc).toContain('worktree')
    expect(dialogSrc).toContain('Add server')
  })
})
