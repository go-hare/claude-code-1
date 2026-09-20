// Upstream 2.1.247: how login sites turn forceLoginOrgUUID into OAuth orgUUID.
import { readFileSync, existsSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
if (!existsSync(BIN)) {
  console.error('missing', BIN)
  process.exit(1)
}
const s = readFileSync(BIN, 'latin1')

const needles = [
  'typeof t.forceLoginOrgUUID==="string"',
  'typeof e.forceLoginOrgUUID==="string"',
  'typeof n.forceLoginOrgUUID==="string"',
  'typeof r.forceLoginOrgUUID==="string"',
  'typeof a.forceLoginOrgUUID==="string"',
  '.forceLoginOrgUUID==="string"',
  'forceLoginOrgUUID==="string"',
  'typeof t?.forceLoginOrgUUID',
  'typeof n?.forceLoginOrgUUID',
]

for (const m of needles) {
  const hits = []
  let i = -1
  while ((i = s.indexOf(m, i + 1)) !== -1) {
    hits.push(i)
    if (hits.length >= 12) break
  }
  console.log(`${hits.length ? 'HIT' : '---'} ${JSON.stringify(m)} n=${hits.length} ${hits.join(',')}`)
}

function dumpAround(label, idx, before = 220, after = 280) {
  if (idx < 0) {
    console.log(`\n=== ${label} MISSING ===`)
    return
  }
  console.log(`\n=== ${label} @ ${idx} ===`)
  console.log(s.slice(idx - before, idx + after).replace(/\s+/g, ' '))
}

let i = -1
const seen = []
while ((i = s.indexOf('.forceLoginOrgUUID==="string"', i + 1)) !== -1) {
  seen.push(i)
  if (seen.length >= 8) break
}
console.log('\n=== .forceLoginOrgUUID==="string" hits ===', seen)
for (const idx of seen) dumpAround('typeof-string', idx)

// Also: array first-element hint?
for (const m of [
  'forceLoginOrgUUID[0]',
  '.forceLoginOrgUUID?.[0]',
  'Array.isArray(t.forceLoginOrgUUID)',
  'Array.isArray(e.forceLoginOrgUUID)',
]) {
  const idx = s.indexOf(m)
  console.log(`${idx >= 0 ? 'HIT' : '---'} ${m} @ ${idx}`)
}
