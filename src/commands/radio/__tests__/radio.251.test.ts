import { describe, expect, test } from 'bun:test'
import radio from '../index.js'
import { openRadio } from '../radio.js'

describe('/radio (2.1.251 #56)', () => {
  test('command is local and has no provider or enable gate', () => {
    expect(radio.name).toBe('radio')
    expect(radio.type).toBe('local')
    expect(radio.supportsNonInteractive).toBe(false)
    expect(radio).not.toHaveProperty('isEnabled')
    expect(radio).not.toHaveProperty('availability')
  })

  test('opens Claude FM and names the fallback URL', async () => {
    const opened: string[] = []
    const ok = await openRadio(async url => {
      opened.push(url)
      return true
    })
    expect(opened).toEqual(['https://clau.de/radio'])
    expect(ok).toEqual({
      type: 'text',
      value: 'Opening Claude FM in your browser…',
    })

    const failed = await openRadio(async () => false)
    expect(failed).toEqual({
      type: 'text',
      value: "Couldn't open the browser. Listen at: https://clau.de/radio",
    })
  })
})
