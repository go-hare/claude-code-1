async function HfO(H) {
  let _ = H.indexOf('--')
  if (!H.includes('--bg-spare', _ + 1)) await N64()
  if (_ < 3 || _ === H.length - 1)
    return iy_(
      void 0,
      'bad argv: --bg-pty-host <sock> <cols> <rows> -- <file> [args...]',
    )
  let q = H[0]
  process.on('uncaughtException', k =>
    iy_(q, `uncaught: ${k?.stack ?? String(k)}`),
  ),
    process.on('unhandledRejection', k =>
      iy_(q, `unhandledRejection: ${k?.stack ?? String(k)}`),
    )
  let K = Number(H[1]) || 200,
    O = Number(H[2]) || 50,
    T = H[_ + 1],
    z = H.slice(_ + 2),
    $ = process.env.CLAUDE_PTY_HOST_EXEC === '1'
  if ((delete process.env.CLAUDE_PTY_HOST_EXEC, n_() !== 'windows'))
    try {
      hh6.setPriority(0, Math.min(hh6.getPriority(0) + 5, 19))
    } catch {}
  let Y = E64(EV_),
    A = new Set(),
    w = !1,
    j = !1,
    J = null,
    M = _fO(process.env.CLAUDE_PTY_RECORD, K, O)
  function D(k) {
    for (let v of A) {
      if (v.destroyed) {
        A.delete(v)
        continue
      }
      if (v.writableLength > eDO) {
        v.destroy(), A.delete(v)
        continue
      }
      v.write(k)
    }
  }
  let f, X
  try {
    ;(f = new Bun.Terminal({
      cols: K,
      rows: O,
      data(k, v) {
        j = !0
        let E = Buffer.from(v)
        if ((Y.push(E), M?.write(E), A.size)) D(SV_(E))
      },
    })),
      (X = Bun.spawn([T, ...z], {
        cwd: process.cwd(),
        env: { ...process.env, TERM: 'xterm-256color' },
        terminal: f,
        windowsHide: !0,
        detached: !1,
      }))
  } catch (k) {
    iy_(q, `spawn failed: ${String(k)}`)
  }
  function P(k, v) {
    if (!k.destroyed) k.write(v)
  }
  function G(k) {
    switch (k.t) {
      case 'resize': {
        let v = Number(k.cols),
          E = Number(k.rows)
        if (v > 0 && v <= JqH && E > 0 && E <= JqH && !w) {
          if ((f.resize(v, E), n_() !== 'windows'))
            try {
              process.kill(-process.pid, 'SIGWINCH')
            } catch {}
        }
        return
      }
      case 'kill': {
        let v = k.sig === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM'
        try {
          X.kill(v)
        } catch {}
        if (v === 'SIGTERM')
          setTimeout(() => {
            if (!w)
              try {
                X.kill('SIGKILL')
              } catch {}
          }, 5000).unref()
        return
      }
      default:
        return
    }
  }
  await Qqq.unlink(q).catch(() => {})
  let W = y64.createServer(k => {
    k.on('error', () => k.destroy()),
      k.once('close', () => A.delete(k)),
      P(
        k,
        CU({
          t: 'hello',
          replPid: X.pid,
          version: {
            ISSUES_EXPLAINER:
              'report the issue at https://github.com/anthropics/claude-code/issues',
            PACKAGE_URL: '@anthropic-ai/claude-code',
            README_URL: 'https://code.claude.com/docs/en/overview',
            VERSION: '2.1.153',
            FEEDBACK_CHANNEL:
              'https://github.com/anthropics/claude-code/issues',
            BUILD_TIME: '2026-05-27T20:03:21Z',
            GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
          }.VERSION,
        }),
      )
    for (let E of Y.chunks) P(k, SV_(E))
    if ((P(k, CU({ t: 'live' })), A.add(k), w)) {
      P(k, CU({ t: 'exit', code: Z, signal: L })), k.end()
      return
    }
    let v = KL6(
      E => {
        if (E.kind === gSH) {
          if (!w) {
            if ((f.write(E.payload), $ && n_() !== 'windows')) {
              let h = E.payload.includes(3)
                ? 'SIGINT'
                : E.payload.includes(28)
                  ? 'SIGQUIT'
                  : null
              if (h) {
                J = h
                try {
                  process.kill(-process.pid, h)
                } catch {}
                setImmediate(() => {
                  J = null
                })
              }
            }
          }
        } else if (E.kind === hV_) G(E.ctrl)
      },
      () => k.destroy(),
    )
    k.on('data', v)
  })
  W.on('error', k => {
    try {
      X.kill('SIGTERM')
    } catch {}
    iy_(q, `server error: ${String(k)}`)
  }),
    W.listen(q),
    W.unref()
  for (let k of ['SIGTERM', 'SIGINT', 'SIGHUP'])
    process.on(k, () => {
      if (J === k) return
      try {
        X.kill(k === 'SIGHUP' ? 'SIGTERM' : k)
      } catch {}
    })
  if ($ && n_() !== 'windows')
    process.on('SIGQUIT', () => {
      if (J === 'SIGQUIT') return
      try {
        X.kill('SIGQUIT')
      } catch {}
    })
  let Z = 0
  Z = await X.exited
  for (let k = 0; k < 20; k++) if (((j = !1), await r6(5), !j)) break
  let L = X.signalCode ?? void 0
  if (((w = !0), f.close(), M?.close(), $ && n_() !== 'windows')) {
    J = 'SIGHUP'
    try {
      process.kill(-process.pid, 'SIGHUP')
    } catch {}
  }
  if ((D(CU({ t: 'exit', code: Z, signal: L })), A.size === 0))
    await Promise.race([
      new Promise(k => W.once('connection', () => k())),
      r6(5000),
    ])
  for (let k of A) k.end()
  if (
    (await Promise.race([
      new Promise(k => W.close(() => k())),
      r6(2000, void 0, { unref: !0 }),
    ]),
    n_() !== 'windows')
  )
    await Qqq.unlink(q).catch(() => {})
  process.exit(Z)
}
function E64(H) {
  let _ = [],
    q = 0,
    K = 0
  function O() {
    if (q > 0) (_ = _.slice(q)), (q = 0)
  }
  return {
    get chunks() {
      return O(), _
    },
    push(T) {
      _.push(T), (K += T.length)
      while (K > H && _.length - q > 1) {
        K -= _[q++].length
        for (let z = 0; z < 3; ) {
          let $ = _[q],
            Y = 0
          while (z + Y < 3 && Y < $.length && ($[Y] & 192) === 128) Y++
          if (Y > 0) (_[q] = $.subarray(Y)), (K -= Y), (z += Y)
          if (_[q].length > 0 || _.length - q === 1) break
          q++
        }
      }
      if (q >= _.length - q) O()
    },
  }
}
function _fO(H, _, q) {
  if (!H) return
  let K = process.hrtime.bigint(),
    O
  try {
    O = s8_.createWriteStream(H, { flags: 'w' })
  } catch {
    return
  }
  O.on('error', () => {
    O?.destroy(), (O = void 0)
  })
  let T = Buffer.allocUnsafe(8)
  return (
    T.writeUInt32BE(_, 0),
    T.writeUInt32BE(q, 4),
    O.write(T),
    {
      write(z) {
        if (!O) return
        let $ = Buffer.allocUnsafe(8 + z.length),
          Y = Number((process.hrtime.bigint() - K) / 1000n)
        $.writeUInt32BE(Y >>> 0, 0),
          $.writeUInt32BE(z.length, 4),
          z.copy($, 8),
          O.write($)
      },
      close() {
        O?.end()
      },
    }
  )
}
function iy_(H, _) {
  if (H)
    try {
      let q = IE(H)
      s8_.mkdirSync(h64.dirname(q), { recursive: !0 }),
        s8_.writeFileSync(
          q,
          `${new Date().toISOString()} ${_}
`,
        )
    } catch {}
  process.exit(1)
}
var s8_,
  Qqq,
  y64,
  hh6,
  h64,
  eDO = 1048576
