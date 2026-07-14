/**
 * Official 2.1.x Ng8/Py3: bare host extraction from bash command URLs.
 */
import { describe, expect, test } from 'bun:test'
import {
  extractBashHostsFromMessages,
  extractHostsFromCommand,
} from '../queryHelpers.js'
import type { Message } from 'src/types/message.js'

describe('extractHostsFromCommand (official Py3)', () => {
  test('extracts bare host from https URL', () => {
    expect(
      extractHostsFromCommand('curl https://api.stripe.com/v1/charges'),
    ).toEqual(['api.stripe.com'])
  })

  test('strips port and userinfo, lowercases', () => {
    expect(
      extractHostsFromCommand(
        'curl https://User:pass@API.Example.com:8443/path',
      ),
    ).toEqual(['api.example.com'])
  })

  test('finds multiple hosts', () => {
    expect(
      extractHostsFromCommand(
        'curl https://a.example.com && wget http://b.example.org/x',
      ),
    ).toEqual(['a.example.com', 'b.example.org'])
  })

  test('returns empty for no URLs', () => {
    expect(extractHostsFromCommand('ls -la')).toEqual([])
    expect(extractHostsFromCommand(undefined)).toEqual([])
  })
})

describe('extractBashHostsFromMessages', () => {
  test('collects hosts from Bash tool_use commands', () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: 'curl https://api.stripe.com/v1' },
            },
          ],
        },
      },
    ] as unknown as Message[]
    expect([...extractBashHostsFromMessages(messages)]).toEqual([
      'api.stripe.com',
    ])
  })
})
