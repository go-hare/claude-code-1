/**
 * Peel gold 2.1.239 chrome install opener: Mby wait-loop + t(zOo) upsell host.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const exe =
  process.env.CLAUDE_SEA_239 ||
  'C:/Users/Administrator/AppData/Local/Temp/official-239-pkg/package/claude.exe'
const buf = readFileSync(exe)
const text = buf.toString('latin1')
console.log(`SEA bytes=${buf.length}`)

function asciiSlice(start, end) {
  let s = ''
  for (let k = start; k < end && k < text.length; k++) {
    const c = text.charCodeAt(k)
    s += c >= 0x20 && c <= 0x7e ? text[k] : '\n'
  }
  return s.replace(/\n+/g, '\n')
}

function dump(needle, before, after, max = 3) {
  const out = []
  let from = 0
  for (let n = 0; n < max; n++) {
    const i = text.indexOf(needle, from)
    if (i < 0) break
    out.push({ at: i, snip: asciiSlice(i - before, i + after) })
    from = i + needle.length
  }
  return out
}

const needles = [
  ['async function Mby', 200, 12000],
  ['function Mby', 200, 8000],
  ['async function*y()', 4000, 2000],
  ['t(zOo,{},{signal:', 6000, 4000],
  ['t(jOo,y(),{signal:', 8000, 2000],
  ['function Nby(', 200, 4000],
  ['async function ejA', 200, 2500],
  ['function gP()', 200, 2500],
  ['function VEi(', 200, 2000],
  ['function Iby(', 200, 2500],
  ['function L0n(', 200, 1500],
  ['function jMs(', 200, 1500],
  ['function jmn(', 200, 1500],
  ['installUpsellResolution', 800, 1200],
  ['chromeInstallUpsellDismissed', 800, 1500],
  ['phase:"waiting_install"', 4000, 4000],
  ['s="waiting_install"', 4000, 4000],
  ['openInChrome(c0e', 2000, 2000],
  ['c0e=', 200, 400],
  ['installPageOpened=!0', 3000, 2000],
  ['list_connected_browsers', 1500, 1500],
]

const lines = []
function log(s) {
  console.log(s.slice(0, 500))
  lines.push(s)
}

for (const [needle, before, after] of needles) {
  log(`\n==== ${needle} ====`)
  const hits = dump(needle, before, after, 4)
  log(`hits=${hits.length}`)
  for (const h of hits) {
    log(`@${h.at}:\n${h.snip.slice(0, 14000)}\n---`)
  }
}

const out = join(import.meta.dir, 'gold-win-Mby.txt')
writeFileSync(out, lines.join('\n'))
console.log(`Wrote ${out} chars=${lines.join('\n').length}`)
