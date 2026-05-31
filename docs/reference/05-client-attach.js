function x(t, jH) {
  if (G) return
  if (
    ((G = !0),
    c('tengu_bg_attach_outcome', {
      outcome: t,
      got_ack: W,
      got_first_frame: D,
      ms: Date.now() - A,
      via: j,
      tempo: J,
    }),
    W)
  ) {
    let KH =
      _.alreadyInAlt || (t === 'disconnected' && _.holdScreenOnDisconnect)
    K.write(
      sQH +
        E.snapshot().map(gQ).reverse().join('') +
        Wh +
        '\x1B[0m\x1B7' +
        ip +
        '\x1B8' +
        (KkH() ? G86 : '') +
        (KH ? '' : YC()),
    )
  }
  if (!I) EN(q, !1)
  if (
    (q.removeListener('readable', Q),
    q.removeListener('end', l),
    'removeListener' in K)
  )
    K.removeListener('resize', U)
  clearTimeout(L), S.destroy(), X({ outcome: t, msg: jH })
}
function U() {
  if (G) return
  if (L === void 0) (k = z), (v = $)
  ;(z = 'columns' in K ? (K.columns ?? O) : O),
    ($ = 'rows' in K ? (K.rows ?? T) : T),
    clearTimeout(L),
    (L = setTimeout(() => {
      if (((L = void 0), G)) return
      if (z < k || $ < v) K.write(f0 + rM)
      IA({ proto: P5, op: 'resize', short: H, cols: z, rows: $, attachId: Y })
    }, 50))
}
function g(t) {
  if (G) return
  let jH = typeof t === 'string' ? Buffer.from(t, 'utf8') : t,
    KH = 0
  for (let qH = 0; qH < jH.length; qH++) {
    let OH = jH[qH]
    if (Z) {
      if (((Z = !1), qH > KH)) S.write(jH.subarray(KH, qH))
      if (OH === pAO) return x('detached')
      S.write(Buffer.from([gsK, OH])), (KH = qH + 1)
      continue
    }
    if (OH === mAO || Yy6(jH, qH, FAO) || Yy6(jH, qH, gAO)) {
      if (qH > KH) S.write(jH.subarray(KH, qH))
      return x('detached')
    }
    if (C && OH === BAO) {
      if (qH > KH) S.write(jH.subarray(KH, qH))
      S.write(UAO), (KH = qH + 1)
      continue
    }
    let zH =
      OH === gsK
        ? 1
        : Yy6(jH, qH, QsK)
          ? QsK.length
          : Yy6(jH, qH, dsK)
            ? dsK.length
            : 0
    if (zH) {
      if (qH > KH) S.write(jH.subarray(KH, qH))
      ;(qH += zH - 1), (KH = qH + 1), (Z = !0)
    }
  }
  if (KH < jH.length) S.write(jH.subarray(KH))
}
function Q() {
  let t
  while ((t = q.read()) !== null) g(t)
}
function l() {
  x('detached')
}
let d = j2H,
  r = j2H,
  a = j2H
