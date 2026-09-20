import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function extractJsRuns(start, end, minLen = 40) {
  const runs = []
  let cur = ''
  let curStart = 0
  for (let i = start; i < end && i < buf.length; i++) {
    const c = buf[i]
    if (c >= 32 && c <= 126) {
      if (!cur) curStart = i
      cur += String.fromCharCode(c)
    } else {
      if (cur.length >= minLen) runs.push({ start: curStart, s: cur })
      cur = ''
    }
  }
  if (cur.length >= minLen) runs.push({ start: curStart, s: cur })
  return runs
}

const anchors = [
  208925200, // constants
  221770000, // job_attach_host_dead
  221617693, // attach stall
  221629000,
]

for (const a of anchors) {
  const runs = extractJsRuns(a - 2000, a + 20000, 50)
  let out = `# peel @ ${a}\n\n`
  for (const r of runs) {
    out += `\n----- ${r.start} len=${r.s.length} -----\n${r.s}\n`
  }
  const name = `gold-host-died-anchor-${a}.txt`
  writeFileSync(`docs/upstream-extraction/v2.1.247/snippets/${name}`, out)
  console.log('wrote', name, out.length, 'runs', runs.length)
}

// specifically extract the job_attach function by searching the string
const needle = Buffer.from('job_attach_host_dead')
let i = 0
const hits = []
while (true) {
  const j = buf.indexOf(needle, i)
  if (j < 0) break
  hits.push(j)
  i = j + 1
}
console.log('job_attach_host_dead hits', hits)

for (const h of hits) {
  const runs = extractJsRuns(h - 8000, h + 8000, 60)
  let out = `# job_attach_host_dead @ ${h}\n\n`
  for (const r of runs) {
    if (
      /job_attach|EHOSTDEAD|host process|kind:"error"|function |opening|ENOJOB|ESTALLED|conversation is saved|press Enter|ehostdead|Xe\(|state==="failed"/.test(
        r.s,
      )
    ) {
      out += `\n----- ${r.start} len=${r.s.length} -----\n${r.s}\n`
    }
  }
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-job-attach-${h}.txt`,
    out,
  )
  console.log('wrote gold-job-attach', h, out.length)
}

// constants block around EHOSTDEAD assignment
const cHit = buf.indexOf(Buffer.from('ct="EHOSTDEAD"'))
console.log('ct="EHOSTDEAD" @', cHit)
if (cHit >= 0) {
  const runs = extractJsRuns(cHit - 3000, cHit + 4000, 30)
  let out = `# constants around ct=EHOSTDEAD @ ${cHit}\n\n`
  for (const r of runs) out += `\n----- ${r.start} -----\n${r.s}\n`
  writeFileSync(
    'docs/upstream-extraction/v2.1.247/snippets/gold-host-died-consts.txt',
    out,
  )
}
