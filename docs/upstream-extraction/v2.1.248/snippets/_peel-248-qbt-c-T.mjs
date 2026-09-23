/**
 * Peel official Qbt c() flush bag + gKt T().
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  extractFnAt,
  lastFnStart,
  allHits,
} from './_peel-248-na-helpers.mjs'

const b = loadSea(EXE_248)
const out = [`when=${new Date().toISOString()}`]

// Qbt neighborhood
out.push('\n## Qbt window')
out.push(asciiSlice(b, 179232800, 179234200))

// T(e)===Wa near gKt
out.push('\n## T===Wa near gKt')
out.push(asciiSlice(b, 189576850, 189576980))

// sessionFile Zs + T uses
const hits = []
let i = 0
const n = Buffer.from('function Zs(){return Si().project?.sessionFile??null}')
while (i < b.length) {
  const k = b.indexOf(n, i)
  if (k < 0) break
  hits.push(k)
  i = k + n.length
}
out.push(`\n## sessionFile Zs hits=${hits}`)
for (const h of hits.slice(0, 2)) {
  out.push(asciiSlice(b, h, h + 800))
}

// T( near sessionFile Zs - look for function T( that takes a path
for (const needle of [
  'function T(e){return',
  'function T(t){return',
  'function T(e){let',
  'T(e)===Wa',
]) {
  const hs = []
  const nb = Buffer.from(needle)
  let p = 0
  while (p < b.length) {
    const k = b.indexOf(nb, p)
    if (k < 0) break
    hs.push(k)
    p = k + nb.length
  }
  out.push(`\n## needle ${JSON.stringify(needle)} hits=${hs.length}`)
  for (const h of hs.slice(0, 6)) {
    out.push(`- @${h} ${asciiSlice(b, h - 80, h + 200).replace(/\n/g, ' ')}`)
    const start = lastFnStart(b, h, ['function T('])
    if (start.i > 0 && start.i !== h) {
      const ext = extractFnAt(b, start.i, 2000)
      if (ext.body) out.push(ext.body.slice(0, 400))
    }
  }
}

// c().flush near Qbt
out.push('\n## c().flush hits')
const cf = []
const n2 = Buffer.from('function Qbt(){return c().flush()}')
let q = 0
while (q < b.length) {
  const k = b.indexOf(n2, q)
  if (k < 0) break
  cf.push(k)
  q = k + n2.length
}
out.push(`Qbt exact=${cf}`)
out.push(asciiSlice(b, 179230000, 179233500))

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-qbt-c-T.txt',
  out.join('\n'),
)
console.log('wrote', out.length)
