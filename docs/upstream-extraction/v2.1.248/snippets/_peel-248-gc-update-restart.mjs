import { readFileSync, writeFileSync } from 'fs'

const exe =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const b = readFileSync(exe)
const out = []

function win(label, off, before = 600, after = 900) {
  out.push(`\n## ${label} @${off}`)
  out.push(b.slice(Math.max(0, off - before), off + after).toString('utf8'))
}

const needles = [
  'Cannot /update',
  'tengu_update_refused',
  'Mhr=async',
  'async function le(o,s,i){if(wo())return',
  'this session has restrictions a restart',
  'Signed in to Cloud gateway',
  "name:\"update\"",
  'type:"local",name:"update"',
  'name:"update",description',
]

for (const s of needles) {
  const n = Buffer.from(s)
  let i = 0
  let c = 0
  const hits = []
  while ((i = b.indexOf(n, i)) !== -1 && c < 10) {
    if (i > 170000000) hits.push(i)
    i++
    c++
  }
  out.push(`\n## needle ${JSON.stringify(s)} hits=${hits.length}`)
  out.push(hits.map(h => `@${h}`).join(' '))
}

win('update-refuse-g', 192086231, 2500, 1500)
win('restart-le', 205714430, 2500, 1200)

// Find slash-command registration for update near Mhr
const mhr = b.indexOf(Buffer.from('Mhr=async'))
out.push(`\n## Mhr@${mhr}`)
out.push(b.slice(Math.max(0, mhr - 400), mhr + 200).toString('utf8'))

// Search command object that references Mhr
const mhrUse = []
let i = 0
const needle = Buffer.from('Mhr')
while ((i = b.indexOf(needle, i)) !== -1 && mhrUse.length < 20) {
  if (i > 190000000 && i < 195000000) mhrUse.push(i)
  i++
}
out.push(`\n## Mhr uses near update ${mhrUse.join(' ')}`)
for (const h of mhrUse.slice(0, 8)) {
  out.push(`\n### Mhr@${h}`)
  out.push(b.slice(h - 120, h + 180).toString('utf8'))
}

writeFileSync(
  new URL('./gold-248-gc-update-restart.txt', import.meta.url),
  out.join('\n'),
)
console.log('wrote', out.length, 'chunks')