var C64 = R(() => {
  $9()
  v64()
  nv()
  QSH()
  ;(s8_ = require('fs')),
    (Qqq = require('fs/promises')),
    (y64 = require('net')),
    (hh6 = require('os')),
    (h64 = require('path'))
})
function b64(H, _) {
  return new Promise((q, K) => {
    let O = z => {
        T.close(), K(z)
      },
      T = I64.createServer(z => {
        let $ = ''
        z.setEncoding('utf8'),
          z.on('data', Y => {
            $ += Y
            let A = $.indexOf(`
`)
            if (A < 0) return
            T.close()
            try {
              q(B_($.slice(0, A)))
            } catch (w) {
              K(w)
            }
          }),
          z.on('error', O)
      })
    if ((T.on('error', O), _))
      T.once('listening', () => {
        try {
          _()
        } catch (z) {
          O(z)
        }
      })
    T.listen(H)
  })
}
async function x64(H, _) {
  let q = await x$(H.cwd)
  if ((process.chdir(q), Xy(q), g9H(q), Q9H(q), H.sessionId))
    KR(RX(H.sessionId))
  Xx6(),
    nlK(),
    Object.assign(process.env, H.env),
    (process.argv = [process.argv[0], process.argv[1], ...H.argv])
  let { main: K } = await _
  await K()
}
var I64
var u64 = R(() => {
  J_()
  cP()
  nj()
  i_()
  q2H()
  I64 = require('net')
})
function dqq(H) {
  let _ = '',
    q = '',
    K = !0,
    O = 0,
    T = '',
    z = !1
  function $(A, w) {
    let j = D1(q).slice(0, Eh6),
      J = `${A}|${w}|${j}`
    if (J === T) return
    ;(T = J),
      o7(H)
        .then(M =>
          M && !z
            ? iO(H, {
                ...M,
                state: A,
                tempo: w,
                detail: j,
                updatedAt: new Date().toISOString(),
              })
            : void 0,
        )
        .catch(hH)
  }
  let Y = setInterval(() => {
    if (O === 0) return
    if (Date.now() - O < m64) $('working', 'active')
    else if (!K && q) $('blocked', 'blocked')
    else $('working', 'idle')
  }, m64)
  return (
    Y.unref(),
    {
      feed(A) {
        let w = D5(A.replace(qfO, '\x00'))
          .replace(
            /\r\n?/g,
            `
`,
          )
          .replace(/\0+$/, '')
          .replace(
            /\0/g,
            `
`,
          )
        if (!w) return
        ;(O = Date.now()), (_ += w)
        let j = _.split(`
`)
        if (
          ((_ = j.pop() ?? ''),
          (K = _ === ''),
          (q = _.trim() || j.findLast(M => M.trim())?.trim() || q),
          _.length > Eh6 * 2)
        )
          _ = _.slice(-Eh6)
        if (T.startsWith('blocked|')) $('working', 'active')
      },
      dispose() {
        ;(z = !0), clearInterval(Y)
      },
      get lastLine() {
        return D1(q).slice(0, Eh6)
      },
    }
  )
}
var m64 = 2000,
  Eh6 = 120,
  qfO
