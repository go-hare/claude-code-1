import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function ascii(start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function allHits(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function extractFrom(offset, max = 4000) {
  let i = offset
  let depth = 0
  let seen = false
  while (i < offset + max && i < buf.length) {
    if (buf[i] === 123) {
      depth++
      seen = true
    } else if (buf[i] === 125) {
      depth--
      if (seen && depth === 0) return ascii(offset, i + 1)
    }
    i++
  }
  return ascii(offset, Math.min(offset + max, buf.length))
}

const base = 'docs/upstream-extraction/v2.1.247/snippets/'
const winLo = 210520000
const winHi = 210560000

function report(label, needle) {
  const hits = allHits(needle)
  const win = hits.filter(i => i > winLo && i < winHi)
  console.log(
    `\n==== ${label} ====\nneedle=${JSON.stringify(needle)} total=${hits.length} win=${win.length} hits=${JSON.stringify(hits.slice(0, 10))}`,
  )
  for (const i of (win.length ? win : hits).slice(0, 2)) {
    console.log(`@${i}`, ascii(i, i + 200))
  }
  return { hits, win }
}

const pnSig = 'function pn(){return y([oe(),un()'
const ieSig = 'function Ie(){let e=pn(),n=j()'
const wSig = 'function w(){return S(_.of(f().host))}'
const jSig = 'function J(){let e=_.of(f().host),r=S(e);return r}'
const krSig = 'function Kr(){let e=qa();return["/dev/stdout"'
const nSig = 'function N(){let e=l.CLAUDE_CODE_TMPDIR'

const pn = report('pn unique', pnSig)
const ie = report('Ie unique', ieSig)
report('function pn(){', 'function pn(){')
report('function Ie(){', 'function Ie(){')
report('function oe(){', 'function oe(){')
report('function un(){', 'function un(){')
report('function ne(){', 'function ne(){')
report('wZb as oe', 'wZb as oe')
report('yZb as un', 'yZb as un')
report('yKb as ne', 'yKb as ne')
report('w unique sig', wSig)
report('J unique sig', jSig)
report('Kr unique sig', krSig)
report('N unique sig', nSig)
report('function w(){', 'function w(){')
report('function J(){', 'function J(){')
report('function Kr(){', 'function Kr(){')

const pnOff = pn.hits[0]
const ieOff = ie.hits[0]
const wOff = allHits(wSig)[0]
const jOff = allHits(jSig)[0]
const krOff = allHits(krSig)[0]
const nOff = allHits(nSig)[0]

writeFileSync(base + 'gold-forged-pn.txt', extractFrom(pnOff, 400))
// win32 case-fold: do not write gold-forged-Ie*.txt / gold-forged-ne.txt
writeFileSync(base + 'gold-forged-pn-Ie.txt', extractFrom(ieOff, 400))

const oeHits = allHits('function oe(){')
const unHits = allHits('function un(){')
const neHits = allHits('function ne(){')

writeFileSync(
  base + 'gold-forged-oe.txt',
  [
    `# function oe(){ hits=${oeHits.length} win(21052-21056)=${oeHits.filter(i => i > winLo && i < winHi).length} NOT UNIQUE`,
    `# import: wZb as oe from _615.js @210530797`,
    `# target ${wSig} unique @${wOff} (function w(){ hits=${allHits('function w(){').length} shared tempfile)`,
    extractFrom(nOff, 200),
    extractFrom(wOff, 200),
    extractFrom(allHits('function S(e){let t=d(N(),"claude")')[0], 400),
  ].join('\n'),
)

writeFileSync(
  base + 'gold-forged-un.txt',
  [
    `# function un(){ hits=${unHits.length} win(21052-21056)=0 NOT UNIQUE`,
    `# import: yZb as un from _615.js @210530807`,
    `# target ${jSig} unique @${jOff} (function J(){ hits=${allHits('function J(){').length} shared tempfile)`,
    extractFrom(jOff, 200),
  ].join('\n'),
)

writeFileSync(
  base + 'gold-forged-pn-ne.txt',
  [
    `# function ne(){ hits=${neHits.length} win(21052-21056)=0 NOT UNIQUE`,
    `# import: yKb as ne from _584.js @210530552 (yKb as sites=${allHits('yKb as').length})`,
    `# target ${krSig} unique @${krOff} (function Kr(){ hits=${allHits('function Kr(){').length}; qa() not locked in _584)`,
    extractFrom(krOff, 400),
  ].join('\n'),
)

console.log('\n==== wrote ====')
console.log('pn', pnOff, extractFrom(pnOff, 400))
console.log('Ie', ieOff, extractFrom(ieOff, 400))
console.log('oe/w', wOff, extractFrom(wOff, 120))
console.log('un/J', jOff, extractFrom(jOff, 120))
console.log('ne/Kr', krOff, extractFrom(krOff, 280))

console.log('\n==== verdict ====')
console.log(
  'pn+Ie unique. oe/un are shared _615 os.tmpdir helpers (w/J/N). ne is _584 Kr sandbox extras. DO NOT invent TMP/TEMP/os.tmpdir lists. leave []',
)
