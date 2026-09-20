import { existsSync, readFileSync, writeFileSync } from 'fs'

const p247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const p246 =
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'

function allHits(buf, needle) {
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

function asciiWindow(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function dumpAt(buf, name, offset, before, after, extra = '') {
  const s = asciiWindow(buf, Math.max(0, offset - before), offset + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${offset} ${extra}\n\n${s}\n`,
  )
  console.log('OK', name, offset, s.length)
}

const b247 = readFileSync(p247)
const b246 = existsSync(p246) ? readFileSync(p246) : null

// #9 yh regex + 246 Ea CSI u
for (const n of [
  'var yh=',
  'yh=/',
  'function yh',
  'var ph=',
  'ph=/',
]) {
  const h = allHits(b247, n)
  console.log('247', n, h.length, h.slice(0, 3).join(','))
}

const yhNear = allHits(b247, 'function Ea(e=""){')
console.log('Ea 247', yhNear)
if (yhNear[0]) dumpAt(b247, 'gold-9-Ea.txt', yhNear[0], 2500, 2000)

if (b246) {
  const qs = allHits(b246, 'function Qs(e=""){')
  console.log('Qs 246', qs)
  if (qs[0]) dumpAt(b246, 'gold246-9-Qs.txt', qs[0], 2500, 2000)
}

// search yh= near parse-keypress offset 211023528
dumpAt(b247, 'gold-9-yh-before.txt', 211023528, 8000, 200)

// #10 jM YM ol Kb INITIAL
for (const n of ['var jM=', 'jM=/', 'var YM=', 'YM=/', 'function ol(', 'var Kb=']) {
  const h = allHits(b247, n)
  console.log('10', n, h.length, h.slice(0, 5).join(','))
}

// find jM= in window before qb
dumpAt(b247, 'gold-10-regex-before.txt', 211021159, 4000, 200)

// INITIAL_STATE
const init = allHits(b247, 'droppedMousePrefix:""')
console.log('droppedMousePrefix:""', init)
for (const off of init.slice(0, 4)) {
  dumpAt(b247, `gold-10-init-${init.indexOf(off)}.txt`, off, 400, 400)
}

// #29 pt(
const ptCall = allHits(b247, 'E?pt(e.href)')
console.log('E?pt', ptCall)
if (ptCall[0]) dumpAt(b247, 'gold-29-pt-call.txt', ptCall[0], 500, 200)

for (const n of ['function pt(', 'function pt(e)', 'pt=function']) {
  const h = allHits(b247, n)
  console.log(n, h.length, h.slice(0, 8).join(','))
}

// search unique from link case: linkCap
const linkCap = allHits(b247, 'linkCap')
console.log('linkCap', linkCap.length, linkCap.slice(0, 6).join(','))
if (linkCap[0]) dumpAt(b247, 'gold-29-linkCap-0.txt', linkCap[0], 2000, 2000)

// G(e.href) and z(e.href) near markdown
const Ghref = allHits(b247, 'G(e.href)')
console.log('G(e.href)', Ghref)

// #11 Ec
for (const n of ['function Ec(', 'function Ec()', 'Ec=function', 'function Ec({']) {
  const h = allHits(b247, n)
  console.log(n, h.length, h.slice(0, 6).join(','))
}

dumpAt(b247, 'gold-11-Ec-search.txt', 209993434, 8000, 200)

// settings symlink cleanup needles
for (const n of [
  'settings.json',
  'userSettings',
  'isSymbolicLink()&&',
  'isSymbolicLink())',
  'readlink(',
  'readlinkSync(',
  'realpathSync(',
  'outside',
  'writable',
]) {
  const h = allHits(b247, n)
  const h6 = b246 ? allHits(b246, n).length : -1
  if (h.length !== h6) console.log('DIFF', n, h6, '->', h.length)
}

// #3 sW
for (const n of ['var sW=', 'sW={', 'sW.workflow=', 'workflow:"Yes']) {
  const h = allHits(b247, n)
  console.log('3', n, h.length, h.slice(0, 4).join(','))
}
const yesSwitch = allHits(b247, 'Yes, and switch to auto mode')
console.log('Yes switch hits', yesSwitch.length)
for (let i = 0; i < Math.min(yesSwitch.length, 4); i++) {
  const s = asciiWindow(b247, Math.max(0, yesSwitch[i] - 300), yesSwitch[i] + 200)
  if (s.includes('sW') || s.includes('workflow') || s.includes('function')) {
    dumpAt(b247, `gold-3-yes-${i}.txt`, yesSwitch[i], 800, 400, 'js-ish')
  }
}

// COe
for (const n of ['function COe(', 'COe=']) {
  const h = allHits(b247, n)
  console.log(n, h.length, h.slice(0, 5).join(','))
}

// DualInk function start - find `function` before canOffer at 232860427
dumpAt(b247, 'gold-3-cmy-start.txt', 232860000, 3500, 500)

// caller of ut / installBindingsForZed
const instZed = allHits(b247, 'Installed Zed Shift+Enter')
console.log('Installed Zed', instZed)
for (const off of instZed) {
  const s = asciiWindow(b247, Math.max(0, off - 200), off + 100)
  if (s.includes('function') || s.includes('installed')) {
    dumpAt(b247, `gold-12-caller-${instZed.indexOf(off)}.txt`, off, 3000, 800)
  }
}
