import { readFileSync, writeFileSync } from 'fs'
const text = readFileSync(`${process.env.TEMP}/official-239/package/claude.exe`).toString('latin1')

// Find renderer near notification strings in code section (not string table)
const markers = [
  'Claude proposed a session goal',
  'Auto-mode setup proposal is ready for review',
  'Auto-mode setup flagged some permission rules for review',
]
for (const m of markers) {
  let from = 0
  let n = 0
  while (n < 5) {
    const i = text.indexOf(m, from)
    if (i < 0) break
    const snip = text.slice(i - 300, i + 200)
    if (snip.includes('jsx') || snip.includes('kind]') || snip.includes('Usu')) {
      console.log('\nHIT', m, i)
      console.log(snip.replace(/[^\x20-\x7e]/g, '.'))
    }
    from = i + m.length
    n++
  }
}

// Find function that returns goal proposal UI - search for approved:!1 default near dialog answer
const gp = text.indexOf('kind:"goal_proposal"')
console.log('\ngoal_proposal Qg', gp)
// Find xou renderer - search jsx near goal
const xouIdx = text.indexOf('function xou(')
console.log('xou', xouIdx)
writeFileSync(
  'docs/upstream-extraction/v2.1.236/snippets/gold-xou-goal.txt',
  text.slice(xouIdx, xouIdx + 2500).replace(/[^\x20-\x7e\n]/g, '.'),
)
const snu = text.indexOf('function snu(')
const anu = text.indexOf('function anu(')
const giu = text.indexOf('function Giu(')
const hnu = text.indexOf('function Hnu(')
console.log({ snu, anu, giu, hnu })
for (const [name, i] of Object.entries({ snu, anu, giu, hnu, xou: xouIdx })) {
  if (i < 0) continue
  writeFileSync(
    `docs/upstream-extraction/v2.1.236/snippets/gold-${name}.txt`,
    text.slice(i, i + 2000).replace(/[^\x20-\x7e\n]/g, '.'),
  )
  console.log(name, text.slice(i, i + 400).replace(/[^\x20-\x7e]/g, '.'))
}

// Veu = auto_default_nudge UI
const veu = text.indexOf('currentMode:e.currentMode,onDone:(r)=>t(r?"accepted":"declined")')
console.log('\nVeu call', veu)
console.log(text.slice(veu - 200, veu + 100).replace(/[^\x20-\x7e]/g, '.'))

// refusal Giu - Session paused
const giu2 = text.indexOf('[$ne.kind]:"Session paused"')
console.log('\nUsu refusal', giu2)
// find function Giu after
let g = text.indexOf('function Giu(')
if (g < 0) g = text.indexOf('Giu=({')
console.log('Giu def', g, text.slice(g, g + 600).replace(/[^\x20-\x7e]/g, '.'))
