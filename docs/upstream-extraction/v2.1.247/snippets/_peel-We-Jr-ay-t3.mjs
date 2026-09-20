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

function findAll(needle, limit = 40) {
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
        return { start, end: i + 1, text: asciiWindow(start, i + 1) }
      }
    }
  }
  return { start, end: start + 200, text: asciiWindow(start, start + 200) }
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
  return name
}

const report = []
function log(s) {
  report.push(s)
  console.log(s)
}

log(`# We/Jr/ay/t3 peel official-247 size=${buf.length}`)

const uniqueNeedles = [
  '{storageV5:p,credentials:g}=We()',
  'let{storageV5:p,credentials:g}=We()',
  'let{storageV5:u,credentials:m}=We()',
  'await Zr(ne.name,void 0,p,g)',
  'ay("userSettings",{pluginConfigs:o},void 0,t)',
  'await ay("userSettings",{pluginConfigs:o},void 0,t)',
  'deletePluginOptions: failed to clear pluginSecrets',
  'deletePluginOptions: storage lock unavailable',
  'Jr().mutate',
  'Jr().readAsync',
  'function t3(){Xn().optionValues.clear()}',
  'Xn().optionValues.clear()',
  'return{storageV5:',
  'return {storageV5:',
  'storageV5:e,credentials:',
  'function ce(e){return{storageV5:e,credentials:',
  'CredentialsStoreHandle',
  'secureStorage.CredentialsStoreHandle',
  'getPinnedStorageV5',
  'getPinnedCredentials',
  'credentialsStoreFor',
  'pinCredentialsStore',
  'pinStorageV5',
]

for (const n of uniqueNeedles) {
  const hits = findAll(n, 20)
  log(`STR ${JSON.stringify(n)} count=${hits.length} hits=${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(i - 80, i + n.length + 100).replace(/\n/g, ' ')}`)
  }
}

// --- We() defs vs callers ---
const weDefNeedles = [
  'function We(){',
  'function We(){return',
  'function We(){let',
  'async function We(){',
  'We=()=>',
  'We=()=>{',
]
for (const n of weDefNeedles) {
  const hits = findAll(n, 30)
  log(`WEDEF ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 12)) {
    const win = asciiWindow(i, i + 220).replace(/\n/g, ' ')
    const looksHost =
      win.includes('storageV5') ||
      win.includes('credentials') ||
      win.includes('WeakMap') ||
      win.includes('.of(') ||
      win.includes('.get(')
    log(`  @${i}${looksHost ? ' HOSTISH' : ''} ${win}`)
    if (looksHost || hits.length <= 4) {
      const fn = extractFn(i)
      dump(
        `gold-We-def-${i}.txt`,
        `# needle=${n} pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
      )
    }
  }
}

// Zg neighborhood: imports of We
const zg = findAll('function Zg({setViewState:e', 3)
for (const i of zg) {
  dump('gold-We-Zg-before-4k.txt', `# Zg@${i} before 4k\n${asciiWindow(i - 4000, i + 200)}\n`)
  log(`ZG @${i}`)
}

// Plugin UI second We() caller
const we2 = findAll('{storageV5:p,credentials:g}=We()', 5)
for (const i of we2) {
  dump(
    `gold-We-caller-${i}.txt`,
    `# We() caller @${i}\n${asciiWindow(i - 200, i + 400)}\n`,
  )
}

// as We near Zg (23602xxxx)
for (const n of [' as We', 'We as ', '{We}', ',We,', 'We(){return{storageV5']) {
  const hits = findAll(n, 25)
  log(`WEALIAS ${JSON.stringify(n)} count=${hits.length}`)
  const nearZg = hits.filter((i) => i > 235000000 && i < 237000000)
  log(`  nearZg=${nearZg.join(',')}`)
  for (const i of [...nearZg, ...hits.slice(0, 4)]) {
    log(`  @${i} ${asciiWindow(i - 60, i + 120).replace(/\n/g, ' ')}`)
  }
}

// --- Jr() ---
const jrNeedles = [
  'function Jr(){',
  'function Jr(){return',
  'async function Jr(){',
  'Jr=()=>',
  ' as Jr',
  'Jr as ',
]
for (const n of jrNeedles) {
  const hits = findAll(n, 25)
  log(`JR ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 10)) {
    const win = asciiWindow(i - 30, i + 180).replace(/\n/g, ' ')
    const looksStore =
      win.includes('mutate') ||
      win.includes('readAsync') ||
      win.includes('pluginSecrets') ||
      win.includes('secure') ||
      win.includes('keychain') ||
      win.includes('getSecure')
    log(`  @${i}${looksStore ? ' STOREISH' : ''} ${win}`)
    if (looksStore) {
      const fn = extractFn(i)
      dump(
        `gold-Jr-def-${i}.txt`,
        `# needle=${n} pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
      )
    }
  }
}

