/**
 * Full remaining bodies: NU, Cn, wo, qo, ign, ME siblings, bjn, host-flag R/U/B.
 */
import {
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()

function hitsOf(n) {
  return allHits(buf, n)
}

function namedFnHits(name) {
  const raw = [...hitsOf(`function ${name}(`), ...hitsOf(`async function ${name}(`)]
  const uniq = [...new Set(raw)].sort((a, b) => a - b)
  return uniq.filter(i => !asciiSlice(buf, Math.max(0, i - 6), i).endsWith('async '))
}

function extractAround(i, maxLen = 40000) {
  const pre = asciiSlice(buf, Math.max(0, i - 6), i)
  const start = pre.endsWith('async ') ? i - 6 : i
  return { start, ...extractFnAt(buf, start, maxLen) }
}

function extractAssignValue(i, maxLen = 20000) {
  const win = asciiSlice(buf, i, i + maxLen)
  const eq = win.indexOf('=')
  if (eq < 0) return { i, miss: true }
  let p = eq + 1
  while (p < win.length && (win[p] === ' ' || win[p] === '\n')) p++
  const startChar = win[p]
  if (startChar === '/' && win[p + 1] !== '/') {
    // regex
    let esc = false
    for (let q = p + 1; q < win.length; q++) {
      const c = win[q]
      if (esc) {
        esc = false
        continue
      }
      if (c === '\\') {
        esc = true
        continue
      }
      if (c === '/') {
        let flags = ''
        let r = q + 1
        while (r < win.length && /[gimsuy]/.test(win[r])) {
          flags += win[r]
          r++
        }
        const body = win.slice(0, r)
        return { i, body, sha: sha(body), len: body.length, kind: 'regex' }
      }
    }
    return { i, missEnd: true, kind: 'regex', preview: win.slice(0, 200) }
  }
  if (startChar === '{' || startChar === '[') {
    const open = startChar
    const close = startChar === '{' ? '}' : ']'
    let depth = 0
    let inStr = null
    let esc = false
    for (let q = p; q < win.length; q++) {
      const c = win[q]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === inStr) inStr = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') {
        inStr = c
        continue
      }
      if (c === open) depth++
      else if (c === close) {
        depth--
        if (depth === 0) {
          const body = win.slice(0, q + 1)
          return { i, body, sha: sha(body), len: body.length, kind: 'obj' }
        }
      }
    }
    return { i, missEnd: true, kind: 'obj', preview: win.slice(0, 240) }
  }
  // until comma/semicolon at depth 0
  let depth = 0
  let inStr = null
  let esc = false
  for (let q = p; q < win.length; q++) {
    const c = win[q]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') depth--
    else if (depth === 0 && (c === ';' || c === ',')) {
      const body = win.slice(0, q)
      return { i, body, sha: sha(body), len: body.length, kind: 'expr' }
    }
  }
  return { i, missEnd: true, preview: win.slice(0, 200) }
}

console.log('=== all ME ===')
for (const h of namedFnHits('ME')) {
  const ext = extractAround(h)
  console.log(`@${h} len=${ext.len} ${ (ext.body || '').slice(0, 160)}`)
}

console.log('\n=== Pbt neighborhood ===')
console.log(asciiSlice(buf, 180587650, 180588120))

console.log('\n=== NU assigns ===')
for (const h of hitsOf('NU=')) {
  const prev = asciiSlice(buf, Math.max(0, h - 20), h + 4)
  console.log(`@${h} prev=${JSON.stringify(prev)}`)
}
const nu = extractAssignValue(180248953, 80000)
console.log('NU @180248953', nu.kind, nu.len, nu.sha, nu.missEnd ? 'MISS' : 'BODY')
console.log((nu.body || nu.preview || '').slice(0, 800))
console.log('---tail---')
console.log((nu.body || '').slice(-200))

console.log('\n=== NU= window @180248940 ===')
console.log(asciiSlice(buf, 180248900, 180249400))

console.log('\n=== Cn regex full ===')
const cn = extractAssignValue(179760658, 4000)
console.log(cn.kind, cn.len, cn.sha)
console.log(cn.body || cn.preview)

console.log('\n=== Rn regex ===')
const rn = extractAssignValue(179761257, 400)
console.log(rn.kind, rn.len, rn.sha, rn.body)

console.log('\n=== $Kt full ===')
const kt = extractAround(179744103)
console.log(kt.len, kt.sha, kt.body)

console.log('\n=== wo full ===')
const wo = extractAround(180773882, 20000)
console.log(wo.len, wo.sha)
console.log(wo.body)

console.log('\n=== qo full ===')
const qo = extractAround(188061219, 8000)
console.log(qo.len, qo.sha)
console.log(qo.body)

console.log('\n=== ign full ===')
const ign = extractAround(185402726, 20000)
console.log(ign.len, ign.sha)
console.log(ign.body)

console.log('\n=== bjn near CAt ===')
for (const n of ['bjn=', 'var bjn', ',bjn=', 'bjn=/']) {
  const hs = hitsOf(n)
  const near = hs.filter(h => Math.abs(h - 186859544) < 80000)
  console.log(n, 'near', near, 'all', hs.slice(0, 6))
  for (const h of near.slice(0, 3)) {
    const asg = extractAssignValue(h, 2000)
    console.log(' ', h, asg.kind, asg.len, asg.body || asg.preview)
  }
}

console.log('\n=== AVt + VP ===')
const avt = extractAround(180783062)
console.log(avt.body)
const vpHits = namedFnHits('VP')
const vpNear = vpHits
  .map(h => ({ h, d: Math.abs(h - 180783062) }))
  .sort((a, b) => a.d - b.d)
  .slice(0, 5)
console.log('VP nearest', vpNear)
if (vpNear[0]) console.log(extractAround(vpNear[0].h).body)

console.log('\n=== host R U B ===')
for (const [name, i] of [
  ['R', 204736845],
  ['U', 204737601],
  ['B', 205209120],
  ['zje', 203965042],
]) {
  const ext = extractAround(i, 8000)
  console.log(`\n${name} @${i} len=${ext.len} sha=${ext.sha}`)
  console.log(ext.body)
}

console.log('\n=== Ii all distances from J ===')
for (const h of namedFnHits('Ii')) {
  console.log(h, h - 181689542, extractAround(h).body?.slice(0, 80))
}

console.log('\n=== wo().state hits ===')
for (const n of ['wo().state', 'function wo()']) {
  console.log(n, hitsOf(n))
}
