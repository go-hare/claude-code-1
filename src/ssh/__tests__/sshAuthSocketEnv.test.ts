/**
 * The `claude ssh` auth proxy hands the remote an env var naming the tunnel it
 * should route Anthropic API calls through. Producer and consumer have to agree
 * on that name, and the name is fixed by upstream: ANTHROPIC_UNIX_SOCKET.
 *
 * This regressed once. SSHAuthProxy produced ANTHROPIC_AUTH_SOCKET, which no
 * code anywhere read, so on a non-Windows host the unix branch forwarded a
 * socket the remote never used — and since ANTHROPIC_BASE_URL is only set on the
 * Windows/TCP branch, the remote fell through to calling api.anthropic.com
 * directly. It failed silently and only off-Windows, which is why it survived.
 */
import { describe, expect, test } from 'bun:test'

const ENV = 'ANTHROPIC_UNIX_SOCKET'
/** The name that regressed; must not come back under any spelling. */
const WRONG = 'ANTHROPIC_AUTH_SOCKET'

async function read(rel: string): Promise<string> {
  return await Bun.file(new URL(rel, import.meta.url)).text()
}

describe('claude ssh auth socket env var', () => {
  test('the proxy produces the name the API client consumes', async () => {
    const producer = await read('../SSHAuthProxy.ts')
    const consumer = await read('../../utils/proxy.ts')

    expect(producer).toContain(`authEnv: { ${ENV}: socketPath }`)
    // getFetchOptions returns { unix } only for the Anthropic API client, so the
    // consumer side is what makes the forwarded socket actually load-bearing.
    expect(consumer).toContain(`process.env.${ENV}`)
    expect(consumer).toContain('unix: unixSocket')
  })

  test('the -R rewrite targets the same var it forwards', async () => {
    const session = await read('../createSSHSession.ts')
    // The remote socket path differs from the local one, so createSSHSession
    // rewrites the entry in place. Both halves must name the same var.
    expect(session).toContain(`\`${ENV}=\${authEnv.${ENV}}\``)
    expect(session).toContain(`remoteCli[idx] = \`${ENV}=\${remoteSocket}\``)
  })

  test('the dead name is gone from the ssh transport', async () => {
    for (const rel of [
      '../SSHAuthProxy.ts',
      '../createSSHSession.ts',
      '../SSHSessionManager.ts',
      '../../utils/proxy.ts',
    ]) {
      expect(await read(rel)).not.toContain(WRONG)
    }
  })

  test('the TCP branch keeps a nonce that is actually sent', async () => {
    const producer = await read('../SSHAuthProxy.ts')
    const client = await read('../../services/api/client.ts')
    // Windows has no unix sockets, so that branch overrides the base URL
    // instead and guards the loopback listener with a nonce header.
    expect(producer).toContain('ANTHROPIC_BASE_URL')
    expect(producer).toContain('ANTHROPIC_AUTH_NONCE: nonce')
    expect(client).toContain('ANTHROPIC_AUTH_NONCE')
    expect(client).toContain("'x-auth-nonce'")
  })
})
