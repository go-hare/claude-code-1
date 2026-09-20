import { readFileSync, writeFileSync, existsSync } from 'fs'

const paths = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}
const bufs = Object.fromEntries(
  Object.entries(paths).map(([k, p]) => [k, readFileSync(p)]),
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

function allHits(buf, needle, max = 20) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (hits.length < max) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    hits.push(j)
    i = j + n.length
  }
  return hits
}

function dumpAll(ver, needle, before, after, tag) {
  const buf = bufs[ver]
  const hits = allHits(buf, needle)
  let out = `# ${ver} needle=${JSON.stringify(needle)} hits=${hits.length}\n\n`
  hits.forEach((i, idx) => {
    out += `===== HIT ${idx} offset=${i} =====\n`
    out += asciiWindow(buf, Math.max(0, i - before), i + after)
    out += '\n\n'
  })
  const name = `gold-cmp-${tag}-${ver}.txt`
  writeFileSync(`docs/upstream-extraction/v2.1.247/snippets/${name}`, out)
  console.log('wrote', name, hits.length)
  return hits
}

const jobs = [
  ['output was lost', 2500, 800, 'output-lost'],
  ['row above', 1500, 400, 'row-above'],
  ['error type', 2000, 600, 'error-type'],
  ['request id', 2000, 600, 'request-id'],
  ['default system prompt', 2000, 600, 'default-sysprompt'],
  ['Summarize from here', 2000, 800, 'summarize-from'],
  ['could not be written', 800, 400, 'could-not-written'],
  ['arrow-key', 1500, 400, 'arrow-key'],
  ['[exited with code', 1500, 500, 'exited-code'],
  ['exited with code -1', 1500, 400, 'exited-m1'],
  ['carried over', 1500, 400, 'carried-over'],
  ['output discarded', 1500, 400, 'output-discarded'],
]

for (const [needle, before, after, tag] of jobs) {
  dumpAll('246', needle, before, after, tag)
  dumpAll('247', needle, before, after, tag)
}