function s(t) {
  if (!b) return t
  let jH = a.length > 0,
    KH = jH ? Buffer.concat([a, t]) : t
  if (jH) a = j2H
  let qH = KH.indexOf(m)
  if (qH < 0) {
    let MH = B6q(KH, m)
    if (MH === 0) return KH
    return (
      (a = Buffer.from(KH.subarray(KH.length - MH))),
      KH.subarray(0, KH.length - MH)
    )
  }
  let OH = [],
    zH = 0,
    $H = qH
  for (;;) {
    if ($H > zH) OH.push(KH.subarray(zH, $H))
    if (((zH = $H + m.length), ($H = KH.indexOf(m, zH)), $H < 0)) break
  }
  let TH = KH.subarray(zH),
    YH = B6q(TH, m)
  if (YH > 0) a = Buffer.from(TH.subarray(TH.length - YH))
  if (TH.length > YH) OH.push(TH.subarray(0, TH.length - YH))
  if (OH.length === 0) return j2H
  if (OH.length === 1) return OH[0]
  return Buffer.concat(OH)
}
function _H(t) {
  K.write(t),
    E.feed(t.toString('latin1'), jH => {
      if (jH === 1004 && h) K.write(h)
    }),
    f()
}
function HH(t) {
  if (G) return
  let jH = r.length > 0 ? Buffer.concat([r, t]) : t,
    KH = jH.indexOf(csK)
  if (KH >= 0) {
    let OH = jH.subarray(0, KH)
    if (KH > 0) {
      let zH = s(OH)
      if (zH.length > 0) _H(zH)
    }
    return (r = j2H), (a = j2H), x('detached', gLK(OH))
  }
  let qH = B6q(jH, csK)
  if (jH.length > qH) {
    let OH = jH.subarray(0, jH.length - qH),
      zH = s(OH)
    if (zH.length > 0) _H(zH)
  }
  r = qH > 0 ? Buffer.from(jH.subarray(jH.length - qH)) : j2H
}
return S.on("data",(t)=>{if(G)return;if(W){HH(t);return}d=Buffer.concat([d,t]);let jH=d.indexOf(10);if(jH<0)return;let KH=d.subarray(0,jH).toString("utf8"),qH=d.subarray(jH+1),OH;try{OH=B_(KH)}catch(TH){return x("error",`bad ack: ${LH(TH)}`)}if(!OH.ok)return x("error",`${OH.code}: ${OH.error}`);if(W=!0,S.setTimeout(0),w=Date.now()-A,j=OH.op==="attach"?OH.via:void 0,J=OH.op==="attach"?OH.tempo:void 0,M=OH.op==="attach"?OH.state:void 0,process.env.TMUX&&!lsK)lsK=!0,L6("tmux",["set","-as","terminal-features",",*:RGB"]);let $H=((OH.op==="attach"?OH.decModes:void 0)??[]).map(FQ).join("");if(E.feed($H),K.write(_.alreadyInAlt?op+Rr()+$H:BwH()+$H+(b?op:"")+`
  \x1B[2mAttaching\u2026\x1B[0m
`),"ref"in q)q.ref();if(EN(q,!0),"on"in K)K.on("resize",U);if(q.on("readable",Q),"resume"in q&&"pause"in q)q.resume(),q.pause();if(q.once("end",l),Q(),qH.length)HH(qH)}),S.on("error",(t)=>x("error",LH(t))),S.once("close",()=>{if(!G)x(W?"disconnected":"error","control socket closed")}),S.once("connect",()=>{S.write(CH({proto:P5,op:"attach",short:H,cols:O,rows:T,attachId:Y,caps:QAO(),..._.holdingFrame&&{holdingFrame:!0}})+`
`)}),P
}
function QAO() {
  return {
    terminal: Q8.terminal,
    mux: process.env.TMUX
      ? 'tmux'
      : process.env.ZELLIJ != null
        ? 'zellij'
        : process.env.STY
          ? 'screen'
          : null,
    ssh: Q8.isSSH(),
    wheelFlood: cj8(),
    hyperlinks: pP(),
    progressReporting: KkH(),
    wtSession: !!process.env.WT_SESSION,
    isVscodeTerm: process.env.TERM_PROGRAM === 'vscode',
    browser: process.env.BROWSER ?? null,
    colorLevel: D_.level,
    editor: process.env.VISUAL?.trim() || process.env.EDITOR?.trim() || null,
  }
}
var nsK,
  isK,
  gsK = 2,
  mAO = 26,
  pAO = 100,
  BAO = 8,
  UAO,
  QsK,
  dsK,
  FAO,
  gAO,
  csK,
  j2H,
  lsK = !1
