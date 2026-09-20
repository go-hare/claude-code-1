import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function ascii(start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

const base = 'docs/upstream-extraction/v2.1.247/snippets/'

const OFFSETS = {
  fe: 212749724,
  header: 212748169,
  ho: 210585999,
  hoInit: 210586400,
  j3c: 208236744,
  ybc: 207530679,
  ybcN: 207531200,
  jn: 210557192,
  he: 210529090,
  j: 209216997,
  bc: 206469431,
  r4n: 215232065,
  sweep: 215262700,
  bhe: 215272211,
  huImport: 212821111,
  tct: 215257791,
}

writeFileSync(base + 'gold-forged-J4n-fe.txt', ascii(OFFSETS.fe, OFFSETS.fe + 420))
writeFileSync(base + 'gold-forged-J4n-h-w-header.txt', ascii(OFFSETS.header, OFFSETS.header + 900))
writeFileSync(base + 'gold-forged-IGb-w.txt', ascii(OFFSETS.ho, OFFSETS.ho + 900))
writeFileSync(base + 'gold-forged-J3c-h.txt', ascii(OFFSETS.j3c, OFFSETS.j3c + 160))
writeFileSync(base + 'gold-forged-Wn-YBc.txt', ascii(OFFSETS.ybc, OFFSETS.ybc + 1400))
writeFileSync(base + 'gold-forged-Jn.txt', ascii(OFFSETS.jn, OFFSETS.jn + 180))
writeFileSync(base + 'gold-forged-He-JVb.txt', ascii(OFFSETS.he, OFFSETS.he + 180))
writeFileSync(base + 'gold-forged-j-PYb.txt', ascii(OFFSETS.j, OFFSETS.j + 80))
writeFileSync(base + 'gold-forged-Bc-Pzd.txt', ascii(OFFSETS.bc, OFFSETS.bc + 60))
writeFileSync(base + 'gold-forged-R4n-A4n.txt', ascii(OFFSETS.r4n, OFFSETS.r4n + 520))
writeFileSync(base + 'gold-forged-TCt-seed-sweep.txt', ascii(OFFSETS.sweep, OFFSETS.sweep + 900))
writeFileSync(base + 'gold-forged-bHe.txt', ascii(OFFSETS.bhe, OFFSETS.bhe + 120))

const combined = [
  `fe@${OFFSETS.fe}`,
  ascii(OFFSETS.fe, OFFSETS.fe + 420),
  '',
  `ho/IGb/w@${OFFSETS.ho}`,
  ascii(OFFSETS.ho, OFFSETS.ho + 280),
  '',
  `J3c/h@${OFFSETS.j3c}`,
  ascii(OFFSETS.j3c, OFFSETS.j3c + 120),
  '',
  `YBc/Wn@${OFFSETS.ybc}`,
  ascii(OFFSETS.ybc, OFFSETS.ybc + 320),
  '',
  `Jn@${OFFSETS.jn}`,
  ascii(OFFSETS.jn, OFFSETS.jn + 160),
  '',
  `He/JVb@${OFFSETS.he}`,
  ascii(OFFSETS.he, OFFSETS.he + 160),
  '',
  `j/PYb@${OFFSETS.j}`,
  ascii(OFFSETS.j, OFFSETS.j + 70),
  '',
  `Bc/Pzd@${OFFSETS.bc}`,
  ascii(OFFSETS.bc, OFFSETS.bc + 50),
  '',
  `R4n/A4n@${OFFSETS.r4n}`,
  ascii(OFFSETS.r4n, OFFSETS.r4n + 400),
  '',
  `TCt sweep@${OFFSETS.sweep}`,
  ascii(OFFSETS.sweep, OFFSETS.sweep + 700),
  '',
  `bHe@${OFFSETS.bhe}`,
  ascii(OFFSETS.bhe, OFFSETS.bhe + 90),
  '',
  `Hu import IJb@${OFFSETS.huImport}`,
  ascii(OFFSETS.huImport, OFFSETS.huImport + 220),
].join('\n')

writeFileSync(base + 'gold-forged-J4n-h-w-Wn-Hu.txt', combined)

for (const [name, off] of Object.entries(OFFSETS)) {
  console.log(name, off)
}
