// densable 2.1.248 #48 — find UDS/trust apply that uses overflowuid
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe',
)
const exe247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const b247 = existsSync(exe247) ? readFileSync(exe247) : null

function asciiSlice(buf, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function allHits(buf, needle) {
  const n = typeof needle === 'string' ? Buffer.from(needle) : needle
  const hits = []
  let i = 0
  while (i < buf.length) {
    const k = buf.indexOf(n, i)
    if (k < 0) break
    hits.push(k)
    i = k + n.length
  }
  return hits
}

const lines = ['# gold-248-48-apply', '']

function dumpHits(label, needle, buf, max = 8) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const h of hits.slice(0, max)) {
    lines.push(`- @${h}`)
    lines.push(asciiSlice(buf, h - 160, h + 280))
    lines.push('')
  }
}

const needles = [
  'owner does not match',
  'assertPrivateDirectory',
  'socket parent',
  'owned by uid',
  'overflowuid',
  'hostStart',
  'innerStart',
  'uidsCollapse',
  '/proc/self/',
  'uid_map',
  'gid_map',
  'setgroups',
  'canonical system',
  'system directories',
  'root-equivalent',
  'root equivalent',
  'unmapped owner',
  'unmapped',
  'nobody',
  '65534',
  '===y||',
  '===y&&',
  '===y?',
  '==y||',
  '==y&&',
  ',y)',
  '(y,',
  'y===',
  'await C()',
  'function ce(',
  '/tmp',
  '/var/tmp',
  '/run',
  '/dev',
  'XDG_RUNTIME_DIR',
  'isCanonical',
  'canonicalDir',
  'systemDir',
  'SYSTEM_DIRS',
  'CANONICAL',
]

for (const n of needles) dumpHits(`248 ${JSON.stringify(n)}`, n, b248, 6)

// 247 daemon chunk around same helpers
if (b247) {
  for (const n of [
    'var y=65534',
    'overflowuid',
    'innerStart',
    'async function _(){return}',
    'function v(e){let n=[];for(let t of e.split',
    'owner does not match',
    'owned by uid',
  ]) {
    dumpHits(`247 ${JSON.stringify(n)}`, n, b247, 4)
  }
}

// list official packages
const tempRoot = 'C:/Users/Administrator/AppData/Local/Temp'
let official = []
try {
  for (const name of readdirSync(tempRoot)) {
    if (/official/i.test(name)) official.push(name)
  }
} catch {}
lines.push('## official temp dirs')
lines.push(official.join('\n'))
lines.push('')

writeFileSync(`${outDir}/gold-248-48-apply.txt`, lines.join('\n'))
console.log('WROTE apply', lines.length, 'official', official)
