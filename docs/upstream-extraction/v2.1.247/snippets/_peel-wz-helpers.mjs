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

function dump(name, needle, before, after, which = 0) {
  const hits = allHits(needle)
  if (!hits.length) {
    console.log('MISS', name, JSON.stringify(needle))
    return
  }
  const i = hits[which] ?? hits[0]
  writeFileSync(
    `${outDir}/${name}`,
    `# offset=${i} hit=${which + 1}/${hits.length} needle=${JSON.stringify(needle)}\n\n${ascii(Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i, `${which + 1}/${hits.length}`)
}

const WZ = 210418470
console.log('=== window before WZ (8k) function names ===')
const before = ascii(WZ - 8000, WZ)
for (const m of before.matchAll(/function [A-Za-z_$][\w$]*\([^)]*\)\{/g)) {
  console.log('  ', m[0])
}

console.log('\n=== function Vm(e,t) ALL ===')
for (const i of allHits('function Vm(e,t)')) {
  const body = extractFrom(i, 800)
  console.log('---', i, body.slice(0, 220).replaceAll('\n', ' '))
  writeFileSync(`${outDir}/gold-11-Vm-et-${i}.txt`, `# ${i}\n\n${body}\n`)
}

console.log('\n=== function Ji(e,t) ALL ===')
for (const i of allHits('function Ji(e,t)')) {
  const body = extractFrom(i, 800)
  console.log('---', i, body.slice(0, 220).replaceAll('\n', ' '))
  writeFileSync(`${outDir}/gold-11-Ji-et-${i}.txt`, `# ${i}\n\n${body}\n`)
}

console.log('\n=== function Qi(e,t) ALL ===')
for (const i of allHits('function Qi(e,t)')) {
  const body = extractFrom(i, 1200)
  console.log('---', i, body.slice(0, 220).replaceAll('\n', ' '))
  writeFileSync(`${outDir}/gold-11-Qi-et-${i}.txt`, `# ${i}\n\n${body}\n`)
}

console.log('\n=== function Qi(e,t,n) ALL ===')
for (const i of allHits('function Qi(e,t,n)')) {
  const body = extractFrom(i, 1200)
  console.log('---', i, body.slice(0, 280).replaceAll('\n', ' '))
  writeFileSync(`${outDir}/gold-11-Qi-etn-${i}.txt`, `# ${i}\n\n${body}\n`)
}

console.log('\n=== function wv(e,t,n ALL ===')
for (const n of [
  'function wv(e,t,n,r)',
  'function wv(e,t,n)',
  'wv(e,t,n,r){',
  'function wv(e,t,n,r){',
]) {
  const hits = allHits(n)
  console.log(n, hits.length, hits.slice(0, 8))
  for (const i of hits.slice(0, 5)) {
    console.log('  ', i, extractFrom(i, 1500).slice(0, 300))
  }
}

console.log('\n=== pN neighborhood wv def hunt ===')
const pN = buf.indexOf(Buffer.from('function pN(){'))
console.log('pN', pN)
dump('gold-11-wz-before-8k.txt', 'function WZ(e){', 8000, 80)
dump('gold-11-wv-call-wide.txt', 'wv(t,s.dev,s.ino,r)', 80, 40)

for (const n of [
  'identity-record',
  'osLinkedRootRealpaths',
  's.dev,s.ino',
  'dev,ino,fd',
  'function Lm(e,t)',
  'function _Z(e,t)',
]) {
  const hits = allHits(n)
  console.log(n, hits.length, hits.slice(0, 6))
}

// same-module helpers often sit just after pN / before WZ
writeFileSync(
  `${outDir}/gold-11-between-pN-WZ-fns.txt`,
  ascii(210378555, 210418470)
    .match(/function [A-Za-z_$][\w$]*\([^)]*\)\{/g)
    ?.join('\n') ?? 'none',
)
