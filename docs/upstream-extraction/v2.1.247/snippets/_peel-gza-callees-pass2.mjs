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

function findAll(needle, limit = 30) {
  const n = typeof needle === 'string' ? Buffer.from(needle) : needle
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
        const end = i + 1
        return { start, end, text: asciiWindow(start, end) }
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

// --- known alias windows ---
const aliasWins = {
  r0n_DOb: 212822076,
  qFe_Ahb: 212809276,
  HFe_mMb: 212823888,
  wB_cHc: 212841902,
  sk_eIc: 212842292,
  gza_Aea: 219687415,
  nPe_G1: 219679344,
  dPe_baa: 219684806,
  K8_Sda: 219687027,
}

for (const [k, i] of Object.entries(aliasWins)) {
  dump(`gold-gza-alias-${k}.txt`, `# ${k} @${i}\n${asciiWindow(i - 400, i + 500)}\n`)
  log(`WIN ${k} @${i} ${asciiWindow(i - 80, i + 120).replace(/\n/g, ' ')}`)
}

// gza-module imports: the 21284x block is marketplace consumer
dump('gold-gza-mod-imports-21284.txt', `# @212809000-212843000\n${asciiWindow(212809000, 212843200)}\n`)

// --- find host function defs ---
const hosts = [
  'function DOb(',
  'async function DOb(',
  'function Ahb(',
  'async function Ahb(',
  'function mMb(',
  'async function mMb(',
  'function eIc(',
  'async function eIc(',
  'function cHc(',
  'async function cHc(',
  'function bHc(',
  'async function bHc(',
  'function KBo(',
  'async function ame(',
  'function ame(',
  'function py(',
  'async function py(',
  'function ii(',
  'async function ii(',
  'function Rs(',
  'async function Rs(',
  'function h(e){return Lr(e,p())}',
  'updateSettingsForSourceWithTransform:()=>ii',
  'updateSettingsForSource:()=>Rs',
  'getSettingsForSource:()=>h',
]

for (const n of hosts) {
  const hits = findAll(n, 12)
  log(`HOST ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  hits.forEach((i, idx) => {
    const fn = n.startsWith('function') || n.startsWith('async') ? extractFn(i) : { text: asciiWindow(i, i + 220), end: i + 220 }
    dump(
      `gold-gza-host-${n.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)}-${idx}.txt`,
      `# needle=${n} pos=${i}\n${fn.text}\n`,
    )
    log(`  @${i} ${fn.text.slice(0, 180).replace(/\n/g, ' ')}`)
  })
}

// export maps: ii as, Rs as, h as, DOb as, Ahb as, mMb as, eIc as, py as
const exp = [
  'ii as ',
  'Rs as ',
  'DOb as ',
  'Ahb as ',
  'mMb as ',
  'eIc as ',
  'cHc as ',
  'bHc as ',
  'py as ',
  'KBo as ',
  'ame as ',
]

for (const n of exp) {
  const hits = findAll(n, 8)
  log(`EXP ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 30, i + 70).replace(/\n/g, ' ')}`)
  }
}

// gza / Aea call sites
for (const n of ['gza(', 'await gza(', 'Aea(', 'await Aea(']) {
  const hits = findAll(n, 20)
  log(`CALL ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 12)) {
    log(`  @${i} ${asciiWindow(i - 60, i + 140).replace(/\n/g, ' ')}`)
  }
}

// marketplace remove --scope
for (const n of [
  'plugin marketplace remove',
  '--scope to remove',
  'marketplace remove',
  '.option("--scope',
  ".option('--scope",
]) {
  const hits = findAll(n, 8)
  log(`CLI ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 80, i + 160).replace(/\n/g, ' ')}`)
  }
}

// HFe call sites besides gza
for (const n of ['await HFe(', 'HFe(p)', 'HFe(e)']) {
  const hits = findAll(n, 15)
  log(`HFECALL ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 80, i + 120).replace(/\n/g, ' ')}`)
  }
}

// sk usage / definition nearby extraKnown
for (const n of [
  'eIc as sk',
  'sk.some(',
  'for(let p of sk)',
  '["userSettings","projectSettings","localSettings"]',
  "['userSettings','projectSettings','localSettings']",
]) {
  const hits = findAll(n, 10)
  log(`SK ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 60, i + 140).replace(/\n/g, ' ')}`)
  }
}

// official-name predicate fingerprints
for (const n of [
  'claude-plugins-official',
  'function DOb',
  'ALLOWED_OFFICIAL',
  'isOfficialMarketplaceName',
]) {
  const hits = findAll(n, 8)
  log(`R0N ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 5)) {
    log(`  @${i} ${asciiWindow(i - 40, i + 120).replace(/\n/g, ' ')}`)
  }
}

// qFe fingerprints
for (const n of [
  'project, gitignored',
  'shared project settings',
  'enterprise managed settings',
  'function Ahb',
]) {
  const hits = findAll(n, 8)
  log(`QFE ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits) {
    log(`  @${i} ${asciiWindow(i - 40, i + 160).replace(/\n/g, ' ')}`)
  }
}

dump('gold-gza-callee-pass2.txt', report.join('\n') + '\n')
