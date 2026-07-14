import { describe, expect, test } from 'bun:test'
import { hostProxyPortsAsEnv, readHostProxyPorts } from '../hostProxyPorts.js'

describe('readHostProxyPorts', () => {
  test('empty when unset', () => {
    expect(readHostProxyPorts({})).toEqual({})
  })

  test('parses valid ports', () => {
    expect(
      readHostProxyPorts({
        CLAUDE_CODE_HOST_HTTP_PROXY_PORT: '8080',
        CLAUDE_CODE_HOST_SOCKS_PROXY_PORT: '1080',
      }),
    ).toEqual({ httpProxyPort: 8080, socksProxyPort: 1080 })
  })

  test('ignores invalid / non-positive', () => {
    expect(
      readHostProxyPorts({
        CLAUDE_CODE_HOST_HTTP_PROXY_PORT: '0',
        CLAUDE_CODE_HOST_SOCKS_PROXY_PORT: 'nope',
      }),
    ).toEqual({})
  })
})

describe('hostProxyPortsAsEnv', () => {
  test('stringifies present ports only', () => {
    expect(hostProxyPortsAsEnv({ httpProxyPort: 9 })).toEqual({
      CLAUDE_CODE_HOST_HTTP_PROXY_PORT: '9',
    })
  })
})
