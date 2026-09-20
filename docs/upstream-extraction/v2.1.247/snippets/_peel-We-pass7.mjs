import { readFileSync, writeFileSync } from 'fs'

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

function findAll(needle, limit = 15) {
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

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

for (const n of [
  't(LR,{',
  't(Ar,{storageV5',
  't(Ar,{',
  'LR,{storageV5',
  'Ar,{storageV5',
  'function X(e,t=S){return v()&&e!==void 0',
  'function ce(e){return{storageV5:e,credentials:X(e)}}',
  'function G(e=S){return{...e,[J]:"CredentialsStoreHandle"}}',
]) {
  const hits = findAll(n, 8)
  log(`${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 80, i + 160).replace(/\n/g, ' ')}`)
  }
}

writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-We-pass7-scan.txt',
  report.join('\n') + '\n',
)
