/**
 * densable 2.1.251 SEA peel — changelog #37 #38 #39 #40 #41 #42 #44 #46 #49 #50 #51 #53 #54.
 * Skip #43 #45 #47 #48 #52. Invent-ban. Does not mark HAVE.
 * Writes snippets/gold-251-e.md.
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-251-helpers.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const buf = loadSea()
const CAP = 2500

function fnAt(anchor, maxLen = 12000) {
  const i = buf.indexOf(Buffer.from(anchor))
  if (i < 0) return { miss: true, anchor }
  const fn = extractFnAt(buf, i, maxLen)
  const head = asciiSlice(buf, i, i + 48)
  const name = (head.match(/function\s+([A-Za-z_$][\w$]*)/) || [])[1] || '(anon)'
  return { ...fn, name, anchor }
}

function fnContaining(needle, maxBack = 24000) {
  const hits = allHits(buf, needle)
  for (const h of hits) {
    const start = Math.max(0, h - maxBack)
    const win = asciiSlice(buf, start, h)
    const re = /function\s+[A-Za-z_$][\w$]*\s*\(/g
    let m
    const starts = []
    while ((m = re.exec(win))) starts.push(start + m.index)
    for (let c = starts.length - 1; c >= 0; c--) {
      const fn = extractFnAt(buf, starts[c], Math.min(20000, h - starts[c] + 6000))
      if (fn.body && fn.body.includes(needle)) {
        const name =
          (asciiSlice(buf, starts[c], starts[c] + 40).match(
            /function\s+([A-Za-z_$][\w$]*)/,
          ) || [])[1] || '(anon)'
        return { ...fn, name, anchor: needle }
      }
    }
  }
  return { miss: true, anchor: needle }
}

function methodAt(anchor) {
  const i = buf.indexOf(Buffer.from(anchor))
  if (i < 0) return { miss: true, anchor }
  const win = asciiSlice(buf, i, i + 4000)
  const brace = win.indexOf('{')
  let depth = 0
  let inStr = null
  let esc = false
  for (let p = brace; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const body = win.slice(0, p + 1)
        return { i, body, sha: sha(body), len: body.length, name: '#r' }
      }
    }
  }
  return { i, missEnd: true, anchor }
}

function cap(text, needle) {
  if (!text) return ''
  if (text.length <= CAP) return text
  const at = needle ? text.indexOf(needle) : 0
  const center = at < 0 ? 0 : at
  let from = Math.max(0, center - Math.floor(CAP / 2))
  let to = from + CAP
  if (to > text.length) {
    to = text.length
    from = Math.max(0, to - CAP)
  }
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`
}

function hitsOf(needles) {
  return needles.map(needle => ({ needle, n: allHits(buf, needle).length }))
}

function hitLine(rows) {
  return rows.map(r => `\`${r.needle}\` ${r.n}`).join('; ')
}

const Lr = fnAt('function Lr(t,o){t.command("add <name>', 8000)
const jr = fnContaining('Add an MCP server (stdio, SSE, HTTP, or WebSocket)')
const dnt = fnAt('function dnt(e,t,r){let o=!0,u=1000', 12000)
const pollO = fnAt('async function O(r,t,s,i){let o=Date.now()+s', 4000)
const dollarT = fnAt('function $$t(){return I("tengu_linear_brook",!0)}', 200)
const Qo = fnAt('function Qo(e,t){if(!or.has(e))return!1', 400)
const Oo = fnAt('function Oo(e){if(WNe(process.env))return{}', 800)
const So = fnAt('async function So(e,t,o,r,i,d,u)', 12000)
const urr = fnAt('function urr(e){return{...e.subscriptionType', 600)
const oEn = fnAt('function oEn(){if(a.CLAUDE_CODE_SESSION_KIND!=="bg")', 500)
const dollarN = fnAt(
  'function $n(){if(yl())return Tl();if(!wl())return null;let e=Xt()',
  400,
)
const oI = fnAt('function oI(){if(!Yp())return null;switch(oEn()', 500)
const iI = fnAt('function iI(){if(!Yp())return null;let e=oEn().rateLimitTier', 400)
const gP = fnAt('function gP(e,t){return lp(e)&&!cjt(Xe(e))&&Gce()&&f6e(t)}', 200)
const rMethod = methodAt('async#r(b){let{session:R,store:x')
const wt = fnAt('function wt(){return C2()==="bg"}', 200)
const f_ = fnAt('function f_(){return oc()||wt()||pie()', 200)
const pie = fnAt('function pie(){return n().host.extensionsConfig.teammateAgentId()}', 200)
const TG = fnAt('function TG(e="/feedback")', 800)
const nBug = fnAt('async function n(o,a,e,m){return gRt', 200)
const uln = fnAt('function uln(){if(TG()!==null)', 500)
const schedF = fnContaining('cannot be attached to cloud')
const schedWe = fnContaining('No MCP connectors for cloud routines')
const RMe = fnAt('function RMe(e,t){if(t.activityObservation', 800)
const Bpe = fnAt(
  'function Bpe({input:b,submitCount:R,hasMessages:x,viewingAgentName:P})',
  800,
)
const wCe = fnAt('function wCe(s){let{teammate:n,localAgent:m}', 400)
const Mn = fnAt('function _Mn(s){let n=wCe(s)', 500)
const Pbt = fnAt('async function Pbt(e){if(KFe()!==null)return', 500)
const Jbn = fnAt('function Jbn(e){let t=hr(e).trim().toLowerCase()', 300)
const hostS = fnAt(
  'async function S(){if(Ne()!=="bedrock")return[];if(a.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)return[]',
  2000,
)
const hostF = fnAt(
  'async function F(){if(Ne()!=="bedrock")return[];if(a.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)return[]',
  2000,
)
const eAn = fnAt('function eAn(e,t){let o=VU(e),s=0,r=0,c={}', 2000)
const c5 = fnAt(
  'function c5(e){return Object.keys(e.shellSettings).length>0||Object.keys(e.envVars)',
  400,
)
const Oe = fnAt('function Oe(bt){let i=y(95),{settings:S,baseline:Ge', 8000)

const required = [
  Lr, jr, dnt, pollO, Qo, Oo, So, urr, oEn, dollarN, oI, iI, gP, rMethod,
  wt, f_, pie, TG, nBug, uln, schedF, schedWe, RMe, Bpe, wCe, Mn, Pbt,
  Jbn, hostS, hostF, eAn, c5, Oe,
]
for (const fn of required) {
  if (!fn.body) {
    console.error('MISS anchor', fn.anchor || fn.name)
    process.exit(1)
  }
}
const must = [
  [Lr, 'Set headers for HTTP/SSE'],
  [jr, 'add-json'],
  [dnt, 'startupFailure'],
  [pollO, 'startupFailure'],
  [Qo, 'or.has(e)'],
  [Oo, 'companions'],
  [So, 'Oo(ge)'],
  [So, 'urr('],
  [urr, 'CLAUDE_BG_DISPATCHER_SUBSCRIPTION_TYPE'],
  [oEn, 'SESSION_KIND'],
  [gP, 'Gce'],
  [rMethod, 'shouldShowAutoDefaultNudge'],
  [TG, 'DISABLE_BUG_COMMAND'],
  [nBug, '/bug'],
  [schedF, 'cannot be attached to cloud'],
  [schedWe, "can't be attached"],
  [RMe, 'descendant'],
  [Bpe, 'Message @'],
  [wCe, 'localAgent'],
  [Mn, 'agentName'],
  [Pbt, 'PROVIDER_MANAGED_BY_HOST'],
  [hostS, 'PROVIDER_MANAGED_BY_HOST'],
  [hostF, 'PROVIDER_MANAGED_BY_HOST'],
  [Jbn, 'toLowerCase'],
  [eAn, 'unchangedCount'],
  [Oe, 'unchanged since your last approval'],
]
for (const [fn, needle] of must) {
  if (!fn.body.includes(needle)) {
    console.error('body missing', needle, 'in', fn.name, '@', fn.i)
    process.exit(1)
  }
}

const h37 = hitsOf([
  'WebSocket headers',
  'stdio or SSE',
  'HTTP headers (e.g.',
  'stdio, sse, http',
  'Transport type (stdio, sse, http)',
  'add-json',
])
const h38 = hitsOf([
  'ultrareview',
  '30 minutes',
  'startupFailure',
  'session_start_failed',
  'cloud session could not start',
  'isRemoteReview',
])
const h39 = hitsOf([
  'OPTIND',
  'arithmetic expression',
  'integer attribute',
  'arith-evals',
])
const h40 = hitsOf([
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'backgrounded sessions',
])
const h41 = hitsOf([
  'usage credits',
  'fable_overage_consent_prompt',
  'CLAUDE_BG_DISPATCHER_SUBSCRIPTION_TYPE',
  'CLAUDE_BG_DISPATCHER_RATE_LIMIT_TIER',
  '--model fable',
])
const h42 = hitsOf([
  'make auto mode your default',
  'make auto mode the default',
  'auto_default_nudge',
  'hasSeenAutoDefaultNudge',
  'shouldShowAutoDefaultNudge',
])
const h44 = hitsOf([
  '/feedback has been disabled',
  'DISABLE_BUG_COMMAND',
  'DISABLE_FEEDBACK_COMMAND',
  '/share',
])
const h46 = hitsOf(['redundant UI', 're-render', 're-renders', 'redundant render'])
const h49 = hitsOf([
  'No MCP connectors',
  'cloud routines',
  "can't be attached",
  'cannot be attached to cloud',
  'configured in Claude Code',
])
const h50 = hitsOf([
  'worker inside this session',
  'working inside this same session',
  'another Claude session',
  'Another Claude session sent a message',
])
const h51 = hitsOf(['Message @', 'viewingAgentName', 'localAgent'])
const h53 = hitsOf([
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'sessionModelIsProviderId',
  'ListInferenceProfiles',
  'inference profile',
])
const h54 = hitsOf([
  'settings that changed',
  'since you last approved',
  'unchanged since your last approval',
  'previously approved',
  'Managed settings require approval',
])

const kAt = buf.indexOf('working inside this same session')
const kWin = asciiSlice(buf, kAt - 80, kAt + 720)
const ffeAt = buf.indexOf('ANTHROPIC_VERTEX_BASE_URL",selection:"CLAUDE_CODE_USE_VERTEX"')
const ffeWin = asciiSlice(buf, ffeAt - 180, ffeAt + 420)
const orAt = buf.indexOf('or=new Set(["RANDOM","SECONDS","LINENO","OPTIND"')
const setWin = asciiSlice(buf, orAt, Qo.i + Qo.len)
const neeAt = buf.indexOf('var Nee=go({kind:"fable_overage_consent_prompt"')
const neeWin = asciiSlice(buf, neeAt, gP.i + gP.len)
const gPCallAt = buf.indexOf('if(gP(zr,ct.requestDialog))')
const gPCall = asciiSlice(buf, gPCallAt, gPCallAt + 32)
const pbtNeedle = 'await Pbt({sessionModelIsProviderId:'
const pbtCallAt = buf.indexOf(pbtNeedle)
const pbtEnd = pbtCallAt < 0 ? -1 : buf.indexOf('})', pbtCallAt)
const pbtCall = pbtEnd < 0 ? '' : asciiSlice(buf, pbtCallAt, pbtEnd + 2)

const lines = []
const log = s => lines.push(s)

log('# gold-251-e')
log('')
log(
  `densable 2.1.251 SEA \`claude.exe\` ${buf.length} bytes. Invent-ban. Skipped #43 #45 #47 #48 #52.`,
)
log('')
log(
  '**BODY** = a function whose body contains the behavior. **STRING-ONLY** = string hits, no function for this bullet. **MISS** = needles absent. Excerpts capped at 2500. sha is the full extract.',
)
log('')
log('| # | verdict | hits | sha | bytes |')
log('| --- | --- | --- | --- | --- |')

const rows = [
  [
    37,
    'BODY',
    hitLine(h37),
    `\`Lr\` \`${Lr.sha}\` len ${Lr.len}; \`jr\` \`${jr.sha}\` len ${jr.len}`,
    '`--header` help is HTTP/SSE; add-json lists stdio, SSE, HTTP, or WebSocket',
  ],
  [
    38,
    'BODY',
    hitLine(h38),
    `\`dnt\` \`${dnt.sha}\` len ${dnt.len}; \`O\` \`${pollO.sha}\` len ${pollO.len}`,
    'remote review fails on `startupFailure` before the 30-minute poll timeout',
  ],
  [
    39,
    'BODY',
    hitLine(h39),
    `\`Qo\` \`${Qo.sha}\` len ${Qo.len}`,
    '`OPTIND`/`RANDOM` in `or`; non-integer RHS is too-complex',
  ],
  [
    40,
    'BODY',
    hitLine(h40),
    `\`Oo\` \`${Oo.sha}\` len ${Oo.len}; \`So\` \`${So.sha}\` len ${So.len}`,
    'bg `env` spreads shell endpoint + `CLAUDE_CODE_SKIP_*_AUTH` companions',
  ],
  [
    41,
    'BODY',
    hitLine(h41),
    `\`urr\` \`${urr.sha}\` len ${urr.len}; \`oEn\` \`${oEn.sha}\` len ${oEn.len}; \`gP\` \`${gP.sha}\` len ${gP.len}`,
    'bg reattach copies subscription + rate-limit tier; fable credit dialog is `gP`',
  ],
  [
    42,
    'BODY',
    hitLine(h42),
    `\`#r\` \`${rMethod.sha}\` len ${rMethod.len}`,
    'bg `wt()` returns before the nudge; `f_()` also skips teammates',
  ],
  [
    44,
    'BODY',
    hitLine(h44),
    `\`TG\` \`${TG.sha}\` len ${TG.len}; \`n\` \`${nBug.sha}\` len ${nBug.len}`,
    'bug/share pass `/bug` or `/share` into the disabled-reason template',
  ],
  [
    46,
    'STRING-ONLY',
    hitLine(h46),
    '—',
    'no UI-cut function; hits are pre-rendered, React docs, ConPTY, changelog prose',
  ],
  [
    49,
    'BODY',
    hitLine(h49),
    `\`F\` \`${schedF.sha}\` len ${schedF.len}; \`we\` \`${schedWe.sha}\` len ${schedWe.len}`,
    'schedule copy says Claude Code MCP servers cannot attach to cloud routines',
  ],
  [
    50,
    'BODY',
    hitLine(h50),
    `\`RMe\` \`${RMe.sha}\` len ${RMe.len}`,
    'descendant lineage uses the in-session subagent/teammate disclaimer',
  ],
  [
    51,
    'BODY',
    hitLine(h51),
    `\`Bpe\` \`${Bpe.sha}\` len ${Bpe.len}; \`wCe\` \`${wCe.sha}\` len ${wCe.len}`,
    'placeholder is `Message @name…` when a local agent or teammate is viewed',
  ],
  [
    53,
    'BODY',
    hitLine(h53),
    `\`Pbt\` \`${Pbt.sha}\` len ${Pbt.len}; \`S\` \`${hostS.sha}\` len ${hostS.len}; \`F\` \`${hostF.sha}\` len ${hostF.len}`,
    'host-managed + provider model id returns before profile discovery',
  ],
  [
    54,
    'BODY',
    hitLine(h54),
    `\`eAn\` \`${eAn.sha}\` len ${eAn.len}; \`Oe\` \`${Oe.sha}\` len ${Oe.len}`,
    'dialog rows come from `eAn` changed keys, not the full bag',
  ],
]
for (const [id, verdict, hits, shaCell, bytes] of rows) {
  log(`| ${id} | ${verdict} | ${hits} | ${shaCell} | ${bytes} |`)
}
log('')

function section(id, verdict, point, hitRows, blocks) {
  log(`## #${id} ${verdict}`)
  log('')
  log(point)
  log('')
  log(`hits: ${hitLine(hitRows)}`)
  log('')
  for (const b of blocks) log(b)
}

function fence(fn, needle) {
  return [
    `### \`${fn.name}\` @${fn.i} sha=\`${fn.sha}\` len=${fn.len}`,
    '',
    '```',
    cap(fn.body, needle),
    '```',
    '',
  ].join('\n')
}

section(37, 'BODY', 'mcp add --header / add-json help names transports', h37, [
  'Old help strings `WebSocket headers` and `stdio or SSE` are absent.',
  '',
  fence(Lr, 'Set headers for HTTP/SSE'),
  fence(jr, 'add-json'),
])

section(
  38,
  'BODY',
  'ultrareview stops when the cloud session fails to start',
  h38,
  [
    `\`$$t\` @${dollarT.i} sha=\`${dollarT.sha}\` len=${dollarT.len}: \`${dollarT.body}\`. \`wZ.session_start_failed\` is \`cloud session could not start\`. \`dnt\` returns failed on \`isRemoteReview && startupFailure && $$t()\` instead of waiting out \`poll_timeout\` (\`cloud session exceeded 30 minutes\`). \`O\` throws \`startupFailure\` inside the poll loop before the timeout throw.`,
    '',
    fence(dnt, 'startupFailure'),
    fence(pollO, 'startupFailure'),
  ],
)

section(
  39,
  'BODY',
  'integer-attribute assignment is not auto-approved',
  h39,
  [
    '`or` includes `OPTIND` and `RANDOM`. `Qo` is true unless the RHS is a plain integer (or it contains `[`, `` ` ``, or `$(`). Callers treat that as too-complex (`has integer attribute`). `arithmetic expression` is absent.',
    '',
    '```',
    cap(setWin, 'function Qo'),
    '```',
    '',
    `set+Qo sha of \`Qo\` only: \`${Qo.sha}\` len ${Qo.len}.`,
    '',
  ],
)

section(
  40,
  'BODY',
  'background spawn keeps shell Vertex/Bedrock gateway env',
  h40,
  [
    '`Ffe` pairs each `ANTHROPIC_*_BASE_URL` with `CLAUDE_CODE_SKIP_*_AUTH` companions. `Oo` copies those from `process.env`. `So` spreads `Oo(ge)` into the background `env` when not `--exec`. The phrase `backgrounded sessions` is absent.',
    '',
    '```',
    cap(ffeWin, 'ANTHROPIC_VERTEX_BASE_URL'),
    '```',
    '',
    fence(Oo, 'companions'),
    fence(So, 'Oo(ge)'),
  ],
)

section(
  41,
  'BODY',
  'bg session receives the parent subscription and rate-limit tier used by the fable credit dialog',
  h41,
  [
    '`So` sets `reattachEnv` from `urr(awn())`. `urr` writes `CLAUDE_BG_DISPATCHER_SUBSCRIPTION_TYPE` and `CLAUDE_BG_DISPATCHER_RATE_LIMIT_TIER`. `oEn` reads them only when `CLAUDE_CODE_SESSION_KIND==="bg"`. `$n` uses `subscriptionType ?? oI()`, and `oI` maps that env to `max`/`pro`/`team`/`enterprise`. `iI` reads the dispatcher rate-limit tier. `Nee` (`kind:"fable_overage_consent_prompt"`) sits immediately before `f6e`/`gP`. A caller is `if(gP(zr,ct.requestDialog))`. `--model fable` as a literal is absent.',
    '',
    '```',
    neeWin,
    '```',
    '',
    `\`${gPCall}\` @${gPCallAt}`,
    '',
    '',
    fence(urr, 'CLAUDE_BG_DISPATCHER'),
    fence(oEn, 'SESSION_KIND'),
    fence(dollarN, 'oI'),
    fence(oI, 'max'),
    fence(iI, 'rateLimitTier'),
    fence(gP, 'Gce'),
    fence(So, 'urr('),
  ],
)

section(
  42,
  'BODY',
  'auto-default nudge does not open for bg or teammate sessions',
  h42,
  [
    '`make auto mode your default` is absent. `make auto mode the default` is the doctor skill text, not this gate. `#r` returns immediately when `wt()` (`CLAUDE_CODE_SESSION_KIND==="bg"`). Otherwise it loads `shouldShowAutoDefaultNudge` only when `f_()` is false. `f_()` is `oc()||wt()||pie()!==void 0`, and `pie()` is `teammateAgentId()`.',
    '',
    fence(rMethod, 'shouldShowAutoDefaultNudge'),
    fence(wt, 'bg'),
    fence(f_, 'pie'),
    fence(pie, 'teammateAgentId'),
  ],
)

section(
  44,
  'BODY',
  'disabled /bug and /share name themselves, not /feedback',
  h44,
  [
    'The fixed sentence `/feedback has been disabled` is absent. `TG` interpolates the command argument. `n` calls `gRt` with `/share` or `/bug`. `uln` returns false when `TG()!==null`, and the config tips row `feedbackDrafts` is spread only when `uln()` is true.',
    '',
    fence(TG, 'DISABLE_BUG_COMMAND'),
    fence(nBug, '/bug'),
    fence(uln, 'TG()'),
  ],
)

section(
  46,
  'STRING-ONLY',
  'redundant interactive UI re-renders',
  h46,
  [
    'No function implements a redundant-UI cut. `redundant UI` and `redundant render` are absent. `re-render` / `re-renders` hits include the substring `pre-rendered`, React docs ("across re-renders"), ConPTY re-rendering, a goal-indicator comment, and changelog prose (`re-rendered on every update`). Those are not this bullet.',
    '',
  ],
)

section(
  49,
  'BODY',
  '/schedule explains that Claude Code MCP servers cannot attach to cloud routines',
  h49,
  [
    fence(schedF, 'cannot be attached to cloud'),
    fence(schedWe, "can't be attached"),
  ],
)

section(
  50,
  'BODY',
  'descendant senders are framed as in-session agents',
  h50,
  [
    '`worker inside this session` and `unrelated Claude session` are absent. `RMe` uses disclaimer `K` when `lineage==="descendant"`, else the peer disclaimer `A`. `K` says the sender is an agent working inside this same session (a subagent or teammate).',
    '',
    '```',
    cap(kWin, 'working inside this same session'),
    '```',
    '',
    fence(RMe, 'descendant'),
  ],
)

section(
  51,
  'BODY',
  'prompt placeholder Message @name while a local agent is viewed',
  h51,
  [
    '`wCe` resolves `viewingAgentTaskId` to a teammate (`viewed`) or `localAgent` (`named_agent`). `_Mn` returns that task\'s `agentName`, or the registry name, or `agentType`. `Bpe` returns `Message @${name}…` when `viewingAgentName` is set.',
    '',
    fence(wCe, 'localAgent'),
    fence(Mn, 'agentName'),
    fence(Bpe, 'Message @'),
  ],
)

section(
  53,
  'BODY',
  'host-managed Bedrock with a provider model id skips inference-profile discovery',
  h53,
  [
    `Call \`${pbtCall}\` @${pbtCallAt}. \`Jbn\` is true for a known alias (\`jm\` or \`NU\`). \`Pbt\` returns after \`ME(),gl()\` when \`CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST\` and \`sessionModelIsProviderId\`, and does not \`await ef()\`. \`S\` and \`F\` return \`[]\` before \`Ibt()\` (\`ListInferenceProfiles\`) when the host flag is set.`,
    '',
    fence(Jbn, 'toLowerCase'),
    fence(Pbt, 'PROVIDER_MANAGED_BY_HOST'),
    fence(hostS, 'PROVIDER_MANAGED_BY_HOST'),
    fence(hostF, 'PROVIDER_MANAGED_BY_HOST'),
  ],
)

section(
  54,
  'BODY',
  'managed-settings approval lists the diff against the last approval',
  h54,
  [
    '`settings that changed` and `since you last approved` are absent. `eAn` returns `changed`, `unchangedCount`, and `removedCount`. `c5` is true when that changed bag has any shell, env, sandbox, hooks, or CLAUDE.md entry. `Oe` lists `c5(U.changed) ? U.changed :` the full extract, and separate lines for unchanged and removed.',
    '',
    fence(c5, 'shellSettings'),
    fence(eAn, 'unchangedCount'),
    fence(Oe, 'unchanged since your last approval'),
  ],
)

const out = join(__dir, 'gold-251-e.md')
writeFileSync(out, `${lines.join('\n')}\n`)
console.log(`wrote ${out} lines=${lines.length} bytes=${buf.length}`)
for (const [id, verdict] of rows) console.log(`#${id} ${verdict}`)
