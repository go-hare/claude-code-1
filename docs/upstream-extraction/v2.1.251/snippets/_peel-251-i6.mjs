/**
 * densable 2.1.251 — Qxt hop + exact sha/len confirmation for gold-251-i.md
 */
import {
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()

function extractGrow(i, caps = [2000, 8000, 20000, 60000, 200000, 800000]) {
  let last = { i, miss: true }
  for (const cap of caps) {
    last = extractFnAt(buf, i, cap)
    if (last.body) return { ...last, cap }
  }
  return last
}

for (const n of [
  'async function*Qxt',
  'function*Qxt',
  'function Qxt(',
  'async function Qxt(',
]) {
  const hs = allHits(buf, n)
  console.log(n, hs.length, hs.slice(0, 6).join(','))
  for (const h of hs.slice(0, 3)) {
    const fn = extractGrow(h)
    console.log(
      `  @${h} len=${fn.len} sha=${fn.sha} miss=${!!fn.miss}${fn.missEnd ? ' missEnd' : ''}`,
    )
    console.log('  HEAD', asciiSlice(buf, h, h + 100))
    if (fn.body) {
      console.log('  START', fn.body.slice(0, 200))
      console.log('  END', fn.body.slice(-120))
    }
  }
}

// confirm exact bodies + sha for gold
const lock = [
  ['Osn', 186758304],
  ['Lsn', 186757898],
  ['z_', 187242129],
  ['$sn', 185574156],
  ['Y_e', 185568683],
  ['vwe', 185568973],
  ['VSn', 185573811],
  ['gRn', 179049328],
  ['dD', 186760799],
  ['cre', 180584703],
  ['hJ', 180584572],
  ['pEt', 179887321],
  ['LOe', 180780907],
  ['yBn', 186764691],
  ['HPe', 184985281],
  ['jL', 184985089],
  ['Jt-bar', 208972948],
  ['Xxt', 187242390],
  ['nVn', 186758371],
  ['DOe', 180780145],
  ['Jt-reg', 181786426],
]
for (const [name, i] of lock) {
  const fn = extractGrow(i)
  console.log(
    `${name} @${i} len=${fn.len} sha=${fn.sha} starts=${fn.body?.slice(0, 40)}`,
  )
}

const extras = {
  Kle: 'var Kle=new Ln(()=>({registry:void 0}));',
  yEt: 'var yEt=new Ln(()=>new gEt);',
  gEt: 'class gEt{pending=[];landedOn=null;inFlight=new Set}',
  Ln: 'class Ln{#e;#t=new WeakMap;constructor(e){this.#e=e}peek(e){return this.#t.get(e.root)}of(e){let t=e.root,o=this.#t.get(t);if(o!==void 0)return o;let r=this.#e();return this.#t.set(t,r),r}drop(e){this.#t.delete(e.root)}}',
  Hye: 'Hye=30000',
  W6n: 'var W6n=new Set(["PreToolUse","PermissionRequest","UserPromptSubmit","UserPromptExpansion","TaskCompleted","TeammateIdle"]);',
}
for (const [k, v] of Object.entries(extras)) {
  const off = buf.indexOf(Buffer.from(v))
  console.log(`${k} off=${off} len=${v.length} sha=${sha(v)}`)
}
