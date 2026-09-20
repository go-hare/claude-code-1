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
  if (i >= buf.length) return { start, end: start, text: '' }
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

log('# mp pass5 hMb/Fs + xe + clean golds')

for (const n of [
  'hMb as Fs',
  ' as hMb}',
  ' as hMb,',
  ',hMb as ',
  '{hMb as ',
  'function hMb(',
]) {
  const hits = findAll(n, 12)
  log(`HMB ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 60, i + 140).replace(/\n/g, ' ')}`)
  }
}

dump(
  'gold-mp-Fs-import-hMb.txt',
  `# hMb as Fs @212823622\n${asciiWindow(212823400, 212824200)}\n`,
)

// xe import in sl module (before 211421964)
{
  const lo = 211350000
  const hi = 211421964
  for (const n of [' as xe}', ' as xe,', 'xe as ', 'function xe(r)', 'function xe(e)']) {
    const needle = Buffer.from(n)
    let from = lo
    let c = 0
    while (c < 8) {
      const i = buf.indexOf(needle, from)
      if (i < 0 || i > hi) break
      log(`SSxe ${JSON.stringify(n)} @${i} ${asciiWindow(i - 50, i + 120).replace(/\n/g, ' ')}`)
      from = i + n.length
      c++
    }
    if (c === 0) log(`SSxe ${JSON.stringify(n)} count=0`)
  }
}

// walk back from sl to find xe def
dump(
  'gold-mp-sl-before-4k.txt',
  `# sl@211421964 before 4k\n${asciiWindow(211417964, 211422120)}\n`,
)

// qr unique
dump(
  'gold-mp-qr-full.txt',
  `# qr unique via De(le(),"plugins","cache") @211421701\n${extractFn(211421701).text}\n`,
)

// dump clean golds
dump(
  'gold-mp-sl-full.txt',
  `# mp SOURCE sl unique function sl(r count=1 @211421964
# export sl as Heb @211611951 count=1
# K8 import Heb as mp @212808064 count=1
${extractFn(211421964).text}
`,
)

dump(
  'gold-mp-zr-full.txt',
  `# zr unique function zr(r count=1 @211421749 — mp callee
${extractFn(211421749).text}
`,
)

dump(
  'gold-mp-Yr-full.txt',
  `# Yr unique function Yr(r){return r.endsWith(".zip")} @211421923
${extractFn(211421923).text}
`,
)

dump(
  'gold-mp-ss-wg.txt',
  `# wg SOURCE ss unique var ss=".orphaned_at" @211423438 count=1
# export ss as Deb @211611911 count=1
# K8 import Deb as wg @212807979 count=1
# neighbor stamps
${asciiWindow(211423438, 211423560)}
`,
)

dump(
  'gold-mp-_r-pluginCache.txt',
  `# _r SOURCE L.pluginCache unique @207948340 count=1
# export L as Edd @207950000 count=1
# K8 import Edd as _r @212851093 count=1 from _814.js
pluginCache:(e,n,a,t)=>({namespace:"pluginCache",marketplace:e,plugin:n,version:a,relPath:t})
# factory neighborhood
${asciiWindow(207948200, 207948430)}
`,
)

dump(
  'gold-mp-K8-call.txt',
  `# already-locked K8 @214509181
${extractFn(214509181).text}
`,
)

dump('gold-mp-pass5.txt', report.join('\n') + '\n')
