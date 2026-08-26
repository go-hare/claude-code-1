import { getAPIProvider } from 'src/utils/model/providers.js'
import { isEssentialTrafficOnly } from 'src/utils/privacyLevel.js'

/**
 * densable h0m — official copy for !g0m() on bridge / cloud-session send.
 */
export const CROSS_MACHINE_MESSAGING_UNAVAILABLE =
  'Cross-machine messaging is unavailable: it sends the message through Anthropic servers, which is not allowed on a third-party provider or with nonessential traffic disabled. Messages to sessions on this machine still work.'

/**
 * densable g0m — `ao()==="firstParty"&&!fa()`.
 * Official uses this in SendMessage `call()` before posting a bridge hop
 * (explicit `bridge:` and resolved cloud/RC session). Do not invent a
 * separate cloud relay.
 */
export function isCrossMachineMessagingAvailable(): boolean {
  return getAPIProvider() === 'firstParty' && !isEssentialTrafficOnly()
}
