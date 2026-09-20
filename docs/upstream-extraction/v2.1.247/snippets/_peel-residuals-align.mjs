import { existsSync, readFileSync, writeFileSync } from 'fs'

const p247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
if (!existsSync(p247)) {
  console.log('MISSING SEA', p247)
  process.exit(1)
}
const buf = readFileSync(p247)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

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

function extractFn(pos, name, max = 4000) {
  const startNeedle = Buffer.from(name)
  let start = pos
  const back = ascii(Math.max(0, pos - 80), pos)
  const idx = back.lastIndexOf(name.startsWith('async') ? 'async function' : 'function')
  if (idx >= 0) start = pos - (80 - idx)
  let i = start
  let depth = 0
  let seen = false
  while (i < start + max && i < buf.length) {
    const c = buf[i]
    if (c === 123) {
      depth++
      seen = true
    } else if (c === 125) {
      depth--
      if (seen && depth === 0) {
        return ascii(start, i + 1)
      }
    }
    i++
  }
  return ascii(start, Math.min(start + max, buf.length))
}

function dump(name, needle, before, after, which = 0) {
  const hits = allHits(needle)
  if (!hits.length) {
    console.log('MISS', name, JSON.stringify(needle))
    return
  }
  const i = hits[which] ?? hits[0]
  const s = ascii(Math.max(0, i - before), i + after)
  writeFileSync(
    `${outDir}/${name}`,
    `# offset=${i} hit=${which + 1}/${hits.length} needle=${JSON.stringify(needle)}\n\n${s}\n`,
  )
  console.log('OK', name, i, `${which + 1}/${hits.length}`)
}

// wrap fN/pN
dump('gold-11-fn-fN-near.txt', 'async function fN(){await _y().catch', 200, 2500, 0)
const fNHits = allHits('async function fN()')
console.log('fN hits', fNHits)
if (fNHits[0] != null) {
  writeFileSync(`${outDir}/gold-11-fn-fN-body.txt`, extractFn(fNHits[0], 'async function fN()', 3000))
  console.log('fN body', extractFn(fNHits[0], 'async function fN()', 3000).length)
}
const pNHits = allHits('function pN()')
console.log('pN hits', pNHits.slice(0, 8))
for (const [k, h] of pNHits.slice(0, 6).entries()) {
  const win = ascii(h, h + 200)
  console.log('pN', k, win.slice(0, 180))
  if (win.includes('function pN(){') && (win.includes('yN') || win.includes('wrap') || win.includes('Te()') || win.includes('_y') || win.includes('sandbox'))) {
    writeFileSync(`${outDir}/gold-11-fn-pN-body.txt`, extractFn(h, 'function pN()', 2500))
    console.log('pN body from', h)
  }
}

dump('gold-11-fn-pN-near-fN.txt', 'async function fN(){await _y().catch', 100, 4000, 0)

// WZ helpers
dump('gold-11-fn-Vm-near.txt', 'function Vm(', 50, 400, 0)
for (const [k, h] of allHits('function Vm(').slice(0, 5).entries()) {
  console.log('Vm', k, ascii(h, h + 180))
}
dump('gold-11-fn-Ji-near.txt', 'function Ji(', 50, 400, 0)
dump('gold-11-fn-Qi-near.txt', 'function Qi(', 50, 400, 0)

// Whe / Q4o / Joi
for (const n of [
  'async function Whe',
  'function Whe(',
  'async function Q4o',
  'function Q4o(',
  'getRelevantTips',
  'cooldownSessions',
  'maxLifetimeShows',
]) {
  const hits = allHits(n)
  console.log(JSON.stringify(n), hits.length, hits.slice(0, 4))
}

dump('gold-2-Whe-async.txt', 'async function Whe', 80, 2000, 0)
dump('gold-2-Whe-fn.txt', 'function Whe(', 80, 2000, 0)
dump('gold-2-Q4o.txt', 'function Q4o(', 80, 2000, 0)
dump('gold-2-Joi-cooldown.txt', 'cooldownSessions', 400, 800, 0)

// QT
for (const n of ['function QT(', 'function QT()', 'let x=QT(', 'QT(u)']) {
  const hits = allHits(n)
  console.log(JSON.stringify(n), hits.length, hits.slice(0, 6))
}
dump('gold-19-QT-fn.txt', 'function QT(', 80, 600, 0)
dump('gold-19-QT-call.txt', 'let x=QT(', 80, 200, 0)

// checkPid pty
dump('gold-15-checkPid-pty.txt', 'failIfHostExited("poll")', 300, 200, 0)
dump('gold-15-checkPid-kill0.txt', 'if(!this.pty)', 200, 250, 0)
