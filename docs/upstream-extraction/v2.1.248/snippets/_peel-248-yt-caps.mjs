/**
 * Peel official Yt constant used as he.#s default (SurfaceCapabilities caps).
 * Near class he @178525654. Yt is NOT a class.
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  EXE_248,
  allHits,
  asciiSlice,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const buf = loadSea(EXE_248)
const out = []
function log(s) {
  out.push(s)
  console.log(s)
}

const HE = 178525654
log(`## class he window @${HE}`)
log(asciiSlice(buf, HE - 200, HE + 1400))

log('\n## #s=Yt hits')
for (const [i, h] of allHits(buf, '#s=Yt').entries()) {
  log(`- #${i} @${h} ${asciiSlice(buf, h - 40, h + 80)}`)
}

log('\n## Yt= object / array / literal scans near he')
const needles = [
  'Yt={',
  'Yt=Object',
  'var Yt=',
  ',Yt={',
  ';Yt={',
  'Yt={workspace',
  'Yt={type',
  'Yt={kind',
  'Yt={caps',
  'Yt={name',
  'Yt={mode',
  'Yt={local',
  'Yt={remote',
  'Yt=!0',
  'Yt=!1',
  'Yt=null',
  'Yt=void',
  'Yt=[]',
]

for (const n of needles) {
  const hits = allHits(buf, n)
  log(`\n### ${JSON.stringify(n)} hits=${hits.length}`)
  for (const [i, h] of hits.slice(0, 12).entries()) {
    // Prefer hits near he class (±2MB)
    const near = Math.abs(h - HE) < 2_000_000
    log(
      `- #${i} @${h} nearHe=${near} ${asciiSlice(buf, h - 30, h + n.length + 200)}`,
    )
  }
}

// Walk backward from he for "Yt=" assignment in same module
log('\n## walk-back Yt= from he')
const winStart = HE - 50000
const win = asciiSlice(buf, winStart, HE + 50)
const re = /(?:^|[^A-Za-z0-9_$])Yt=/g
let m
const found = []
while ((m = re.exec(win))) {
  found.push(winStart + m.index)
}
log(`Yt= in [-50k,+50]: ${found.length}`)
for (const h of found.slice(-20)) {
  log(`- @${h} ${asciiSlice(buf, h, h + 300)}`)
}

// Also check for Yt reset in he.reset
log('\n## this.#s=Yt / #s=Yt in reset')
for (const n of ['this.#s=Yt', '#s=Yt', 'this.#s={...this.#s,workspace']) {
  for (const [i, h] of allHits(buf, n).slice(0, 5).entries()) {
    log(`- ${n} #${i} @${h} ${asciiSlice(buf, h - 20, h + 120)}`)
  }
}

// Peel nn sentinel used by He.slowOperations
log('\n## nn empty sentinel near He')
const HE_CLS = allHits(buf, 'class He{#e=[];#t=[];#n=void 0')
log(`He class hits=${HE_CLS.length} @${HE_CLS.join(',')}`)
for (const h of HE_CLS.slice(0, 2)) {
  log(asciiSlice(buf, h - 500, h + 800))
}
for (const n of ['var nn=', ',nn=', ';nn=', 'nn=[]', 'nn=Object.freeze']) {
  const hits = allHits(buf, n)
  const near = hits.filter(h => Math.abs(h - (HE_CLS[0] ?? HE)) < 500_000)
  log(`\n### ${JSON.stringify(n)} total=${hits.length} nearHe=${near.length}`)
  for (const h of near.slice(0, 8)) {
    log(`- @${h} ${asciiSlice(buf, h - 20, h + 120)}`)
  }
}

writeFileSync(join(__dir, 'gold-248-yt-caps.txt'), out.join('\n'))
log(`\nsha out=${sha(out.join('\n'))}`)
log(`wrote gold-248-yt-caps.txt`)
