import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
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

function dumpAt(name, i, before, after, extra = '') {
  writeFileSync(
    `${outDir}/${name}`,
    `# offset=${i} ${extra}\n\n${ascii(Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i)
}

// Vhe import window
dumpAt('gold-2-Vhe-imports.txt', 232386953, 2500, 100)

// cooldownSessions JS uses
const cd = allHits('cooldownSessions')
console.log('cooldownSessions', cd.length)
for (const [k, h] of cd.entries()) {
  const w = ascii(h - 60, h + 80)
  if (w.includes('function') || w.includes('filter') || w.includes('>=') || w.includes('IV(')) {
    console.log('cd-js', k, h, w.replace(/\n/g, ' '))
    dumpAt(`gold-2-cd-${k}.txt`, h, 400, 400, `hit ${k}`)
  }
}

// .cooldownSessions
for (const n of ['.cooldownSessions', 'cooldownSessions)', 'IV(_.id)', 'IV(o.id)']) {
  const hits = allHits(n)
  console.log(JSON.stringify(n), hits.length, hits.slice(0, 5))
}

// as Whe
for (const n of [' as Whe}', ' as Whe,', 'as Whe from', 'Whe as ']) {
  const hits = allHits(n)
  console.log(JSON.stringify(n), hits.length, hits.slice(0, 6))
}

// WZ helpers: search function Vm(e,t) near 2104e6
const vm = allHits('function Vm(e,t)')
console.log('Vm(e,t)', vm.length)
for (const [k, h] of vm.entries()) {
  const w = ascii(h, h + 200)
  console.log('Vm', k, h, w.slice(0, 180))
}

const ji = allHits('function Ji(e,t)')
console.log('Ji(e,t)', ji.length)
for (const [k, h] of ji.slice(0, 10).entries()) {
  console.log('Ji', k, h, ascii(h, h + 160))
}

const qi = allHits('function Qi(e,t)')
console.log('Qi(e,t)', qi.length)
for (const [k, h] of qi.slice(0, 10).entries()) {
  console.log('Qi', k, h, ascii(h, h + 160))
}

// 3-arg Qi
const qi3 = allHits('function Qi(e,t,n)')
console.log('Qi(e,t,n)', qi3.length, qi3.slice(0, 4))
for (const h of qi3.slice(0, 4)) console.log(ascii(h, h + 200))

// installedFilter JS (skip string table ~203110040)
const inst = allHits('installedFilterRequestEnforcesAllowlist')
for (const [k, h] of inst.entries()) {
  const w = ascii(h - 80, h + 120)
  if (w.includes('function') || w.includes('=') || w.includes('if(')) {
    console.log('inst', k, h, w.replace(/\n/g, ' ').slice(0, 220))
    dumpAt(`gold-11-inst-${k}.txt`, h, 300, 300, `hit ${k}`)
  }
}

// _y already have. Dump dN(0) full
dumpAt('gold-11-dN-0.txt', 210378177, 80, 500)

// pN helpers Fm mZ pZ
for (const n of ['function Fm(e){', 'function mZ(e){', 'function pZ(e){', 'function uu(e){']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 3), hits[0] != null ? ascii(hits[0], hits[0] + 180) : '')
}
