import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const buf = loadSea(EXE_248)
const out = []
function log(s) {
  out.push(s)
  console.log(s)
}
function dumpHits(label, needle, ctx = 80) {
  const hits = allHits(buf, needle)
  log(`\n## ${label} ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [i, h] of hits.slice(0, 8).entries()) {
    log(`- #${i} @${h} ${asciiSlice(buf, h - 50, h + needle.length + ctx)}`)
  }
}

dumpHits('var bwe', 'var bwe=')
dumpHits('bwe=', 'bwe=')
dumpHits('var Fy', 'var Fy=')
dumpHits('Fy=', 'Fy=')
dumpHits('var ft=', 'var ft=')
dumpHits('ft="', 'ft="')
dumpHits('var md=', 'var md=')
dumpHits('md="Workflow"', 'md="')
dumpHits('chunk prelude', 'var s="",a=')

// same-module prelude before e=
log('\n## prelude @196763800')
log(asciiSlice(buf, 196763700, 196763900))

// imports of that chunk
log('\n## chunk header before e')
log(asciiSlice(buf, 196763200, 196763900))

// vy vg
dumpHits('function vy', 'function vy(')
dumpHits('function vg', 'function vg(')

// vo Skill name
dumpHits('export vo', 'vo="Skill"')
dumpHits('var vo=', 'var vo=')

writeFileSync(join(__dir, 'gold-248-40-consts-log.txt'), out.join('\n'))
