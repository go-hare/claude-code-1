import { readFileSync, writeFileSync } from 'fs'

const buf247 = readFileSync(
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

function first(needle, from = 0) {
  return buf247.indexOf(Buffer.from(needle), from)
}

function dumpAt(name, i, before, after, needle) {
  if (i < 0) {
    console.log('MISS', name, JSON.stringify(needle))
    return
  }
  const s = asciiWindow(buf247, Math.max(0, i - before), i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# 247 offset=${i} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', name, i)
}

function all(needle) {
  const n = Buffer.from(needle)
  const out = []
  let from = 0
  while (from < buf247.length) {
    const i = buf247.indexOf(n, from)
    if (i < 0) break
    out.push(i)
    from = i + n.length
  }
  return out
}

// All function ly( near xt (231300179)
const xt = first('function xt(ote){let Va=R(18)')
console.log('xt', xt)
for (const i of all('function ly(')) {
  if (Math.abs(i - xt) < 800000) {
    const head = asciiWindow(buf247, i, i + 180)
    console.log('ly-near-xt', i, xt - i, head.slice(0, 160))
    if (Math.abs(i - xt) < 200000) {
      dumpAt(`gold-ly-near-xt-${i}.txt`, i, 40, 600, 'function ly( near xt')
    }
  }
}

for (const i of all('function cy(')) {
  if (Math.abs(i - xt) < 200000) {
    console.log('cy-near-xt', i, xt - i, asciiWindow(buf247, i, i + 160))
  }
}

// xt callers with body
for (const needle of [
  'body:ry',
  'body:',
  'o(xt,{',
  'displayName:',
]) {
  // skip
}

dumpAt('gold-xt-callers.txt', first('o(xt,{'), 200, 400, 'o(xt,{')
// second o(xt
const xt2 = first('o(xt,{', first('o(xt,{') + 5)
dumpAt('gold-xt-callers-2.txt', xt2, 200, 500, 'o(xt,{ #2')
const xt3 = first('o(xt,{', xt2 + 5)
dumpAt('gold-xt-callers-3.txt', xt3, 200, 500, 'o(xt,{ #3')

// UserCrossSession render
dumpAt(
  'gold-UserCross-render.txt',
  first('Cannot destructure property \'UserCrossSessionMessage\''),
  200,
  1500,
  'UserCrossSessionMessage destructure',
)

// pm module dump
const pm = first('function pm(){return H("policySettings")===null')
dumpAt('gold-pm-module-8k.txt', pm, 8000, 400, 'pm module 8k before')

// policy errors
for (const needle of [
  'could not be read',
  'getSettingsWithErrors',
  'policySettingsErrors',
  'managedSettingsErrors',
]) {
  const hits = all(needle)
  console.log(needle, hits.slice(0, 8), 'count', hits.length)
}

dumpAt(
  'gold-could-not-be-read-settings.txt',
  first('could not be read'),
  400,
  400,
  'could not be read first',
)

// hu helpers
const hu = first('function hu(){return DP()||Pt()!==null||Zi()||IP()}')
dumpAt('gold-hu-exact.txt', hu, 800, 200, 'hu exact')
dumpAt('gold-function-ie.txt', first('function ie(){return'), 40, 300, 'function ie(){return')
dumpAt('gold-function-Zi.txt', first('function Zi(){return'), 40, 300, 'function Zi(){return')
dumpAt('gold-function-Pt.txt', first('function Pt(){return'), 40, 300, 'function Pt(){return')
dumpAt('gold-function-Un.txt', first('function Un(){'), 40, 400, 'function Un(){')
dumpAt('gold-function-Io.txt', first('function Io('), 40, 300, 'function Io(')

// CL / E3n / uV
dumpAt('gold-var-E3n.txt', first('var E3n='), 40, 80, 'var E3n=')
dumpAt('gold-function-CL-compact.txt', first('function CL(e,t){let n=Math.min(uV(e),E3n)'), 40, 200, 'CL compact')

// Xb usage
dumpAt('gold-Xb-call.txt', first('Xb()'), 200, 400, 'Xb()')
dumpAt('gold-Xb-call2.txt', first('Xb()?'), 200, 400, 'Xb()?')
