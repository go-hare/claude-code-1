import { describe, expect, test } from 'bun:test'
import { formatAttachError } from '../helpers.js'
import {
  EHOSTDEAD,
  HOST_DEAD_SESSION_ATTACH_ERROR,
  HOST_DEAD_SESSION_DETAIL,
} from '../../../daemon/hostDeath.js'

describe('densable 2.1.247 #15 formatAttachError EHOSTDEAD', () => {
  test('does not wrap official session host-death copy', () => {
    expect(
      formatAttachError(`${EHOSTDEAD}: ${HOST_DEAD_SESSION_ATTACH_ERROR}`),
    ).toBe(HOST_DEAD_SESSION_ATTACH_ERROR)
    expect(formatAttachError(HOST_DEAD_SESSION_ATTACH_ERROR)).toBe(
      HOST_DEAD_SESSION_ATTACH_ERROR,
    )
    expect(formatAttachError(HOST_DEAD_SESSION_DETAIL)).toBe(
      HOST_DEAD_SESSION_DETAIL,
    )
  })

  test('keeps ENOJOB on the existing still-starting path', () => {
    expect(formatAttachError('ENOJOB: job not found')).toBe(
      'Session is still starting \u2014 try again in a moment',
    )
  })
})
