import { writeFileSync } from 'fs'
import { EXE_248, allHits, asciiSlice, extractFnAt, loadSea } from './_peel-248-na-helpers.mjs'
const buf = loadSea(EXE_248)
const lines = ['# gold-248-wKn-v-seed helpers pass2', '']

function near(needle, hint, take=5, maxLen=2000) {
  const hits = allHits(buf, needle)
  lines.push(`## ${JSON.stringify(needle)} hits=${hits.length}`)
  const ranked = hits.map(i => ({i, d: Math.abs(i-hint)})).sort((a,b)=>a.d-b.d)
  for (const {i,d} of ranked.slice(0,take)) {
    lines.push(`@${i} dist=${d}`)
    const ext = extractFnAt(buf, i, maxLen)
    if (ext.body) { lines.push(`sha=${ext.sha} len=${ext.len}`); lines.push(ext.body) }
    else lines.push(asciiSlice(buf, i, i+500))
    lines.push('')
  }
}

// S and y and w immediately before W @179535299
lines.push('## window before W')
lines.push(asciiSlice(buf, 179535100, 179535320))
lines.push('')

near('function S(', 179535299, 8, 400)
near('function y(', 179535299, 8, 600)
near('function w(', 179535299, 8, 400)

// Pc object
near('Pc={', 179534300, 5, 800)
near('var Pc=', 179534300, 5, 800)
near('Pc={home(', 179000000, 5, 900)
near('home(e){return{space:"home"', 179534300, 5, 900)
near('space:"workspace"', 179534300, 8, 400)
near('space:"system"', 179534300, 5, 400)

// real nyn — managed settings path getter
near('function nyn(', 179529582, 5, 400)
near('CLAUDE_CODE_MANAGED_SETTINGS_PATH', 179529582, 3, 200)
// find function that returns the env
{
  const hits = allHits(buf, 'CLAUDE_CODE_MANAGED_SETTINGS_PATH')
  for (const i of hits.slice(0, 6)) {
    const start = Math.max(0, i - 400)
    const win = asciiSlice(buf, start, i + 80)
    lines.push(`## env context @${i}`)
    lines.push(win)
    lines.push('')
  }
}

// $Me and T_ and rx near managed
near('function T_()', 179438431, 3, 400)
near('function T_(', 179438431, 3, 400)
near('T_=()', 179438431, 3, 200)
near(',T_=()', 179438431, 3, 200)
near('function rx(', 179438431, 5, 400)
near('rx=', 179438431, 5, 200)

// F empty listing / Fte
near('var F=[]', 179529582, 3, 100)
near('F=[]', 179529582, 5, 80)

// correct v — peel lastFn before string
{
  const i = 179529782
  const start = Math.max(0, i - 500)
  const win = asciiSlice(buf, start, i + 50)
  lines.push('## v preamble window')
  lines.push(win)
  lines.push('')
  const m = [...win.matchAll(/function v\(/g)]
  if (m.length) {
    const at = start + m[m.length-1].index
    const ext = extractFnAt(buf, at, 2500)
    lines.push(`## function v @${at}`)
    if (ext.body) { lines.push(`sha=${ext.sha} len=${ext.len}`); lines.push(ext.body) }
  }
}

// serving/serves on hostFiles type leftovers already known

writeFileSync(new URL('./gold-248-wKn-v-seed-pass2.txt', import.meta.url), lines.join('\n'))
console.log('done', lines.length)
