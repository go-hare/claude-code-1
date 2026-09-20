/**
 * #8 pass2g — ED (246) vs VD (247) callers; bg-agent attach vs toolErrors.
 */
import { readFileSync, writeFileSync } from 'fs'

const buf247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const buf246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function asciiWindow(buf, start, end) {
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

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    hits.push(j)
    i = j + n.length
    if (hits.length > 40) break
  }
  return hits
}

function dump(name, text) {
  const body = text.endsWith('\n') ? text : `${text}\n`
  writeFileSync(`${outDir}/${name}`, body)
  console.log('WROTE', name, body.length)
}

// 246 error formatter is ED at 212641910 area
const edDef = buf246.indexOf(
  Buffer.from(
    'function ED(e){if(e instanceof Rn)return e.message||kw;if(!(e instanceof Error))return String(e)',
  ),
)
const vdDef = buf247.indexOf(
  Buffer.from(
    'function VD(e){if(e instanceof yn)return e.message||jw;if(!(e instanceof Error))return String(e)',
  ),
)
console.log({ edDef, vdDef })

dump(
  'gold-8-pass2g-ED-complete-246.txt',
  `# off=${edDef}\n\n${asciiWindow(buf246, edDef, edDef + 700)}\n`,
)
dump(
  'gold-8-pass2g-VD-complete-247.txt',
  `# off=${vdDef}\n\n${asciiWindow(buf247, vdDef, vdDef + 400)}\n`,
)

// Distinctive call shapes
const callNeedles = [
  'Ht(VD(',
  'Ht(ED(',
  'return Pc(n)',
  'return ED(',
  'return VD(',
  'VD(Wt)',
  'ED(Wt)',
  'VD(e)',
  'ED(e)',
  'Pc(n)',
  'Pc(Ur(',
]
console.log('\n=== call shapes ===')
for (const n of callNeedles) {
  const a = allHits(buf246, n)
  const b = allHits(buf247, n)
  if (a.length || b.length) {
    console.log(`${a.length}\t${b.length}\t${JSON.stringify(n)}${a.length !== b.length ? ' DIFF' : ''}`)
  }
}

for (const n of ['Ht(VD(', 'Ht(ED(', 'VD(Wt)', 'ED(Wt)', 'Pc(Ur(']) {
  for (const [ver, buf] of [
    [247, buf247],
    [246, buf246],
  ]) {
    allHits(buf, n)
      .slice(0, 4)
      .forEach((off, i) => {
        dump(
          `gold-8-pass2g-call-${n.replace(/[^A-Za-z0-9]+/g, '')}-${ver}-h${i}.txt`,
          `# off=${off}\n\n${asciiWindow(buf, Math.max(0, off - 250), off + 200)}\n`,
        )
      })
  }
}

// Unique 247 strings around ED/VD cluster
const clusterNeedles = [
  'n.length<=1e4',
  'length<=1e4',
  'r=5000,o=on(n,r)',
  't+dPo',
  'dPo=1024',
  'function Pc(e,t=Mue)',
  'function ED(e){if(e instanceof',
  'function VD(e){if(e instanceof yn)',
]
console.log('\n=== cluster ===')
for (const n of clusterNeedles) {
  console.log(
    JSON.stringify(n),
    '246',
    allHits(buf246, n).length,
    '247',
    allHits(buf247, n).length,
  )
}

// bg-agent attach: does agent completion/error go through VD/Pc?
const bgNear = [
  'background agent',
  'Background agent',
  'task_notification',
  'agent_progress',
  'agentError',
  'agent_error',
]
function nearBoth(needle, neighbor, radius = 800) {
  const keep = (buf) =>
    allHits(buf, needle).filter((off) => {
      const w = asciiWindow(buf, Math.max(0, off - radius), off + radius)
      return w.includes(neighbor)
    })
  return { a: keep(buf246).length, b: keep(buf247).length, offs: keep(buf247) }
}

console.log('\n=== VD/Pc/ED near bg ===')
for (const n of ['VD(', 'Pc(', 'ED(', 'characters truncated']) {
  for (const nb of bgNear) {
    const r = nearBoth(n, nb, 600)
    if (r.a || r.b) {
      console.log(n, '~', nb, r)
      r.offs.slice(0, 2).forEach((off, i) => {
        dump(
          `gold-8-pass2g-near-${n.replace(/[^A-Za-z0-9]+/g, '')}-${nb.replace(/[^A-Za-z0-9]+/g, '')}-${i}.txt`,
          `# off=${off}\n\n${asciiWindow(buf247, Math.max(0, off - 400), off + 400)}\n`,
        )
      })
    }
  }
}

// hook blocking still uncapped?
console.log('\n=== hook error still full ===')
for (const n of [
  'he.stderr||"No stderr output"',
  'ye.stderr||"No stderr output"',
  'blockingError.blockingError',
]) {
  console.log(JSON.stringify(n), allHits(buf246, n).length, allHits(buf247, n).length)
}

console.log('DONE pass2g')
