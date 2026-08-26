/**
 * densable 2.1.239 stream withhold + media replay (SEA):
 *
 *   let Gm=!1
 *   if(ztm(Co)) Gm=!0
 *   if(EFi(Co)) Gm=!0, Ji.push(Co)
 *   if(Jsm(Co)) Gm=!0
 *   if(!Gm){ if(Ji.length>0) yield*Ji, Ji.length=0; yield Kl }
 *
 * ztm = PTL, EFi = media-size, Jsm = max_output_tokens.
 * Only EFi pushes Ji (original Co, not the possibly-landed Kl).
 * Leftover Ji is not flushed at stream end — recovery uses last assistant.
 */
export function applyStreamMediaReplay<T>(
  buffer: T[],
  message: T,
  withhold: {
    ptl: boolean
    media: boolean
    maxOutputTokens: boolean
  },
): { withheld: boolean; replay: T[] } {
  let withheld = false
  if (withhold.ptl) withheld = true
  if (withhold.media) {
    withheld = true
    buffer.push(message)
  }
  if (withhold.maxOutputTokens) withheld = true
  if (!withheld && buffer.length > 0) {
    const replay = buffer.slice()
    buffer.length = 0
    return { withheld: false, replay }
  }
  return { withheld, replay: [] }
}
