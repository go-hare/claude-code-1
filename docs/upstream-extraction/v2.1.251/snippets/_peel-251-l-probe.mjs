/**
 * Probe named missing callees for gold-251-l. Does not write gold.
 */
import {
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
} from './_peel-251-helpers.mjs'

const buf = loadSea()
if (buf.length !== 217360032) throw new Error(`size ${buf.length}`)

const CALLERS = {
  Pbt: 180587897,
  Jbn: 180784878,
  S: 204744184,
  F: 204745112,
  tomb: 186913600,
  BZn: 187544776,
  rw: 180760796,
  RYe: 181265183,
  aw: 180769116,
  J: 181689542,
  K: 181690406,
  Kh: 180677347,
  Zq: 180677112,
  ign: 185402726,
  Tn: 179761036,
}

function hitsOf(needle) {
  return allHits(buf, needle)
}

function lastNamedFn(name, before, maxLook = 800000) {
  const needle = `function ${name}(`
  const asyncNeedle = `async function ${name}(`
  const hits = [...hitsOf(needle), ...hitsOf(asyncNeedle)].sort((a, b) => a - b)
  const beforeHits = hits.filter(h => h < before)
  const i = beforeHits.length ? beforeHits[beforeHits.length - 1] : -1
  return { name, hits, i, dist: i < 0 ? null : before - i }
}

function lastAssign(name, before, maxLook = 400000) {
  const needles = [
    `${name}=`,
    `,${name}=`,
    `;${name}=`,
    `var ${name}=`,
    `let ${name}=`,
    `const ${name}=`,
  ]
  let best = -1
  let which = ''
  for (const n of needles) {
    const hs = hitsOf(n).filter(h => h < before && before - h < maxLook)
    if (hs.length) {
      const i = hs[hs.length - 1]
      if (i > best) {
        best = i
        which = n
      }
    }
  }
  return { name, i: best, which, preview: best < 0 ? '' : asciiSlice(buf, best, best + 220) }
}

function showFn(label, name, caller) {
  const rec = lastNamedFn(name, caller)
  const hitStr = rec.hits.slice(0, 8).join(',') + (rec.hits.length > 8 ? ` …+${rec.hits.length - 8}` : '')
  console.log(`\n=== ${label} ${name} caller@${caller} defHits=${rec.hits.length} lastBefore=${rec.i} dist=${rec.dist}`)
  console.log(`  hits: ${hitStr || '(none)'}`)
  if (rec.i >= 0) {
    const ext = extractFnAt(buf, rec.i, 40000)
    if (ext.body) {
      console.log(`  BODY len=${ext.len} sha=${ext.sha}`)
      console.log(`  head: ${ext.body.slice(0, 180)}`)
      console.log(`  tail: ${ext.body.slice(-120)}`)
    } else {
      console.log(`  missEnd preview: ${(ext.preview || '').slice(0, 180)}`)
    }
  } else {
    const asg = lastAssign(name, caller)
    console.log(`  no function. lastAssign ${asg.which} @${asg.i}`)
    console.log(`  ${asg.preview.slice(0, 200)}`)
    const gen = lastFnStartGeneric(buf, caller, 8000)
    console.log(`  lastFnStartGeneric @${gen.i} name=${gen.name}`)
  }
}

const jobs = [
  ['#53', 'NU', CALLERS.Jbn],
  ['#53', 'ME', CALLERS.Pbt],
  ['#53', 'gl', CALLERS.Pbt],
  ['#55', 'CAt', CALLERS.tomb],
  ['#55', 'x0e', CALLERS.tomb],
  ['#55', 'OS', CALLERS.tomb],
  ['#55', 'qo', CALLERS.tomb],
  ['#59', 'AVt', CALLERS.BZn],
  ['#60', 'wo', CALLERS.rw],
  ['#60', 'pbr', CALLERS.RYe],
  ['#60', 'aw', CALLERS.aw],
  ['#61', 'G3', CALLERS.J],
  ['#61', 'p5e', CALLERS.J],
  ['#61', 'Ii', CALLERS.J],
  ['#62', 'Zq', CALLERS.Kh],
  ['#63', 'ign', CALLERS.ign],
  ['#67', 'Rn', CALLERS.Tn],
  ['#67', '$Kt', CALLERS.Tn],
  ['#67', 'Cn', CALLERS.Tn],
]

for (const j of jobs) showFn(...j)

console.log('\n=== host-flag empty returns ===')
for (const n of [
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)return[]',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)return',
  'PROVIDER_MANAGED_BY_HOST)return[]',
  'PROVIDER_MANAGED_BY_HOST)return;',
]) {
  const hs = hitsOf(n)
  console.log(`${JSON.stringify(n)} hits=${hs.length} ${hs.slice(0, 12).join(',')}`)
}

console.log('\n=== NU / Rn / Cn assignment shapes near callers ===')
for (const [name, caller] of [
  ['NU', CALLERS.Jbn],
  ['Rn', CALLERS.Tn],
  ['Cn', CALLERS.Tn],
  ['wo', CALLERS.rw],
]) {
  for (const n of [
    `function ${name}(`,
    `async function ${name}(`,
    `${name}=/`,
    `${name}={`,
    `var ${name}=`,
    `,${name}=/`,
    `,${name}={`,
    `${name}=new`,
  ]) {
    const hs = hitsOf(n)
    const near = hs.filter(h => Math.abs(h - caller) < 200000)
    if (hs.length) {
      console.log(
        `  ${name} ${JSON.stringify(n)} total=${hs.length} near200k=${near.length} ${near.slice(0, 6).join(',') || hs.slice(0, 4).join(',')}`,
      )
    }
  }
}

console.log('\n=== CAt/x0e/OS/qo unique needles ===')
for (const n of [
  'function CAt(',
  'function x0e(',
  'function OS(',
  'function qo(',
  'text_has_leaked_invoke',
  'malformed_tool_use_exhausted',
]) {
  const hs = hitsOf(n)
  console.log(`  ${JSON.stringify(n)} ${hs.length} ${hs.slice(0, 8).join(',')}`)
}
