import { describe, expect, mock, test } from 'bun:test'

mock.module('src/cost-tracker.js', () => ({
  formatTotalCost: () =>
    '\u001b[2mTotal cost:            $0.0000\nTotal duration (API):  0s\nTotal duration (wall): 0s\nTotal code changes:    0 lines added, 0 lines removed\nUsage:                 0 input, 0 output, 0 cache read, 0 cache write\u001b[22m',
}))

const { call } = await import('../usage-noninteractive.js')

describe('usage noninteractive (densable SSs)', () => {
  test('returns stripped cost summary text', async () => {
    const r = await call('', {} as never)
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value).toContain('Total cost:')
      expect(r.value).toContain('$0.0000')
      expect(r.value).not.toContain('\u001b[')
    }
  })
})
