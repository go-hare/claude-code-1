/**
 * Second probe: hoisted defs after caller, NU/Rn/Cn assigns, host-flag empties, qo factory.
 */
import {
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
} from './_peel-251-helpers.mjs'

const buf = loadSea()

function hitsOf(n) {
  return allHits(buf, n)
}

function namedFnHits(name) {
  const raw = [...hitsOf(`function ${name}(`), ...hitsOf(`async function ${name}(`)]
  const uniq = [...new Set(raw)].sort((a, b) => a - b)
  // drop substring hits: `function X(` inside `async function X(`
  return uniq.filter(i => {
    const pre = asciiSlice(buf, Math.max(0, i - 6), i)
    return !pre.endsWith('async ')
  })
}

function extractAround(i, maxLen = 20000) {
  // if this is `function` inside `async function`, step back
  const pre = asciiSlice(buf, Math.max(0, i - 6), i)
  const start = pre.endsWith('async ') ? i - 6 : i
  return { start, ...extractFnAt(buf, start, maxLen) }
}

function nearestFn(name, caller, window = 80000) {
  const hs = namedFnHits(name)
  let best = -1
  let bestAbs = Infinity
  for (const h of hs) {
    const d = Math.abs(h - caller)
    if (d < bestAbs) {
      bestAbs = d
      best = h
    }
  }
  const near = hs.filter(h => Math.abs(h - caller) < window)
  return { hs, best, bestAbs, near }
}

const jobs = [
  ['ME', 180587897],
  ['gl', 180587897],
  ['CAt', 186913600],
  ['x0e', 186913600],
  ['OS', 186913600],
  ['qo', 186913600],
  ['AVt', 187544776],
  ['wo', 180760796],
  ['pbr', 181265183],
  ['aw', 180769116],
  ['G3', 181689542],
  ['p5e', 181689542],
  ['Ii', 181689542],
  ['Zq', 180677347],
  ['ign', 185402726],
]

for (const [name, caller] of jobs) {
  const rec = nearestFn(name, caller, 200000)
  console.log(
    `\n${name} caller@${caller} defs=${rec.hs.length} nearest@${rec.best} d=${rec.bestAbs} near200k=${rec.near.join(',')}`,
  )
  if (rec.best >= 0 && rec.bestAbs < 4000000) {
    const ext = extractAround(rec.best, 40000)
    console.log(`  start=${ext.start} body=${!!ext.body} len=${ext.len} sha=${ext.sha}`)
    console.log(`  head: ${(ext.body || ext.preview || '').slice(0, 220)}`)
  }
}

console.log('\n=== qo near tomb: all defs with preview ===')
for (const h of namedFnHits('qo')) {
  if (Math.abs(h - 186913600) > 800000) continue
  const ext = extractAround(h, 4000)
  console.log(`  @${h} len=${ext.len} ${(ext.body || '').slice(0, 160)}`)
}

console.log('\n=== wo near rw ===')
for (const h of namedFnHits('wo')) {
  if (Math.abs(h - 180760796) > 300000) continue
  const ext = extractAround(h, 8000)
  console.log(`  @${h} d=${h - 180760796} len=${ext.len} ${(ext.body || '').slice(0, 200)}`)
}

console.log('\n=== Ii near J ===')
for (const h of namedFnHits('Ii')) {
  if (Math.abs(h - 181689542) > 2000000) continue
  const ext = extractAround(h, 4000)
  console.log(`  @${h} d=${h - 181689542} len=${ext.len} ${(ext.body || '').slice(0, 180)}`)
}

console.log('\n=== NU around Jbn ===')
for (const n of [
  'Object.hasOwn(NU',
  'NU=',
  ',NU=',
  'NU={',
  'var NU',
  'let NU',
  'const NU',
  'NU,',
]) {
  const hs = hitsOf(n)
  console.log(`  ${JSON.stringify(n)} ${hs.length} ${hs.slice(0, 10).join(',')}`)
}
const jbnWin = asciiSlice(buf, 180784700, 180785200)
console.log('  Jbn window:', jbnWin)
const jbnBack = asciiSlice(buf, 180780000, 180785000)
const nuIdx = jbnBack.lastIndexOf('NU')
console.log('  last NU in 5k before Jbn rel', nuIdx, jbnBack.slice(Math.max(0, nuIdx - 40), nuIdx + 80))

console.log('\n=== Rn/Cn assigns near Tn ===')
for (const n of ['Rn=/', 'var Rn=', ',Rn=', 'Cn=/', ',Cn=/', 'var Cn=']) {
  const hs = hitsOf(n)
  const near = hs.filter(h => Math.abs(h - 179761036) < 30000)
  console.log(`  ${n} near=${near.join(',')} all=${hs.slice(0, 6).join(',')}`)
  for (const h of near) console.log('   ', asciiSlice(buf, h, h + 280))
}

console.log('\n=== $Kt / ME async start ===')
const me = extractAround(179503988, 2000)
console.log('ME async', me.len, me.sha, me.body)
const x0e = extractAround(187199244, 4000)
console.log('x0e', x0e.len, x0e.sha, x0e.body)
const pbr = extractAround(181265557, 2000)
console.log('pbr', pbr.len, pbr.sha, pbr.body)
const p5e = extractAround(181690350, 2000)
console.log('p5e', p5e.len, p5e.sha, p5e.body)

console.log('\n=== host-flag empties enclosing fn ===')
for (const off of [204736897, 204737653, 204744237, 204745165, 205209179, 203965106, 180677131]) {
  const st = lastFnStartGeneric(buf, off + 1, 8000)
  const ext = st.i >= 0 ? extractFnAt(buf, st.i, 4000) : { miss: true }
  console.log(
    `  @${off} enc ${st.name}@${st.i} len=${ext.len} head=${(ext.body || '').slice(0, 160)}`,
  )
}

console.log('\n=== qo factory needles ===')
for (const n of [
  'function qo({content',
  'function qo(e){',
  'exhausted system',
  'isMeta:!0',
  'The model\'s tool call could not be parsed',
]) {
  const hs = hitsOf(n)
  console.log(`  ${JSON.stringify(n)} ${hs.length} ${hs.slice(0, 6).join(',')}`)
}

const qoCall = buf.indexOf(Buffer.from('qo({content:"The model\'s tool call could not be parsed'))
console.log('qo call @', qoCall)
if (qoCall >= 0) {
  console.log(asciiSlice(buf, qoCall - 20, qoCall + 180))
}
