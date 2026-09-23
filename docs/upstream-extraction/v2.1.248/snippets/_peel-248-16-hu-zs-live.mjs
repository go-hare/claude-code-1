import { readFileSync, writeFileSync } from 'fs'

const EXE =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const b = readFileSync(EXE)

function slice(i, before, after) {
  return b
    .subarray(Math.max(0, i - before), Math.min(b.length, i + after))
    .toString('latin1')
}

function hits(n) {
  const out = []
  const needle = Buffer.from(n)
  let i = 0
  while ((i = b.indexOf(needle, i)) !== -1) {
    out.push(i)
    i += needle.length
  }
  return out
}

const lines = [
  '# gold-248-16-hu-zs-live',
  `exe=${EXE}`,
  `bytes=${b.length}`,
  `when=${new Date().toISOString()}`,
  '',
  'Re-verify official Hu/Zs stubs + listAllLiveSessions status/jobId/peerProtocol.',
  '',
]

function section(title, body) {
  lines.push(`## ${title}`)
  lines.push(body)
  lines.push('')
}

for (const n of [
  'async function Hu(){return[]}',
  'listRemoteSessions:()=>Hu()',
  'let Zs=!1',
  'peerProtocol:typeof o.peerProtocol',
  'jobId:typeof o.jobId',
  'status:typeof o.status',
]) {
  const h = hits(n)
  section(
    `${JSON.stringify(n)} hits=${h.length}`,
    h.length
      ? h
          .slice(0, 6)
          .map(i => `@${i}\n${slice(i, 0, Math.min(n.length + 160, 280))}`)
          .join('\n\n')
      : 'MISS',
  )
}

const pp = hits('peerProtocol:typeof o.peerProtocol==="number"?o.peerProtocol:void 0')
if (pp[0] != null) {
  section(`live-mapper window @${pp[0]}`, slice(pp[0], 700, 500))
}

const statusesNeedle = 'this.#p("statuses"'
const so = hits(statusesNeedle)
section(
  `#p("statuses" hits=${so.length}`,
  so.map(i => `@${i}\n${slice(i, 0, 420)}`).join('\n\n'),
)

const adopt = hits('(h.peerProtocol??0)>=')
section(
  'adoptedPeers peerProtocol gate',
  adopt.length
    ? adopt.map(i => `@${i}\n${slice(i, 120, 220)}`).join('\n\n')
    : 'MISS — try alternate',
)

const adopt2 = hits('peerProtocol>=')
section(
  'peerProtocol>= hits',
  adopt2
    .filter(i => i > 192000000 && i < 192200000)
    .map(i => `@${i}\n${slice(i, 100, 180)}`)
    .join('\n\n') || 'none in fleet band',
)

const jobWrite = hits('d.set(Ir(h.jobId)')
section(
  'statuses jobId write',
  jobWrite.map(i => `@${i}\n${slice(i, 80, 200)}`).join('\n\n') || 'MISS',
)

const out =
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-16-hu-zs-live.txt'
writeFileSync(out, lines.join('\n'))
console.log('wrote', out, 'lines', lines.length)
