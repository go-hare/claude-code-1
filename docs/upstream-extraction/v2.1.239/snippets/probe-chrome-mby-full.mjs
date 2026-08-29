/**
 * Extract contiguous JS from gold Mby / yau / gP class — denser ASCII filter.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const exe =
  process.env.CLAUDE_SEA_239 ||
  'C:/Users/Administrator/AppData/Local/Temp/official-239-pkg/package/claude.exe'
const buf = readFileSync(exe)
const text = buf.toString('latin1')

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
    .filter(l => l.length >= 8 && /[A-Za-z]{3,}/.test(l) && /[{}();=,`]/.test(l))
    .join('\n')
}

const starts = {
  Mby: text.indexOf('async function Mby(e,t)'),
  yau: text.indexOf('async function yau(e)'),
  Nby: text.indexOf('function Nby()'),
  Bmn: text.indexOf('function Bmn()'),
  slf: text.indexOf('class slf{'),
  ejA: text.indexOf('async function ejA(e)'),
  Vhs: text.indexOf('function Vhs()'),
  nvt: text.indexOf('async function nvt('),
  Fby: text.indexOf('function Fby('),
  getPrompt: text.indexOf('getPromptForCommand(e){let t=e.trim();if(!t)return[{type:"text",text:OBA}]'),
}

const lines = []
function log(s) {
  console.log(s.slice(0, 300))
  lines.push(s)
}

for (const [name, at] of Object.entries(starts)) {
  log(`\n==== ${name} @${at} ====`)
  if (at < 0) continue
  log(jsWindow(at, 200, 18000).slice(0, 16000))
}

const out = join(import.meta.dir, 'gold-win-Mby-full.txt')
writeFileSync(out, lines.join('\n'))
console.log(`Wrote ${out}`)
