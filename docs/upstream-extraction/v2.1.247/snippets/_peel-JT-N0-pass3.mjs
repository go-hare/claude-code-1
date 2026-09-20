import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

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

function dump(name, i, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i)
}

const header = Buffer.from('// @bun @bytecode')

function moduleSpan(anchor) {
  let from = Math.max(0, anchor - 3_000_000)
  let start = -1
  while (from < anchor) {
    const i = buf.indexOf(header, from)
    if (i < 0 || i > anchor) break
    start = i
    from = i + 10
  }
  const end = buf.indexOf(header, start + 10)
  return { start, end: end > 0 ? end : Math.min(buf.length, anchor + 20000) }
}

function lastIndexOfBuf(needle, start, end) {
  const n = Buffer.from(needle)
  let from = start
  let last = -1
  while (from < end) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i >= end) break
    last = i
    from = i + n.length
  }
  return last
}

// --- _844.js export map: h as Hyd, z as Iyd ---
const exp844 = 206455193
const span844 = moduleSpan(exp844)
console.log('844 span', span844, 'len', span844.end - span844.start)
dump('gold-dig-Ar-844-export.txt', exp844, 200, 400)
dump('gold-dig-Ar-844-modhead.txt', span844.start, 0, 500)

const win844 = asciiWindow(buf, span844.start, Math.min(span844.end, exp844 + 20))
for (const n of [
  'class h extends',
  'class h{',
  'h=class',
  'function h(',
  'function z(',
  'z=function',
  'this.telemetryMessage',
  'telemetryMessage',
  'name="TelemetrySafeError"',
  "name='TelemetrySafeError'",
]) {
  const i = win844.lastIndexOf(n)
  console.log('844 last', JSON.stringify(n), i)
  if (i >= 0) console.log(' ', win844.slice(i, i + 260).replace(/\n/g, ' '))
}

// raw lastIndex in 844 span
for (const n of [
  'this.telemetryMessage',
  'TelemetrySafeError',
  'function z(e,t)',
  'function h(e,t)',
  'class h extends Error',
]) {
  const i = lastIndexOfBuf(n, span844.start, span844.end)
  console.log('844 raw', JSON.stringify(n), i)
  if (i >= 0) console.log(' ', asciiWindow(buf, i, i + 300).replace(/\n/g, ' '))
}

// --- hfb = ce export @ 211612232 ---
const expHfb = 211612232
const spanHfb = moduleSpan(expHfb)
console.log('hfb span', spanHfb, 'len', spanHfb.end - spanHfb.start)
dump('gold-dig-tI-hfb-export.txt', expHfb, 200, 400)
dump('gold-dig-tI-hfb-modhead.txt', spanHfb.start, 0, 400)

for (const n of [
  'class ce extends',
  'class ce{',
  'ce=class',
  'function ce(',
  'this.telemetryMessage',
  'TelemetrySafeError',
  'command-source-refused',
  'managed policy',
]) {
  const i = lastIndexOfBuf(n, spanHfb.start, spanHfb.end)
  console.log('hfb raw', JSON.stringify(n), i)
  if (i >= 0) console.log(' ', asciiWindow(buf, i - 40, i + 280).replace(/\n/g, ' '))
}

// --- EOb = ur / DOb = Bm @ 209536882 / 209389044 ---
const expEob = 209536882
const spanCli = moduleSpan(expEob)
console.log('cli span', spanCli, 'len', spanCli.end - spanCli.start)
dump('gold-dig-JT-EOb-export.txt', expEob, 120, 200)
dump('gold-dig-JT-ur-body.txt', 209389044, 80, 350)

const bm = buf.indexOf(Buffer.from('function Bm(e){return'))
console.log('Bm', bm)
if (bm >= 0) dump('gold-dig-JT-Bm-body.txt', bm, 40, 280)

// N0: function N0( in whole exe with claude / plugin
let from = 0
let n0n = 0
const n0needle = Buffer.from('function N0(')
while (n0n < 20) {
  const i = buf.indexOf(n0needle, from)
  if (i < 0) break
  const win = asciiWindow(buf, i, i + 220)
  console.log('function N0', n0n, i, win.replace(/\n/g, ' ').slice(0, 200))
  from = i + 10
  n0n++
}

// marketplace-module N0 truncate def: walk back from first N0( call in-mod
const n0call = 217553250
const back = asciiWindow(buf, n0call - 8000, n0call)
const defRel = Math.max(
  back.lastIndexOf('function N0('),
  back.lastIndexOf('var N0='),
  back.lastIndexOf('N0=function'),
)
console.log('N0 def rel', defRel)
if (defRel >= 0) {
  const abs = n0call - 8000 + defRel
  console.log(asciiWindow(buf, abs, abs + 250))
  dump('gold-dig-N0-mod-def.txt', abs, 20, 300)
} else {
  dump('gold-dig-N0-call-trunc.txt', n0call, 80, 200)
}