// Jr().mutate all sites
const jrMut = findAll('Jr().mutate', 20)
log(`JR.mutate count=${jrMut.length}`)
for (const i of jrMut) {
  log(`  @${i} ${asciiWindow(i - 80, i + 160).replace(/\n/g, ' ')}`)
}

// nPe module header: walk back to import{
const nPe = findAll('async function nPe(e,t,n){', 3)
for (const i of nPe) {
  dump('gold-nPe-callees-nPe-body.txt', `# nPe@${i}\n${extractFn(i).text}\n`)
  // walk back looking for import{ ... as Jr / as ay
  const before = asciiWindow(i - 30000, i)
  dump('gold-nPe-callees-nPe-before-30k.txt', `# nPe@${i} before 30k\n${before}\n`)
  const ayImp = [...before.matchAll(/\{[^}]{0,400}as ay[,}]/g)].slice(-5)
  const jrImp = [...before.matchAll(/\{[^}]{0,400}as Jr[,}]/g)].slice(-5)
  log(`nPe import-as-ay last=${JSON.stringify(ayImp.map((m) => m[0].slice(0, 200)))}`)
  log(`nPe import-as-Jr last=${JSON.stringify(jrImp.map((m) => m[0].slice(0, 200)))}`)
}

// --- ay() ---
const ayNeedles = [
  'function ay(e,t,n,r){',
  'async function ay(e,t,n,r){',
  'function ay(e,t,n){',
  'async function ay(e,t,n){',
  'function ay(e,t){',
  ' as ay',
  'ay as ',
]
for (const n of ayNeedles) {
  const hits = findAll(n, 20)
  log(`AY ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    const win = asciiWindow(i, i + 200).replace(/\n/g, ' ')
    const looksSettings =
      win.includes('userSettings') ||
      win.includes('pluginConfigs') ||
      win.includes('updateSettings') ||
      win.includes('policySettings') ||
      win.includes('error')
    log(`  @${i}${looksSettings ? ' SETTINGISH' : ''} ${win}`)
    if (looksSettings || n.includes('function ay(e,t,n')) {
      const fn = extractFn(i)
      dump(
        `gold-nPe-callees-ay-${i}.txt`,
        `# needle=${n} pos=${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
      )
    }
  }
}

const ayCall = findAll('ay("userSettings",{pluginConfigs:', 15)
log(`AYCALL pluginConfigs count=${ayCall.length}`)
for (const i of ayCall) {
  log(`  @${i} ${asciiWindow(i - 40, i + 180).replace(/\n/g, ' ')}`)
}

// --- t3 ---
const t3defs = findAll('function t3(){', 15)
log(`T3DEF count=${t3defs.length}`)
for (const i of t3defs) {
  const fn = extractFn(i)
  log(`  @${i} len=${fn.end - i} ${fn.text.slice(0, 180)}`)
  dump(
    `gold-nPe-callees-t3-${i}.txt`,
    `# function t3(){ @${i} end=${fn.end} len=${fn.end - i}\n${fn.text}\n`,
  )
}

// --- host WeakMaps / REPL pin ---
const hostNeedles = [
  'session.host',
  '.host).storageV5',
  'storageV5:Xt',
  'credentials:Ce',
  'function We(){return{',
  'return{storageV5:t.of',
  'return{storageV5:',
  'of(e.session.host)',
  'of(e.host)',
  'of(t.session.host)',
  'ns().host',
  'session:{host:',
]
for (const n of hostNeedles) {
  const hits = findAll(n, 15)
  log(`HOST ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    log(`  @${i} ${asciiWindow(i - 80, i + 140).replace(/\n/g, ' ')}`)
  }
}

// REPL / pin
const pinNeedles = [
  'pinStorageV5',
  'pinCredentialsStore',
  'credentialsStoreFor',
  'A()&&p!==void 0',
  'A()&&l!==void 0',
  'k({storageV5:p,credentials:m(p)})',
  'm({storageV5:p,credentials:N})',
  'let{storageV5:d,credentials:g}=Ue()',
]
for (const n of pinNeedles) {
  const hits = findAll(n, 10)
  log(`PIN ${JSON.stringify(n)} count=${hits.length}`)
  for (const i of hits.slice(0, 5)) {
    log(`  @${i} ${asciiWindow(i - 60, i + 160).replace(/\n/g, ' ')}`)
    dump(`gold-We-pin-${i}.txt`, `# ${n} @${i}\n${asciiWindow(i - 400, i + 600)}\n`)
  }
}

dump('gold-We-Jr-ay-t3-scan.txt', report.join('\n') + '\n')
