/**
 * densable 2.1.251 SEA peel — changelog #19 #22 #23 #24 #25 #26 #27
 * #29 #30 #31 #33 #34 #35 #36.
 * Skip #20 #21 #28 #32. Invent-ban. Does not touch src/, checklist, or board.
 *
 * BODY = the bullet's JS control flow (branch / timeout / skip), not a
 * changelog sentence in a string table. Excerpt <= 2500 chars.
 */
import { writeFileSync } from 'fs'
import {
  EXE_251,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
} from './_peel-251-helpers.mjs'

const EXPECT_BYTES = 217360032
const buf = loadSea()
if (buf.length !== EXPECT_BYTES) {
  throw new Error(`SEA bytes ${buf.length} != ${EXPECT_BYTES}`)
}

const BULLETS = [
  {
    id: 19,
    point: 'Opus 1M tip hidden when the model already has 1M',
    needles: [
      ['switch to Opus 1M', true],
      ['5x more context', true],
      ['has1mContext', true],
      ['5× more context', false],
      ['x more context', false],
      ['for 5x more', false],
    ],
  },
  {
    id: 22,
    point: 'Remote Control org-policy disable is a quiet notice',
    needles: [
      ['policy disables', true],
      ['Remote Control', true],
      ['quiet notice', true],
      ["organization's policy", false],
      ['disableRemoteControl', false],
      ['Remote Control is disabled', false],
    ],
  },
  {
    id: 23,
    point: 'RC /mcp reconnect shows the real remedy',
    needles: [
      ['disabled in another session', true],
      ['mcp reconnect', true],
      ['/mcp reconnect', false],
      ['withheld', false],
    ],
  },
  {
    id: 24,
    point: 'stream-json assistant tool calls without a message id',
    needles: [
      ['without a message id', true],
      ['stream-json', true],
      ['message id', true],
      ['input-format', false],
      ['--input-format', false],
    ],
  },
  {
    id: 25,
    point: 'same-ID transcript not overwritten after relocate',
    needles: [
      ['same-ID', true],
      ['relocated', true],
      ['overwritten', true],
      ['same-id', false],
      ['relocateSession', false],
      ['silently overwritten', false],
    ],
  },
  {
    id: 26,
    point: 'bg session can edit files in a git worktree it created',
    needles: [
      ['git worktree add', true],
      ['worktree add', false],
    ],
  },
  {
    id: 27,
    point: 'bg session keeps plugin skills across marketplace refresh',
    needles: [
      ['without any plugin skills', true],
      ['plugin marketplace', true],
      ['plugin skills', false],
      ['refreshing the plugin', false],
    ],
  },
  {
    id: 29,
    point: 'SDK MCP handshake ack wait times out at 70s',
    needles: [
      ['70 seconds', true],
      ['handshake', true],
      ['SDK MCP', true],
      ['handshake acknowledgment', false],
      ['70000', false],
      ['70_000', false],
      ['70e3', false],
      ['7e4', false],
    ],
  },
  {
    id: 30,
    point: 'force-stop kills leftover Bash via killProcessTree',
    needles: [
      ['force-stopped', true],
      ['killProcessTree', true],
      ['force-stop', false],
      ['force stopped', false],
    ],
  },
  {
    id: 31,
    point: 'usage-credits $0 limit offers to ask the admin',
    needles: [
      ['usage-credit', true],
      ['ask the admin', true],
      ['usage-credits', false],
      ['ask your admin', false],
      ['/usage-credits', false],
    ],
  },
  {
    id: 33,
    point: 'Ctrl+G /dev/tty editors in background sessions',
    needles: [
      ['Emacs quit unexpectedly', true],
      ['/dev/tty', true],
      ['emacs -nw', false],
      ['quit unexpectedly', false],
    ],
  },
  {
    id: 34,
    point: 'additionalDirectories null-byte entries are skipped',
    needles: [
      ['additionalDirectories', true],
      ['null byte', true],
      ['\\u0000', false],
      ['\\x00', false],
    ],
  },
  {
    id: 35,
    point: 'MCP copy shortcut reports how the sign-in URL was copied',
    needles: [
      ['Copied!', true],
      ['sign-in URL', true],
      ['(Copied!)', false],
      ['sign-in url', false],
    ],
  },
  {
    id: 36,
    point: 'italic suppressed for GNU screen / TERM=screen',
    needles: [
      ['TERM=screen', true],
      ['GNU screen', true],
      ['italic', true],
      ['screen-256color', false],
    ],
  },
]

