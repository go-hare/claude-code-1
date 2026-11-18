import { describe, expect, test } from 'bun:test'
import { isTransientFsReadError } from '../jobState.js'

describe('jobState 2.1.293 EMFILE/transient error alignment (#297)', () => {
  test('isTransientFsReadError matches EMFILE, ENFILE, EBUSY, EAGAIN, EINTR and ignores ENOENT', () => {
    for (const code of ['EMFILE', 'ENFILE', 'EBUSY', 'EAGAIN', 'EINTR']) {
      expect(
        isTransientFsReadError(Object.assign(new Error(code), { code })),
      ).toBe(true)
    }
    expect(
      isTransientFsReadError(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      ),
    ).toBe(false)
    expect(isTransientFsReadError(null)).toBe(false)
  })
})
