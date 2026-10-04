/**
 * densable 2.1.283 leftover We/ee/cs wrap.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 * - `ee` @202322678 `Error: cannot serve cloud session ${n} from this computer: ${cs(e)}`
 * - `We` @202316964 / `cs` @202322797 / `ps` / `Ht` @202312761
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  bindReasonCopy,
  cannotServeCloudSession,
  checkLocalServeIdentity,
  describeServeIdentityRefusal,
  isLocalServeLinkAllowed,
  parseAttachServeRequest,
} from '../serveIdentity.js'
import { linkForServing, localServeLinkIdentity } from '../cloudSession.js'

const src = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8')

describe('serveIdentity 283 leftover wrap', () => {
  test('source-locks gold ee/cs/We strings; semantic exports only', () => {
    const body = src('../serveIdentity.ts')
    expect(body).toContain('gold `We` @202316964')
    expect(body).toContain('gold `ee` @202322678')
    expect(body).toContain('gold `cs` @202322797')
    expect(body).toContain(
      'Error: cannot serve cloud session ${sessionId} from this computer:',
    )
    expect(body).toContain('that is not a cloud session id.')
    expect(body).toContain(
      'the session is already linked to a different computer.',
    )
    expect(body).toContain(
      'this computer is not signed in to claude.ai (run claude /login), or its login expired.',
    )
    expect(body).toContain('serving tools is switched off on this computer.')
    expect(body).not.toContain('export class v0e')
    expect(body).not.toContain('export function We')
    expect(body).not.toContain('export function ee')
    expect(body).not.toContain('tengu_violin_amati')
    expect(body).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    const host = src('../cloudSession.ts')
    expect(host).toContain("from './serveIdentity.js'")
    expect(host).toContain('isLocalServeLinkAllowed')
    expect(host).toContain('ident.message')
  })

  test('ee FULL refuse prefix 1:1', () => {
    expect(
      cannotServeCloudSession({ kind: 'bad_session_id' }, 'cse_1').message,
    ).toBe(
      'Error: cannot serve cloud session cse_1 from this computer: that is not a cloud session id.',
    )
    expect(
      cannotServeCloudSession(
        { kind: 'local', reason: 'no_device_proof' },
        'cse_2',
      ).message,
    ).toBe(
      'Error: cannot serve cloud session cse_2 from this computer: no trusted-device token here, and this machine was not given one (an organization that does not require trusted devices gives none; otherwise try again, and --debug logs why).',
    )
    expect(
      cannotServeCloudSession(
        { kind: 'serving_off', reason: 'switch_off' },
        'cse_3',
      ).message,
    ).toBe(
      'Error: cannot serve cloud session cse_3 from this computer: serving tools is switched off on this computer.',
    )
    expect(
      cannotServeCloudSession({ kind: 'bound_elsewhere' }, 'cse_4').message,
    ).toBe(
      'Error: cannot serve cloud session cse_4 from this computer: the session is already linked to a different computer.',
    )
    expect(
      cannotServeCloudSession({ kind: 'unavailable', status: 503 }, 'cse_5')
        .message,
    ).toBe(
      'Error: cannot serve cloud session cse_5 from this computer: the service could not be reached or answered unexpectedly (HTTP 503); try again shortly.',
    )
    expect(
      describeServeIdentityRefusal({
        kind: 'refused',
        subReason: 'other',
      }),
    ).toBe('the server refused to link the session to this computer.')
    expect(bindReasonCopy('account')).toBe(
      'no stored claude.ai login on this machine (run /login)',
    )
  })

  test('We seams: bad id / serving_off / local / ok', async () => {
    expect(
      (await checkLocalServeIdentity({ sessionId: 'not-a-session' })).ok,
    ).toBe(false)
    const off = await checkLocalServeIdentity({
      sessionId: 'cse_abc',
      seams: { servingOff: async () => 'windows' },
    })
    expect(off.ok).toBe(false)
    if (!off.ok) {
      expect(off.refusal).toEqual({ kind: 'serving_off', reason: 'windows' })
      expect(off.message).toContain(
        'serving tools from a Windows computer is not available yet.',
      )
    }
    const local = await checkLocalServeIdentity({
      sessionId: 'cse_abc',
      seams: {
        servingOff: async () => undefined,
        identity: async () => ({ ok: false, error: 'no_device_proof' }),
      },
    })
    expect(local.ok).toBe(false)
    expect(isLocalServeLinkAllowed(local)).toBe(true)
    const ok = await checkLocalServeIdentity({
      sessionId: 'cse_abc',
      seams: {
        servingOff: async () => undefined,
        identity: async () => ({ ok: true, accountUuid: 'acct' }),
      },
    })
    expect(ok).toEqual({
      ok: true,
      sessionUuid: 'cse_abc',
      accountUuid: 'acct',
    })
    expect(isLocalServeLinkAllowed(ok)).toBe(true)
  })

  test('Ut parseAttachServeRequest; Yo U=ok||local&&no_device_proof', async () => {
    expect(
      parseAttachServeRequest({
        attachServeRequest: { workId: 'cse_1', environmentId: 'env_a' },
      }),
    ).toEqual({ workId: 'cse_1', environmentId: 'env_a' })
    expect(
      parseAttachServeRequest({
        attachServeRequest: { workId: 'nope', environmentId: 'env_a' },
      }),
    ).toBeUndefined()
    let posted = 0
    const linked = await linkForServing({
      sessionId: 'cse_abc',
      serveOnly: true,
      post: async () => {
        posted += 1
        return { ok: true }
      },
    })
    expect(posted).toBe(0)
    void linked
    const UUID = '11111111-1111-1111-1111-111111111111'
    const withKey = await linkForServing({
      sessionId: UUID,
      sessionUuid: UUID,
      serveOnly: true,
      orgUuid: UUID,
      accountUuid: UUID,
      deviceUUID: UUID,
      key: { sign: async (payload: Buffer) => payload },
      post: async () => {
        posted += 1
        return { ok: true }
      },
    })
    expect(posted).toBeGreaterThan(0)
    expect(withKey.ok).toBe(true)
    const ident = await localServeLinkIdentity({ sessionId: 'not-a-session' })
    expect(ident.ok).toBe(false)
    if (!ident.ok) {
      expect(ident.message).toContain('cannot serve cloud session')
      expect(ident.message).toContain('that is not a cloud session id.')
    }
  })
})
