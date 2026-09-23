import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  EXE_248,
  asciiSlice,
  extractFnAt,
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

function scanQuoted(openPos) {
  let esc = false
  let i = openPos + 1
  const max = Math.min(buf.length, openPos + 80_000)
  while (i < max) {
    const c = buf[i]
    if (esc) {
      esc = false
      i++
      continue
    }
    if (c === 92) {
      esc = true
      i++
      continue
    }
    if (c === buf[openPos]) return { closePos: i }
    i++
  }
  return { missEnd: true }
}

// extract e
const eStart = 196763889
const scanned = scanQuoted(eStart + 2)
log(`e close=${scanned.closePos} asciiLen=${scanned.closePos - (eStart + 3)}`)
const eInner = buf.subarray(eStart + 3, scanned.closePos).toString('utf8')
log(`e utf8 len=${eInner.length} sha=${sha(eInner)}`)
writeFileSync(join(__dir, 'gold-248-40-e.txt'), eInner)
log('wrote gold-248-40-e.txt')
log('--- e full ---')
log(eInner)
log('--- e end ---')

// e() at 195582192
log('\n## e() window @195582000')
log(asciiSlice(buf, 195581980, 195582400))
const eFn = extractFnAt(buf, 195582192, 3000)
log(`e() ${JSON.stringify(eFn)}`)

// i() near eJ
log('\n## around eJ @195582042')
log(asciiSlice(buf, 195581700, 195582350))

// IWe @184162680
const iwe = extractFnAt(buf, 184162680, 2500)
log(`\n## IWe ${JSON.stringify(iwe)}`)

// K$ @178578504
const ks = extractFnAt(buf, 178578504, 800)
log(`\n## K$ ${JSON.stringify(ks)}`)

// Wq
log('\n## Wq around T')
log(asciiSlice(buf, 204709919, 204710744))

// function i( near eJ module
log('\n## function i( before eJ')
log(asciiSlice(buf, 195581400, 195582050))

writeFileSync(join(__dir, 'gold-248-40-extract3-log.txt'), out.join('\n'))
