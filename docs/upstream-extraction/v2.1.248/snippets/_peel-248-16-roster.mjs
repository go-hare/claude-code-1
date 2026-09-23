import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const exe =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const b248 = readFileSync(exe)

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

function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function extractBalanced(buf, i, maxLen = 8000) {
  const win = asciiSlice(buf, i, i + maxLen)
  let depth = 0
  let inStr = null
  let esc = false
  let started = false
  for (let p = 0; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '{') {
      depth++
      started = true
    } else if (c === '}') {
      depth--
      if (started && depth === 0) {
        const body = win.slice(0, p + 1)
        return { body, sha: sha(body), len: body.length }
      }
    }
  }
  return { missEnd: true, preview: win.slice(0, 400) }
}

const lines = [
  '# gold-248-16-roster',
  `exe=${exe}`,
  `bytes=${b248.length}`,
  `when=${new Date().toISOString()}`,
  '',
]

function dump(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

function dumpFrom(label, i, maxLen) {
  lines.push(`## ${label} @${i}`)
  const ext = extractBalanced(b248, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
}

dump('q$n-full', 184558619, 0, 500)
dumpFrom('q$n-fn', 184558619, 800)
dumpFrom('K$n-fn', 184559595, 1200)
dump('host-export', 192130470, 80, 400)
dump('store-init', 192130838, 80, 250)
dump('#x-win', 192131709, 40, 600)
const xRel = asciiSlice(b248, 192131709, 192131709 + 80).indexOf('#x')
dumpFrom('#x-from-hash', xRel >= 0 ? 192131709 + xRel : 192131709, 2000)
dump('#E-win', 192134546, 40, 400)
const eRel = asciiSlice(b248, 192134546, 192134546 + 80).indexOf('#E')
dumpFrom('#E-from-hash', eRel >= 0 ? 192134546 + eRel : 192134546, 1200)
const pHit = b248.indexOf(Buffer.from('#p(i,d){'), 192128000)
dump('#p-win', pHit, 20, 400)
if (pHit >= 0) dumpFrom('#p-fn', pHit, 800)
const classHit = b248.lastIndexOf(Buffer.from('class '), 192131709)
dump('class-head', classHit, 20, 500)
dump('#x-then-tail', 192131709, 0, 900)
dump('#E-seed', 192134546, 0, 500)

writeFileSync(`${outDir}/gold-248-16-roster.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-16-roster.txt`, 'lines', lines.length)
