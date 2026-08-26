/**
 * Peer address parsing — kept separate from peerRegistry.ts so that
 * SendMessageTool can import parseAddress without transitively loading
 * the bridge (axios) and UDS (fs, net) modules at tool-enumeration time.
 */

/** Parse a URI-style address into scheme + target. */
export function parseAddress(to: string): {
  scheme: 'uds' | 'bridge' | 'tcp' | 'other'
  target: string
} {
  if (to.startsWith('uds:')) return { scheme: 'uds', target: to.slice(4) }
  if (to.startsWith('bridge:')) return { scheme: 'bridge', target: to.slice(7) }
  if (to.startsWith('tcp:')) return { scheme: 'tcp', target: to.slice(4) }
  // densable 2.1.239 xD iYb/sYb — only real socket paths are UDS.
  // A title like `/fix-login` must stay `other` so ListAgents/SendMessage
  // do not treat it as a socket (changelog #40 untitled / unreachable).
  if (/^\/\S*\.sock$/.test(to) || /^[\\/]{2}[.?][\\/]pipe[\\/]/i.test(to)) {
    return { scheme: 'uds', target: to }
  }
  return { scheme: 'other', target: to }
}

/** Parse a tcp: target string into host and port. */
export function parseTcpTarget(
  target: string,
): { host: string; port: number } | null {
  const match = target.match(/^([^:]+):(\d+)$/)
  if (!match) return null
  const port = parseInt(match[2]!, 10)
  if (port < 1 || port > 65535) return null
  return { host: match[1]!, port }
}
