/**
 * Pass 4: extractFnAt at known-good offsets; class O6e/xhe; imported ao/lY/gt.
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

function grow(i, max = 120000) {
  for (const cap of [1500, 4000, 12000, 40000, max]) {
    const ex = extractFnAt(buf, i, cap)
    if (ex.body) return { ...ex, at: i }
  }
  const ex = extractFnAt(buf, i, max)
  return { ...ex, at: i }
}

function show(label, i, cap = 3000) {
  const ex = grow(i)
  console.log(`\n==== ${label} @${i}`)
  if (!ex.body) {
    console.log('MISS', asciiSlice(buf, i, i + 200))
    return ex
  }
  console.log(`len=${ex.len} sha=${ex.sha} head=${ex.body.slice(0, 60)}`)
  console.log(ex.body.length <= cap ? ex.body : ex.body.slice(0, cap) + `\n… +${ex.body.length - cap}`)
  return ex
}

function dump(needle, n = 8) {
  const hits = allHits(buf, needle)
  console.log(`\n=== ${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, n)) {
    console.log(`  @${h} ${asciiSlice(buf, h - 50, h + Math.min(needle.length + 140, 200)).replace(/\s+/g, ' ')}`)
  }
  return hits
}

function extractClass(name, near) {
  const needles = [`class ${name}{`, `class ${name} `, `class ${name}\n`]
  let best = null
  for (const n of needles) {
    for (const h of allHits(buf, n)) {
      const d = Math.abs(h - near)
      if (!best || d < best.d) best = { h, n, d }
    }
  }
  if (!best) {
    console.log(`class ${name} MISS`)
    return null
  }
  const win = asciiSlice(buf, best.h, best.h + 20000)
  // brace match from first {
  const brace = win.indexOf('{')
  let depth = 0
  let inStr = null
  let esc = false
  for (let p = brace; p < win.length; p++) {
    const c = win[p]
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
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const body = win.slice(0, p + 1)
        console.log(`\n==== class ${name} @${best.h} len=${body.length} sha=${sha(body)} via=${best.n} dist=${best.d}`)
        console.log(body.length <= 8000 ? body : body.slice(0, 8000) + `\n… +${body.length - 8000}`)
        return { at: best.h, body, len: body.length, sha: sha(body) }
      }
    }
  }
  console.log(`class ${name} missEnd @${best.h}`)
  console.log(win.slice(0, 400))
  return null
}

// #2
show('vp', 188065722, 4000)
show('tX', 188064834, 1500)
show('MLe', 181896185, 1500)
show('K-session', 179041915, 200)
show('IN', 185847023, 500)
show('rbe', 185848716, 200)
show('j8t', 200901033, 80)
show('jUe', 200901113, 200)
show('j8t-alt', 184775812, 80)

// #4 tracker
show('cL', 185036298, 80)
show('c$t', 185036528, 80)
show('u$t', 185036585, 80)
show('D6e-record', 185036330, 200)
show('_8-drop', 185036457, 80)
show('_Gn-clear', 185036641, 200)
extractClass('O6e', 185036298)
extractClass('xhe', 185036298)
dump('class O6e')
dump('class xhe')
dump('function O6e')
dump('O6e{')
dump('xhe{')
dump('new O6e')
dump('new xhe')

// window around tracker methods
console.log('\n==== tracker window 185033400-185036800')
console.log(asciiSlice(buf, 185033400, 185036800))

// #6 ao import + ancestor helper
dump('chunk-vv6p7qh8')
dump('for(let d of ao(')
dump('for(let y of ao(')
dump('function ao(t){let')
// path ancestor: walk L( or dirname
dump('function ao(t){let e=[t]')
dump('ancestors')
// gt readlink near UWt
dump('function gt(')
show('gt-near-UWt', 182285204, 200) // from j2 nearest gt

// Find ao that returns parent chain — look for "while" + L( inside small ao
console.log('\n==== ao decls that look like ancestor walk')
for (const h of allHits(buf, 'function ao(')) {
  const ex = grow(h, 4000)
  if (!ex.body || ex.len > 1500) continue
  const walk =
    (ex.body.includes('L(') || ex.body.includes('dirname') || ex.body.includes('parent')) &&
    (ex.body.includes('push') || ex.body.includes('yield') || ex.body.includes('unshift') || ex.body.includes('while'))
  if (walk || ex.body.includes('/proc/self/fd')) {
    console.log(`ao@${h} len=${ex.len} sha=${ex.sha} procFd=${ex.body.includes('/proc/self/fd')}`)
    console.log(ex.body)
  }
}

// imported ao from path cluster — search export
dump('ao:')
dump('ao:()=>')

// #9
show('qhn-net', 182004789, 400)
show('Oo', 193380287, 200)
show('htn', 193380194, 120)
show('iJ', 182137594, 120)

// #10 lY import
dump('lY as ')
dump('{lY')
dump('lY,')
const e2tImportWin = asciiSlice(buf, 183340000, 183343478)
console.log('\n==== E2t prelude 183340000-183343478')
console.log(e2tImportWin.slice(-800))

// #18
show('hM', 180217949, 80)
show('toe', 180217980, 80)
show('o5', 180218041, 800)
show('ui', 180217756, 250)
show('db', 180217091, 400)
show('Fx', 180131955, 120)
show('yN', 179889190, 150)
show('Bdt', 186056653, 200)
show('Qan', 186055955, 120)

// #16
show('lyr', 181659488, 300)
show('ce-near-lyr', 181659488 - 33130, 200)
