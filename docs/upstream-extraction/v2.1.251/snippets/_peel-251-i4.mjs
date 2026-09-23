/**
 * densable 2.1.251 — extract z_ / Kle / yEt / gEt / Hye / Jt-hook / full bodies.
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

function extractGrow(i, caps = [2000, 8000, 20000, 60000, 200000, 800000]) {
  let last = { i, miss: true }
  for (const cap of caps) {
    last = extractFnAt(buf, i, cap)
    if (last.body) return { ...last, cap }
  }
  return last
}

function dumpFn(label, i) {
  const fn = extractGrow(i)
  console.log(
    `\n## ${label} @${i} miss=${!!fn.miss}${fn.missEnd ? ' missEnd' : ''} len=${fn.len ?? '-'} sha=${fn.sha ?? '-'} cap=${fn.cap ?? '-'}`,
  )
  console.log('HEAD', asciiSlice(buf, Math.max(0, i - 40), i + 60))
  if (fn.body) {
    console.log('FULL')
    console.log(fn.body)
  } else {
    console.log('PREVIEW', fn.preview ?? asciiSlice(buf, i, i + 400))
  }
  return fn
}

function extractClass(off, maxLen = 20000) {
  const win = asciiSlice(buf, off, off + maxLen)
  const brace = win.indexOf('{')
  if (brace < 0) return { miss: true }
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
        return { i: off, body, sha: sha(body), len: body.length }
      }
    }
  }
  return { missEnd: true, preview: win.slice(0, 300) }
}

console.log('--- needles ---')
for (const n of [
  'class gEt',
  'function gEt',
  'gEt=',
  'class Ln',
  'function Ln',
  'hookRegistrationInFlight',
  'var Jt=',
  'Jt=new Ln',
  'function Jt()',
  'limitsObserved',
  'rawUtilization',
]) {
  const hs = allHits(buf, n)
  console.log(`${JSON.stringify(n)} hits=${hs.length} ${hs.slice(0, 10).join(',')}`)
}

dumpFn('z_*', 187242129)

console.log('\n--- z_ neighborhood ---')
console.log(asciiSlice(buf, 187242000, 187242200))

// gEt near yEt
console.log('\n--- before yEt ---')
console.log(asciiSlice(buf, 186762400, 186762750))

for (const n of ['class gEt', 'function gEt', 'gEt{', 'class gEt{']) {
  const hs = allHits(buf, n)
  console.log(n, hs)
}

// walk back from yEt for gEt
{
  const start = 186761000
  const win = asciiSlice(buf, start, 186762723)
  const re = /(?:class|function|var|let|const) gEt/g
  let m
  while ((m = re.exec(win))) {
    console.log('gEt decl', start + m.index, win.slice(m.index, m.index + 80))
  }
}

// Ln class
for (const h of allHits(buf, 'class Ln')) {
  console.log('\nclass Ln @', h, asciiSlice(buf, h, h + 200))
}

// hookRegistrationInFlight
for (const h of allHits(buf, 'hookRegistrationInFlight')) {
  console.log(
    'hookReg @',
    h,
    asciiSlice(buf, h - 60, h + 80),
    'lastFn',
    lastFnStartGeneric(buf, h, 4000),
  )
}

dumpFn('HPe', 184985281)
dumpFn('jL-util', 184985089)
dumpFn('Jt-bar', 208972948)
dumpFn('Osn', 186758304)
dumpFn('Lsn', 186757898)
dumpFn('$sn', 185574156)
dumpFn('Y_e', 185568683)
dumpFn('vwe', 185568973)
dumpFn('VSn', 185573811)
dumpFn('gRn', 179049328)
dumpFn('dD', 186760799)
dumpFn('cre', 180584703)
dumpFn('hJ', 180584572)
dumpFn('pEt', 179887321)
dumpFn('LOe', 180780907)
dumpFn('yBn', 186764691)

console.log('\nHye const window:')
console.log(asciiSlice(buf, 185263180, 185263320))

console.log('\nKle window:')
console.log(asciiSlice(buf, 186765100, 186765220))

console.log('\nyEt window:')
console.log(asciiSlice(buf, 186762680, 186762760))

// HPe neighborhood - is limitsObserved the empty-window gate?
console.log('\nHPe neighborhood:')
console.log(asciiSlice(buf, 184984900, 184985400))