function lastFnStart(before, maxLookback) {
  const start = Math.max(0, before - maxLookback)
  const win = asciiSlice(buf, start, before)
  let bestRel = -1
  let name = ''
  const re = /(?:async )?function ([A-Za-z_$][\w$]*)?\(/g
  let m
  while ((m = re.exec(win))) {
    bestRel = m.index
    name = m[1] || '(anon)'
  }
  if (bestRel < 0) return { i: -1, name: '' }
  return { i: start + bestRel, name }
}

function findAnchor(anchor) {
  const hits = allHits(buf, anchor).filter((off) => off > 170_000_000)
  if (hits.length === 0) {
    throw new Error(`anchor missing: ${anchor.slice(0, 80)}`)
  }
  return hits[0]
}

function windowAt(off, before, after) {
  const max = 2500
  let a = Math.max(0, off - before)
  let b = Math.min(buf.length, a + before + after)
  if (b - a > max) b = a + max
  const text = asciiSlice(buf, a, b)
  if (text.length > max) {
    throw new Error(`excerpt ${text.length} > 2500`)
  }
  const fn = lastFnStart(off + 1, 4000)
  let bodySha = '-'
  let bodyLen = 0
  let fnName = fn.name
  let fnAt = fn.i
  if (fn.i >= 0) {
    const ext = extractFnAt(buf, fn.i, 20000)
    if (ext.body && off >= fn.i && off < fn.i + ext.body.length) {
      bodySha = ext.sha
      bodyLen = ext.len
    }
  }
  return {
    text,
    sha: sha(text),
    off,
    fnName,
    fnAt,
    bodySha,
    bodyLen,
  }
}

function fmtOffsets(offs, cap = 8) {
  if (offs.length === 0) return '-'
  const head = offs.slice(0, cap).join(',')
  return offs.length > cap ? `${head},…+${offs.length - cap}` : head
}

const counts = new Map()
for (const b of BULLETS) {
  counts.set(
    b.id,
    b.needles.map(([needle, primary]) => ({
      needle,
      primary,
      offs: allHits(buf, needle),
    })),
  )
}

const ev = {
  19: [
    windowAt(
      findAnchor(
        'function n(){let e=ap();if(e==="opus"&&wx()&&!ky(bl()))',
      ),
      0,
      520,
    ),
    windowAt(
      findAnchor('function ky(e){if(eN())return!1;let t=Rw(e)'),
      0,
      420,
    ),
  ],
  22: [
    windowAt(
      findAnchor(
        'if(wve())return"Remote Control is disabled by your organization\'s policy',
      ),
      80,
      420,
    ),
    windowAt(
      findAnchor('async function oe(l){let b=await yGt();if(b)return{kind:"error"'),
      0,
      280,
    ),
  ],
  23: [
    windowAt(findAnchor('function qge(e,n,t){if(!n){let i=Q(e,'), 0, 1200),
    windowAt(findAnchor('if(e==="all"){let t=qge(f,p,y)'), 40, 700),
  ],
  24: [
    windowAt(
      findAnchor(
        'if(We.type==="assistant"&&!We.message.id&&We.requestId===void 0)',
      ),
      120,
      900,
    ),
  ],
  25: [
    windowAt(findAnchor('if(!A)x=await dpe(y)'), 80, 900),
    windowAt(
      findAnchor(
        'relocateSessionTranscript: existing destination set aside at',
      ),
      280,
      220,
    ),
  ],
  26: [
    windowAt(
      findAnchor('function Fkn(e){let t=lvt(e);return t!==null&&ue(t)!==t}'),
      0,
      120,
    ),
    windowAt(
      findAnchor(
        'if(u.canonical!==null&&Fkn(u.canonical))return null',
      ),
      200,
      1100,
    ),
  ],
  27: [
    windowAt(findAnchor('var _gr=[30,70,150]'), 40, 40),
    windowAt(
      findAnchor(
        'catalog readable again after a re-read (another process was refreshing it)',
      ),
      900,
      220,
    ),
  ],
  29: [
    windowAt(findAnchor('_e=70000,Re=0.01,Z=512'), 40, 80),
    windowAt(
      findAnchor(
        'async sendMcpMessage(t,e,o=_e){let u=rot(e)?void 0:Xa(void 0,{timeoutMs:o,refTimer:!0})',
      ),
      0,
      360,
    ),
    windowAt(
      findAnchor('function rot(s){return"method"in s&&"id"in s&&s.id!==null}'),
      0,
      80,
    ),
    windowAt(
      findAnchor('async function Rd(e,t,o){let r=[],d=[],u=[];lo()'),
      0,
      2100,
    ),
  ],
  30: [
    windowAt(
      findAnchor(
        'reapDescendants(e){let t=this.treeSnapshot;if(t===void 0)return',
      ),
      220,
      1400,
    ),
    windowAt(
      findAnchor('n(`killProcessTree ${e} failed: ${r??o}`)'),
      420,
      80,
    ),
    windowAt(
      findAnchor(
        'killing process tree at pid=${this.child.pid}`),this.child.pid)ug(this.child.pid)',
      ),
      40,
      220,
    ),
    windowAt(
      findAnchor('function ug(e,o="SIGKILL"){if(!Number.isInteger(e)||e<=1)return Promise.resolve();return P(e)'),
      0,
      160,
    ),
  ],
  31: [
    windowAt(
      findAnchor('e.overageDisabledReason==="group_zero_credit_limit"'),
      700,
      500,
    ),
    windowAt(
      findAnchor('function mhe(){return nS()?'),
      0,
      220,
    ),
  ],
  33: [
    windowAt(
      findAnchor(
        'async function L(){try{return await(await se("/dev/tty",q.O_RDWR|q.O_NOCTTY)).close(),!0}catch{return!1}}',
      ),
      0,
      900,
    ),
    windowAt(
      findAnchor('tengu_bg_worker_ctty",!0)?await z()'),
      80,
      420,
    ),
  ],
  34: [
    windowAt(
      findAnchor(
        'addDirectories carries a directory containing a null byte',
      ),
      350,
      450,
    ),
    windowAt(
      findAnchor('return{resultType:"invalidPath",directoryPath:e,containsNullByte:y}'),
      180,
      200,
    ),
  ],
  35: [
    windowAt(
      findAnchor(
        'function uL(G){let S=y(2),{via:E}=G;if(E==="tmux-buffer")',
      ),
      280,
      520,
    ),
    windowAt(
      findAnchor('Pe=W((ee)=>ee.mcp)'),
      0,
      420,
    ),
  ],
  36: [
    windowAt(
      findAnchor(
        'rendersItalicAsStandout(){return(this.proc.env.TERM??"").startsWith("screen")}',
      ),
      0,
      900,
    ),
  ],
}

const verdict = {
  19: 'BODY',
  22: 'STRING-ONLY',
  23: 'BODY',
  24: 'BODY',
  25: 'BODY',
  26: 'BODY',
  27: 'BODY',
  29: 'BODY',
  30: 'BODY',
  31: 'BODY',
  33: 'BODY',
  34: 'BODY',
  35: 'BODY',
  36: 'BODY',
}

const why = {
  19: 'n() suppresses the tip unless setting is opus/sonnet AND ky(resolved model) is false; ky() is the native-1m check. Quoted tip phrase is a template (Opus 1M + multiplier 5).',
  22: 'policy-disable copy still returns an error string (yGt) and kind:"error" (oe). "quiet notice" and "Remote Control failed" are absent. "policy disables" is the artifact-subscription string, not RC.',
  23: 'qge/y$ build the disabled-in-another-session remedy; /mcp reconnect returns qge() instead of a generic withheld error.',
  24: 'deserializeMessages stamps message.id on id-less assistant entries (pre-#61940 stream-json injection) before same-id merge. Phrase "without a message id" is absent.',
  25: 'relocate sets an existing destination aside via dpe() (.superseded-<ts>) before the move, and restores it if the move fails. "same-ID" phrase is absent.',
  26: 'bg write guard returns null (allow) when Fkn(canonical) — linked worktree — and the denial text says a git worktree add path is accepted.',
  27: 'qFe re-reads a null marketplace catalog on delays _gr=[30,70,150] while $Y does not refuse the entry, and logs that another process was refreshing it. "without any plugin skills" is absent.',
  29: 'sendMcpMessage defaults to _e=70000 but arms the timer only when rot() is false (message lacks method+non-null id). Rd() connects each SDK server in Promise.allSettled and marks only the thrown server failed.',
  30: 'runner session terminate() calls ug(pid); stop() reaps descendants. ug is the killProcessTree module (taskkill /T). "force-stopped" phrase is absent.',
  31: 'group_zero_credit_limit / member_zero_credit_limit copy asks the admin via mhe() (/usage-credits), separate from the spend-cap branch. "ask the admin" phrase is absent.',
  33: 'When CLAUDE_BG_BACKEND==="daemon" and tengu_bg_worker_ctty is on, startup awaits z(), which opens /dev/tty and login_tty(0). "Emacs quit unexpectedly" is absent.',
  34: 'addDirectories permission updates drop a directory that contains a null byte; workspace validate returns containsNullByte instead of throwing. "additionalDirectories" itself is not in that predicate.',
  35: 'uL/cL branch on copiedVia (native "(Copied!)", tmux-buffer, osc52). MCP menu state ee.mcp wires ZW() copiedVia. "sign-in URL" hits are older changelog text.',
  36: 'rendersItalicAsStandout() is TERM.startsWith("screen"); jJn strips italic-off SGR when that is true. "TERM=screen" and "GNU screen" phrases are absent.',
}

for (const [id, parts] of Object.entries(ev)) {
  for (const part of parts) {
    if (part.text.length > 2500) {
      throw new Error(`#${id} excerpt ${part.text.length}`)
    }
  }
}

const rows = BULLETS.map((b) => {
  const parts = ev[b.id] ?? []
  const best = parts[0]
  const hitCol = counts
    .get(b.id)
    .map(
      (n) =>
        `${n.primary ? '*' : ''}${JSON.stringify(n.needle)}=${n.offs.length}`,
    )
    .join(' ')
  return {
    id: b.id,
    verdict: verdict[b.id],
    sha: best?.sha ?? '-',
    fn: best
      ? `${best.fnName || '-'}@${best.fnAt} len=${best.bodyLen || '-'}`
      : '-',
    offsets: best ? `@${best.off}` : '-',
    hits: hitCol,
  }
})

const table = [
  '| # | verdict | sha | fn | offsets | hits |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows.map(
    (r) =>
      `| ${r.id} | ${r.verdict} | ${r.sha} | ${String(r.fn).replace(/\|/g, '/')} | ${r.offsets} | ${r.hits.replace(/\|/g, '/')} |`,
  ),
]

