/**
 * Official CLAUDE_CODE_HOST_HTTP_PROXY_PORT / HOST_SOCKS_PROXY_PORT.
 * Desktop / sandbox host injects local proxy ports for managed sessions.
 */

import { parseOptionalEnvNumber } from './permissions/autoModeFlags.js'

export type HostProxyPorts = {
  httpProxyPort?: number
  socksProxyPort?: number
}

/**
 * Read host-injected proxy ports from env.
 * Invalid / non-positive values are ignored.
 */
export function readHostProxyPorts(
  env: NodeJS.ProcessEnv = process.env,
): HostProxyPorts {
  const http = parseOptionalEnvNumber(env.CLAUDE_CODE_HOST_HTTP_PROXY_PORT)
  const socks = parseOptionalEnvNumber(env.CLAUDE_CODE_HOST_SOCKS_PROXY_PORT)
  return {
    ...(http !== undefined && http > 0
      ? { httpProxyPort: Math.floor(http) }
      : {}),
    ...(socks !== undefined && socks > 0
      ? { socksProxyPort: Math.floor(socks) }
      : {}),
  }
}

/**
 * Env pairs for sandbox / bubblewrap `--setenv` injection (official path).
 * Only includes keys that have valid ports.
 */
export function hostProxyPortsAsEnv(
  ports: HostProxyPorts = readHostProxyPorts(),
): Record<string, string> {
  const out: Record<string, string> = {}
  if (ports.httpProxyPort !== undefined) {
    out.CLAUDE_CODE_HOST_HTTP_PROXY_PORT = String(ports.httpProxyPort)
  }
  if (ports.socksProxyPort !== undefined) {
    out.CLAUDE_CODE_HOST_SOCKS_PROXY_PORT = String(ports.socksProxyPort)
  }
  return out
}
