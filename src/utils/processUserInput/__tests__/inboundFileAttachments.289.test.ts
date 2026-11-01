import { describe, expect, test } from 'bun:test'
import {
  parseInboundCcrTurnId,
  parseInboundFileAttachments,
  relayHumanIdentityStamps,
} from '../inboundFileAttachments.js'

describe('densable 2.1.289 inbound D7@202257989 / NGn / cBn stamps', () => {
  test('inbound D7 parses file_attachments and drops bad entries', () => {
    expect(parseInboundFileAttachments(null)).toEqual([])
    expect(parseInboundFileAttachments({})).toEqual([])
    expect(parseInboundFileAttachments({ file_attachments: 'nope' })).toEqual(
      [],
    )
    expect(
      parseInboundFileAttachments({
        file_attachments: [
          { file_uuid: 'a', file_name: 'x.png', is_image: true, sha256: 'h' },
          { file_uuid: 1, file_name: 'bad' },
          { file_name: 'missing-uuid' },
        ],
      }),
    ).toEqual([
      {
        file_uuid: 'a',
        file_name: 'x.png',
        is_image: true,
        sha256: 'h',
      },
    ])
  })

  test('NGn only parses printable ASCII turn_id for relay humans', () => {
    expect(
      parseInboundCcrTurnId({ turn_id: 'abc' }, { isRelayHuman: false }),
    ).toBeUndefined()
    expect(
      parseInboundCcrTurnId({ turn_id: 'abc' }, { isRelayHuman: true }),
    ).toBe('abc')
    expect(
      parseInboundCcrTurnId({ turn_id: '' }, { isRelayHuman: true }),
    ).toBeUndefined()
    expect(
      parseInboundCcrTurnId({ turn_id: 'has space' }, { isRelayHuman: true }),
    ).toBeUndefined()
    expect(
      parseInboundCcrTurnId(
        { turn_id: 'x'.repeat(129) },
        { isRelayHuman: true },
      ),
    ).toBeUndefined()
  })

  test('cBn stamps verifiedSlack only for non-synthetic relay humans', () => {
    expect(
      relayHumanIdentityStamps({ isRelayHuman: false, ccrTurnId: 't' }),
    ).toEqual({})
    expect(
      relayHumanIdentityStamps({
        isRelayHuman: true,
        ccrTurnId: 't',
        isProjectsUser: true,
      }),
    ).toEqual({
      verifiedSlackHumanTurn: true,
      projectsUserTurn: true,
      ccrTurnId: 't',
    })
    expect(
      relayHumanIdentityStamps({
        isRelayHuman: true,
        isSynthetic: true,
        ccrTurnId: 't',
      }),
    ).toEqual({ ccrTurnId: 't' })
  })
})