var U6q = R(() => {
  F4()
  bP()
  OPH()
  tj8()
  UwH()
  tp()
  SN()
  Mk()
  Gr()
  Cw()
  N_()
  d3()
  W_()
  Y7()
  $9()
  HkH()
  i_()
  LqH()
  p6q()
  nv()
  cv()
  ;(nsK = require('crypto')),
    (isK = require('net')),
    (UAO = Buffer.from([127])),
    (QsK = Buffer.from('\x1B[98;5u', 'latin1')),
    (dsK = Buffer.from('\x1B[27;5;98~', 'latin1')),
    (FAO = Buffer.from('\x1B[122;5u', 'latin1')),
    (gAO = Buffer.from('\x1B[27;5;122~', 'latin1')),
    (csK = Buffer.from(dSH, 'ascii'))
  j2H = Buffer.alloc(0)
})
async function Ay6(H) {
  let { cmd: _, prefixArgs: q } = WE(),
    K = [_, ...q, ...H],
    O = rAO()
  if (n_() === 'windows') {
    let $ = await dAO(K, O)
    if ($.ok) return null
    N(
      `daemon: WMI spawn failed (${$.reason}); falling back to direct spawn \u2014 daemon will not survive SSH/terminal close`,
      { level: 'warn' },
    ),
      c('tengu_bg_daemon_wmi_fallback', {
        timeout: $.reason === 'timeout',
        enoent: $.reason === 'enoent',
        rc: $.rc,
      })
  }
  let T = await rsK(K, O),
    z = f6(T)
  if (z === 'ENOENT' || z === 'EACCES') {
    let $ = WE({ pinToCurrentBinary: !0 })
    if ($.cmd !== _)
      return (
        c('tengu_bg_daemon_spawn_execpath_fallback', {
          errno_enoent: z === 'ENOENT',
          errno_eacces: z === 'EACCES',
        }),
        rsK([$.cmd, ...$.prefixArgs, ...H], O)
      )
  }
  return T
}
async function rsK(H, _) {
  let q = null
  try {
    let K = F6q.spawn(H[0], H.slice(1), {
      detached: !0,
      stdio: 'ignore',
      windowsHide: !0,
      env: _,
    })
    K.once('error', O => {
      q = O
    }),
      K.unref()
  } catch (K) {
    q = K
  }
  return await new Promise(K => setImmediate(K)), q
}
function dAO(H, _) {
  let q
  try {
    q = cAO(lAO(H))
  } catch (T) {
    return Promise.resolve({ ok: !1, reason: LH(T) })
  }
  let K = Buffer.from(q, 'utf16le').toString('base64'),
    O = process.env.SYSTEMROOT || 'C:\\Windows'
  return new Promise(T => {
    let z = !1,
      $ = w => {
        if (z) return
        ;(z = !0), clearTimeout(A), T(w)
      },
      Y = F6q.spawn(
        `${O}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', K],
        { stdio: 'ignore', windowsHide: !0, env: _ },
      )
    Y.once('error', w =>
      $({ ok: !1, reason: f6(w) === 'ENOENT' ? 'enoent' : LH(w) }),
    ),
      Y.once('exit', w => {
        if (w === 0) $({ ok: !0 })
        else
          $({ ok: !1, reason: `Win32_Process.Create rc=${w}`, rc: w ?? void 0 })
      })
    let A = setTimeout(
      (w, j) => {
        j.kill(), w({ ok: !1, reason: 'timeout' })
      },
      5000,
      $,
      Y,
    )
    A.unref()
  })
}
function cAO(H) {
  return [
    '$ErrorActionPreference = "Stop"',
    '$e = [string[]](Get-ChildItem Env: | ForEach-Object { "$($_.Name)=$($_.Value)" })',
    '$s = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ EnvironmentVariables = $e; ShowWindow = [uint16]0; CreateFlags = [uint32]8 }',
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${iAO(H)}; CurrentDirectory = $env:USERPROFILE; ProcessStartupInformation = $s }`,
    'exit $r.ReturnValue',
  ].join(`
`)
}
function lAO(H) {
  return H.map(nAO).join(' ')
}
function nAO(H) {
  if (H.length > 0 && !/[\s"]/.test(H)) return H
  let _ = '"',
    q = 0
  while (q < H.length) {
    let K = 0
    while (H[q] === '\\') K++, q++
    if (q === H.length) _ += '\\'.repeat(K * 2)
    else if (H[q] === '"') (_ += '\\'.repeat(K * 2 + 1) + '"'), q++
    else (_ += '\\'.repeat(K) + H[q]), q++
  }
  return _ + '"'
}
function iAO(H) {
  if (/[\u2018\u2019\u201A\u201B]/.test(H))
    throw Error('unsupported Unicode single-quote in command line')
  return `'${H.replaceAll("'", "''")}'`
}
function rAO() {
  let H = { ...process.env, INVOCATION_ID: '' }
  if (n_() !== 'macos' && process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    if (Q4().read()?.claudeAiOauth?.refreshToken)
      delete H.CLAUDE_CODE_OAUTH_TOKEN,
        delete H.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR
  }
  return H
}
var F6q
var g6q = R(() => {
  N_()
  lH()
  W_()
  $9()
  _Q()
  KXH()
  F6q = require('child_process')
})
async function oCH(H) {
  let _ = Date.now() + H
  while (Date.now() < _) {
    if ((await IA({ proto: P5, op: 'ping' })).ok) return !0
    await Xy_.setTimeout(100)
  }
  return !1
}
async function oAO(H) {
  let _ = Date.now(),
    q = !1,
    K = 'restarting',
    O = Date.now() + 1e4
  while (Date.now() < O) {
    let T = await IA({ proto: P5, op: 'nudge' })
    if (T.ok && T.op === 'nudge') {
      if (((q = !0), !T.restarting)) {
        if (await tAO(T.version, H)) return 'down'
        if (Date.now() - _ > 200)
          c('tengu_bg_skew_nudge', {
            converged: !0,
            duration_ms: Date.now() - _,
          })
        return 'up'
      }
      ;(K = 'restarting'), await Xy_.setTimeout(100)
      continue
    }
    if (!T.ok && T.code === 'ETIMEOUT') {
      ;(q = !0), (K = 'etimeout'), await Xy_.setTimeout(100)
      continue
    }
    if (!T.ok && T.code === 'ENOCONN') {
      if (!q && (await bW().catch(() => null))) q = !0
      if (!q) return 'down'
      ;(K = 'enoconn'), await Xy_.setTimeout(100)
      continue
    }
    return 'up'
  }
  return (
    c('tengu_bg_skew_nudge', {
      converged: !1,
      restarting: K === 'restarting',
      etimeout: K === 'etimeout',
      enoconn: K === 'enoconn',
    }),
    'down'
  )
}
async function KF(H={}){let _=Date.now();if(await oAO(H.forceTransient??!1)==="up")return SH("daemon_ensure_running"),{ok:!0};let q=await ssK(),K=q&&await iL6();if(K)c("tengu_bg_daemon_service_stale_exec",{}),N("daemon service exec path is stale (binary deleted) \u2014 falling back to transient spawn. Run 'claude daemon install' to repair.",{level:"warn"});let O=!1;if(q&&!K){O=!0,H.onStarting?.();let A=await asK();if(A)return uH("daemon_ensure_running","daemon_ensure_zombie_kill_failed"),{ok:!1,reason:A};let w=await nL6(),j=await oCH(5000);if(c("tengu_bg_daemon_install",{outcome_ok:j,via_service:!0,fresh_install:!1,duration_ms:Date.now()-_,platform_darwin:n_()==="macos",platform_linux:n_()==="linux",platform_windows:n_()==="windows"}),j)return SH("daemon_ensure_running"),{ok:!0};c("tengu_bg_daemon_service_poll_fallthrough",{sr_ok:w.ok}),N(`daemon service did not become reachable within 5s${w.ok?"":` (${w.error})`} \u2014 falling back to transient spawn. Run 'claude daemon install' to repair.`,{level:"warn"})}if(!q&&!H.forceTransient&&L66()==="ask"&&tsK()&&!b_().daemonInstallPromptDismissed)return c("tengu_bg_daemon_cold_start_ask",{}),{ok:!1,askInstall:!0,reason:"No background daemon is running. Run 'claude daemon install' to set it up as a persistent service."};if(!O){H.onStarting?.();let A=await asK();if(A)return uH("daemon_ensure_running","daemon_ensure_zombie_kill_failed"),{ok:!1,reason:A}}let T=CH({label:eAO(),cwd:S_(),pid:process.pid}),z=await Ay6(["daemon","run","--origin","transient","--spawned-by",T]);if(z)return c("tengu_bg_daemon_spawn_failed",{errno_enoent:f6(z)==="ENOENT",errno_eacces:f6(z)==="EACCES"}),uH("daemon_ensure_running","daemon_ensure_spawn_failed"),{ok:!1,reason:`spawn ${QA()}: ${LH(z)}`};let $=await oCH(30000),Y=Date.now()-_>60000;i
