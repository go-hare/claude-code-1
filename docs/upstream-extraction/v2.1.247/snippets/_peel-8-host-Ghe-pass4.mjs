/**
 * Pass 4: lock REPL `ge` session bind + S.host vs uk().host.
 */
import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function findAll(needle, limit = 40) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function asciiWindow(start, end) {
  let s = ''
  const a = Math.max(0, start)
  const z = Math.min(buf.length, end)
  for (let j = a; j < z; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function dump(name, content) {
  const body = content.endsWith('\n') ? content : `${content}\n`
  writeFileSync(`${outDir}/${name}`, body)
  console.log('WROTE', name, body.length)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

const bind = 233141792
dump('gold-REPL-bind-before-12k.txt', `# kt.bindHost session:ge @${bind} before 12k\n${asciiWindow(bind - 12000, bind + 200)}\n`)

const before = asciiWindow(bind - 20000, bind)
const geAssigns = [...before.matchAll(/ge[=,(]|let ge|const ge|ge=uk|ge=Tm|ge=n\(|session:ge/g)]
log(`ge tokens in -20k: ${geAssigns.length}`)
for (const m of geAssigns.slice(-30)) {
  const abs = bind - 20000 + m.index
  log(`  @${abs} ${asciiWindow(abs - 40, abs + 80).replace(/\n/g, ' ')}`)
}

const needles = [
  'let ge=',
  'let ge=',
  'ge=uk()',
  'ge=Tm()',
  'ge=n()',
  ',ge=',
  'ge=ft()',
  'session:ge',
  'host:S.host',
  'host:ge.host',
  'ge.host',
  'uk().host',
  'ft()',
  'let ge=',
]
for (const n of [
  'let ge=',
  'ge=uk()',
  'ge=Tm()',
  'ge=n()',
  'ge=ft()',
  'session:ge',
  'host:ge.host',
  'let S=',
  'S=ge',
  'S=uk()',
  'const ge=',
  'ge=es()',
  'ge=Li(',
]) {
  const hits = findAll(n, 20)
  log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    const near = i > 232000000 && i < 234000000
    log(`  @${i}${near ? ' NEAR-REPL' : ''} ${asciiWindow(i - 60, i + n.length + 120).replace(/\n/g, ' ')}`)
    if (near) {
      dump(`gold-ge-${i}.txt`, `# ${n} @${i}\n${asciiWindow(i - 300, i + 400)}\n`)
    }
  }
}

// host:S.host neighborhood — is S the session?
const shost = findAll('host:S.host', 8)
for (const i of shost) {
  dump(`gold-S-host-${i}.txt`, `# host:S.host @${i}\n${asciiWindow(i - 800, i + 200)}\n`)
  log(`S.host @${i} ${asciiWindow(i - 200, i + 80).replace(/\n/g, ' ')}`)
}

// tod as dt — Li imported in another module; does it construct sessions?
dump(
  'gold-tod-as-dt-228961746.txt',
  `# tod as dt @228961746\n${asciiWindow(228961700, 228962200)}\n`,
)
const dtCalls = findAll('dt({host:', 10)
log(`dt({host: count=${dtCalls.length}`)
for (const i of dtCalls) {
  log(`  @${i} ${asciiWindow(i - 40, i + 120).replace(/\n/g, ' ')}`)
}

dump('gold-8-host-Ghe-scan4.txt', report.join('\n') + '\n')
console.log('DONE pass4', report.length)
