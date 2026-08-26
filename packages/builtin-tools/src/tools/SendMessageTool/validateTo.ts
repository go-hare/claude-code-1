import { parseAddress } from 'src/utils/peerAddress.js'
import { isLocalSocketAddress } from 'src/utils/udsMessaging.js'
import { LIST_AGENTS_TOOL_NAME } from '../ListPeersTool/constants.js'

/**
 * densable Qei(to, ListAgentsName). Empty `to` / empty bridge|uds target,
 * then ELe on both parsed target and the raw address string.
 *
 * Official xD has `did:` not `tcp:`. Callers keep a separate empty-`tcp:`
 * check; do not fold tcp into this function.
 */
export function validateSendMessageTo(
  to: string,
  listAgentsToolName: string = LIST_AGENTS_TOOL_NAME,
): string | undefined {
  if (to.trim().length === 0) return 'to must not be empty'
  const addr = parseAddress(to)
  if (
    (addr.scheme === 'bridge' || addr.scheme === 'uds') &&
    addr.target.trim().length === 0
  ) {
    return 'address target must not be empty'
  }
  if (!isLocalSocketAddress(addr.target) || !isLocalSocketAddress(to)) {
    return `'${to}' is not a local socket address. Use an address from ${listAgentsToolName}.`
  }
}