const sections = BULLETS.map((b) => {
  const lines = []
  lines.push(`## #${b.id} ${b.point}`)
  lines.push('')
  lines.push(`verdict=${verdict[b.id]}`)
  lines.push('')
  lines.push(why[b.id])
  lines.push('')
  lines.push('| needle | primary | hits | offsets |')
  lines.push('| --- | --- | --- | --- |')
  for (const n of counts.get(b.id)) {
    lines.push(
      `| ${n.needle.replace(/\|/g, '\\|')} | ${n.primary ? 'yes' : 'no'} | ${n.offs.length} | ${fmtOffsets(n.offs)} |`,
    )
  }
  lines.push('')
  const parts = ev[b.id] ?? []
  if (parts.length === 0) {
    lines.push('No control-flow excerpt. Distinctive phrase misses are in the needle table.')
    lines.push('')
  }
  parts.forEach((part, idx) => {
    lines.push(
      `### evidence ${idx + 1} off=${part.off} fn=${part.fnName || '-'}@${part.fnAt} bodyLen=${part.bodyLen || '-'} bodySha=${part.bodySha} excerptSha=${part.sha}`,
    )
    lines.push('')
    lines.push('~~~~')
    lines.push(part.text)
    lines.push('~~~~')
    lines.push('')
  })
  return lines.join('\n')
})

const gold = [
  '# gold-251-d',
  '',
  `when=${new Date().toISOString()}`,
  `exe=${EXE_251}`,
  `bytes=${buf.length}`,
  'version=2.1.251',
  'skip=#20 #21 #28 #32 (LOCAL or cloud N/A-candidate; not peeled)',
  'rule=BODY is the bullet control flow in JS. A failure string or changelog sentence without that branch is STRING-ONLY. No branch and no distinctive phrase is MISS. Invent-ban. Not HAVE.',
  'primary needles are marked * . Offsets are bytes into claude.exe. excerptSha is sha256-16 of the excerpt below (<=2500). bodySha is the closed function extract when the hit sits inside it.',
  '',
  ...table,
  '',
  ...sections,
].join('\n')

const out = 'docs/upstream-extraction/v2.1.251/snippets/gold-251-d.md'
writeFileSync(out, gold)
console.log(table.join('\n'))
console.log(`wrote ${out} chars=${gold.length}`)
