// Pass 2: Bi / pe / Ge imports in the spawn chunk; L_ in the RO chunk;
// the real `bs` next to Ht() in the dispatch chunk.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

function win(at, before, after) {
  return s.slice(Math.max(0, at - before), at + after).replace(/\s+/g, ' ')
}

// --- spawn chunk header (imports) ---
const spawnFrom = 221841815
console.log('\n\n########## spawn chunk imports ##########')
console.log(s.slice(spawnFrom, spawnFrom + 3500).replace(/\s+/g, ' '))

// L_ in RO chunk
const L = s.indexOf('L_=["', s.indexOf('w_=["ANTHROPIC_BASE_URL"') - 8000)
console.log('\n\n########## L_ near w_ ##########')
// search backwards-ish: find last L_=[ before w_
const wAt = s.indexOf('w_=["ANTHROPIC_BASE_URL"')
const L2 = s.lastIndexOf('L_=[', wAt)
console.log('L_=[ @', L2)
console.log(s.slice(L2, L2 + 700).replace(/\s+/g, ' '))

// dispatch chunk around Ht
const ht = s.indexOf('function Ht(){let e={};for(let t of bs)')
console.log('\n\n########## 2k before Ht ##########')
console.log(win(ht, 2500, 200))

// Find bs= in dispatch chunk 221689041..221790922
const dFrom = 221689041
const dTo = 221790922
const dChunk = s.slice(dFrom, dTo)
for (const [label, re] of [
  ['bs=[', /bs=\[/g],
  ['var bs', /var bs[=,]/g],
  ['let bs', /let bs[=,]/g],
  ['bs=new', /bs=new /g],
  [' as bs,', / as bs[,;}]/g],
  [' as is,', / as is[,;}]/g],
]) {
  const found = [...dChunk.matchAll(re)]
  console.log(`\n# dispatch ${label}: ${found.length}`)
  for (const m of found.slice(0, 5)) {
    console.log(
      `-- @ ${dFrom + m.index} --\n` +
        dChunk
          .slice(Math.max(0, m.index - 80), m.index + 400)
          .replace(/\s+/g, ' '),
    )
  }
}

// pe( and Ge( definitions anywhere near first call in spawn
const peCall = s.indexOf('if(pe(s),!e.env?.CLAUDE_CODE_ENTRYPOINT)Ge(s)')
console.log('\n\n########## pe/Ge call context ##########')
console.log(win(peCall, 100, 200))

// Search whole binary for `function pe(e)` near CLAUDE_CODE_ENTRYPOINT usage
const geDef = s.indexOf('function Ge(e){')
const geDef2 = s.indexOf('function Ge(_){')
console.log('\nGe(e) @', geDef, 'Ge(_) @', geDef2)
if (geDef > 0) console.log(win(geDef, 40, 400))
if (geDef2 > 0) console.log(win(geDef2, 40, 400))
