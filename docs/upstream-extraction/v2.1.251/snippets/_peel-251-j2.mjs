/**
 * Pass 2 recon for 251-j misses: vp/tX/MLe/K, c$t/u$t, qhn, hM/o5,
 * and verify #6 ancestor-walk heuristic.
 */
import {
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
} from './_peel-251-helpers.mjs'

const buf = loadSea()

function dump(label, needle, n = 12) {
  const hits = allHits(buf, needle)
  console.log(`\n=== ${label}  needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const h of hits.slice(0, n)) {
    const win = asciiSlice(buf, h - 80, h + needle.length + 160).replace(/\s+/g, ' ')
    const st = lastFnStartGeneric(buf, h + 1, 8000)
    console.log(`  @${h} fn=${st.name}@${st.i}  ${win.slice(0, 220)}`)
  }
}

function nearestName(name, near) {
  const needles = [
    `function ${name}(`,
    `function ${name} (`,
    `function*${name}(`,
    `async function ${name}(`,
    `var ${name}=`,
    `let ${name}=`,
    `const ${name}=`,
    `${name}=function`,
    `${name}=async function`,
    `${name}=e=>`,
    `${name}=(e=>`,
    `${name}=t=>`,
    `${name}=(t,`,
  ]
  for (const n of needles) {
    const hits = allHits(buf, n)
    if (!hits.length) continue
    let best = hits[0]
    let dist = Math.abs(hits[0] - near)
    for (const h of hits) {
      const d = Math.abs(h - near)
      if (d < dist) {
        best = h
        dist = d
      }
    }
    console.log(
      `  ${name} via ${JSON.stringify(n)} hits=${hits.length} nearest@${best} dist=${dist} win=${JSON.stringify(asciiSlice(buf, best, best + 120))}`,
    )
  }
}

// #2
console.log('\n######## #2 near san=185859343 Ce=201165125')
for (const name of ['vp', 'tX', 'MLe', 'K', 'IN', 'rbe']) {
  console.log(`\n-- ${name}`)
  nearestName(name, 185859343)
}
dump('vp([e.data.message])', 'vp([e.data.message])', 4)
dump('function vp', 'function vp', 8)
dump('!tX(u)', '!tX(u)', 6)
dump('MLe(u.message.content)', 'MLe(u.message.content)', 4)
dump('session_id:K()', 'session_id:K()', 4)

// #4
console.log('\n######## #4 tracker')
dump('c$t(', 'c$t(', 10)
dump('u$t(', 'u$t(', 10)
dump('function c$', 'function c$', 8)
dump('function u$', 'function u$', 8)
nearestName('c$t', 202996715)
nearestName('u$t', 202996715)
dump('missRecacheTokens', 'missRecacheTokens', 8)
dump('cachingObserved', 'cachingObserved', 8)

// #6 verify ao
console.log('\n######## #6 ao / ancestor')
nearestName('ao', 182185287)
dump('function ao', 'function ao', 8)
dump('for(let d of ao(t))', 'for(let d of ao(t))', 6)
const uw = extractFnAt(buf, 182185287, 20000)
console.log('UWt ancestorWalk regex?', /for\s*\([^)]*(?:ao\(|L\(|dirname)/.test(uw.body || ''))
console.log('UWt has for(;;)?', /for\s*\(;;/.test(uw.body || ''))
console.log('UWt has L(N)?', /for\s*\([^;]*;\s*[^;]*;\s*(?:N|p|A|f)=L\(/.test(uw.body || ''))
const dh = extractFnAt(buf, 182187516, 20000)
console.log('DH ancestorWalk regex?', /for\s*\([^)]*(?:ao\(|L\(|dirname)/.test(dh.body || ''))
console.log('DH has for(;;)?', /for\s*\(;;/.test(dh.body || ''))
console.log('DH has L(N)?', /for\s*\([^;]*;\s*[^;]*;\s*(?:N|p|A|f)=L\(/.test(dh.body || ''))
console.log('DH for(;;) window:', (dh.body || '').includes('for(;;)'))

// #9 qhn
console.log('\n######## #9 qhn')
dump('qhn(', 'qhn(', 10)
dump('function qhn', 'function qhn', 8)
nearestName('qhn', 193380425)

// #18
console.log('\n######## #18 hM o5')
dump('hM()', 'hM()', 12)
dump('o5()', 'o5()', 12)
nearestName('hM', 190710208)
nearestName('o5', 190710208)
dump('hM().length', 'hM().length', 6)