var p64 = R(() => {
  YY()
  W6()
  oW()
  qfO = /\x1b\[\d*D/g
})
function Ch6(H, _, q, K, O) {
  let T = C7(),
    z = C7(),
    $,
    Y = new Q64.StringDecoder('utf8'),
    A,
    w = !1,
    j = !1,
    J = 0,
    M = 0,
    D,
    f,
    X,
    P,
    G = 0,
    W,
    Z = !1,
    L = !1,
    k = !1,
    v = q
  if (v === void 0)
    ey(_, { skipCache: !0 }).then(g => {
      v = g
    })
  let E = [],
    h = 0
  function C(g) {
    if (A) {
      if (A.destroyed) return !1
      if (!A.write(g)) {
        if (!X)
          (X = setTimeout(() => {
            ;(X = void 0), A?.destroy()
          }, OfO)),
            X.unref()
        if (!P && A.writableLength > F64)
          (P = setTimeout(() => {
            if (((P = void 0), A && !A.destroyed && A.writableLength > F64))
              I(), A.destroy()
          }, TfO)),
            P.unref()
      }
      return !0
    }
    if (h < 2 * W__) E.push(g), (h += g.length)
    return !1
  }
  function I() {
    if (X) clearTimeout(X), (X = void 0)
    if (P) clearTimeout(P), (P = void 0)
  }
  function b(g, Q) {
    if (j) return
    if (((j = !0), (w = !0), f)) clearTimeout(f), (f = void 0)
    I(), A?.destroy(), (A = void 0)
    let l = Y.end()
    if (l) T.emit(l)
    z.emit({ exitCode: g, signal: Q })
  }
  function m(g) {
    if (
      (Sh6.readFile(IE(H), 'utf8')
        .then(Q => {
          return N(`[bg-pty] host crash: ${Q.trim()}`, { level: 'warn' }), !0
        })
        .catch(() => !1)
        .then(Q =>
          c('tengu_bg_ptyhost_crash', {
            hadBreadcrumb: Q,
            hadHello: Z,
            via: g,
            short: K,
          }),
        ),
      LGH(G ? [-_, G] : [-_], g !== 'hung' ? void 0 : v),
      O)
    ) {
      O.exited.then(
        Q => b(Q, O.signalCode ?? void 0),
        () => b(-1),
      ),
        setTimeout(b, 1000, -1).unref()
      return
    }
    b(-1)
  }
  function S(g) {
    if (g.kind === gSH) {
      if (!L) T.emit(Y.write(g.payload))
    } else if (g.ctrl.t === 'hello') {
      if (Z) (L = !0), Y.end()
      ;(Z = !0), (G = g.ctrl.replPid), (W = g.ctrl.version)
    } else if (g.ctrl.t === 'live') {
      if (L) (L = !1), $?.()
    } else if (g.ctrl.t === 'exit') b(g.ctrl.code, g.ctrl.signal)
  }
  function x() {
    if (w) return
    let g = new g64.Socket(),
      Q = !1
    g.on('error', l => {
      ;(k = f6(l) === 'ENOENT'), U()
    }),
      g.once('close', () => {
        if (A === g) (A = void 0), I()
        if (w) return
        if (Q && !j) {
          try {
            process.kill(_, 0),
              N('[bg-pty] dropped by host; reconnecting', { level: 'debug' }),
              (M = KfO),
              (J = 0),
              U()
            return
          } catch {}
          m('close')
          return
        }
        U()
      }),
      g.once('connect', () => {
        ;(Q = !0),
          (J = 0),
          (M = 0),
          (A = g),
          g.on('drain', I),
          Sh6.unlink(IE(H)).catch(() => {})
        for (let d of E.splice(0)) C(d)
        h = 0
        let l = KL6(S, d => {
          N(`[bg-pty] frame error: ${d}`, { level: 'warn' }), g.destroy()
        })
        g.on('data', l)
      }),
      g.connect(H)
  }
  function U() {
    if (w || D) return
    try {
      process.kill(_, 0)
    } catch {
      m('connect')
      return
    }
    if (M > 0 && --M === 0) {
      m('hung')
      return
    }
    if (q !== void 0 && k && J >= 3)
      N(
        `[bg-pty] ${H}: ENOENT on adopt \u2014 sock file externally deleted; respawning`,
        { level: 'warn' },
      ),
        c('tengu_bg_adopt_sock_unlinked', {}),
        (J = U64)
    if (J >= U64) {
      N(`[bg-pty] ${H}: ${J} connect attempts failed; treating host as dead`, {
        level: 'warn',
      })
      let Q = v && VKH(_)
      if (!v || !Q || v === Q)
        try {
          process.kill(-_, 'SIGKILL')
        } catch {
          try {
            process.kill(_, 'SIGKILL')
          } catch {}
        }
      b(-1)
      return
    }
    let g = B64[Math.min(J, B64.length - 1)]
    J++,
      (D = setTimeout(() => {
        ;(D = void 0), x()
      }, g)),
      D.unref()
  }
  return (
    x(),
    {
      pid: _,
      replPid: () => G,
      replVersion: () => W,
      onResume: g => {
        $ = g
      },
      write: g => {
        if (j) return
        let Q = Buffer.from(g, 'utf8'),
          l = W__ - 1
        for (let d = 0; d < Q.length; d += l) C(SV_(Q.subarray(d, d + l)))
      },
      resize: (g, Q) => C(CU({ t: 'resize', cols: g, rows: Q })),
      kill: g => {
        let Q = g === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM',
          l = C(CU({ t: 'kill', sig: Q }))
        if (n_() === 'windows' && Q === 'SIGTERM' && l) {
          if (f) clearTimeout(f)
          ;(f = setTimeout(
            (d, r) => {
              if (!zz_(d, v)) {
                r(-1)
                return
              }
              try {
                process.kill(d, 'SIGKILL')
              } catch {
                r(-1)
              }
            },
            5000,
            _,
            b,
          )),
            f.unref()
          return
        }
        try {
          process.kill(-_, Q)
        } catch {
          try {
            process.kill(_, Q)
          } catch {
            b(-1)
          }
        }
        if (Q === 'SIGTERM' && !j) {
          if (f) clearTimeout(f)
          ;(f = setTimeout(
            (d, r) => {
              if (!zz_(d, v)) {
                r(-1)
                return
              }
              try {
                process.kill(-d, 'SIGKILL')
              } catch {
                try {
                  process.kill(d, 'SIGKILL')
                } catch {
                  r(-1)
                }
              }
            },
            5000,
            _,
            b,
          )),
            f.unref()
        }
      },
      dispose: () => {
        if (((w = !0), D)) clearTimeout(D), (D = void 0)
        if (f) clearTimeout(f), (f = void 0)
        I(), A?.destroy(), (A = void 0)
      },
      onData: g => ({ dispose: T.subscribe(g) }),
      onExit: g => ({ dispose: z.subscribe(g) }),
    }
  )
}
var Sh6,
  g64,
  Q64,
  B64,
  U64 = 30,
  KfO = 4,
  OfO = 1e4,
  F64,
  TfO = 50
var d64 = R(() => {
  N_()
  lH()
  W_()
  OX()
  $9()
  $A()
  nv()
  QSH()
  ;(Sh6 = require('fs/promises')),
    (g64 = require('net')),
    (Q64 = require('string_decoder')),
    (B64 = [50, 100, 250, 500, 1000, 2000]),
    (F64 = 8 * W__)
})
function i64(H, _, q, K) {
  let O,
    T = !1,
    z = 0,
    $ = !1,
    Y
  function A() {
    if (T) return
    let j = new n64.Socket(),
      J = !1
    j.on('error', () => w()),
      j.once('close', () => {
        if (O === j) O = void 0
        if (T) return
        if (J) q()
        w()
      }),
      j.once('connect', () => {
        ;(J = !0),
          (z = 0),
          ($ = !1),
          (O = j),
          K?.(),
          j.write(
            CH({ proto: P5, role: 'supervisor', supervisorPid: process.pid }) +
              `
`,
          ),
          rL6(j, M => {
            let D
            try {
              D = B_(M)
            } catch {
              return
            }
            if (D && typeof D === 'object' && 'type' in D) _(D)
          })
      }),
      j.connect(H)
  }
  function w() {
    if (T || Y || $) return
    if (z >= l64) {
      ;($ = !0),
        N(
          `[bg-rv] ${H}: ${z} connect attempts failed \u2014 giving up (pid-poll is liveness backstop)`,
          { level: 'warn' },
        ),
        c('tengu_bg_rv_connect_exhausted', { attempts: z })
      return
    }
    let j = c64[Math.min(z, c64.length - 1)]
    z++,
      (Y = setTimeout(() => {
        ;(Y = void 0), A()
      }, j)),
      Y.unref()
  }
  return (
    A(),
    {
      send(j) {
        if (!O || O.destroyed) {
          if (z >= l64) (z = 0), ($ = !1), w()
          return !1
        }
        try {
          return (
            O.write(
              CH(j) +
                `
`,
            ),
            !0
          )
        } catch (J) {
          return N(`[bg-rv] send failed: ${String(J)}`), !1
        }
      },
      close() {
        if (((T = !0), Y)) clearTimeout(Y)
        O?.destroy(), (O = void 0)
      },
    }
  )
}
var n64,
  c64,
  l64 = 30
var r64 = R(() => {
  N_()
  lH()
  i_()
  fo8()
  cv()
  ;(n64 = require('net')), (c64 = [100, 250, 500, 1000, 2000])
})
function nqq() {
  return (H, _, q) => {
    let { cmd: K, prefixArgs: O } = WE({ pinToCurrentBinary: !0 }),
      T = Bun.spawn(
        [
          K,
          ...O,
          '--bg-pty-host',
          q.ptySock,
          String(q.cols),
          String(q.rows),
          '--',
          H,
          ..._,
        ],
        {
          cwd: q.cwd,
          env: q.env,
          stdio: ['ignore', 'ignore', 'ignore'],
          detached: !0,
          windowsHide: !0,
        },
      )
    return T.unref(), Ch6(q.ptySock, T.pid, void 0, q.short, T)
  }
}
function e64(H, _, q, K, O) {
  if (H.launch.mode === 'exec') return H.launch.args
  if (_ > 1 && q) return ['--resume', K, ...O]
  if (H.launch.mode === 'resume')
    return [
      ...(H.launch.fork ? ['--session-id', H.sessionId, '--fork-session'] : []),
      '--resume',
      H.launch.sessionId,
      ...H.launch.flagArgs,
    ]
  return H.launch.args
}
function H84(H, _, q, K) {
  let O = {
    ...process.env,
    ...(q && { CLAUDE_BG_AUTH_SNAPSHOT_PATH: q }),
    ...(n_() === 'windows' && { CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT: '1' }),
    ...H.env,
    CLAUDE_CODE_SESSION_KIND: 'bg',
    CLAUDE_BG_BACKEND: 'daemon',
    CLAUDE_ENABLE_STREAM_WATCHDOG: '1',
    CLAUDE_BG_SOURCE: H.source,
    CLAUDE_JOB_DIR: _,
    CLAUDE_CODE_SESSION_NAME: H.seed?.name || H.seed?.intent || H.short,
    CLAUDE_BG_RENDEZVOUS_SOCK: K,
    FORCE_COLOR: '3',
    COLORTERM: 'truecolor',
    BROWSER: 'true',
  }
  if (process.env.CLAUDE_CONFIG_DIR)
    O.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR
  if (H.isolation === 'worktree') O.CLAUDE_BG_ISOLATION = 'worktree'
  for (let T of rqq) if (!H.env?.[T]) delete O[T]
  if (q) delete O.CLAUDE_CODE_OAUTH_TOKEN
  if (H.launch.mode === 'exec') {
    for (let T of Object.keys(O))
      if (
        (T.startsWith('CLAUDE_') &&
          T !== 'CLAUDE_JOB_DIR' &&
          T !== 'CLAUDE_CONFIG_DIR') ||
        T.startsWith('OTEL_')
      )
        delete O[T]
    delete O.BROWSER, (O.CLAUDE_PTY_HOST_EXEC = '1')
  }
  return O
}
async function iqq(H, _) {
  if (!_ || n_() !== 'macos') return
  let q = tV_(H)
  try {
    return (
      await sqH.mkdir(Zo8(), { recursive: !0, mode: 448 }),
      await sqH.writeFile(q, JSON.stringify(_), { mode: 384 }),
      q
    )
  } catch (K) {
    N(`writeAuthSnapshot failed: ${LH(K)}`, { level: 'warn' })
    return
  }
}
function _84(H) {
  return H.kind === 'retiring'
    ? `retiring:${H.reason}`
    : H.kind === 'retired'
      ? `retired:${H.outcome}`
      : H.kind
}
function jfO(H, _) {
  if (H.kind === 'retired') return !1
  switch (_.kind) {
    case 'spawning':
      return H.kind === 'upgrading' || H.kind === 'running'
    case 'running':
      return H.kind === 'spawning'
    case 'upgrading':
      return H.kind === 'running'
    case 'retiring':
      return !0
    case 'retired':
      return !0
  }
}
class zF{dispatch;spawnPty;getAuthSnapshot;via;record;onStream=C7();onState=C7();onSettle=C7();onRepaintDone=C7();attachers=new Map;pty;procStart;ptyCols=200;ptyRows=50;decModes=fy_();execTracker;execLastLine;offData;offExit;ring=[];ringBytes=0;ringSpawnMark=0;attempt=0;lastSpawnAt=0;fastCrashStreak=0;lastExitCause;backoffTimer=null;pidPoll=null;rv;rvSockPath;ptySockPath;unverifiedSock;phase={kind:"spawning"};workerReady=!1;resizeDeferred=!1;lastInputAt;deleteJobDirOnSettle=!1;get shouldDeleteJobDir(){return this.deleteJobDirOnSettle}adoptedAt;lastRvHeartbeat;stalledLogged=!1;lastCheckPidAt=Date.now();replyChain=Promise.resolve();killOutcome="killed";get isKilling(){return this.phase.kind==="retiring"&&this.phase.reason==="reap"}get isRetiring(){return this.phase.kind==="retiring"&&this.phase.reason==="grace"}get isUnverified(){return this.unverifiedSock!==void 0}getPhase(){return this.phase}get isTransitioning(){return this.phase.kind!=="running"||!this.pty||this.record.pid===0}get isDetached(){return this.phase.kind==="retiring"&&this.phase.reason==="stop"}transitionTo(H){if(!jfO(this.phase,H))return N(`[bg] illegal worker-phase transition ${_84(this.phase)} \u2192 ${_84(H)} for ${this.record.short}`,{level:"warn"}),c("tengu_bg_phase_illegal",{}),!1;return this.phase=H,!0}shutdownWorker(){let H=this.rv?.send({type:"shutdown"})??!1;if(!H)this.sigtermWorker();else setTimeout((_)=>{let q=_.phase;if((q.kind==="upgrading"||q.kind==="retiring"&&q.reason==="grace")&&!_.record.outcome)_.sigtermWorker()},5000,this).unref();return H}async respawnIfIdleStale(H){if(this.dispatch.launch.mode==="exec")return{respawned:!1,reason:"not-stale"};if(this.isTransitioning)return{respawned:!1,reason:"in-progress"};if(this.record.outcome)return{respawned:!1,reason:"no-state"};if(this.attachers.size>0)return{respawned:!1,reason:"attached"};let _=await o7(b4(this.dispatch.short));if(this.isTransitioning)return{respawned:!1,reason:"in-progress"};if(this.record.outcome)return{respawned:!1,reason:"no-state"};if(this.attachers.size>0)return{respawned:!1,reason:"attached"};if(!_)return{respawned:!1,reason:"no-state"};if(HD(_)&&!H?.has(this.dispatch.short))return{respawned:!1,reason:"settled"};if(!_.cliVersion||_.cliVersion==={ISSUES_EXPLAINER:"report the issue at https://github.com/anthropics/claude-code/issues",PACKAGE_URL:"@anthropic-ai/claude-code",README_URL:"https://code.claude.com/docs/en/overview",VERSION:"2.1.153",FEEDBACK_CHANNEL:"https://github.com/anthropics/claude-code/issues",BUILD_TIME:"2026-05-27T20:03:21Z",GIT_SHA:"6cfd211761f355dcebba152b66399d0416e445d2"}.VERSION)return{respawned:!1,reason:"not-stale"};if(!HD(_)&&_.tempo!=="idle")return{respawned:!1,reason:"busy"};if(!this.transitionTo({kind:"upgrading"}))return{respawned:!1,reason:"in-progress"};return this.onState.emit({pid:this.record.pid}),c("tengu_bg_respawn_stale",{short:this.dispatch.short,rvSent:this.shutdownWorker()}),{respawned:!0}}async retireIfSettled(H,_,q=H){if(this.isTransitioning)return{retired:!1,reason:"in-progress"};if(this.record.outcome)return{retired:!1,reason:"no-state"};if(this.attachers.size>0)return{retired:!1,reason:"attached"};if(_?.has(this.dispatch.short))return{retired:!1,reason:"pinned"};if(this.adoptedAt&&Date.now()-this.adoptedAt<AfO)return{retired:!1,reason:"recent-adopt"};if(this.lastInputAt&&Date.now()-this.lastInputAt<H)return{retired:!1,reason:"recent-input"};let K=await o7(b4(this.dispatch.short));if(this.isTransitioning||this.attachers.size>0)return{retired:!1,reason:"in-progress"};if(this.lastInputAt&&Date.now()-this.lastInputAt<H)return{retired:!1,reason:"recent-input"};if(!K){if(this.dispatch.source==="spare"&&Date.now()-this.dispatch.createdAt>H){if(!this.transitionTo({kind:"retiring",reason:"grace"}))return{retired:!1,reason:"in-progress"};return c("tengu_bg_retired",{short:this.dispatch.short,rvSent:this.shutdownWorker(),settledForMs:Date.now()-this.dispatch.createdAt,state:"stale-spare"}),{retired:!0}}return{retired:!1,reason:"no-state"}}if(this.dispatch.source!=="shell"&&!K.name&&!K.intent&&!K.worktreePath&&K.template==="bg"&&K.state==="working"&&K.tempo==="blocked"){let z=Date.now()-Date.parse(K.createdAt);if(z<wfO)return{retired:!1,reason:"empty-idle-grace"};if(!this.transitionTo({kind:"retiring",reason:"grace"}))return{retired:!1,reason:"in-progress"};return this.deleteJobDirOnSettle=!0,c("tengu_bg_retired",{short:this.dispatch.short,rvSent:this.shutdownWorker(),settledForMs:z,state:"empty-idle"}),{retired:!0}}if(!HD(K))return{retired:!1,reason:"not-settled"};if((K.inFlight?.tasks??1)>0||(K.inFlight?.queued??1)>0)return{retired:!1,reason:"inflight"};if(K.inFlight?.kinds.includes("session_cron"))return{retired:!1,reason:"session-cron"};if(K.routine)return{retired:!1,reason:"routine"};let O=K.bridgeSessionId?Math.max(H,q):H,T=K.updatedAt&&Date.now()-Date.parse(K.updatedAt);if(!T||T<O)return{retired:!1,reason:"grace"};if(!this.transitionTo({kind:"retiring",reason:"grace"}))return{retired:!1,reason:"in-progress"};return c("tengu_bg_retired",{short:this.dispatch.short,rvSent:this.shutdownWorker(),settledForMs:T,bridged:!!K.bridgeSessionId,state:K.state}),{retired:!0}}sigtermWorker(){try{this.pty?.kill("SIGTERM")}catch{}}constructor(H,_,q,K,O){this.dispatch=H;this.spawnPty=_;this.getAuthSnapshot=q;this.via=K;if(this.record={short:H.short,nonce:H.nonce,sessionId:H.sessionId,pid:0,attempt:0,startedAt:Date.now(),cwd:H.cwd,backend:"daemon",tempo:"active",state:"starting",detail:"",intent:H.seed?.intent??"",name:H.seed?.name,agent:H.agent,routine:H.routine,worktreePath:H.worktree?.path,cliVersion:{ISSUES_EXPLAINER:"report the issue at https://github.com/anthropics/claude-code/issues",PACKAGE_URL:"@anthropic-ai/claude-code",README_URL:"https://code.claude.com/docs/en/overview",VERSION:"2.1.153",FEEDBACK_CHANNEL:"https://github.com/anthropics/claude-code/issues",BUILD_TIME:"2026-05-27T20:03:21Z",GIT_SHA:"6cfd211761f355dcebba152b66399d0416e445d2"}.VERSION,source:H.source,...O},H.cols)this.ptyCols=H.cols;if(H.rows)this.ptyRows=H.rows}static spawn(H,_,q,K){let O=new zF(H,_??nqq(),q,"cold");if(K?.afterUpgrade)return O.attempt=1,O.buildBridgeReattachEnvFromState().then((T)=>O.doSpawn(T)),O;return O.doSpawn(H.reattachEnv),O}static claim(H,_){let q=new zF(H,_.spawnPty,_.getAuthSnapshot,"spare",{pid:_.pid,attempt:1,state:"running",cliVersion:{ISSUES_EXPLAINER:"report the issue at https://github.com/anthropics/claude-code/issues",PACKAGE_URL:"@anthropic-ai/claude-code",README_URL:"https://code.claude.com/docs/en/overview",VERSION:"2.1.153",FEEDBACK_CHANNEL:"https://github.com/anthropics/claude-code/issues",BUILD_TIME:"2026-05-27T20:03:21Z",GIT_SHA:"6cfd211761f355dcebba152b66399d0416e445d2"}.VERSION});return q.attempt=1,q.ptySockPath=_.ptySockPath,q.rvSockPath=x__(H.short),q.wirePty(Ch6(_.ptySockPath,_.pid,void 0,H.short)),q.resize(H.cols??200,H.rows??50),q.connectRv(),ey(_.pid,{skipCache:!0}).then((K)=>{if(q.record.pid!==_.pid||q.isDetached||q.record.outcome)return;if(K)q.procStart=K;q.patch({pid:_.pid})}),q}static buildClaimFrame(H,_){let q=b4(H.short),K=H84(H,q,_,x__(H.short));if(H.reattachEnv)Object.assign(K,H.reattachEnv);let O=e64(H,1,!1,H.sessionId,H.respawnFlags);return{env:K,argv:O}}static async adopt(H,_,q,K){try{process.kill(_.pid,0)}
