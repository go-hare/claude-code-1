import { existsSync, readFileSync, writeFileSync } from 'fs'

const p247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const buf = readFileSync(p247)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

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

function allHits(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function dump(name, needle, before, after, which = 0) {
  const hits = allHits(needle)
  if (!hits.length) {
    console.log('MISS', name, JSON.stringify(needle))
    return hits
  }
  const i = hits[which] ?? hits[0]
  writeFileSync(
    `${outDir}/${name}`,
    `# offset=${i} hit=${which + 1}/${hits.length} needle=${JSON.stringify(needle)}\n\n${ascii(Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i, `${which + 1}/${hits.length}`)
  return hits
}

// WZ neighborhood: helpers
dump('gold-11-WZ-before.txt', 'function WZ(e){', 3500, 600, 0)

// _y ensureBridgeSpawnRootDir
dump('gold-11-fn-_y.txt', 'ensureBridgeSpawnRootDir', 200, 800, 0)
dump('gold-11-fn-_y-async.txt', 'async function _y(', 80, 1500, 0)
dump('gold-11-fn-_y-fn.txt', 'function _y(', 80, 800, 0)

// dN staging dirs
const dN = allHits('function dN(')
console.log('dN hits', dN.length)
for (const [k, h] of dN.slice(0, 8).entries()) {
  const w = ascii(h, h + 220)
  console.log('dN', k, w.slice(0, 200))
}

// Vhe / real Whe
dump('gold-2-Vhe-body.txt', 'async function Vhe(', 80, 400, 0)
dump('gold-2-await-Whe.txt', 'await Whe(', 200, 200, 0)
dump('gold-2-qhe-before.txt', 'function qhe(e){', 80, 400, 0)

// tip merge: org-tip: in Whe
dump('gold-2-Joi-filter.txt', '.filter(_=>getSessionsSinceLastShown', 300, 400, 0)
dump('gold-2-IV-cooldown.txt', 'IV(o.id)>=', 200, 200, 0)
for (const n of [
  '>=_.cooldownSessions',
  '>=o.cooldownSessions',
  'customTips',
  '...filtered',
  'loadOrgSpinnerTips',
  'org-tip:',
]) {
  const hits = allHits(n)
  console.log(JSON.stringify(n), hits.length, hits.slice(0, 3))
}

// checkPid kill 0
dump('gold-15-kill-0.txt', 'process.kill(this.record.pid,0)', 400, 400, 0)
dump('gold-15-kill-0-space.txt', 'process.kill(this.record.pid, 0)', 400, 400, 0)

// WeakMap readers
dump(
  'gold-11-installedFilter-read.txt',
  'installedFilterRequestEnforcesAllowlist',
  80,
  200,
  0,
)
console.log(
  'installedFilter hits',
  allHits('installedFilterRequestEnforcesAllowlist').length,
)
console.log(
  'installsSince hits',
  allHits('installsSinceInitializeStartedAllEnforce').length,
)
