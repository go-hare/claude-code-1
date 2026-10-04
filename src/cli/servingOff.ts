/**
 * densable 2.1.283 leftover gold `fs` @202325188 — serving-off chain.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 *   async function fs(){
 *     let[{remoteToolServingOffReason:e},{servedToolsUnavailableReason:n},
 *         {isViolinWoodServedOff:s},{primeWindowsProfileDirs:r}]=await Promise.all([...]);
 *     return await r(),e()??n()??(s()?"flag_off":void 0)
 *   }
 *
 * Engines (remote/served/profile dirs) are missing on MAIN — wrap still lands
 * the chain. Default prime is a no-op; remote/served reasons are undefined;
 * wood-off (`!isViolinWoodEnabledSync()`) → `'flag_off'`.
 *
 * Copy for serving_off keys lives in `serveIdentity.ts` (`ps` / SERVING_OFF).
 * Do not duplicate that map here. `checkLocalServeIdentity` default
 * `seams.servingOff` is undefined; callers may pass `servingOffReason`.
 *
 * Semantic export; minify `fs` stays in comments.
 */

import { isViolinWoodEnabledSync } from './violinWood.js'

export type ServingOffSeams = {
  primeWindowsProfileDirs?: () => void | Promise<void>
  remoteToolServingOffReason?: () => string | undefined
  servedToolsUnavailableReason?: () => string | undefined
  isViolinWoodServedOff?: () => boolean
}

function defaultSeams(): Required<ServingOffSeams> {
  return {
    primeWindowsProfileDirs: () => {},
    remoteToolServingOffReason: () => undefined,
    servedToolsUnavailableReason: () => undefined,
    isViolinWoodServedOff: () => !isViolinWoodEnabledSync(),
  }
}

/** gold `fs` @202325188 */
export async function servingOffReason(
  seams?: ServingOffSeams,
): Promise<string | undefined> {
  const resolved = { ...defaultSeams(), ...seams }
  await resolved.primeWindowsProfileDirs()
  return (
    resolved.remoteToolServingOffReason() ??
    resolved.servedToolsUnavailableReason() ??
    (resolved.isViolinWoodServedOff() ? 'flag_off' : undefined)
  )
}
