import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(start, end) {
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
  return s.replace(/[.]{4,}/g, '...')
}

function findAll(needle, limit = 20) {
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

function extractFn(start) {
  let i = start
  while (i < buf.length && buf[i] !== 123) i++
  let depth = 0
  let inS = 0
  let esc = false
  for (; i < buf.length; i++) {
    const c = buf[i]
    if (inS) {
      if (esc) {
        esc = false
        continue
      }
      if (c === 92) {
        esc = true
        continue
      }
      if (c === inS) inS = 0
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      inS = c
      continue
    }
    if (c === 123) depth++
    else if (c === 125) {
      depth--
      if (depth === 0) {
        return { start, end: i + 1, text: asciiWindow(start, i + 1) }
      }
    }
  }
  return { start, end: start + 200, text: asciiWindow(start, start + 200) }
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

for (const n of [
  'function z(j){let R=v(6)',
  'jdb as ',
  ' as jdb',
  'storageV5:n,credentials:s,children',
  'n===void 0&&s===void 0?c:',
]) {
  const hits = findAll(n, 12)
  log(`${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 40, i + 140).replace(/\n/g, ' ')}`)
  }
}

{
  const i = buf.indexOf(Buffer.from('function z(j){let R=v(6)'))
  if (i >= 0) {
    const fn = extractFn(i)
    dump('gold-We-z-provider.txt', `# z@${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`)
    log(`z@${i} len=${fn.end - i}`)
  }
}

// who mounts Provider — search jdb as Xxx then Xxx({storageV5
{
  const hits = findAll('jdb as ', 15)
  for (const i of hits) {
    const win = asciiWindow(i, i + 40)
    const m = win.match(/jdb as ([A-Za-z0-9_$]+)/)
    log(`jdb-import @${i} local=${m?.[1]} ${asciiWindow(i - 20, i + 80)}`)
  }
}

dump('gold-We-pass6-scan.txt', report.join('\n') + '\n')
