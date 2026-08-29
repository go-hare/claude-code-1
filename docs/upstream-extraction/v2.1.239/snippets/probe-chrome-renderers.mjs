/**
 * Peel gold 239 Host renderers: znu (zOo upsell) + Kmy (jOo setup).
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const exe =
  process.env.CLAUDE_SEA_239 ||
  'C:/Users/Administrator/AppData/Local/Temp/official-239-pkg/package/claude.exe'
const buf = readFileSync(exe)
const text = buf.toString('latin1')
console.log(`SEA bytes=${buf.length}`)

function jsWindow(i, before, after) {
  const start = Math.max(0, i - before)
  const end = Math.min(text.length, i + after)
  let s = ''
  for (let k = start; k < end; k++) {
    const c = text.charCodeAt(k)
    if (c >= 0x20 && c <= 0x7e) s += text[k]
    else s += '\n'
  }
  return s
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length >= 6 && /[A-Za-z]{2,}/.test(l) && /[{}();=,.]/.test(l))
    .join('\n')
}

function dump(needle, before = 800, after = 5500, max = 4) {
  const out = []
  let from = 0
  for (let n = 0; n < max; n++) {
    const i = text.indexOf(needle, from)
    if (i < 0) break
    out.push({ at: i, snip: jsWindow(i, before, after) })
    from = i + needle.length
  }
  return out
}

const needles = [
  'function znu',
  'function Kmy',
  'znu=',
  'Kmy=',
  'Xmy=[{value:"install"',
  'Setting up Claude in Chrome',
  'Claude wants to use your browser',
  'keep_waiting',
  'installPageOpened',
  'Opens the install page in Chrome',
  '...vM(zOo,znu)',
  '...vM(jOo,Kmy)',
]

const lines = []
function log(s) {
  console.log(s.slice(0, 500))
  lines.push(s)
}

for (const needle of needles) {
  log(`\n==== ${needle} ====`)
  const hits = dump(needle)
  log(`hits=${hits.length}`)
  for (const h of hits) {
    log(`@${h.at}:\n${h.snip.slice(0, 7000)}\n---`)
  }
}

const out = join(import.meta.dir, 'gold-win-chrome-renderers.txt')
writeFileSync(out, lines.join('\n'))
console.log(`wrote ${out}`)
