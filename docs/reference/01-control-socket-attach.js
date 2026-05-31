var cv = R(() => {
  I8()
  QSH()
  vOH = /^[a-f0-9]{8}$/
  ;(OL6 = yH(() =>
    y.object({
      proto: y.number().int().min(CV_).max(P5),
      short: y.string().regex(vOH),
      nonce: y.string().regex(vOH).optional(),
      sessionId: y.string(),
      createdAt: y.number(),
      source: y.enum(['shell', 'slash', 'fleet', 'spare', 'respawn']),
      cwd: y.string(),
      launch: y.discriminatedUnion('mode', [
        y.object({ mode: y.literal('prompt'), args: y.array(y.string()) }),
        y.object({
          mode: y.literal('resume'),
          sessionId: y.string(),
          fork: y.boolean(),
          flagArgs: y.array(y.string()),
        }),
        y.object({
          mode: y.literal('exec'),
          cmd: y.string(),
          args: y.array(y.string()),
        }),
      ]),
      env: y.record(y.string(), y.string()).default({}),
      reattachEnv: y.record(y.string(), y.string()).optional(),
      worktree: y
        .object({ path: y.string(), ownershipToken: y.string() })
        .optional(),
      isolation: y.enum(['none', 'worktree']).default('none'),
      respawnFlags: y.array(y.string()).default([]),
      attachStallRespawns: y.number().int().optional(),
      agent: y.string().optional(),
      routine: y.string().optional(),
      seed: y
        .object({ intent: y.string(), name: y.string().optional() })
        .optional(),
      cols: y.number().int().positive().max(JqH).optional(),
      rows: y.number().int().positive().max(JqH).optional(),
    }),
  )),
    (Z__ = /ERESPAWNING|ESTARTING/),
    (IV_ = /ESTALLED|EUNVERIFIED/),
    (bV_ = /^EKICKED:\s*/),
    (Kc3 = yH(() =>
      y.object({
        pid: y.number(),
        procStart: y.string().optional(),
        sessionId: y.string(),
        rendezvousSock: y.string(),
        ptySock: y.string().optional(),
        messagingSock: y.string().optional(),
        cliVersion: y.string().optional(),
        startedAt: y.number(),
        attempt: y.number(),
        cwd: y.string(),
        worktreePath: y.string().optional(),
        dispatch: OL6(),
        pendingRespawn: y.literal('upgrade').optional(),
        decModes: y.array(y.number()).optional(),
      }),
    )),
    (QLK = yH(() =>
      y.object({
        proto: y.number().int().min(CV_).max(P5),
        supervisorPid: y.number(),
        updatedAt: y.number(),
        workers: y.record(y.string(), Kc3()),
      }),
    )),
    (dLK = yH(() => {
      let H = y.string().regex(vOH),
        _ = y.number().int().min(CV_).max(P5)
      return y.discriminatedUnion('op', [
        y.object({ proto: _, op: y.literal('ping') }),
        y.object({ proto: _, op: y.literal('nudge') }),
        y.object({ proto: _, op: y.literal('yield') }),
        y.object({
          proto: _,
          op: y.literal('lease'),
          client: y
            .object({ label: y.string(), cwd: y.string(), pid: y.number() })
            .optional(),
        }),
        y.object({ proto: _, op: y.literal('leases') }),
        y.object({
          proto: _,
          op: y.literal('await-ack'),
          short: H,
          nonce: H.optional(),
          timeoutMs: y.number(),
        }),
        y.object({
          proto: _,
          op: y.literal('dispatch'),
          d: OL6(),
          timeoutMs: y.number(),
        }),
        y.object({ proto: _, op: y.literal('list') }),
        y.object({ proto: _, op: y.literal('has'), short: H }),
        y.object({
          proto: _,
          op: y.literal('kill'),
          short: H,
          signal: y.enum(['SIGTERM', 'SIGKILL']).optional(),
        }),
        y.object({
          proto: _,
          op: y.literal('reply'),
          short: H,
          text: y.string(),
        }),
        y.object({
          proto: _,
          op: y.literal('subscribe'),
          short: H,
          tail: y.number().optional(),
        }),
        y.object({
          proto: _,
          op: y.literal('attach'),
          short: H,
          cols: y.number().int().min(1).max(JqH),
          rows: y.number().int().min(1).max(JqH),
          attachId: y.string().optional(),
          caps: y
            .object({
              terminal: y.string().nullable(),
              mux: y.enum(['tmux', 'screen', 'zellij']).nullable(),
              ssh: y.boolean(),
              wheelFlood: y.boolean().optional(),
              hyperlinks: y.boolean().optional(),
              progressReporting: y.boolean().optional(),
              wtSession: y.boolean().optional(),
              isVscodeTerm: y.boolean().optional(),
              browser: y.string().nullable().optional(),
              colorLevel: y
                .union([y.literal(0), y.literal(1), y.literal(2), y.literal(3)])
                .optional(),
              editor: y.string().nullable().optional(),
            })
            .optional(),
          holdingFrame: y.boolean().optional(),
        }),
        y.object({
          proto: _,
          op: y.literal('resize'),
          short: H,
          cols: y.number().int().min(1).max(JqH),
          rows: y.number().int().min(1).max(JqH),
          attachId: y.string().optional(),
        }),
        y.object({ proto: _, op: y.literal('ensure-spare'), cwd: y.string() }),
        y.object({
          proto: _,
          op: y.literal('permission-response'),
          short: H,
          requestId: y.string(),
          allow: y.boolean(),
        }),
        y.object({ proto: _, op: y.literal('respawn-stale'), short: H }),
        y.object({
          proto: _,
          op: y.literal('shutdown'),
          reapWorkers: y.boolean().optional(),
        }),
      ])
    }))
})
function yOH() {
  if (!dr_()) return
  let H = ULK()
  ta({ type: 'detach-request', msg: H }), process.stdout.write(MqH(H))
}
var xV_ = R(() => {
  jV_()
  F3()
  P__()
  cv()
})
function _r8() {
  let H = [process.argv[1] || '', process.execPath || ''],
    _ = [
      '/build-ant/',
      '/build-ant-native/',
      '/build-external/',
      '/build-external-native/',
    ]
  return H.some(q => _.some(K => q.includes(K)))
}
function Oc3(H) {
  let _ = _r8() ? 'claude-dev' : 'claude',
    q = new URL(`${_}://resume`)
  return q.searchParams.set('session', H), q.toString()
}
async function qr8() {
  if (_r8()) return !0
  let H = 'darwin'
  if (H === 'darwin') return j5('/Applications/Claude.app')
  else if (H === 'linux') {
    let { code: _, stdout: q } = await L6('xdg-mime', [
      'query',
      'default',
      'x-scheme-handler/claude',
    ])
    return _ === 0 && q.trim().length > 0
  } else if (H === 'win32') {
    let { code: _ } = await L6('reg', [
      'query',
      'HKEY_CLASSES_ROOT\\claude',
      '/ve',
    ])
    return _ === 0
  }
  return !1
}
async function Tc3() {
  {
    let { code: _, stdout: q } = await L6('defaults', [
      'read',
      '/Applications/Claude.app/Contents/Info.plist',
      'CFBundleShortVersionString',
    ])
    if (_ !== 0) return null
    let K = q.trim()
    return K.length > 0 ? K : null
  }
  return null
}
async function Kr8() {
  if (!(await qr8())) return { status: 'not-installed' }
  let _
  try {
    _ = await Tc3()
  } catch {
    return { status: 'ready', version: 'unknown' }
  }
  if (!_) return { status: 'ready', version: 'unknown' }
  let q = cLK.coerce(_)
  if (!q || !Dk(q.version, TL6))
    return { status: 'version-too-old', version: _ }
  return { status: 'ready', version: _ }
}
async function zc3(H) {
  N(`Opening deep link: ${H}`)
  {
    if (_r8()) {
      let { code: K } = await L6('osascript', [
        '-e',
        `tell application "Electron" to open location "${H}"`,
      ])
      return K === 0
    }
    let { code: q } = await L6('open', [H])
    return q === 0
  }
  return !1
}
async function lLK() {
  let H = h_(),
    _ = await Kr8()
  if (_.status === 'not-installed')
    return {
      success: !1,
      error:
        'Claude Desktop is not installed. Install it from https://claude.ai/download',
    }
  if (_.status === 'version-too-old')
    return {
      success: !1,
      error: `Claude Desktop ${_.version} is too old to resume this session. Please update to ${TL6} or later.`,
    }
  let q = Oc3(H)
  if (!(await zc3(q)))
    return {
      success: !1,
      error: 'Failed to open Claude Desktop. Please try opening it manually.',
      deepLinkUrl: q,
    }
  return { success: !0, deepLinkUrl: q }
}
var cLK,
  TL6 = '1.1.9669'
var Or8 = R(() => {
  J_()
  lH()
  Y7()
  C4()
  cLK = p(UQ(), 1)
})
function $c3() {
  switch ('darwin') {
    case 'win32':
      return 'https://claude.ai/api/desktop/win32/x64/exe/latest/redirect'
    default:
      return 'https://claude.ai/api/desktop/darwin/universal/dmg/latest/redirect'
  }
}
function zL6(H) {
  let _ = nLK.c(23),
    { onDone: q } = H,
    [K, O] = GI.useState('checking'),
    [T, z] = GI.useState(null),
    [$, Y] = GI.useState(''),
    A = rq(),
    w
  if (_[0] !== T || _[1] !== q || _[2] !== K)
    (w = function (W) {
      if (
        W.key === 'escape' ||
        ((W.ctrl || W.meta) && (W.key === 'c' || W.key === 'd'))
      ) {
        W.preventDefault(),
          q(`Cancelled. Learn more about Claude Desktop at ${Tr8}`, {
            display: 'system',
          })
        return
      }
      if (W.ctrl || W.meta) return
      if (K === 'error') {
        W.preventDefault(), q(T ?? 'Unknown error', { display: 'system' })
        return
      }
      if (K === 'prompt-download') {
        if (W.key === 'y' || W.key === 'Y')
          W.preventDefault(),
            f4($c3()).catch(Yc3),
            q(
              `Starting download. Re-run /desktop once you\u2019ve installed the app.
Learn more at ${Tr8}`,
              { display: 'system' },
            )
        else if (W.key === 'n' || W.key === 'N')
          W.preventDefault(),
            q(
              `The desktop app is required for /desktop. Learn more at ${Tr8}`,
              { display: 'system' },
            )
      }
    }),
      (_[0] = T),
      (_[1] = q),
      (_[2] = K),
      (_[3] = w)
  else w = _[3]
  let j = w,
    J,
    M
  if (_[4] !== A || _[5] !== q)
    (J = () => {
      ;(async function () {
        O('checking')
        let Z = await Kr8()
        if (Z.status === 'not-installed') {
          Y('Claude Desktop is not installed.'), O('prompt-download')
          return
        }
        if (Z.status === 'version-too-old') {
          Y(
            `Claude Desktop needs to be updated (found v${Z.version}, need v${TL6}+).`,
          ),
            O('prompt-download')
          return
        }
        O('flushing'), await yG(), O('opening')
        let L = await lLK()
        if (!L.success) {
          z(L.error), O('error')
          return
        }
        O('success'),
          A.setTimeout(async () => {
            if (
              (q('Session transferred to Claude Desktop', {
                display: 'system',
              }),
              N7())
            )
              yOH()
            await O7(0, 'other')
          }, 500)
      })().catch(W => {
        z(LH(W)), O('error')
      })
    }),
      (M = [q, A]),
      (_[4] = A),
      (_[5] = q),
      (_[6] = J),
      (_[7] = M)
  else (J = _[6]), (M = _[7])
  if ((GI.useEffect(J, M), K === 'error')) {
    let G
    if (_[8] !== T)
      (G = GI.default.createElement(V, { color: 'error' }, 'Error: ', T)),
        (_[8] = T),
        (_[9] = G)
    else G = _[9]
    let W
    if (_[10] === Symbol.for('react.memo_cache_sentinel'))
      (W = GI.default.createElement(
        V,
        { dimColor: !0 },
        'Press any key to continue\u2026',
      )),
        (_[10] = W)
    else W = _[10]
    let Z
    if (_[11] !== j || _[12] !== G)
      (Z = GI.default.createElement(
        B,
        {
          flexDirection: 'column',
          paddingX: 2,
          tabIndex: 0,
          autoFocus: !0,
          onKeyDown: j,
        },
        G,
        W,
      )),
        (_[11] = j),
        (_[12] = G),
        (_[13] = Z)
    else Z = _[13]
    return Z
  }
  if (K === 'prompt-download') {
    let G
    if (_[14] !== $)
      (G = GI.default.createElement(V, null, $)), (_[14] = $), (_[15] = G)
    else G = _[15]
    let W
    if (_[16] === Symbol.for('react.memo_cache_sentinel'))
      (W = GI.default.createElement(V, null, 'Download now? (y/n)')),
        (_[16] = W)
    else W = _[16]
    let Z
    if (_[17] !== j || _[18] !== G)
      (Z = GI.default.createElement(
        B,
        {
          flexDirection: 'column',
          paddingX: 2,
          tabIndex: 0,
          autoFocus: !0,
          onKeyDown: j,
        },
        G,
        W,
      )),
        (_[17] = j),
        (_[18] = G),
        (_[19] = Z)
    else Z = _[19]
    return Z
  }
  let D
  if (_[20] === Symbol.for('react.memo_cache_sentinel'))
    (D = {
      checking: 'Checking for Claude Desktop\u2026',
      flushing: 'Saving session\u2026',
      opening: 'Opening Claude Desktop\u2026',
      success: 'Opening in Claude Desktop\u2026',
    }),
      (_[20] = D)
  else D = _[20]
  let X = D[K],
    P
  if (_[21] !== X)
    (P = GI.default.createElement(
      B,
      { paddingX: 2 },
      GI.default.createElement(N1, { message: X }),
    )),
      (_[21] = X),
      (_[22] = P)
  else P = _[22]
  return P
}
function Yc3() {}
var nLK,
  GI,
  Tr8 = 'https://clau.de/desktop'
var zr8 = R(() => {
  xV_()
  iH()
  sA()
  F3()
  Or8()
  W_()
  pT()
  YK()
  kD()
  ;(nLK = p(q_(), 1)), (GI = p(PH(), 1))
})
var rLK = {}
f_(rLK, { call: () => Ac3 })
async function Ac3(H) {
  return iLK.default.createElement(zL6, { onDone: H })
}
var iLK
var oLK = R(() => {
  zr8()
  iLK = p(PH(), 1)
})
function aLK() {
  return !0
}
var wc3, sLK
var tLK = R(() => {
  ;(wc3 = {
    type: 'local-jsx',
    name: 'desktop',
    aliases: ['app'],
    description: 'Continue the current session in Claude Desktop',
    availability: ['claude-ai'],
    isEnabled: aLK,
    get isHidden() {
      return !aLK()
    },
    load: () => Promise.resolve().then(() => (oLK(), rLK)),
  }),
    (sLK = wc3)
})
function HkK(H, _, q) {
  let { commit: K, pr: O } = WSH(),
    T = q ?? O,
    z = _kK(process.env.SAFEUSER || ''),
    $ = _kK(process.env.USER || ''),
    Y = '',
    A = '',
    w = '',
    j = '',
    J = `

5. After creating/updating the PR, check if the user's CLAUDE.md mentions posting to Slack channels. If it does, use ToolSearch to search for "slack send message" tools. If ToolSearch finds a Slack tool, ask the user if they'd like you to post the PR URL to the relevant Slack channel. Only post if the user confirms. If ToolSearch returns no results or errors, skip this step silently\u2014do not mention the failure, do not attempt workarounds, and do not try alternative approaches.`
  return `${Y}## Context

- \`SAFEUSER\`: ${z}
- \`whoami\`: ${$}
- \`git status\`: !\`git status\`
- \`git diff HEAD\`: !\`git diff HEAD\`
- \`git branch --show-current\`: !\`git branch --show-current\`
- \`git diff ${H}...HEAD\`: !\`git diff ${H}...HEAD\`
- \`gh pr view --json number\`: !\`${t4() ? 'gh pr view --json number 2>/dev/null || true' : 'gh pr view --json number 2>$null; if (-not $?) { "" }'}\`

## Git Safety Protocol

- NEVER update the git config
- NEVER run destructive/irreversible git commands (like push --force, hard reset, etc) unless the user explicitly requests them
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- NEVER run force push to main/master, warn the user if they request it
- Do not commit files that likely contain secrets (.env, credentials.json, etc)
- Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported

## Your task

Analyze all changes that will be included in the pull request, making sure to look at all relevant commits (NOT just the latest commit, but ALL commits that will be included in the pull request from the git diff ${H}...HEAD output above).

Based on the above changes:
1. Create a new branch if on ${H} (use SAFEUSER from context above for the branch name prefix, falling back to whoami if SAFEUSER is empty, e.g., \`username/feature-name\`)
2. Create a single commit with an appropriate message${K ? ', ending with the attribution text shown in the example below' : ''}:
${
  t4()
    ? `\`\`\`
git commit -m "$(cat <<'EOF'
Commit message here.${
        K
          ? `

${K}`
          : ''
      }
EOF
)"
\`\`\``
    : `\`\`\`
git commit -m @'
Commit message here.${
        K
          ? `

${K}`
          : ''
      }
'@
\`\`\`
The closing \`'@\` MUST be at column 0 with no leading whitespace.`
}
3. Push the branch to origin
4. If a PR already exists for this branch (check the gh pr view output above), update the PR title and body using \`gh pr edit\` to reflect the current diff${w}. Otherwise, create a pull request using \`gh pr create\` with the multi-line body syntax shown below${A}.
   - IMPORTANT: Keep PR titles short (under 70 characters). Use the body for details.
${
  t4()
    ? `\`\`\`
gh pr create --title "Short, descriptive title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Test plan
[Bulleted markdown checklist of TODOs for testing the pull request...]${j}${
        T
          ? `

${T}`
          : ''
      }
EOF
)"
\`\`\``
    : `\`\`\`
gh pr create --title "Short, descriptive title" --body @'
## Summary
<1-3 bullet points>

## Test plan
[Bulleted markdown checklist of TODOs for testing the pull request...]${j}${
        T
          ? `

${T}`
          : ''
      }
'@
\`\`\``
}

You have the capability to call multiple tools in a single response. You MUST do all of the above in a single message.${J}

Return the PR URL when you're done, so the user can see it.`
}
function _kK(H) {
  return H.replace(/[^a-zA-Z0-9._-]/g, '')
}
var jc3, eLK, Jc3, qkK
var KkK = R(() => {
  nG6()
  Dq()
  JK()
  qH_()
  jz()
  PSH()
  ;(jc3 = [
    'git checkout -b *',
    'git add *',
    'git status *',
    'git push *',
    'git commit *',
    'gh pr create *',
    'gh pr edit *',
    'gh pr view *',
    'gh pr merge *',
  ]),
    (eLK = [
      ...jc3.flatMap(H => [`Bash(${H})`, `PowerShell(${H})`]),
      'ToolSearch',
      'mcp__slack__send_message',
      'mcp__claude_ai_Slack__slack_send_message',
    ])
  ;(Jc3 = {
    type: 'prompt',
    name: OW8,
    description: 'Commit, push, and open a PR',
    allowedTools: eLK,
    get contentLength() {
      return HkK('main', !1).length
    },
    progressMessage: 'creating commit and PR',
    source: 'builtin',
    async getPromptForCommand(H, _) {
      let [q, K] = await Promise.all([eV(), C2K(_.getAppState)]),
        T = HkK(q, !1, K),
        z = H?.trim()
      if (z)
        T += `

## Additional instructions from user

${z}`
      return [
        {
          type: 'text',
          text: await r8H(
            T,
            {
              ..._,
              getAppState() {
                let Y = _.getAppState()
                return {
                  ...Y,
                  toolPermissionContext: {
                    ...Y.toolPermissionContext,
                    alwaysAllowRules: {
                      ...Y.toolPermissionContext.alwaysAllowRules,
                      command: eLK,
                    },
                  },
                }
              },
            },
            `/${OW8}`,
          ),
        },
      ]
    },
  }),
    (qkK = Jc3)
})
var zkK = {}
f_(zkK, { call: () => Mc3 })
async function Dc3(H, _, q) {
  _.onCompactEvent?.({
    type: 'compact_progress',
    event: { type: 'hooks_start', hookType: 'pre_compact' },
  }),
    _.onCompactEvent?.({ type: 'sdk_status', status: 'compacting' })
  let K = performance.now(),
    O,
    T = oR(H),
    z,
    $
  try {
    let [Y, A] = await Promise.all([
      zc(
        { trigger: 'manual', customInstructions: q || null },
        _.abortController.signal,
      ),
      TkK(_, H),
    ])
    uZ6(Y, f => _.onQueryEvent?.({ type: 'notification', notification: f }))
    let w = _d8(q, Y.newCustomInstructions)
    _.onCompactEvent?.({ type: 'stream_mode', mode: 'requesting' }),
      _.onQueryEvent?.({ type: 'response_length', op: 'reset' }),
      _.onCompactEvent?.({
        type: 'compact_progress',
        event: { type: 'compact_start' },
      })
    let j = await fc3(q, Y.newCustomInstructions, H, _.abortController.signal)
    $ = j.reuse
    let J = await (j.hit
      ? vT6({ ...j.finalize, startTime: K, cacheSafeParams: A })
      : FV8(H, A, {
          customInstructions: w,
          trigger: 'manual',
          manualPrecomputeReuse: j.reuse,
          userWaitStartedAt: K,
          precomputedKind: j.precomputedKind,
          precomputedFailureCause: j.precomputedFailureCause,
        })
    ).catch(f => {
      return hH(f), { ok: !1, reason: 'error', detail: LH(f) }
    })
    if (!J.ok)
      switch (J.reason) {
        case 'too_few_groups':
          throw Error(XH_)
        case 'aborted':
          throw Error(MI)
        case 'exhausted':
          throw new jOH(
            'Compaction failed \xB7 conversation could not be reduced below the context limit',
          )
        case 'media_unstrippable':
          throw new jOH(
            'Compaction failed \xB7 attached media exceeds size limits',
          )
        case 'error':
          throw new jOH(
            `Error during compaction: ${J.detail || 'unknown error'}`,
          )
      }
    let M = J.result.boundaryMarker
    if (M.subtype === 'compact_boundary' && 'compactMetadata' in M)
      z = M.compactMetadata.postTokens
    Eo(void 0, _.setAppState), KvH(), Vj.cache.clear?.()
    let D =
      [Y.userDisplayMessage, J.result.userDisplayMessage].filter(Boolean).join(`
`) || void 0
    return {
      type: 'compact',
      compactionResult: { ...J.result, userDisplayMessage: D },
      displayText: OkK(_, D),
    }
  } catch (Y) {
    throw (
      ((O = Y instanceof Error ? Y.message : 'reactive compaction failed'), Y)
    )
  } finally {
    _.onCompactEvent?.({ type: 'stream_mode', mode: 'requesting' }),
      _.onQueryEvent?.({ type: 'response_length', op: 'reset' }),
      _.onCompactEvent?.({
        type: 'compact_progress',
        event: { type: 'compact_end' },
      }),
      pJH({
        trigger: 'manual',
        success: !O,
        durationMs: performance.now() - K,
        preTokens: T,
        postTokens: z,
        error: O,
        precomputeReuse: $,
      }),
      _.onCompactEvent?.({
        type: 'sdk_status',
        status: null,
        metadata: {
          compactResult: O ? 'failed' : 'success',
          ...(O && { compactError: O }),
        },
      })
  }
}
async function fc3(H, _, q, K) {
  if (H) return { hit: !1, reuse: 'miss_custom_instructions' }
  if (_) return { hit: !1, reuse: 'miss_hook' }
  let O = performance.now(),
    T = await yV8(void 0, K),
    z = performance.now() - O
  if (T === null)
    return (
      diH('none', T, z),
      { hit: !1, reuse: 'miss_not_ready', precomputedKind: 'none' }
    )
  if (T.kind === 'turn_aborted') throw (diH('aborted', T, z), Error(MI))
  if (T.kind === 'failed')
    return (
      diH('failed', T, z),
      {
        hit: !1,
        reuse: 'miss_not_ready',
        precomputedKind: 'failed',
        precomputedFailureCause: T.failure.cause,
      }
    )
  let $ = hV8(q, T.ready.precomputedAtUuid)
  if ($ === null)
    return (
      diH('none', T, z),
      ZT6(T.ready, 'boundary_uuid_missing', void 0),
      { hit: !1, reuse: 'miss_not_ready', precomputedKind: 'none' }
    )
  return (
    diH('applied', T, z),
    {
      hit: !0,
      reuse: 'hit',
      finalize: {
        compactResult: T.ready.result,
        messagesToPreserve: [...T.ready.result.messagesToPreserve, ...$],
        preCompactMessages: q,
        querySource: void 0,
        trigger: 'manual',
        precomputed: !0,
        manualPrecomputeReuse: 'hit',
        precomputeTelemetry: {
          statusAtPTL: T.statusAtPTL === 'ready' ? 'ready' : 'pending',
          leadMs: O - T.ready.startedAt,
          totalMs: T.ready.readyDurationMs,
          borrowed: !1,
          messagesSinceTokens: oR($),
        },
      },
    }
  )
}
function OkK(H, _) {
  let q = krH('tip'),
    K = fX('app:toggleTranscript', 'Global', 'ctrl+o'),
    O = [
      ...(H.options.verbose ? [] : [`(${K} to see full summary)`]),
      ...(_ ? [_] : []),
      ...(q ? [q] : []),
    ]
  return D_.dim(
    'Compacted ' +
      O.join(`
`),
  )
}
async function TkK(H, _) {
  let q = H.getAppState(),
    K = await LG(
      H.options.tools,
      H.options.mainLoopModel,
      Array.from(G8(H).additionalWorkingDirectories.keys()),
    ),
    O = Fu({
      mainThreadAgentDefinition: void 0,
      toolUseContext: H,
      customSystemPrompt: H.options.customSystemPrompt,
      defaultSystemPrompt: K,
      appendSystemPrompt: H.options.appendSystemPrompt,
    }),
    [T, z] = await Promise.all([Vj(), Df(q.cacheBreakerPhrase)])
  return {
    systemPrompt: O,
    userContext: T,
    systemContext: z,
    toolUseContext: H,
    forkContextMessages: _,
  }
}
var Mc3 = async (H, _) => {
  let { abortController: q } = _,
    { messages: K } = _
  if (((K = lY(K)), K.length === 0)) throw Error('No messages to compact')
  let O = H.trim()
  try {
    if (!Tc()) return await Dc3(K, _, O)
    let T = await itH(
      K,
      _,
      await TkK(_, K),
      !1,
      O,
      !1,
      void 0,
      wd8(),
      void 0,
      z => _.onQueryEvent?.({ type: 'notification', notification: z }),
      z => _.onQueryEvent?.(z),
    )
    return (
      KvH(),
      Vj.cache.clear?.(),
      Eo(void 0, _.setAppState),
      {
        type: 'compact',
        compactionResult: T,
        displayText: OkK(_, T.userDisplayMessage),
      }
    )
  } catch (T) {
    if (
      (_.onCompactEvent?.({
        type: 'sdk_status',
        status: null,
        metadata: {
          compactResult: 'failed',
          compactError: T instanceof Error ? T.message : String(T),
        },
      }),
      q.signal.aborted)
    )
      throw Error('Compaction canceled.')
    else if (Gn(T, XH_)) return { type: 'text', value: XH_ }
    else if (Gn(T, PH_)) throw Error(PH_)
    else if (T instanceof jOH) throw T
    else
      throw (
        (hH(T),
        Error(
          `Error during compaction: ${T instanceof Error ? T.message : String(T)}`,
          { cause: T },
        ))
      )
  }
}
var $kK = R(() => {
  F4()
  YU()
  bx()
  pr()
  tC()
  ho()
  FiH()
  iiH()
  RT6()
  TvH()
  qo()
  A4()
  W_()
  l5()
  W6()
  B8()
  lz6()
  EEH()
  Fw()
})
var Xc3, $L6
var YkK = R(() => {
  c_()
  ;(Xc3 = {
    type: 'local',
    name: 'compact',
    description: 'Free up context by summarizing the conversation so far',
    isEnabled: () => !xH(process.env.DISABLE_COMPACT),
    supportsNonInteractive: !0,
    argumentHint: '<optional custom summarization instructions>',
    thinClientDispatch: 'post-text',
    load: () => Promise.resolve().then(() => ($kK(), zkK)),
  }),
    ($L6 = Xc3)
})
var AkK = {}
f_(AkK, { call: () => Wc3, applyAutoCompactWindow: () => uV_ })
function Pc3(H, _) {
  let { window: q, configured: K, source: O } = Kl(H, _),
    T = K > q ? ` \xB7 capped to ${tK(q)} by model` : '',
    $ = [
      `Auto-compact window: ${O === 'auto' ? 'auto' : O === 'experiment' ? `auto (${tK(K)} tokens)` : O === 'env' ? `${tK(K)} tokens (from CLAUDE_CODE_AUTO_COMPACT_WINDOW)${T}` : `${tK(K)} tokens (from settings)${T}`}`,
    ]
  if (!JG()) $.push('Auto-compact is currently disabled (see /config)')
  if (
    ($.push(
      "Auto-compact summarizes the conversation when context usage approaches this limit. The actual threshold is the minimum of this setting and your model's maximum context window.",
    ),
    $.push(
      'The auto setting picks a window tuned for your model and is strongly recommended for the best cost and performance.',
    ),
    O === 'env' || O === 'settings')
  )
    $.push(
      'Overriding auto may result in high token usage, especially when resuming long sessions.',
    )
  return $.join(`
`)
}
function uV_(H, _) {
  let q = _.options.mainLoopModel
  if (Kl(q, void 0).source === 'env')
    return 'CLAUDE_CODE_AUTO_COMPACT_WINDOW is set and takes precedence. Unset it to change this setting.'
  let K = H.trim().toLowerCase(),
    T = K === 'reset' || K === 'unset' || K === 'default' ? 'auto' : zd8(K)
  if (T === void 0)
    return `Couldn't parse '${H}'. Expected 'auto' or 100k\u20131M tokens (e.g. 500k, 200000, or 200 as shorthand)`
  let z = T === 'auto' ? void 0 : T,
    { error: $ } = g8('userSettings', { autoCompactWindow: z })
  if ($) return `Couldn't save setting: ${$.message}`
  let Y = o8().autoCompactWindow,
    { window: A, source: w } = Kl(q, Y),
    j = w === 'env' || Y !== z,
    J = j ? Y : z
  if (
    (_.onQueryEvent?.({
      type: 'apply_flag_settings',
      settings: { autoCompactWindow: J ?? null },
    }),
    c('tengu_autocompact_command', {
      action: T === 'auto' ? 'auto' : 'set',
      ...(z !== void 0 && { tokens: z }),
    }),
    T === 'auto')
  )
    return j
      ? `Auto-compact window set to auto in settings, but a higher-priority override is active (${tK(A)} tokens)`
      : 'Auto-compact window set to auto'
  let M = ''
  if (j) M = `, but a higher-priority override is active (${tK(A)} tokens)`
  else if (A < T) M = ` (capped to model limit of ${tK(A)})`
  return `Auto-compact window set to ${tK(T)} tokens${M}`
}
var Wc3 = async (H, _) => {
  let q = H.trim()
  if (!q)
    return {
      type: 'text',
      value: Pc3(_.options.mainLoopModel, _.options.autoCompactWindow),
    }
  return { type: 'text', value: uV_(q, _) }
}
var $r8 = R(() => {
  N_()
  tC()
  fq()
  M8()
})
var jkK = {}
f_(jkK, { call: () => Rc3 })
function Zc3(H) {
  let _ = wkK.c(52),
    { onDone: q, context: K } = H,
    O = M_(Gc3),
    T = PM(),
    z
  if (_[0] !== O || _[1] !== T)
    (z = Kl(T, O)), (_[0] = O), (_[1] = T), (_[2] = z)
  else z = _[2]
  let { window: $, configured: Y, source: A } = z,
    w
  if (_[3] === Symbol.for('react.memo_cache_sentinel')) (w = JG()), (_[3] = w)
  else w = _[3]
  let j = w,
    J = Y > $,
    M = A === 'env',
    D =
      A === 'env'
        ? 'from CLAUDE_CODE_AUTO_COMPACT_WINDOW'
        : A === 'settings'
          ? 'from settings'
          : 'auto',
    f =
      A === 'auto' || A === 'experiment'
        ? cSH
        : Math.min(wr8, Math.max(Ar8, Math.round(Y / Yr8) * Yr8)),
    [X, P] = jr8.useState(f),
    [G, W] = jr8.useState(!1),
    Z
  if (_[4] !== M)
    (Z = function (zH) {
      if (M) return
      W(!0),
        P($H => {
          if ($H === cSH) return zH > 0 ? Ar8 : wr8
          let TH = $H + zH * Yr8
          if (TH < Ar8) return cSH
          if (TH > wr8) return cSH
          return TH
        })
    }),
      (_[4] = M),
      (_[5] = Z)
  else Z = _[5]
  let L = Z,
    k
  if (_[6] !== J || _[7] !== $)
    (k = J ? ` \xB7 capped to ${tK($)} by model` : ''),
      (_[6] = J),
      (_[7] = $),
      (_[8] = k)
  else k = _[8]
  let v = k,
    E
  if (_[9] !== v || _[10] !== Y || _[11] !== A || _[12] !== D)
    (E =
      A === 'auto'
        ? 'auto'
        : A === 'experiment'
          ? `auto (${tK(Y)} tokens)`
          : `${tK(Y)} tokens (${D})${v}`),
      (_[9] = v),
      (_[10] = Y),
      (_[11] = A),
      (_[12] = D),
      (_[13] = E)
  else E = _[13]
  let h = E,
    C
  if (_[14] !== G || _[15] !== K || _[16] !== h || _[17] !== q || _[18] !== X)
    (C = function () {
      if (!G) {
        q(`Auto-compact window unchanged: ${h}`)
        return
      }
      let zH = X === cSH ? 'auto' : String(X)
      q(uV_(zH, K))
    }),
      (_[14] = G),
      (_[15] = K),
      (_[16] = h),
      (_[17] = q),
      (_[18] = X),
      (_[19] = C)
  else C = _[19]
  let I = C,
    b,
    m
  if (_[20] !== L)
    (b = () => L(1)), (m = () => L(-1)), (_[20] = L), (_[21] = b), (_[22] = m)
  else (b = _[21]), (m = _[22])
  let S
  if (_[23] !== I || _[24] !== b || _[25] !== m)
    (S = { 'select:previous': b, 'select:next': m, 'select:accept': I }),
      (_[23] = I),
      (_[24] = b),
      (_[25] = m),
      (_[26] = S)
  else S = _[26]
  let x
  if (_[27] === Symbol.for('react.memo_cache_sentinel'))
    (x = { context: 'Select' }), (_[27] = x)
  else x = _[27]
  zq(S, x)
  let U
  if (_[28] !== L)
    (U = { 'tabs:next': () => L(1), 'tabs:previous': () => L(-1) }),
      (_[28] = L),
      (_[29] = U)
  else U = _[29]
  let g
  if (_[30] === Symbol.for('react.memo_cache_sentinel'))
    (g = { context: 'Tabs' }), (_[30] = g)
  else g = _[30]
  zq(U, g)
  let Q
  if (_[31] !== X)
    (Q = X === cSH ? 'auto' : `${tK(X)} tokens`), (_[31] = X), (_[32] = Q)
  else Q = _[32]
  let l = Q,
    d = `Current setting: ${h}`,
    r
  if (_[33] !== h || _[34] !== q)
    (r = () => q(`Auto-compact window unchanged: ${h}`)),
      (_[33] = h),
      (_[34] = q),
      (_[35] = r)
  else r = _[35]
  let a
  if (_[36] === Symbol.for('react.memo_cache_sentinel'))
    (a = i$.createElement(
      V,
      { dimColor: !0 },
      i$.createElement(
        Y6,
        null,
        i$.createElement(z_, { chord: ['up', 'down'], action: 'change' }),
        i$.createElement(z_, { chord: 'enter', action: 'apply' }),
        i$.createElement(z_, { chord: 'escape', action: 'cancel' }),
      ),
    )),
      (_[36] = a)
  else a = _[36]
  let s
  if (_[37] === Symbol.for('react.memo_cache_sentinel'))
    (s = i$.createElement(
      V,
      null,
      "This command configures when auto-compaction happens. The actual threshold is the minimum of this setting and your model's maximum context window.",
    )),
      (_[37] = s)
  else s = _[37]
  let _H, HH
  if (_[38] === Symbol.for('react.memo_cache_sentinel'))
    (_H = i$.createElement(
      V,
      null,
      'The auto setting picks a window tuned for your model and is',
      ' ',
      i$.createElement(V, { bold: !0 }, 'strongly recommended'),
      ' for the best cost and performance. You can override it below.',
    )),
      (HH =
        !j &&
        i$.createElement(
          V,
          { color: 'warning' },
          'Auto-compact is currently disabled (see /config)',
        )),
      (_[38] = _H),
      (_[39] = HH)
  else (_H = _[38]), (HH = _[39])
  let t
  if (_[40] !== X)
    (t =
      X !== cSH &&
      i$.createElement(
        V,
        { color: 'warning' },
        'Overriding auto may result in high token usage, especially when resuming long sessions.',
      )),
      (_[40] = X),
      (_[41] = t)
  else t = _[41]
  let jH
  if (_[42] !== l || _[43] !== M)
    (jH = M
      ? i$.createElement(
          V,
          { color: 'warning' },
          'CLAUDE_CODE_AUTO_COMPACT_WINDOW is set and takes precedence. Unset it to change this setting here.',
        )
      : i$.createElement(
          B,
          null,
          i$.createElement(V, null, 'Select auto-compact window: '),
          i$.createElement(V, { bold: !0, color: 'suggestion' }, l),
        )),
      (_[42] = l),
      (_[43] = M),
      (_[44] = jH)
  else jH = _[44]
  let KH
  if (_[45] !== t || _[46] !== jH)
    (KH = i$.createElement(
      B,
      { flexDirection: 'column', gap: 1 },
      s,
      _H,
      HH,
      t,
      jH,
    )),
      (_[45] = t),
      (_[46] = jH),
      (_[47] = KH)
  else KH = _[47]
  let qH
  if (_[48] !== d || _[49] !== r || _[50] !== KH)
    (qH = i$.createElement(
      b6,
      { title: 'Auto-compact window', subtitle: d, onCancel: r, inputGuide: a },
      KH,
    )),
      (_[48] = d),
      (_[49] = r),
      (_[50] = KH),
      (_[51] = qH)
  else qH = _[51]
  return qH
}
function Gc3(H) {
  return H.autoCompactWindow
}
var wkK,
  i$,
  jr8,
  Yr8 = 1e5,
  Ar8 = 1e5,
  wr8 = 1e6,
  cSH = 0,
  Rc3 = async (H, _, q) => {
    let K = q?.trim() || ''
    if (K) {
      let O = uV_(K, _)
      return H(O), null
    }
    return (
      c('tengu_autocompact_dialog_opened', { source: 'dialog' }),
      i$.createElement(Zc3, { onDone: H, context: _ })
    )
  }
var JkK = R(() => {
  A9()
  g9()
  Pq()
  ZE()
  iH()
  kq()
  N_()
  tC()
  i8()
  fq()
  $r8()
  ;(wkK = p(q_(), 1)), (i$ = p(PH(), 1)), (jr8 = p(PH(), 1))
})
function MkK() {
  return Tc()
}
var DkK, Jr8
var fkK = R(() => {
  J_()
  tC()
  ;(DkK = {
    type: 'local-jsx',
    name: 'autocompact',
    description: 'Configure the auto-compact window size',
    isEnabled: () => MkK() && !S8(),
    isHidden: !1,
    argumentHint: '[auto|<tokens>]',
    load: () => Promise.resolve().then(() => (JkK(), jkK)),
    userFacingName() {
      return 'autocompact'
    },
  }),
    (Jr8 = {
      type: 'local',
      name: 'autocompact',
      supportsNonInteractive: !0,
      description: 'Configure the auto-compact window size',
      get isHidden() {
        return !S8()
      },
      isEnabled() {
        return MkK() && S8()
      },
      argumentHint: '[auto|<tokens>]',
      load: () => Promise.resolve().then(() => ($r8(), AkK)),
      userFacingName() {
        return 'autocompact'
      },
    })
})
function n0(H) {
  let _ = mV_.c(46),
    {
      title: q,
      color: K,
      defaultTab: O,
      children: T,
      hidden: z,
      useFullWidth: $,
      selectedTab: Y,
      onTabChange: A,
      banner: w,
      disableNavigation: j,
      initialHeaderFocused: J,
      contentHeight: M,
      navFromContent: D,
    } = H,
    f = J === void 0 ? !0 : J,
    X = D === void 0 ? !1 : D,
    { columns: P } = K8(),
    G = T.map(Nc3),
    W = O ? G.findIndex(r_ => O === r_[0]) : 0,
    Z = Y !== void 0,
    [L, k] = G$.useState(W !== -1 ? W : 0),
    v = Z ? G.findIndex(r_ => r_[0] === Y) : -1,
    E = Z ? (v !== -1 ? v : 0) : L,
    h = G$.useContext(WC),
    C = JcH(),
    I = h76(),
    b = G$.useRef(null),
    [m, S] = G$.useState(0),
    x
  if (_[0] !== m)
    (x = () => {
      let r_ = b.current ? Kd(b.current).height : 0
      if (r_ !== m) S(r_)
    }),
      (_[0] = m),
      (_[1] = x)
  else x = _[1]
  G$.useLayoutEffect(x)
  let U = (z ? 0 : 2) + m,
    g,
    Q
  if (_[2] !== I || _[3] !== U)
    (g = () => {
      if (!I) return
      return I(U), () => I(null)
    }),
      (Q = [I, U]),
      (_[2] = I),
      (_[3] = U),
      (_[4] = g),
      (_[5] = Q)
  else (g = _[4]), (Q = _[5])
  G$.useLayoutEffect(g, Q)
  let l
  if (_[6] === Symbol.for('react.memo_cache_sentinel'))
    (l = { rows: 0, columns: 0 }), (_[6] = l)
  else l = _[6]
  let { rows: d } = TJ(l),
    r = I !== null && C !== null,
    a = r ? d - U : void 0,
    s
  if (_[7] !== h || _[8] !== r)
    (s = h && r ? { ...h, claimScrollBox: null } : null),
      (_[7] = h),
      (_[8] = r),
      (_[9] = s)
  else s = _[9]
  let _H = s,
    HH = !1,
    t = G$.useRef(null),
    { focus: jH, focusDirection: KH, blur: qH } = CdH(),
    [OH, zH] = G$.useState(f),
    $H
  if (_[10] !== jH)
    ($H = () => {
      if (HH && t.current) jH(t.current)
      zH(!0)
    }),
      (_[10] = jH),
      (_[11] = $H)
  else $H = _[11]
  let TH = $H,
    YH
  if (_[12] !== qH)
    (YH = () => {
      if (HH) qH()
      zH(!1)
    }),
      (_[12] = qH),
      (_[13] = YH)
  else YH = _[13]
  let MH = YH,
    [AH, DH] = G$.useState(0),
    fH
  if (_[14] === Symbol.for('react.memo_cache_sentinel'))
    (fH = () => {
      return DH(Vc3), () => DH(kc3)
    }),
      (_[14] = fH)
  else fH = _[14]
  let GH = fH,
    JH = AH > 0,
    RH = OH || !JH,
    VH = r_ => {
      let w6 = G[r_]?.[0]
      if (Z && A && w6) A(w6)
      else k(r_)
      TH()
    },
    NH = r_ => {
      VH((E + G.length + r_) % G.length)
    },
    dH = !z && !j && RH,
    mH
  if (_[15] !== dH)
    (mH = { context: 'Tabs', isActive: dH }), (_[15] = dH), (_[16] = mH)
  else mH = _[16]
  zq({ 'tabs:next': () => NH(1), 'tabs:previous': () => NH(-1) }, mH)
  let cH
  if (
    _[17] !== j ||
    _[18] !== KH ||
    _[19] !== OH ||
    _[20] !== z ||
    _[21] !== JH
  )
    (cH = r_ => {
      if (z || j) return
      if (HH) {
        if (!OH) {
          if (
            r_.key === 'left' ||
            r_.key === 'right' ||
            r_.key === 'tab' ||
            (JH && (r_.key === 'up' || r_.key === 'down'))
          )
            r_.preventDefault()
          return
        }
        if (r_.key === 'left' || r_.key === 'right' || r_.key === 'tab')
          r_.preventDefault()
        else if (r_.key === 'down' && JH)
          r_.preventDefault(), KH('down'), zH(!1)
        return
      }
      if (!JH) return
      if (r_.key === 'up' || r_.key === 'down') {
        if ((r_.preventDefault(), OH && r_.key === 'down')) zH(!1)
      }
    }),
      (_[17] = j),
      (_[18] = KH),
      (_[19] = OH),
      (_[20] = z),
      (_[21] = JH),
      (_[22] = cH)
  else cH = _[22]
  let tH = cH,
    K_ = !HH && X && !OH && JH && !z && !j,
    pH
  if (_[23] !== K_)
    (pH = { context: 'Tabs', isActive: K_ }), (_[23] = K_), (_[24] = pH)
  else pH = _[24]
  zq({ 'tabs:next': () => NH(1), 'tabs:previous': () => NH(-1) }, pH)
  let gH = q ? a_(q) + 1 : 0,
    eH = G.reduce(Lc3, 0),
    H_ = gH + eH,
    $_ = $ ? Math.max(0, P - H_) : 0,
    oH = $ ? P : void 0,
    E_ = B,
    w_ = 'column',
    O_ = HH ? void 0 : 0,
    v_ = HH ? void 0 : f,
    I_ = HH ? void 0 : tH,
    V_ = C ? 0 : void 0,
    sH =
      !z &&
      G$.default.createElement(
        B,
        {
          ref: HH ? t : void 0,
          tabIndex: HH ? 0 : void 0,
          autoFocus: HH ? f : void 0,
          onFocus: HH ? () => zH(!0) : void 0,
          onBlur: HH ? () => zH(!1) : void 0,
          onKeyDown: HH ? tH : void 0,
          flexDirection: 'row',
          gap: 1,
          flexShrink: C ? 0 : void 0,
          alignSelf: HH && !$ ? 'flex-start' : void 0,
        },
        q !== void 0 && G$.default.createElement(V, { bold: !0, color: K }, q),
        G.map((r_, w6) => {
          let [t_, s_] = r_
          return G$.default.createElement(vc3, {
            key: t_,
            title: s_,
            isCurrent: E === w6,
            headerFocused: RH && !j,
            color: K,
            onClick: j ? void 0 : () => VH(w6),
          })
        }),
        $_ > 0 && G$.default.createElement(V, null, ' '.repeat($_)),
      ),
    R_
  if (_[25] !== w)
    (R_ =
      w != null &&
      G$.default.createElement(
        B,
        { ref: b, flexDirection: 'column', flexShrink: 0 },
        w,
      )),
      (_[25] = w),
      (_[26] = R_)
  else R_ = _[26]
  let u_
  if (
    _[27] !== _H ||
    _[28] !== T ||
    _[29] !== M ||
    _[30] !== oH ||
    _[31] !== z ||
    _[32] !== C ||
    _[33] !== r ||
    _[34] !== a ||
    _[35] !== E
  )
    (u_ = r
      ? G$.default.createElement(
          B,
          { width: oH, marginTop: z ? 0 : 1, flexShrink: 0 },
          G$.default.createElement(
            EU,
            {
              key: E,
              ref: C,
              flexDirection: 'column',
              flexShrink: 0,
              maxHeight: a,
              stickyScroll: !1,
            },
            G$.default.createElement(WC, { value: _H }, T),
          ),
        )
      : G$.default.createElement(
          B,
          {
            width: oH,
            marginTop: z ? 0 : 1,
            height: M,
            overflowY: M !== void 0 ? 'hidden' : void 0,
            flexShrink: C ? 0 : void 0,
          },
          T,
        )),
      (_[27] = _H),
      (_[28] = T),
      (_[29] = M),
      (_[30] = oH),
      (_[31] = z),
      (_[32] = C),
      (_[33] = r),
      (_[34] = a),
      (_[35] = E),
      (_[36] = u_)
  else u_ = _[36]
  let Q_
  if (
    _[37] !== E_ ||
    _[38] !== O_ ||
    _[39] !== v_ ||
    _[40] !== I_ ||
    _[41] !== V_ ||
    _[42] !== sH ||
    _[43] !== R_ ||
    _[44] !== u_
  )
    (Q_ = G$.default.createElement(
      E_,
      {
        flexDirection: w_,
        tabIndex: O_,
        autoFocus: v_,
        onKeyDown: I_,
        flexShrink: V_,
      },
      sH,
      R_,
      u_,
    )),
      (_[37] = E_),
      (_[38] = O_),
      (_[39] = v_),
      (_[40] = I_),
      (_[41] = V_),
      (_[42] = sH),
      (_[43] = R_),
      (_[44] = u_),
      (_[45] = Q_)
  else Q_ = _[45]
  return G$.default.createElement(
    YL6.Provider,
    {
      value: {
        selectedTab: G[E][0],
        width: oH,
        headerFocused: OH,
        focusHeader: TH,
        blurHeader: MH,
        registerOptIn: GH,
      },
    },
    Q_,
  )
}
function Lc3(H, _) {
  let [, q] = _
  return H + (q ? a_(q) : 0) + 2 + 1
}
function kc3(H) {
  return H - 1
}
function Vc3(H) {
  return H + 1
}
function Nc3(H) {
  return [H.props.id ?? H.props.title, H.props.title]
}
function vc3(H) {
  let _ = mV_.c(15),
    { title: q, isCurrent: K, headerFocused: O, color: T, onClick: z } = H,
    [$, Y] = G$.useState(!1),
    A = z !== void 0,
    w = K && O,
    j
  if (_[0] !== w)
    (j = { line: 0, column: 1, active: w }), (_[0] = w), (_[1] = j)
  else j = _[1]
  let J = XjH(j),
    M = T && K && O,
    D,
    f
  if (_[2] === Symbol.for('react.memo_cache_sentinel'))
    (D = () => Y(!0)), (f = () => Y(!1)), (_[2] = D), (_[3] = f)
  else (D = _[2]), (f = _[3])
  let X
  if (
    _[4] !== A ||
    _[5] !== T ||
    _[6] !== M ||
    _[7] !== $ ||
    _[8] !== K ||
    _[9] !== q
  )
    (X = M
      ? G$.default.createElement(yj, { color: T, bold: !0, padded: !0 }, q)
      : G$.default.createElement(
          V,
          { inverse: K, bold: K, underline: $ && A },
          ' ',
          q,
          ' ',
        )),
      (_[4] = A),
      (_[5] = T),
      (_[6] = M),
      (_[7] = $),
      (_[8] = K),
      (_[9] = q),
      (_[10] = X)
  else X = _[10]
  let P
  if (_[11] !== J || _[12] !== z || _[13] !== X)
    (P = G$.default.createElement(
      B,
      { ref: J, onClick: z, onMouseEnter: D, onMouseLeave: f },
      X,
    )),
      (_[11] = J),
      (_[12] = z),
      (_[13] = X),
      (_[14] = P)
  else P = _[14]
  return P
}
function eO(H) {
  let _ = mV_.c(4),
    { title: q, id: K, children: O } = H,
    { selectedTab: T, width: z } = G$.useContext(YL6),
    $ = OJ()
  if (T !== (K ?? q)) return null
  let Y = $ ? 0 : void 0,
    A
  if (_[0] !== O || _[1] !== Y || _[2] !== z)
    (A = G$.default.createElement(B, { width: z, flexShrink: Y }, O)),
      (_[0] = O),
      (_[1] = Y),
      (_[2] = z),
      (_[3] = A)
  else A = _[3]
  return A
}
function XkK() {
  let { width: H } = G$.useContext(YL6)
  return H
}
function QX() {
  let H = mV_.c(6),
    {
      headerFocused: _,
      focusHeader: q,
      blurHeader: K,
      registerOptIn: O,
    } = G$.useContext(YL6),
    T
  if (H[0] !== O) (T = [O]), (H[0] = O), (H[1] = T)
  else T = H[1]
  G$.useLayoutEffect(O, T)
  let z
  if (H[2] !== K || H[3] !== q || H[4] !== _)
    (z = { headerFocused: _, focusHeader: q, blurHeader: K }),
      (H[2] = K),
      (H[3] = q),
      (H[4] = _),
      (H[5] = z)
  else z = H[5]
  return z
}
var mV_, G$, YL6
var hG = R(() => {
  aM()
  U9()
  uSH()
  JJ_()
  eq6()
  T96()
  O4()
  iH()
  kq()
  Mc()
  ;(mV_ = p(q_(), 1)),
    (G$ = p(PH(), 1)),
    (YL6 = G$.createContext({
      selectedTab: void 0,
      width: void 0,
      headerFocused: !1,
      focusHeader: () => {},
      blurHeader: () => {},
      registerOptIn: () => () => {},
    }))
})
function Xl() {
  let H = o8()?.autoUpdatesChannel
  if (H && H !== 'latest') return H
  return 'latest'
}
var tXH = R(() => {
  i6()
  M8()
})
function hc3(H, _) {
  switch (H) {
    case 'grid':
      return 3 * _ + 1
    case 'simple':
      return 3 * _ - 1
    case 'minimal':
    case 'plain':
      return Dr8 * (_ - 1)
  }
}
function Ec3(H) {
  if (typeof H === 'string' || typeof H === 'number') return !0
  if (R$.isValidElement(H) && H.type === R$.Fragment) return !0
  return !1
}
function Sc3(H, _, q) {
  if (!Ec3(H)) return H
  return R$.default.createElement(
    V,
    { dimColor: _.dim && !q, bold: _.bold || q },
    H,
  )
}
function PkK(H) {
  return a_(pkH(H))
}
function Cc3(H, _, q, K, O) {
  let T = H.length,
    z = H.map((A, w) => {
      let j = q ? PkK(A.header) : 0
      for (let J of _) j = Math.max(j, PkK(J[w]))
      return j
    }),
    $ = Array(T),
    Y = []
  for (let A = 0; A < T; A++) {
    let w = H[A].width
    if (typeof w === 'number') $[A] = w
    else if (w && 'ratio' in w && w.ratio !== void 0) Y.push(A), ($[A] = 0)
    else if (w) $[A] = pY(z[A], w.min ?? 0, w.max ?? 1 / 0)
    else $[A] = z[A]
  }
  if (Y.length > 0) {
    let A = $.reduce((J, M) => J + M, 0),
      w = Math.max(0, K - hc3(O, T) - A),
      j = Y.reduce((J, M) => J + (H[M].width.ratio ?? 0), 0)
    for (let J of Y) {
      let M = H[J].width,
        D = j > 0 ? Math.floor((w * (M.ratio ?? 0)) / j) : 0
      $[J] = pY(D, M.min ?? 1, M.max ?? 1 / 0)
    }
  }
  return $
}
function Ic3(H) {
  let _ = lSH.c(2),
    { box: q } = H
  if (q === 'grid' || q === 'simple') {
    let O
    if (_[0] === Symbol.for('react.memo_cache_sentinel'))
      (O = R$.default.createElement(V, { dimColor: !0 }, ' \u2502 ')),
        (_[0] = O)
    else O = _[0]
    return O
  }
  let K
  if (_[1] === Symbol.for('react.memo_cache_sentinel'))
    (K = R$.default.createElement(B, { width: Dr8, flexShrink: 0 })), (_[1] = K)
  else K = _[1]
  return K
}
function WkK(H) {
  let _ = lSH.c(3),
    { box: q, side: K } = H
  if (q === 'grid') {
    let O = K === 'left' ? '\u2502 ' : ' \u2502',
      T
    if (_[0] !== O)
      (T = R$.default.createElement(V, { dimColor: !0 }, O)),
        (_[0] = O),
        (_[1] = T)
    else T = _[1]
    return T
  }
  if (q === 'simple') {
    let O
    if (_[2] === Symbol.for('react.memo_cache_sentinel'))
      (O = R$.default.createElement(V, null, ' ')), (_[2] = O)
    else O = _[2]
    return O
  }
  return null
}
function Mr8(H) {
  let _ = lSH.c(19),
    { box: q, type: K, widths: O } = H
  if (q === 'minimal') {
    let J
    if (_[0] !== O) (J = O.map(xc3)), (_[0] = O), (_[1] = J)
    else J = _[1]
    let M
    if (_[2] !== J)
      (M = R$.default.createElement(B, { flexDirection: 'row' }, J)),
        (_[2] = J),
        (_[3] = M)
    else M = _[3]
    return M
  }
  let T, z, $, Y, A, w
  if (_[4] !== q || _[5] !== K || _[6] !== O) {
    w = Symbol.for('react.early_return_sentinel')
    H: {
      let J = O.map(bc3)
      if (q === 'simple') {
        w = R$.default.createElement(V, { dimColor: !0 }, J.join('\u253C'))
        break H
      }
      let [M, D, f] =
        K === 'top'
          ? ['\u250C', '\u252C', '\u2510']
          : K === 'bottom'
            ? ['\u2514', '\u2534', '\u2518']
            : ['\u251C', '\u253C', '\u2524']
      ;(z = f), (T = V), ($ = !0), (Y = M), (A = J.join(D))
    }
    ;(_[4] = q),
      (_[5] = K),
      (_[6] = O),
      (_[7] = T),
      (_[8] = z),
      (_[9] = $),
      (_[10] = Y),
      (_[11] = A),
      (_[12] = w)
  } else
    (T = _[7]), (z = _[8]), ($ = _[9]), (Y = _[10]), (A = _[11]), (w = _[12])
  if (w !== Symbol.for('react.early_return_sentinel')) return w
  let j
  if (_[13] !== T || _[14] !== z || _[15] !== $ || _[16] !== Y || _[17] !== A)
    (j = R$.default.createElement(T, { dimColor: $ }, Y, A, z)),
      (_[13] = T),
      (_[14] = z),
      (_[15] = $),
      (_[16] = Y),
      (_[17] = A),
      (_[18] = j)
  else j = _[18]
  return j
}
function bc3(H) {
  return '\u2500'.repeat(H + 2)
}
function xc3(H, _) {
  return R$.default.createElement(
    R$.default.Fragment,
    { key: _ },
    _ > 0 && R$.default.createElement(B, { width: Dr8, flexShrink: 0 }),
    R$.default.createElement(V, { dimColor: !0 }, '\u2500'.repeat(H)),
  )
}
function ZkK(H) {
  let _ = lSH.c(19),
    { cells: q, columns: K, widths: O, box: T, isHeader: z } = H,
    $
  if (_[0] !== T)
    ($ = R$.default.createElement(WkK, { box: T, side: 'left' })),
      (_[0] = T),
      (_[1] = $)
  else $ = _[1]
  let Y
  if (_[2] !== T || _[3] !== q || _[4] !== K || _[5] !== z || _[6] !== O) {
    let j
    if (_[8] !== T || _[9] !== q || _[10] !== z || _[11] !== O)
      (j = (J, M) =>
        R$.default.createElement(
          R$.default.Fragment,
          { key: M },
          M > 0 && R$.default.createElement(Ic3, { box: T }),
          R$.default.createElement(
            B,
            {
              width: O[M] || void 0,
              flexShrink: 0,
              justifyContent: yc3[J.align ?? 'start'],
            },
            Sc3(q[M], J, z),
          ),
        )),
        (_[8] = T),
        (_[9] = q),
        (_[10] = z),
        (_[11] = O),
        (_[12] = j)
    else j = _[12]
    ;(Y = K.map(j)),
      (_[2] = T),
      (_[3] = q),
      (_[4] = K),
      (_[5] = z),
      (_[6] = O),
      (_[7] = Y)
  } else Y = _[7]
  let A
  if (_[13] !== T)
    (A = R$.default.createElement(WkK, { box: T, side: 'right' })),
      (_[13] = T),
      (_[14] = A)
  else A = _[14]
  let w
  if (_[15] !== $ || _[16] !== Y || _[17] !== A)
    (w = R$.default.createElement(B, { flexDirection: 'row' }, $, Y, A)),
      (_[15] = $),
      (_[16] = Y),
      (_[17] = A),
      (_[18] = w)
  else w = _[18]
  return w
}
function uc3(H) {
  let _ = lSH.c(2),
    { children: q } = H,
    K
  if (_[0] !== q)
    (K = R$.default.createElement(R$.default.Fragment, null, q)),
      (_[0] = q),
      (_[1] = K)
  else K = _[1]
  return K
}
function mc3(H) {
  let _ = lSH.c(22),
    { box: q, columns: K, children: O, forceWidth: T } = H,
    z = q === void 0 ? 'plain' : q,
    { columns: $ } = K8(),
    Y = T ?? $,
    A,
    w,
    j,
    J,
    M,
    D,
    f
  if (_[0] !== z || _[1] !== O || _[2] !== K || _[3] !== Y) {
    let G = R$.Children.toArray(O).filter(R$.isValidElement),
      W = G.map(Uc3),
      Z = K.some(Bc3)
    ;(f = Cc3(K, W, Z, Y, z)),
      (A = B),
      (w = 'column'),
      (j =
        z === 'grid' &&
        R$.default.createElement(Mr8, { box: z, type: 'top', widths: f })),
      (J =
        Z &&
        R$.default.createElement(ZkK, {
          cells: K.map(pc3),
          columns: K,
          widths: f,
          box: z,
          isHeader: !0,
        })),
      (M =
        Z &&
        z !== 'plain' &&
        R$.default.createElement(Mr8, { box: z, type: 'header', widths: f })),
      (D = W.map((L, k) =>
        R$.default.createElement(ZkK, {
          key: G[k].key ?? k,
          cells: L,
          columns: K,
          widths: f,
          box: z,
          isHeader: !1,
        }),
      )),
      (_[0] = z),
      (_[1] = O),
      (_[2] = K),
      (_[3] = Y),
      (_[4] = A),
      (_[5] = w),
      (_[6] = j),
      (_[7] = J),
      (_[8] = M),
      (_[9] = D),
      (_[10] = f)
  } else
    (A = _[4]),
      (w = _[5]),
      (j = _[6]),
      (J = _[7]),
      (M = _[8]),
      (D = _[9]),
      (f = _[10])
  let X
  if (_[11] !== z || _[12] !== f)
    (X =
      z === 'grid' &&
      R$.default.createElement(Mr8, { box: z, type: 'bottom', widths: f })),
      (_[11] = z),
      (_[12] = f),
      (_[13] = X)
  else X = _[13]
  let P
  if (
    _[14] !== A ||
    _[15] !== w ||
    _[16] !== j ||
    _[17] !== J ||
    _[18] !== M ||
    _[19] !== D ||
    _[20] !== X
  )
    (P = R$.default.createElement(A, { flexDirection: w }, j, J, M, D, X)),
      (_[14] = A),
      (_[15] = w),
      (_[16] = j),
      (_[17] = J),
      (_[18] = M),
      (_[19] = D),
      (_[20] = X),
      (_[21] = P)
  else P = _[21]
  return P
}
function pc3(H) {
  return H.header
}
function Bc3(H) {
  return H.header !== void 0
}
function Uc3(H) {
  return R$.Children.toArray(H.props.children)
}
var lSH,
  R$,
  yc3,
  Dr8 = 2,
  cT
var nSH = R(() => {
  U9()
  lQ()
  O4()
  iH()
  Sf8()
  ;(lSH = p(q_(), 1)),
    (R$ = p(PH(), 1)),
    (yc3 = { start: 'flex-start', center: 'center', end: 'flex-end' })
  cT = Object.assign(mc3, { Row: uc3 })
})
function Fc3() {
  let H = h_(),
    q =
      W$(H) ??
      IU(H) ??
      c1.createElement(V, { dimColor: !0 }, '/rename to add a name')
  return [
    {
      label: 'Version',
      value: `${{ ISSUES_EXPLAINER: 'report the issue at https://github.com/anthropics/claude-code/issues', PACKAGE_URL: '@anthropic-ai/claude-code', README_URL: 'https://code.claude.com/docs/en/overview', VERSION: '2.1.153', FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues', BUILD_TIME: '2026-05-27T20:03:21Z', GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2' }.VERSION}${zS()}`,
    },
    ...[],
    { label: 'Session name', value: q },
    { label: 'Session ID', value: H },
    ...[],
    ...[],
    { label: 'cwd', value: S_() },
    ...NM6(),
    ...Qc3(),
    ...vM6(),
  ]
}
function gc3(H) {
  switch (H) {
    case 'hipaa':
      return 'HIPAA'
    case 'zdr':
      return 'ZDR (Zero Data Retention)'
    default:
      return (
        N(`Unknown compliance_taint '${H}' from policyLimits`, {
          level: 'warn',
        }),
        H
      )
  }
}
function Qc3() {
  let H = gz9()
  return H.length > 0 ? [{ label: 'Compliance', value: H.map(gc3) }] : []
}
function dc3({ mainLoopModel: H, mcp: _, theme: q, context: K }) {
  return [
    { label: 'Model', value: pc7(H) },
    ...Cc7(_.clients, K.options.ideInstallationStatus, q),
    ...Ic7(_.clients, q),
    ...Sc7(),
    ...xc7(),
  ]
}
async function GkK() {
  return [...(await uc7()), ...(await mc7()), ...(await bc7())]
}
function cc3(H) {
  let _ = AL6.c(8),
    { value: q } = H
  if (Array.isArray(q)) {
    let K
    if (_[0] !== q) {
      let T
      if (_[2] !== q.length)
        (T = (z, $) =>
          c1.createElement(V, { key: $ }, z, $ < q.length - 1 ? ',' : '')),
          (_[2] = q.length),
          (_[3] = T)
      else T = _[3]
      ;(K = q.map(T)), (_[0] = q), (_[1] = K)
    } else K = _[1]
    let O
    if (_[4] !== K)
      (O = c1.createElement(
        B,
        { flexWrap: 'wrap', columnGap: 1, flexShrink: 99 },
        K,
      )),
        (_[4] = K),
        (_[5] = O)
    else O = _[5]
    return O
  }
  if (typeof q === 'string') {
    let K
    if (_[6] !== q) (K = c1.createElement(V, null, q)), (_[6] = q), (_[7] = K)
    else K = _[7]
    return K
  }
  return q
}
function RkK(H) {
  let _ = AL6.c(21),
    { context: q, diagnosticsPromise: K } = H,
    O = M_(rc3),
    T = M_(ic3),
    [z] = i7(),
    $
  if (_[0] === Symbol.for('react.memo_cache_sentinel')) ($ = Fc3()), (_[0] = $)
  else $ = _[0]
  let Y
  if (_[1] !== q || _[2] !== O || _[3] !== T || _[4] !== z)
    (Y = dc3({ mainLoopModel: O, mcp: T, theme: z, context: q })),
      (_[1] = q),
      (_[2] = O),
      (_[3] = T),
      (_[4] = z),
      (_[5] = Y)
  else Y = _[5]
  let A
  if (_[6] !== Y) (A = [$, Y]), (_[6] = Y), (_[7] = A)
  else A = _[7]
  let w = A,
    j = OJ() ? 1 : void 0,
    J
  if (_[8] === Symbol.for('react.memo_cache_sentinel'))
    (J = [{ bold: !0 }, {}]), (_[8] = J)
  else J = _[8]
  let M
  if (_[9] !== w)
    (M = c1.createElement(
      cT,
      { box: 'plain', columns: J },
      w.filter(nc3).flatMap(lc3),
    )),
      (_[9] = w),
      (_[10] = M)
  else M = _[10]
  let D
  if (_[11] !== K)
    (D = c1.createElement(
      wL6.Suspense,
      { fallback: null },
      c1.createElement(oc3, { promise: K }),
    )),
      (_[11] = K),
      (_[12] = D)
  else D = _[12]
  let f
  if (_[13] !== j || _[14] !== M || _[15] !== D)
    (f = c1.createElement(
      B,
      { flexDirection: 'column', gap: 1, flexGrow: j },
      M,
      D,
    )),
      (_[13] = j),
      (_[14] = M),
      (_[15] = D),
      (_[16] = f)
  else f = _[16]
  let X
  if (_[17] === Symbol.for('react.memo_cache_sentinel'))
    (X = c1.createElement(
      V,
      { dimColor: !0 },
      c1.createElement(o6, {
        action: 'confirm:no',
        context: 'Settings',
        fallback: 'Esc',
        description: 'cancel',
      }),
    )),
      (_[17] = X)
  else X = _[17]
  let P
  if (_[18] !== j || _[19] !== f)
    (P = c1.createElement(
      B,
      { flexDirection: 'column', gap: 1, flexGrow: j },
      f,
      X,
    )),
      (_[18] = j),
      (_[19] = f),
      (_[20] = P)
  else P = _[20]
  return P
}
function lc3(H, _) {
  return [
    _ > 0 &&
      c1.createElement(
        cT.Row,
        { key: `gap-${_}` },
        c1.createElement(c1.Fragment, null, ' '),
        c1.createElement(c1.Fragment, null, ''),
      ),
    ...H.map((q, K) => {
      let { label: O, value: T } = q
      return c1.createElement(
        cT.Row,
        { key: `${_}-${K}` },
        c1.createElement(c1.Fragment, null, O !== void 0 ? `${O}:` : ''),
        c1.createElement(cc3, { value: T }),
      )
    }),
  ]
}
function nc3(H) {
  return H.length > 0
}
function ic3(H) {
  return H.mcp
}
function rc3(H) {
  return H.mainLoopModel
}
function oc3(H) {
  let _ = AL6.c(5),
    { promise: q } = H,
    K = wL6.use(q)
  if (K.length === 0) return null
  let O
  if (_[0] === Symbol.for('react.memo_cache_sentinel'))
    (O = c1.createElement(V, { bold: !0 }, 'System diagnostics')), (_[0] = O)
  else O = _[0]
  let T
  if (_[1] !== K) (T = K.map(ac3)), (_[1] = K), (_[2] = T)
  else T = _[2]
  let z
  if (_[3] !== T)
    (z = c1.createElement(
      B,
      { flexDirection: 'column', paddingBottom: 1 },
      O,
      T,
    )),
      (_[3] = T),
      (_[4] = z)
  else z = _[4]
  return z
}
function ac3(H, _) {
  return c1.createElement(
    B,
    { key: _, flexDirection: 'row', gap: 1, paddingX: 1 },
    c1.createElement(Uq, { status: 'warning' }),
    typeof H === 'string' ? c1.createElement(V, { wrap: 'wrap' }, H) : H,
  )
}
var AL6, c1, wL6
var LkK = R(() => {
  J_()
  aM()
  iH()
  hr_()
  i8()
  Dq()
  lH()
  C4()
  tXH()
  YK()
  DI8()
  E4()
  xT()
  nSH()
  ;(AL6 = p(q_(), 1)), (c1 = p(PH(), 1)), (wL6 = p(PH(), 1))
})
function VkK({
  isDisabled: H = !1,
  visibleOptionCount: _ = 5,
  options: q,
  defaultValue: K = [],
  onChange: O,
  onCancel: T,
  onFocus: z,
  focusValue: $,
  submitButtonText: Y,
  onSubmit: A,
  onDownFromLastItem: w,
  onUpFromFirstItem: j,
  initialFocusLast: J,
  hideIndexes: M = !1,
}) {
  let [D, f] = eXH.useState(K),
    [X, P] = eXH.useState(!1),
    [G, W] = eXH.useState(q)
  if (q !== G && !kkK.isDeepStrictEqual(q, G)) f(K), W(q)
  let [Z, L] = eXH.useState(() => {
      let C = new Map()
      return (
        q.forEach(I => {
          if (I.type === 'input' && I.initialValue)
            C.set(I.value, I.initialValue)
        }),
        C
      )
    }),
    k = eXH.useCallback(
      C => {
        let I = typeof C === 'function' ? C(D) : C
        f(I), O?.(I)
      },
      [D, O],
    ),
    v = I76({
      visibleOptionCount: _,
      options: q,
      initialFocusValue: J ? q[q.length - 1]?.value : void 0,
      onFocus: z,
      focusValue: $,
    })
  U$('multi-select')
  let E = eXH.useCallback(
    (C, I) => {
      L(m => {
        let S = new Map(m)
        return S.set(C, I), S
      })
      let b = q.find(m => m.value === C)
      if (b && b.type === 'input') b.onChange(I)
      k(m => {
        if (I) {
          if (!m.includes(C)) return [...m, C]
          return m
        } else return m.filter(S => S !== C)
      })
    },
    [q, k],
  )
  return {
    ...v,
    selectedValues: D,
    inputValues: Z,
    isSubmitFocused: X,
    updateInputValue: E,
    onCancel: T,
    handleKeyDown: C => {
      if (H) return
      let I = Zb_(C.key),
        m = q.find(x => x.value === v.focusedValue)?.type === 'input'
      if (m) {
        if (
          !(
            C.key === 'up' ||
            C.key === 'down' ||
            C.key === 'escape' ||
            C.key === 'tab' ||
            C.key === 'return' ||
            (C.ctrl && (C.key === 'n' || C.key === 'p' || C.key === 'return'))
          )
        )
          return
      }
      let S = q[q.length - 1]?.value
      if (C.key === 'tab' && !C.shift) {
        if ((C.preventDefault(), Y && A && v.focusedValue === S && !X)) P(!0)
        else if (!X) v.focusNextOption()
        return
      }
      if (C.key === 'tab' && C.shift) {
        if ((C.preventDefault(), Y && A && X)) P(!1), v.focusOption(S)
        else v.focusPreviousOption()
        return
      }
      if (
        C.key === 'down' ||
        (C.ctrl && C.key === 'n') ||
        (!C.ctrl && !C.shift && C.key === 'j')
      ) {
        if ((C.preventDefault(), X && w)) w()
        else if (Y && A && v.focusedValue === S && !X) P(!0)
        else if (!Y && w && v.focusedValue === S) w()
        else if (!X) v.focusNextOption()
        return
      }
      if (
        C.key === 'up' ||
        (C.ctrl && C.key === 'p') ||
        (!C.ctrl && !C.shift && C.key === 'k')
      ) {
        if ((C.preventDefault(), Y && A && X)) P(!1), v.focusOption(S)
        else if (j && v.focusedValue === q[0]?.value) j()
        else v.focusPreviousOption()
        return
      }
      if (C.key === 'pagedown') {
        C.preventDefault(), v.focusNextPage()
        return
      }
      if (C.key === 'pageup') {
        C.preventDefault(), v.focusPreviousPage()
        return
      }
      if (C.key === 'return' || bzH(C.key) === ' ') {
        if ((C.preventDefault(), C.ctrl && C.key === 'return' && m && A)) {
          A(D)
          return
        }
        if (X && A) {
          A(D)
          return
        }
        if (C.key === 'return' && !Y && A) {
          A(D)
          return
        }
        if (v.focusedValue !== void 0) {
          let x = D.includes(v.focusedValue)
            ? D.filter(U => U !== v.focusedValue)
            : [...D, v.focusedValue]
          k(x)
        }
        return
      }
      if (!M && /^[0-9]$/.test(I)) {
        C.preventDefault()
        let x = parseInt(I) - 1
        if (x >= 0 && x < q.length) {
          let U = q[x].value,
            g = D.includes(U) ? D.filter(Q => Q !== U) : [...D, U]
          k(g)
        }
        return
      }
      if (C.key === 'escape') T(), C.stopImmediatePropagation()
    },
  }
}
var eXH, kkK
var NkK = R(() => {
  wf()
  R8()
  uf8()
  ;(eXH = p(PH(), 1)), (kkK = require('util'))
})
function HPH(H) {
  let _ = vkK.c(51),
    {
      isDisabled: q,
      visibleOptionCount: K,
      options: O,
      defaultValue: T,
      onCancel: z,
      onChange: $,
      onFocus: Y,
      focusValue: A,
      submitButtonText: w,
      onSubmit: j,
      onDownFromLastItem: J,
      onUpFromFirstItem: M,
      initialFocusLast: D,
      onOpenEditor: f,
      hideIndexes: X,
      onImagePaste: P,
      pastedContents: G,
      onRemoveImage: W,
    } = H,
    Z = q === void 0 ? !1 : q,
    L = K === void 0 ? 5 : K,
    k
  if (_[0] !== T) (k = T === void 0 ? [] : T), (_[0] = T), (_[1] = k)
  else k = _[1]
  let v = k,
    E = X === void 0 ? !1 : X,
    h = O.some(tc3),
    C = pf8(L, h ? 'compact-vertical' : 'compact'),
    I
  if (
    _[2] !== v ||
    _[3] !== A ||
    _[4] !== E ||
    _[5] !== D ||
    _[6] !== Z ||
    _[7] !== z ||
    _[8] !== $ ||
    _[9] !== J ||
    _[10] !== Y ||
    _[11] !== j ||
    _[12] !== M ||
    _[13] !== O ||
    _[14] !== w ||
    _[15] !== C
  )
    (I = {
      isDisabled: Z,
      visibleOptionCount: C,
      options: O,
      defaultValue: v,
      onChange: $,
      onCancel: z,
      onFocus: Y,
      focusValue: A,
      submitButtonText: w,
      onSubmit: j,
      onDownFromLastItem: J,
      onUpFromFirstItem: M,
      initialFocusLast: D,
      hideIndexes: E,
    }),
      (_[2] = v),
      (_[3] = A),
      (_[4] = E),
      (_[5] = D),
      (_[6] = Z),
      (_[7] = z),
      (_[8] = $),
      (_[9] = J),
      (_[10] = Y),
      (_[11] = j),
      (_[12] = M),
      (_[13] = O),
      (_[14] = w),
      (_[15] = C),
      (_[16] = I)
  else I = _[16]
  let b = VkK(I),
    m = PV.useRef(null)
  TB(m, !Z)
  let S, x, U, g, Q, l, d
  if (
    _[17] !== E ||
    _[18] !== Z ||
    _[19] !== z ||
    _[20] !== P ||
    _[21] !== f ||
    _[22] !== W ||
    _[23] !== O.length ||
    _[24] !== G ||
    _[25] !== b
  ) {
    let _H = O.length.toString().length
    if (
      ((x = B),
      (U = 'column'),
      (g = m),
      _[33] !== Z || _[34] !== b.handleKeyDown)
    )
      (Q = Z ? {} : { tabIndex: 0, onKeyDown: b.handleKeyDown }),
        (_[33] = Z),
        (_[34] = b.handleKeyDown),
        (_[35] = Q)
    else Q = _[35]
    ;(S = B),
      (l = 'column'),
      (d = b.visibleOptions.map((HH, t) => {
        let jH = !Z && b.focusedValue === HH.value && !b.isSubmitFocused,
          KH = b.selectedValues.includes(HH.value),
          qH = HH.index === b.visibleFromIndex,
          OH = HH.index === b.visibleToIndex - 1,
          zH = b.visibleToIndex < O.length,
          $H = b.visibleFromIndex > 0,
          TH = b.visibleFromIndex + t + 1
        if (HH.type === 'input') {
          let YH = b.inputValues.get(HH.value) || ''
          return PV.default.createElement(
            B,
            { key: String(HH.value), gap: 1 },
            PV.default.createElement(
              McH,
              {
                option: HH,
                isFocused: jH,
                isSelected: !1,
                shouldShowDownArrow: zH && OH,
                shouldShowUpArrow: $H && qH,
                maxIndexWidth: _H,
                index: TH,
                inputValue: YH,
                onInputChange: MH => {
                  b.updateInputValue(HH.value, MH)
                },
                onSubmit: sc3,
                onExit: () => {
                  z()
                },
                layout: 'compact',
                onOpenEditor: f,
                onImagePaste: P,
                pastedContents: G,
                onRemoveImage: W,
              },
              PV.default.createElement(
                V,
                { color: KH ? 'success' : void 0 },
                '[',
                KH ? __.tick : ' ',
                ']',
                ' ',
              ),
            ),
          )
        }
        return PV.default.createElement(
          B,
          { key: String(HH.value), gap: 1 },
          PV.default.createElement(
            GjH,
            {
              isFocused: jH,
              isSelected: !1,
              shouldShowDownArrow: zH && OH,
              shouldShowUpArrow: $H && qH,
              description: HH.description,
            },
            !E &&
              PV.default.createElement(
                V,
                { dimColor: !0 },
                `${TH}.`.padEnd(_H),
              ),
            PV.default.createElement(
              V,
              { color: KH ? 'success' : void 0 },
              '[',
              KH ? __.tick : ' ',
              ']',
            ),
            PV.default.createElement(
              V,
              { color: jH ? 'suggestion' : void 0 },
              HH.label,
            ),
          ),
        )
      })),
      (_[17] = E),
      (_[18] = Z),
      (_[19] = z),
      (_[20] = P),
      (_[21] = f),
      (_[22] = W),
      (_[23] = O.length),
      (_[24] = G),
      (_[25] = b),
      (_[26] = S),
      (_[27] = x),
      (_[28] = U),
      (_[29] = g),
      (_[30] = Q),
      (_[31] = l),
      (_[32] = d)
  } else
    (S = _[26]),
      (x = _[27]),
      (U = _[28]),
      (g = _[29]),
      (Q = _[30]),
      (l = _[31]),
      (d = _[32])
  let r
  if (_[36] !== S || _[37] !== l || _[38] !== d)
    (r = PV.default.createElement(S, { flexDirection: l }, d)),
      (_[36] = S),
      (_[37] = l),
      (_[38] = d),
      (_[39] = r)
  else r = _[39]
  let a
  if (_[40] !== j || _[41] !== b.isSubmitFocused || _[42] !== w)
    (a =
      w &&
      j &&
      PV.default.createElement(
        B,
        { marginTop: 0, gap: 1 },
        b.isSubmitFocused
          ? PV.default.createElement(V, { color: 'suggestion' }, __.pointer)
          : PV.default.createElement(V, null, ' '),
        PV.default.createElement(
          B,
          { marginLeft: 3 },
          PV.default.createElement(
            V,
            { color: b.isSubmitFocused ? 'suggestion' : void 0, bold: !0 },
            w,
          ),
        ),
      )),
      (_[40] = j),
      (_[41] = b.isSubmitFocused),
      (_[42] = w),
      (_[43] = a)
  else a = _[43]
  let s
  if (
    _[44] !== x ||
    _[45] !== U ||
    _[46] !== g ||
    _[47] !== Q ||
    _[48] !== r ||
    _[49] !== a
  )
    (s = PV.default.createElement(x, { flexDirection: U, ref: g, ...Q }, r, a)),
      (_[44] = x),
      (_[45] = U),
      (_[46] = g),
      (_[47] = Q),
      (_[48] = r),
      (_[49] = a),
      (_[50] = s)
  else s = _[50]
  return s
}
function sc3() {}
function tc3(H) {
  return H.description
}
var vkK, PV
var pV_ = R(() => {
  k9()
  bkH()
  iH()
  nK()
  bf8()
  E76()
  NkK()
  ;(vkK = p(q_(), 1)), (PV = p(PH(), 1))
})
var GM = R(() => {
  pV_()
  nK()
})
function G__(H) {
  let _ = ykK.c(88),
    {
      onThemeSelect: q,
      showIntroText: K,
      helpText: O,
      showHelpTextBelow: T,
      hideEscToCancel: z,
      skipExitHandling: $,
      onCancel: Y,
      onCustomTheme: A,
    } = H,
    w = K === void 0 ? !1 : K,
    j = O === void 0 ? '' : O,
    J = T === void 0 ? !1 : T,
    M = z === void 0 ? !1 : z,
    D = $ === void 0 ? !1 : $,
    [f] = i7(),
    X = gQH(),
    { columns: P } = K8(),
    G
  if (_[0] === Symbol.for('react.memo_cache_sentinel')) (G = TZ_()), (_[0] = G)
  else G = _[0]
  let W = G,
    Z
  if (_[1] !== f) (Z = W === null ? Fo7(f) : null), (_[1] = f), (_[2] = Z)
  else Z = _[2]
  let L = Z,
    { setPreviewTheme: k, savePreview: v, cancelPreview: E } = y86(),
    h = M_(_l3) ?? !1,
    C = qq()
  R76('ThemePicker')
  let I = v1('theme:toggleSyntaxHighlighting', 'ThemePicker', 'ctrl+t'),
    b
  if (_[3] !== C || _[4] !== h)
    (b = () => {
      if (W === null) {
        let eH = !h
        g8('userSettings', { syntaxHighlightingDisabled: eH }),
          C(H_ => ({
            ...H_,
            settings: { ...H_.settings, syntaxHighlightingDisabled: eH },
          }))
      }
    }),
      (_[3] = C),
      (_[4] = h),
      (_[5] = b)
  else b = _[5]
  let m
  if (_[6] === Symbol.for('react.memo_cache_sentinel'))
    (m = { context: 'ThemePicker' }), (_[6] = m)
  else m = _[6]
  _8('theme:toggleSyntaxHighlighting', b, m)
  let S = DT(D ? Hl3 : void 0),
    { customThemes: x } = CwH(),
    [U, g] = hkK.useState(X),
    Q
  if (_[7] !== U) (Q = ywH(U)), (_[7] = U), (_[8] = Q)
  else Q = _[8]
  let l = Q,
    d
  if (_[9] !== x || _[10] !== l)
    (d = l ? x.find(eH => eH.slug === l) : void 0),
      (_[9] = x),
      (_[10] = l),
      (_[11] = d)
  else d = _[11]
  let r = d,
    a = v1('theme:editCustom', 'ThemePicker', 'ctrl+e'),
    s
  if (_[12] !== r || _[13] !== A || _[14] !== v)
    (s = () => {
      if (r && A) v(), A(r)
    }),
      (_[12] = r),
      (_[13] = A),
      (_[14] = v),
      (_[15] = s)
  else s = _[15]
  let _H
  if (_[16] === Symbol.for('react.memo_cache_sentinel'))
    (_H = { context: 'ThemePicker' }), (_[16] = _H)
  else _H = _[16]
  _8('theme:editCustom', s, _H)
  let HH, t, jH, KH, qH, OH, zH
  if (_[17] === Symbol.for('react.memo_cache_sentinel'))
    (HH = { label: 'Auto (match terminal)', value: 'auto' }),
      (t = { label: 'Dark mode', value: 'dark' }),
      (jH = { label: 'Light mode', value: 'light' }),
      (KH = {
        label: 'Dark mode (colorblind-friendly)',
        value: 'dark-daltonized',
      }),
      (qH = {
        label: 'Light mode (colorblind-friendly)',
        value: 'light-daltonized',
      }),
      (OH = { label: 'Dark mode (ANSI colors only)', value: 'dark-ansi' }),
      (zH = { label: 'Light mode (ANSI colors only)', value: 'light-ansi' }),
      (_[17] = HH),
      (_[18] = t),
      (_[19] = jH),
      (_[20] = KH),
      (_[21] = qH),
      (_[22] = OH),
      (_[23] = zH)
  else
    (HH = _[17]),
      (t = _[18]),
      (jH = _[19]),
      (KH = _[20]),
      (qH = _[21]),
      (OH = _[22]),
      (zH = _[23])
  let $H
  if (_[24] !== x || _[25] !== A) {
    let eH
    if (_[27] !== A)
      (eH = A ? [{ label: 'New custom theme\u2026', value: fr8 }] : []),
        (_[27] = A),
        (_[28] = eH)
    else eH = _[28]
    ;($H = [HH, t, jH, KH, qH, OH, zH, ...x.map(ec3), ...eH]),
      (_[24] = x),
      (_[25] = A),
      (_[26] = $H)
  } else $H = _[26]
  let TH = $H,
    YH
  if (_[29] !== w)
    (YH = w
      ? y1.createElement(V, null, "Let's get started.")
      : y1.createElement(V, { bold: !0, color: 'permission' }, 'Theme')),
      (_[29] = w),
      (_[30] = YH)
  else YH = _[30]
  let MH
  if (_[31] === Symbol.for('react.memo_cache_sentinel'))
    (MH = y1.createElement(
      V,
      { bold: !0 },
      'Choose the text style that looks best with your terminal',
    )),
      (_[31] = MH)
  else MH = _[31]
  let AH
  if (_[32] !== j || _[33] !== J)
    (AH = j && !J && y1.createElement(V, { dimColor: !0 }, j)),
      (_[32] = j),
      (_[33] = J),
      (_[34] = AH)
  else AH = _[34]
  let DH
  if (_[35] !== AH)
    (DH = y1.createElement(B, { flexDirection: 'column' }, MH, AH)),
      (_[35] = AH),
      (_[36] = DH)
  else DH = _[36]
  let fH
  if (_[37] !== E || _[38] !== k)
    (fH = eH => {
      if ((g(eH), eH === fr8)) E()
      else k(eH)
    }),
      (_[37] = E),
      (_[38] = k),
      (_[39] = fH)
  else fH = _[39]
  let GH
  if (_[40] !== E || _[41] !== A || _[42] !== q || _[43] !== v)
    (GH = eH => {
      if (eH === fr8) {
        E(), A?.(void 0)
        return
      }
      v(), q(eH)
    }),
      (_[40] = E),
      (_[41] = A),
      (_[42] = q),
      (_[43] = v),
      (_[44] = GH)
  else GH = _[44]
  let JH
  if (_[45] !== E || _[46] !== Y || _[47] !== D)
    (JH = D
      ? () => {
          E(), Y?.()
        }
      : async () => {
          E(), await O7(0)
        }),
      (_[45] = E),
      (_[46] = Y),
      (_[47] = D),
      (_[48] = JH)
  else JH = _[48]
  let RH = Math.min(TH.length, 12),
    VH
  if (
    _[49] !== fH ||
    _[50] !== GH ||
    _[51] !== JH ||
    _[52] !== RH ||
    _[53] !== TH ||
    _[54] !== X
  )
    (VH = y1.createElement(s6, {
      options: TH,
      onFocus: fH,
      onChange: GH,
      onCancel: JH,
      visibleOptionCount: RH,
      defaultValue: X,
      defaultFocusValue: X,
    })),
      (_[49] = fH),
      (_[50] = GH),
      (_[51] = JH),
      (_[52] = RH),
      (_[53] = TH),
      (_[54] = X),
      (_[55] = VH)
  else VH = _[55]
  let NH
  if (_[56] !== YH || _[57] !== DH || _[58] !== VH)
    (NH = y1.createElement(B, { flexDirection: 'column', gap: 1 }, YH, DH, VH)),
      (_[56] = YH),
      (_[57] = DH),
      (_[58] = VH),
      (_[59] = NH)
  else NH = _[59]
  let dH
  if (_[60] === Symbol.for('react.memo_cache_sentinel'))
    (dH = {
      oldStart: 1,
      newStart: 1,
      oldLines: 3,
      newLines: 3,
      lines: [
        ' function greet() {',
        '-  console.log("Hello, World!");',
        '+  console.log("Hello, Claude!");',
        ' }',
      ],
    }),
      (_[60] = dH)
  else dH = _[60]
  let mH
  if (_[61] !== P)
    (mH = y1.createElement(
      Eu,
      { paddingX: 0 },
      y1.createElement(W8H, {
        patch: dH,
        dim: !1,
        filePath: 'demo.js',
        firstLine: null,
        width: P,
      }),
    )),
      (_[61] = P),
      (_[62] = mH)
  else mH = _[62]
  let cH =
      W === 'env'
        ? `Syntax highlighting disabled (via CLAUDE_CODE_SYNTAX_HIGHLIGHT=${process.env.CLAUDE_CODE_SYNTAX_HIGHLIGHT})`
        : h
          ? `Syntax highlighting disabled (${I} to enable)`
          : L
            ? `Syntax theme: ${L.theme}${L.source ? ` (from ${L.source})` : ''} (${I} to disable)`
            : `Syntax highlighting enabled (${I} to disable)`,
    tH
  if (_[63] !== cH)
    (tH = y1.createElement(V, { dimColor: !0 }, ' ', cH)),
      (_[63] = cH),
      (_[64] = tH)
  else tH = _[64]
  let K_
  if (_[65] !== mH || _[66] !== tH)
    (K_ = y1.createElement(
      B,
      { flexDirection: 'column', width: '100%' },
      mH,
      tH,
    )),
      (_[65] = mH),
      (_[66] = tH),
      (_[67] = K_)
  else K_ = _[67]
  let pH
  if (_[68] !== NH || _[69] !== K_)
    (pH = y1.createElement(B, { flexDirection: 'column', gap: 1 }, NH, K_)),
      (_[68] = NH),
      (_[69] = K_),
      (_[70] = pH)
  else pH = _[70]
  let gH = pH
  if (!w) {
    let eH
    if (_[71] !== gH)
      (eH = y1.createElement(B, { flexDirection: 'column' }, gH)),
        (_[71] = gH),
        (_[72] = eH)
    else eH = _[72]
    let H_
    if (_[73] !== j || _[74] !== J)
      (H_ =
        J &&
        j &&
        y1.createElement(
          B,
          { marginLeft: 3 },
          y1.createElement(V, { dimColor: !0 }, j),
        )),
        (_[73] = j),
        (_[74] = J),
        (_[75] = H_)
    else H_ = _[75]
    let $_
    if (_[76] !== a || _[77] !== S || _[78] !== r || _[79] !== M || _[80] !== A)
      ($_ =
        !M &&
        y1.createElement(
          B,
          null,
          y1.createElement(
            V,
            { dimColor: !0, italic: !0 },
            S.pending
              ? y1.createElement(
                  y1.Fragment,
                  null,
                  'Press ',
                  S.keyName,
                  ' again to exit',
                )
              : y1.createElement(
                  Y6,
                  null,
                  y1.createElement(z_, { chord: 'enter', action: 'select' }),
                  r && A && y1.createElement(z_, { chord: a, action: 'edit' }),
                  y1.createElement(z_, { chord: 'escape', action: 'cancel' }),
                ),
          ),
        )),
        (_[76] = a),
        (_[77] = S),
        (_[78] = r),
        (_[79] = M),
        (_[80] = A),
        (_[81] = $_)
    else $_ = _[81]
    let oH
    if (_[82] !== H_ || _[83] !== $_)
      (oH = y1.createElement(B, { marginTop: 1 }, H_, $_)),
        (_[82] = H_),
        (_[83] = $_),
        (_[84] = oH)
    else oH = _[84]
    let E_
    if (_[85] !== eH || _[86] !== oH)
      (E_ = y1.createElement(y1.Fragment, null, eH, oH)),
        (_[85] = eH),
        (_[86] = oH),
        (_[87] = E_)
    else E_ = _[87]
    return E_
  }
  return gH
}
function ec3(H) {
  return {
    label:
      H.source === 'user'
        ? `${H.name} (custom)`
        : `${H.name} (from ${H.source.plugin})`,
    value: QLH(H.slug),
  }
}
function Hl3() {}
function _l3(H) {
  return H.settings.syntaxHighlightingDisabled
}
var ykK,
  y1,
  hkK,
  fr8 = '__new_custom_theme__'
var jL6 = R(() => {
  qW()
  U9()
  iH()
  Mx()
  kq()
  g0()
  i8()
  dLH()
  pT()
  M8()
  GM()
  A9()
  zhH()
  Pq()
  tD6()
  GsH()
  ;(ykK = p(q_(), 1)), (y1 = p(PH(), 1)), (hkK = p(PH(), 1))
})
function ql3() {
  let H = b_().clientDataCache?.model_notices
  if (typeof H !== 'object' || H === null || Array.isArray(H)) return {}
  let _ = {}
  for (let [q, K] of Object.entries(H))
    if (q.trim().length > 0 && typeof K === 'string' && K.length > 0) _[q] = K
  return _
}
function EkK(H) {
  let _ = ql3()
  if (Object.keys(_).length === 0) return
  let q = H.toLowerCase(),
    K = TK(H).toLowerCase(),
    O = U7(K).toLowerCase()
  for (let [T, z] of Object.entries(_)) {
    let $ = T.toLowerCase()
    if ($ === q || $ === K || $ === O || K.includes($)) return z
  }
  return
}
var SkK = R(() => {
  n6()
  mq()
})
function bkK() {
  if (!xH(process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY)) return !1
  if (vq() !== 'firstParty') return !1
  if (qO()) return !1
  if (!process.env.ANTHROPIC_BASE_URL) return !1
  return !0
}
function xkK() {
  return Pr8.join(d6(), 'cache')
}
function ukK() {
  return Pr8.join(xkK(), 'gateway-models.json')
}
function mkK() {
  if (!bkK()) return []
  let H = Xr8(ukK())
  if (!H || H.baseUrl !== process.env.ANTHROPIC_BASE_URL) return []
  return H.models.map(_ => ({
    value: _.id,
    label: _.display_name || _.id,
    description: 'From gateway',
  }))
}
async function pkK() {
  if (!bkK()) return
  if (_K()) return
  try {
    let H = process.env.ANTHROPIC_BASE_URL
    if (!H) return
    let _ = process.env.ANTHROPIC_AUTH_TOKEN,
      q = l2()
    if (!_ && !q) return
    let K = {}
    for (let j of (process.env.ANTHROPIC_CUSTOM_HEADERS ?? '').split(/\r?\n/)) {
      let J = j.indexOf(':')
      if (J <= 0) continue
      let M = j.slice(0, J).trim(),
        D = j.slice(J + 1).trim()
      if (M && D) K[M] = D
    }
    let O = `${H.replace(/\/+$/, '')}/v1/models?limit=1000`,
      T = await fetch(O, {
        method: 'GET',
        headers: {
          ...(_
            ? { Authorization: `Bearer ${_}` }
            : q
              ? { 'x-api-key': q }
              : {}),
          'anthropic-version': '2023-06-01',
          'User-Agent': E$(),
          ...K,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(Kl3),
        ...Vw({ url: O }),
      })
    if (!T.ok) {
      N(`[gatewayDiscovery] non-OK status ${T.status}`)
      return
    }
    let z = await T.json(),
      $ = y.object({ data: y.array(IkK()) }).safeParse(z)
    if (!$.success) {
      N('[gatewayDiscovery] response body failed validation')
      return
    }
    let Y = $.data.data.filter(j => /^(claude|anthropic)/i.test(j.id))
    if (Y.length === 0) {
      N('[gatewayDiscovery] 0 usable models after filter')
      return
    }
    let A = ukK(),
      w = Xr8(A)
    if (w && w.baseUrl === H && Ww(w.models, Y)) return
    await JL6.mkdir(xkK(), { recursive: !0 }),
      await JL6.writeFile(
        A,
        CH({ baseUrl: H, fetchedAt: Date.now(), models: Y }),
        { encoding: 'utf-8', mode: 384 },
      ),
      Xr8.cache.delete(A),
      N(`[gatewayDiscovery] cached ${Y.length} models`)
  } catch (H) {
    N(
      `[gatewayDiscovery] fetch failed: ${H instanceof Error ? H.message : 'unknown'}`,
    )
  }
}
var CkK,
  JL6,
  Pr8,
  Kl3 = 3000,
  IkK,
  Ol3,
  Xr8
var Wr8 = R(() => {
  gn()
  G7()
  I8()
  jq()
  lH()
  c_()
  W3()
  gO()
  MA()
  i_()
  GK()
  ;(CkK = require('fs')),
    (JL6 = require('fs/promises')),
    (Pr8 = require('path')),
    (IkK = yH(() =>
      y.object({ id: y.string(), display_name: y.string().optional() }).strip(),
    )),
    (Ol3 = yH(() =>
      y.object({
        baseUrl: y.string(),
        fetchedAt: y.number(),
        models: y.array(IkK()),
      }),
    ))
  Xr8 = y6(
    H => {
      try {
        let _ = CkK.readFileSync(H, 'utf-8'),
          q = Ol3().safeParse(V7(_, !1))
        return q.success ? q.data : null
      } catch {
        return null
      }
    },
    H => H,
  )
})
function ML6(H) {
  if (Zq())
    return { value: null, label: 'Default (recommended)', description: Cr_(H) }
  let _ = !u$()
  return {
    value: null,
    label: _ ? 'Default' : 'Default (recommended)',
    description: `Use the default model (currently ${_z_(z0())})${_ ? '' : ` \xB7 ${_k(og)}`}`,
  }
}
function Gr8() {
  return !u$() || !qO()
}
function Zr8() {
  return RKH(GR())
}
function BkK() {
  let H = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  if (Gr8() && H) {
    let _ = $0(H)
    return {
      value: 'sonnet',
      label: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME ?? H,
      description:
        process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION ??
        `Custom Sonnet model${_ ? ' (1M context)' : ''}`,
      descriptionForModel: `${process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION ?? `Custom Sonnet model${_ ? ' with 1M context' : ''}`} (${H})`,
    }
  }
}
function UkK() {
  let H = !u$()
  return {
    value: H ? $$().sonnet46 : 'sonnet',
    label: 'Sonnet',
    description: `Sonnet 4.6 \xB7 Best for everyday tasks${H ? '' : ` \xB7 ${_k(PKH)}`}`,
    descriptionForModel:
      'Sonnet 4.6 - best for everyday tasks. Generally recommended for most coding tasks',
  }
}
function FkK() {
  let H = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  if (Gr8() && H) {
    let _ = $0(H)
    return {
      value: 'opus',
      label: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME ?? H,
      description:
        process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION ??
        `Custom Opus model${_ ? ' (1M context)' : ''}`,
      descriptionForModel: `${process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION ?? `Custom Opus model${_ ? ' with 1M context' : ''}`} (${H})`,
    }
  }
}
function Tl3() {
  return {
    value: $$().opus41,
    label: 'Opus 4.1',
    description: 'Opus 4.1 \xB7 Legacy',
    descriptionForModel: 'Opus 4.1 - legacy version',
  }
}
function ikK(H = !1, _ = !0) {
  return {
    value: !u$() ? $$().opus46 : 'claude-opus-4-6',
    label: 'Opus 4.6',
    description: `Opus 4.6 \xB7 Most capable for complex work${_ ? GKH(H) : ''}`,
    descriptionForModel: 'Opus 4.6 - most capable for complex work',
  }
}
function zl3(H = !1) {
  let _ = !u$(),
    q = Wi() ? ` \xB7 ${_k(og)}` : GKH(H)
  return {
    value: _ ? $$().opus47 : 'opus',
    label: 'Opus',
    description: `Opus 4.7 \xB7 Most capable for complex work${_ ? '' : q}`,
    descriptionForModel: 'Opus 4.7 - most capable for complex work',
  }
}
function gkK() {
  let H = !u$()
  return {
    value: H ? $$().sonnet46 + '[1m]' : 'sonnet[1m]',
    label: 'Sonnet (1M context)',
    description: `Sonnet 4.6 for long sessions${H ? '' : ` \xB7 ${_k(PKH)}`}`,
    descriptionForModel:
      'Sonnet 4.6 with 1M context window - for long sessions with large codebases',
  }
}
function rkK(H = !1, _ = !0) {
  return {
    value: !u$() ? $$().opus46 + '[1m]' : 'claude-opus-4-6[1m]',
    label: 'Opus 4.6 (1M context)',
    description: `Opus 4.6 for long sessions${_ ? GKH(H) : ''}`,
    descriptionForModel:
      'Opus 4.6 with 1M context window - for long sessions with large codebases',
  }
}
function QkK(H = !1) {
  let _ = !u$(),
    q = Wi() ? ` \xB7 ${_k(og)}` : GKH(H)
  return {
    value: _ ? $$().opus47 + '[1m]' : 'opus[1m]',
    label: 'Opus (1M context)',
    description: `Opus 4.7 for long sessions${_ ? '' : q}`,
    descriptionForModel:
      'Opus 4.7 with 1M context window - for long sessions with large codebases',
  }
}
function dkK() {
  let H = process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  if (Gr8() && H)
    return {
      value: 'haiku',
      label: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME ?? H,
      description:
        process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION ??
        'Custom Haiku model',
      descriptionForModel: `${process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION ?? 'Custom Haiku model'} (${H})`,
    }
}
function okK() {
  return {
    value: 'haiku',
    label: 'Haiku',
    description: `Haiku 4.5 \xB7 Fastest for quick answers${!u$() ? '' : ` \xB7 ${_k(e98)}`}`,
    descriptionForModel:
      'Haiku 4.5 - fastest for quick answers. Lower cost but less capable than Sonnet 4.6.',
  }
}
function $l3() {
  return {
    value: 'haiku',
    label: 'Haiku',
    description: `Haiku 3.5 for simple tasks${!u$() ? '' : ` \xB7 ${_k(t98)}`}`,
    descriptionForModel:
      'Haiku 3.5 - faster and lower cost, but less capable than Sonnet. Use for simple tasks.',
  }
}
function Yl3() {
  return SUH() === $$().haiku45 ? okK() : $l3()
}
function Rr8() {
  if (qK() === 'pro' && G_('tengu_gypsum_kite', !1))
    return ' \xB7 ~2\xD7 usage vs Sonnet'
  return ''
}
function akK(H = !1) {
  let _ = !u$()
  return {
    value: 'opus',
    label: 'Opus',
    description: `Opus 4.7 \xB7 Most capable for complex work${Rr8()}${_ || !H ? '' : ` \xB7 ${_k(og)}`}`,
  }
}
function ckK() {
  let H = !u$(),
    _ = Zq() ? ' \xB7 Draws from usage credits' : ''
  return {
    value: 'sonnet[1m]',
    label: 'Sonnet (1M context)',
    description: `Sonnet 4.6 with 1M context${_}${!(_ !== '' && !H) ? '' : ` \xB7 ${_k(PKH)}`}`,
  }
}
function lkK() {
  let H = !u$(),
    _ = Zq() ? ' \xB7 Draws from usage credits' : '',
    q = _ !== '' && !H
  return {
    value: 'opus[1m]',
    label: 'Opus (1M context)',
    description: `Opus 4.7 with 1M context${Rr8()}${_}${!q ? '' : ` \xB7 ${_k(og)}`}`,
  }
}
function skK(H = !1, _ = !1) {
  let q = !u$(),
    K = Wi() ? ` \xB7 ${_k(og)}` : GKH(_)
  return {
    value: q ? $$().opus47 + '[1m]' : 'opus[1m]',
    label: 'Opus (1M context)',
    description: `Opus 4.7 with 1M context \xB7 Most capable for complex work${Rr8()}${q || !H ? '' : K}`,
    descriptionForModel:
      'Opus 4.7 with 1M context - most capable for complex work',
  }
}
function wl3() {
  return {
    value: 'opusplan',
    label: 'Opus Plan Mode',
    description: 'Use Opus in plan mode, Sonnet otherwise',
  }
}
function jl3(H = !1) {
  if (Zq()) {
    if (Re() || wAH() || IUH()) {
      let z = [ML6(H)]
      if (!LP() && X6H() && !Zr8()) z.push(lkK())
      if ((z.push(Al3), Q5H())) z.push(ckK())
      return z.push(nkK), z
    }
    let T = [ML6(H)]
    if (Q5H()) T.push(ckK())
    if (LP()) T.push(skK(!1))
    else if ((T.push(akK(!1)), X6H() && !Zr8())) T.push(lkK())
    return T.push(nkK), T
  }
  if (u$()) {
    let T = [ML6(H)],
      z = FkK()
    if (z !== void 0) T.push(z)
    else if (!LP() && X6H() && !Zr8()) T.push(QkK(H))
    let $ = BkK()
    if ($ !== void 0) T.push($)
    else if ((T.push(UkK()), Q5H())) T.push(gkK())
    return T.push(dkK() ?? okK()), T
  }
  let _ = [ML6(H)],
    q = BkK()
  if (q !== void 0) _.push(q)
  else if ((_.push(UkK()), Q5H())) _.push(gkK())
  let K = FkK()
  if (K !== void 0) _.push(K)
  else {
    if ((_.push(Tl3()), _.push(zl3()), X6H() && !RKH($$().opus47)))
      _.push(QkK())
    if ((_.push(ikK(H, !1)), X6H())) _.push(rkK(H))
  }
  let O = dkK()
  if (O !== void 0) _.push(O)
  else _.push(Yl3())
  return _
}
function Jl3(H) {
  let _ = U7(H)
  if (_.includes('sonnet')) {
    let q = aj(WN())
    if (q) return { alias: 'Sonnet', currentVersionName: q }
  }
  if (_.includes('opus')) {
    let q = aj(GR())
    if (q) return { alias: 'Opus', currentVersionName: q }
  }
  if (_.includes('haiku')) {
    let q = aj(SUH())
    if (q) return { alias: 'Haiku', currentVersionName: q }
  }
  return null
}
function Ml3(H) {
  let _ = aj(H)
  if (!_) return null
  let q = Jl3(H)
  if (!q) return { value: H, label: _, description: H }
  if (_ !== q.currentVersionName)
    return {
      value: H,
      label: _,
      description: `Newer version available \xB7 select ${q.alias} for ${q.currentVersionName}`,
    }
  return { value: H, label: _, description: H }
}
function R__(H = !1) {
  let _ = jl3(H),
    q = process.env.ANTHROPIC_CUSTOM_MODEL_OPTION
  if (q && !_.some($ => $.value === q))
    _.push({
      value: q,
      label: process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME ?? q,
      description:
        process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION ??
        `Custom model (${q})`,
    })
  for (let $ of b_().additionalModelOptionsCache ?? [])
    if (!_.some(Y => Y.value === $.value)) _.push($)
  for (let $ of mkK()) if (!_.some(Y => Y.value === $.value)) _.push($)
  let { availableModels: K } = Gq() ?? {}
  if (K)
    for (let $ of K) {
      let Y = $.trim()
      if (!Y.startsWith('anthropic.') || _.some(A => A.value === Y)) continue
      _.push({ value: Y, label: Y, description: 'Custom model' })
    }
  let O = null,
    T = Pe(),
    z = c9H()
  if (T !== void 0 && T !== null) O = T
  else if (z !== void 0 && z !== null) O = z
  if (O === null || _.some($ => $.value === O)) return _PH(_)
  else if (O === 'opusplan') return _PH([..._, wl3()])
  else if (O === 'opus') {
    if (!u$()) {
      let $ = GR()
      return _PH(_.map(Y => (Y.value === $ ? { ...Y, value: 'opus' } : Y)))
    }
    return _PH([..._, akK(!1)])
  } else if (O === 'opus[1m]' && u$()) return _PH([..._, skK(!1)])
  else if (O === 'claude-opus-4-6' && u$()) return _PH([..._, ikK(H, !1)])
  else if (O === 'claude-opus-4-6[1m]' && u$()) return _PH([..._, rkK(H, !1)])
  else {
    let $ = Ml3(O)
    if ($) _.push($)
    else _.push({ value: O, label: O, description: 'Custom model' })
    return _PH(_)
  }
}
function _PH(H) {
  if (!(Gq() || {}).availableModels) return H
  return H.filter(q => q.value === null || (q.value !== null && ag(q.value)))
}
var Al3, nkK
var DL6 = R(() => {
  J_()
  i6()
  jq()
  Xi()
  Xe()
  RP()
  M8()
  cz6()
  GK()
  GGH()
  mq()
  NP()
  n6()
  Wr8()
  ;(Al3 = {
    value: 'sonnet',
    label: 'Sonnet',
    description: 'Sonnet 4.6 \xB7 Best for everyday tasks',
  }),
    (nkK = {
      value: 'haiku',
      label: 'Haiku',
      description: 'Haiku 4.5 \xB7 Fastest for quick answers',
    })
})
function tkK(H, _, q) {
  if (q || !OW(_)) return
  return Lk(_, H)
}
function ekK(H) {
  if (!H) return
  return `${Lr8(H)} ${H} \xB7 /effort`
}
function Lr8(H) {
  switch (H) {
    case 'low':
      return hNq
    case 'medium':
      return sU_
    case 'high':
      return oi6
    case 'xhigh':
      return ENq
    case 'max':
      return SNq
    case 'ultra':
      return CNq
    default:
      return oi6
  }
}
function HVK(H) {
  return
}
function _VK(H) {
  let _ = H.filter(Boolean).join('  ') || void 0
  return _
    ? { content: ` ${_} `, position: 'top', align: 'end', offset: 0 }
    : void 0
}
var kr8 = R(() => {
  lK()
  FY()
  Ew()
  F4H()
  H1H()
})
function iSH(H) {
  let _ = Nr8.c(98),
    {
      initial: q,
      sessionModel: K,
      onSelect: O,
      onSetDefault: T,
      onCancel: z,
      isStandaloneCommand: $,
      showFastModeNotice: Y,
      headerText: A,
      skipSettingsWrite: w,
    } = H,
    j = qq(),
    J = q === null ? BV_ : q,
    [M, D] = qPH.useState(J),
    f = M_(Zl3),
    [X, P] = qPH.useState(!1),
    G = M_(Wl3),
    W
  if (_[0] !== G) (W = G !== void 0 ? R1H(G) : void 0), (_[0] = G), (_[1] = W)
  else W = _[1]
  let [Z, L] = qPH.useState(W),
    k = f ?? !1,
    v
  if (_[2] !== k) (v = R__(k)), (_[2] = k), (_[3] = v)
  else v = _[3]
  let E = v,
    h
  H: {
    if (q !== null && !E.some(R_ => R_.value === q)) {
      let R_
      if (_[4] !== q) (R_ = bb(q)), (_[4] = q), (_[5] = R_)
      else R_ = _[5]
      let u_
      if (_[6] !== q || _[7] !== R_)
        (u_ = { value: q, label: R_, description: 'Current model' }),
          (_[6] = q),
          (_[7] = R_),
          (_[8] = u_)
      else u_ = _[8]
      let Q_
      if (_[9] !== E || _[10] !== u_)
        (Q_ = [...E, u_]), (_[9] = E), (_[10] = u_), (_[11] = Q_)
      else Q_ = _[11]
      h = Q_
      break H
    }
    h = E
  }
  let C = h,
    I
  if (_[12] !== C) (I = C.map(Pl3)), (_[12] = C), (_[13] = I)
  else I = _[13]
  let b = I,
    m
  if (_[14] !== J || _[15] !== b)
    (m = b.some(R_ => R_.value === J) ? J : (b[0]?.value ?? void 0)),
      (_[14] = J),
      (_[15] = b),
      (_[16] = m)
  else m = _[16]
  let S = m,
    x = Math.min(10, b.length),
    U = Math.max(0, b.length - x),
    g
  if (_[17] !== M || _[18] !== b)
    (g = b.find(R_ => R_.value === M)?.label),
      (_[17] = M),
      (_[18] = b),
      (_[19] = g)
  else g = _[19]
  let Q = g,
    l
  if (_[20] !== M) (l = fL6(M)), (_[20] = M), (_[21] = l)
  else l = _[21]
  let d = l,
    [, r] = qPH.useReducer(Xl3, 0),
    a
  if (_[22] !== r || _[23] !== d)
    (a = () => {
      if (!d?.includes('application-inference-profile')) return
      let R_ = !1
      return (
        qUH(d).then(() => {
          if (!R_) r()
        }),
        () => {
          R_ = !0
        }
      )
    }),
      (_[22] = r),
      (_[23] = d),
      (_[24] = a)
  else a = _[24]
  let s
  if (_[25] !== d) (s = [d]), (_[25] = d), (_[26] = s)
  else s = _[26]
  qPH.useEffect(a, s)
  let _H
  if (_[27] !== d) (_H = d ? OW(d) : !1), (_[27] = d), (_[28] = _H)
  else _H = _[28]
  let HH = _H,
    t
  if (_[29] !== d) (t = d ? PcH(d) : !1), (_[29] = d), (_[30] = t)
  else t = _[30]
  let jH = t,
    KH
  if (_[31] !== d) (KH = d ? hJ_(d) : !1), (_[31] = d), (_[32] = KH)
  else KH = _[32]
  let qH = KH,
    OH
  if (_[33] !== d) (OH = d ? wX8(d) : !1), (_[33] = d), (_[34] = OH)
  else OH = _[34]
  let zH = OH,
    $H
  if (_[35] !== M) ($H = Vr8(M)), (_[35] = M), (_[36] = $H)
  else $H = _[36]
  let TH = $H,
    YH
  if (_[37] !== d || _[38] !== X)
    (YH = !X && !!d && g76(d)), (_[37] = d), (_[38] = X), (_[39] = YH)
  else YH = _[39]
  let MH = YH,
    AH = MH
      ? 'xhigh'
      : Z === 'ultra' && !zH
        ? jH
          ? 'max'
          : 'high'
        : (Z === 'max' && !jH) || (Z === 'xhigh' && !qH)
          ? 'high'
          : Z,
    DH
  if (_[40] !== G || _[41] !== X)
    (DH = R_ => {
      if ((D(R_), !X && G === void 0)) L(Vr8(R_))
    }),
      (_[40] = G),
      (_[41] = X),
      (_[42] = DH)
  else DH = _[42]
  let fH = DH,
    GH
  if (
    _[43] !== TH ||
    _[44] !== MH ||
    _[45] !== HH ||
    _[46] !== jH ||
    _[47] !== zH ||
    _[48] !== qH
  )
    (GH = R_ => {
      if (!HH) return
      L(u_ => Gl3(MH ? 'xhigh' : (u_ ?? TH), R_, jH, qH, zH)), P(!0)
    }),
      (_[43] = TH),
      (_[44] = MH),
      (_[45] = HH),
      (_[46] = jH),
      (_[47] = zH),
      (_[48] = qH),
      (_[49] = GH)
  else GH = _[49]
  let JH = GH,
    RH,
    VH
  if (_[50] !== JH)
    (RH = () => JH('left')),
      (VH = () => JH('right')),
      (_[50] = JH),
      (_[51] = RH),
      (_[52] = VH)
  else (RH = _[51]), (VH = _[52])
  let NH
  if (_[53] === Symbol.for('react.memo_cache_sentinel'))
    (NH = { context: 'ModelPicker' }), (_[53] = NH)
  else NH = _[53]
  zq(
    {
      'modelPicker:decreaseEffort': RH,
      'modelPicker:increaseEffort': VH,
      'modelPicker:thisSessionOnly': () => {
        if (!T || M === void 0) return
        dH(M)
      },
    },
    NH,
  )
  function dH(R_) {
    if ((c('tengu_model_command_menu_effort', { effort: Z }), !w && X)) {
      let r_ = BH7(Z, Vr8(R_), S6('userSettings')?.effortLevel, X),
        w6 = hjH(r_)
      if (w6 !== void 0) g8('userSettings', { effortLevel: w6 })
      O6(fl3), j(t_ => ({ ...t_, effortValue: r_ }))
    }
    let u_ = fL6(R_),
      Q_ = X && u_ && OW(u_) ? Z : void 0
    if (R_ === BV_) {
      O(null, Q_)
      return
    }
    O(R_, Q_)
  }
  let mH
  if (_[54] === Symbol.for('react.memo_cache_sentinel'))
    (mH = P4.createElement(V, { color: 'remember', bold: !0 }, 'Select model')),
      (_[54] = mH)
  else mH = _[54]
  let cH =
      A ??
      'Switch between Claude models. Your pick becomes the default for new sessions. For other/previous model names, specify with --model.',
    tH
  if (_[55] !== cH)
    (tH = P4.createElement(V, { dimColor: !0 }, cH)), (_[55] = cH), (_[56] = tH)
  else tH = _[56]
  let K_
  if (_[57] !== K)
    (K_ =
      K &&
      P4.createElement(
        V,
        { dimColor: !0 },
        'Currently using ',
        bb(K),
        ' for this session only. Selecting a model will undo this.',
      )),
      (_[57] = K),
      (_[58] = K_)
  else K_ = _[58]
  let pH
  if (_[59] !== tH || _[60] !== K_)
    (pH = P4.createElement(
      B,
      { marginBottom: 1, flexDirection: 'column' },
      mH,
      tH,
      K_,
    )),
      (_[59] = tH),
      (_[60] = K_),
      (_[61] = pH)
  else pH = _[61]
  let gH
  if (_[62] !== dH || _[63] !== T)
    (gH = R_ => {
      if (T) T(R_ === BV_ ? null : R_)
      dH(R_)
    }),
      (_[62] = dH),
      (_[63] = T),
      (_[64] = gH)
  else gH = _[64]
  let eH = z ?? Dl3,
    H_
  if (
    _[65] !== fH ||
    _[66] !== S ||
    _[67] !== J ||
    _[68] !== b ||
    _[69] !== gH ||
    _[70] !== eH ||
    _[71] !== x
  )
    (H_ = P4.createElement(
      B,
      { flexDirection: 'column' },
      P4.createElement(s6, {
        defaultValue: J,
        defaultFocusValue: S,
        options: b,
        onChange: gH,
        onFocus: fH,
        onCancel: eH,
        visibleOptionCount: x,
      }),
    )),
      (_[65] = fH),
      (_[66] = S),
      (_[67] = J),
      (_[68] = b),
      (_[69] = gH),
      (_[70] = eH),
      (_[71] = x),
      (_[72] = H_)
  else H_ = _[72]
  let $_
  if (_[73] !== U)
    ($_ =
      U > 0 &&
      P4.createElement(
        B,
        { paddingLeft: 3 },
        P4.createElement(nP, { count: U, unit: 'model' }),
      )),
      (_[73] = U),
      (_[74] = $_)
  else $_ = _[74]
  let oH
  if (_[75] !== H_ || _[76] !== $_)
    (oH = P4.createElement(
      B,
      { flexDirection: 'column', marginBottom: 1 },
      H_,
      $_,
    )),
      (_[75] = H_),
      (_[76] = $_),
      (_[77] = oH)
  else oH = _[77]
  let E_
  if (_[78] !== AH || _[79] !== TH || _[80] !== Q || _[81] !== HH)
    (E_ = P4.createElement(
      B,
      { marginBottom: 1, flexDirection: 'column' },
      HH
        ? P4.createElement(
            V,
            { dimColor: !0 },
            P4.createElement(qVK, { effort: AH }),
            ' ',
            AH === 'xhigh' ? 'xHigh' : kNH(AH),
            ' ',
            'effort',
            AH === TH ? ' (default)' : '',
            ' ',
            P4.createElement(
              V,
              { color: 'subtle' },
              P4.createElement(z_, {
                chord: ['left', 'right'],
                action: 'adjust',
              }),
            ),
          )
        : P4.createElement(
            V,
            { color: 'subtle' },
            P4.createElement(qVK, { effort: void 0 }),
            ' Effort not supported',
            Q ? ` for ${Q}` : '',
          ),
    )),
      (_[78] = AH),
      (_[79] = TH),
      (_[80] = Q),
      (_[81] = HH),
      (_[82] = E_)
  else E_ = _[82]
  let w_
  if (_[83] !== Y)
    (w_ = h4()
      ? Y
        ? P4.createElement(
            B,
            { marginBottom: 1 },
            P4.createElement(
              V,
              { dimColor: !0 },
              'Fast mode is ',
              P4.createElement(V, { bold: !0 }, 'ON'),
              ' and available with',
              ' ',
              Xp(),
              ' (/fast). Switching to other models turns off fast mode.',
            ),
          )
        : T0() && !fe()
          ? P4.createElement(
              B,
              { marginBottom: 1 },
              P4.createElement(
                V,
                { dimColor: !0 },
                'Use ',
                P4.createElement(V, { bold: !0 }, '/fast'),
                ' to turn on Fast mode (',
                Xp(),
                ').',
              ),
            )
          : null
      : null),
      (_[83] = Y),
      (_[84] = w_)
  else w_ = _[84]
  let O_
  if (_[85] !== pH || _[86] !== oH || _[87] !== E_ || _[88] !== w_)
    (O_ = P4.createElement(B, { flexDirection: 'column' }, pH, oH, E_, w_)),
      (_[85] = pH),
      (_[86] = oH),
      (_[87] = E_),
      (_[88] = w_),
      (_[89] = O_)
  else O_ = _[89]
  let v_
  if (_[90] !== $ || _[91] !== T)
    (v_ =
      $ &&
      P4.createElement(
        tA,
        null,
        P4.createElement(
          Y6,
          null,
          P4.createElement(z_, {
            chord: 'enter',
            action: T ? 'set as default' : 'confirm',
          }),
          T &&
            P4.createElement(z_, {
              chord: 's',
              action: 'use this session only',
            }),
          P4.createElement(o6, {
            action: 'select:cancel',
            context: 'Select',
            fallback: 'Esc',
            description: 'cancel',
          }),
        ),
      )),
      (_[90] = $),
      (_[91] = T),
      (_[92] = v_)
  else v_ = _[92]
  let I_
  if (_[93] !== O_ || _[94] !== v_)
    (I_ = P4.createElement(B, { flexDirection: 'column' }, O_, v_)),
      (_[93] = O_),
      (_[94] = v_),
      (_[95] = I_)
  else I_ = _[95]
  let V_ = I_
  if (!$) return V_
  let sH
  if (_[96] !== V_)
    (sH = P4.createElement(Z1, { color: 'permission' }, V_)),
      (_[96] = V_),
      (_[97] = sH)
  else sH = _[97]
  return sH
}
function Dl3() {}
function fl3(H) {
  return H.unpinOpus47LaunchEffort ? H : { ...H, unpinOpus47LaunchEffort: !0 }
}
function Xl3(H) {
  return H + 1
}
function Pl3(H) {
  let _ = H.value === null ? BV_ : H.value,
    q = fL6(_),
    K = q ? EkK(q) : void 0,
    O = K ? (H.description ? `${H.description} \xB7 ${K}` : K) : H.description
  return { ...H, value: _, description: O }
}
function Wl3(H) {
  return H.effortValue
}
function Zl3(H) {
  return h4() ? H.fastMode : !1
}
function fL6(H) {
  if (!H) return
  return H === BV_ ? KX() : TK(H)
}
function qVK(H) {
  let _ = Nr8.c(5),
    { effort: q } = H,
    K = q ? 'claude' : 'subtle',
    O = q ?? 'low',
    T
  if (_[0] !== O) (T = Lr8(O)), (_[0] = O), (_[1] = T)
  else T = _[1]
  let z
  if (_[2] !== K || _[3] !== T)
    (z = P4.createElement(V, { color: K }, T)),
      (_[2] = K),
      (_[3] = T),
      (_[4] = z)
  else z = _[4]
  return z
}
function Gl3(H, _, q, K, O) {
  let T = ['low', 'medium', 'high']
  if (K) T.push('xhigh')
  if (q) T.push('max')
  if (O) T.push('ultra')
  let z = T.indexOf(H),
    $ = z !== -1 ? z : T.indexOf('high')
  if (_ === 'right') return T[($ + 1) % T.length]
  else return T[($ - 1 + T.length) % T.length]
}
function Vr8(H) {
  let _ = fL6(H) ?? KX()
  return R1H(Q76(_))
}
var Nr8,
  P4,
  qPH,
  BV_ = '__NO_PREFERENCE__'
var XL6 = R(() => {
  t36()
  Ou()
  N_()
  RP()
  iH()
  kq()
  i8()
  n6()
  FY()
  JKH()
  mq()
  SkK()
  DL6()
  M8()
  E4()
  GM()
  A9()
  Pq()
  Vx()
  Gj()
  kr8()
  ;(Nr8 = p(q_(), 1)), (P4 = p(PH(), 1)), (qPH = p(PH(), 1))
})
function KPH(H, _, q) {
  if (!Zq()) return !1
  let K = H !== null ? TK(H).toLowerCase() : KX().toLowerCase(),
    O = K.includes('opus-4-6'),
    T = K.includes('opus-4-7'),
    z = K.includes('sonnet-4-6')
  if ((O || (!Wi() && T)) && _) return !0
  if (!$0(K)) return !1
  if (O && q) return !1
  if (T && q) return !1
  return O || T || z
}
var UV_ = R(() => {
  jq()
  NP()
  RP()
  mq()
})
var OVK = {}
f_(OVK, { ClaudeMdExternalIncludesDialog: () => vr8 })
function vr8(H) {
  let _ = KVK.c(17),
    { onDone: q, isStandaloneDialog: K, externalIncludes: O } = H,
    T
  if (_[0] === Symbol.for('react.memo_cache_sentinel')) (T = []), (_[0] = T)
  else T = _[0]
  _s.useEffect(Vl3, T)
  let z
  if (_[1] !== q)
    (z = P => {
      if (P === 'no')
        c('tengu_claude_md_external_includes_dialog_declined', {}), hw(kl3)
      else c('tengu_claude_md_external_includes_dialog_accepted', {}), hw(Ll3)
      q()
    }),
      (_[1] = q),
      (_[2] = z)
  else z = _[2]
  let $ = z,
    Y
  if (_[3] !== $)
    (Y = () => {
      $('no')
    }),
      (_[3] = $),
      (_[4] = Y)
  else Y = _[4]
  let A = Y,
    w = !K,
    j = !K,
    J
  if (_[5] === Symbol.for('react.memo_cache_sentinel'))
    (J = _s.default.createElement(
      V,
      null,
      "This project's CLAUDE.md imports files outside the current working directory. Never allow this for third-party repositories.",
    )),
      (_[5] = J)
  else J = _[5]
  let M
  if (_[6] !== O)
    (M =
      O &&
      O.length > 0 &&
      _s.default.createElement(
        B,
        { flexDirection: 'column' },
        _s.default.createElement(V, { dimColor: !0 }, 'External imports:'),
        O.map(Rl3),
      )),
      (_[6] = O),
      (_[7] = M)
  else M = _[7]
  let D
  if (_[8] === Symbol.for('react.memo_cache_sentinel'))
    (D = _s.default.createElement(
      V,
      { dimColor: !0 },
      'Important: Only use Claude Code with files you trust. Accessing untrusted files may pose security risks',
      ' ',
      _s.default.createElement(G9, {
        url: 'https://code.claude.com/docs/en/security',
      }),
      ' ',
    )),
      (_[8] = D)
  else D = _[8]
  let f
  if (_[9] !== $)
    (f = _s.default.createElement(l4, {
      confirmLabel: 'Yes, allow external imports',
      cancelLabel: 'No, disable external imports',
      onConfirm: () => $('yes'),
      onCancel: () => $('no'),
    })),
      (_[9] = $),
      (_[10] = f)
  else f = _[10]
  let X
  if (_[11] !== A || _[12] !== w || _[13] !== j || _[14] !== M || _[15] !== f)
    (X = _s.default.createElement(
      b6,
      {
        title: 'Allow external CLAUDE.md file imports?',
        color: 'warning',
        onCancel: A,
        hideBorder: w,
        hideInputGuide: j,
      },
      J,
      M,
      D,
      f,
    )),
      (_[11] = A),
      (_[12] = w),
      (_[13] = j),
      (_[14] = M),
      (_[15] = f),
      (_[16] = X)
  else X = _[16]
  return X
}
function Rl3(H, _) {
  return _s.default.createElement(V, { key: _, dimColor: !0 }, '  ', H.path)
}
function Ll3(H) {
  return {
    ...H,
    hasClaudeMdExternalIncludesApproved: !0,
    hasClaudeMdExternalIncludesWarningShown: !0,
  }
}
function kl3(H) {
  return {
    ...H,
    hasClaudeMdExternalIncludesApproved: !1,
    hasClaudeMdExternalIncludesWarningShown: !0,
  }
}
function Vl3() {
  c('tengu_claude_md_includes_dialog_shown', {})
}
var KVK, _s
var yr8 = R(() => {
  N_()
  iH()
  n6()
  Qw()
  g9()
  ;(KVK = p(q_(), 1)), (_s = p(PH(), 1))
})
function zVK(H) {
  let _ = TVK.c(17),
    { currentVersion: q, onChoice: K } = H,
    O
  if (_[0] !== K)
    (O = function (X) {
      K(X)
    }),
      (_[0] = K),
      (_[1] = O)
  else O = _[1]
  let T = O,
    z
  if (_[2] !== K)
    (z = function () {
      K('cancel')
    }),
      (_[2] = K),
      (_[3] = z)
  else z = _[3]
  let $ = z,
    Y
  if (_[4] !== q)
    (Y = FV_.default.createElement(
      V,
      null,
      "The stable channel may have an older version than what you're currently running (",
      q,
      ').',
    )),
      (_[4] = q),
      (_[5] = Y)
  else Y = _[5]
  let A
  if (_[6] === Symbol.for('react.memo_cache_sentinel'))
    (A = FV_.default.createElement(
      V,
      { dimColor: !0 },
      'How would you like to handle this?',
    )),
      (_[6] = A)
  else A = _[6]
  let w
  if (_[7] === Symbol.for('react.memo_cache_sentinel'))
    (w = {
      label: 'Allow possible downgrade to stable version',
      value: 'downgrade',
    }),
      (_[7] = w)
  else w = _[7]
  let j = `Stay on current version (${q}) until stable catches up`,
    J
  if (_[8] !== j) (J = [w, { label: j, value: 'stay' }]), (_[8] = j), (_[9] = J)
  else J = _[9]
  let M
  if (_[10] !== T || _[11] !== J)
    (M = FV_.default.createElement(s6, { options: J, onChange: T })),
      (_[10] = T),
      (_[11] = J),
      (_[12] = M)
  else M = _[12]
  let D
  if (_[13] !== $ || _[14] !== Y || _[15] !== M)
    (D = FV_.default.createElement(
      b6,
      {
        title: 'Switch to Stable Channel',
        onCancel: $,
        color: 'permission',
        hideBorder: !0,
        hideInputGuide: !0,
      },
      Y,
      A,
      M,
    )),
      (_[13] = $),
      (_[14] = Y),
      (_[15] = M),
      (_[16] = D)
  else D = _[16]
  return D
}
var TVK, FV_
var $VK = R(() => {
  iH()
  GM()
  g9()
  ;(TVK = p(q_(), 1)), (FV_ = p(PH(), 1))
})
function YVK(H) {
  return Object.entries(H).map(([_, q]) => ({
    label: q?.name ?? Nl3,
    value: _,
    description: q?.description ?? vl3,
  }))
}
function wVK(H) {
  let _ = AVK.c(16),
    { initialStyle: q, onComplete: K, onCancel: O, isStandaloneCommand: T } = H,
    z
  if (_[0] === Symbol.for('react.memo_cache_sentinel')) (z = []), (_[0] = z)
  else z = _[0]
  let [$, Y] = gV_.useState(z),
    [A, w] = gV_.useState(!0),
    j,
    J
  if (_[1] === Symbol.for('react.memo_cache_sentinel'))
    (j = () => {
      aH_(S_())
        .then(Z => {
          let L = YVK(Z)
          Y(L), w(!1)
        })
        .catch(() => {
          let Z = YVK(BMH)
          Y(Z), w(!1)
        })
    }),
      (J = []),
      (_[1] = j),
      (_[2] = J)
  else (j = _[1]), (J = _[2])
  gV_.useEffect(j, J)
  let M
  if (_[3] !== K)
    (M = Z => {
      K(Z)
    }),
      (_[3] = K),
      (_[4] = M)
  else M = _[4]
  let D = M,
    f = !T,
    X = !T,
    P
  if (_[5] === Symbol.for('react.memo_cache_sentinel'))
    (P = bU.createElement(
      B,
      { marginTop: 1 },
      bU.createElement(
        V,
        { dimColor: !0 },
        'This changes how Claude Code communicates with you',
      ),
    )),
      (_[5] = P)
  else P = _[5]
  let G
  if (_[6] !== D || _[7] !== q || _[8] !== A || _[9] !== $)
    (G = bU.createElement(
      B,
      { flexDirection: 'column', gap: 1 },
      P,
      A
        ? bU.createElement(V, { dimColor: !0 }, 'Loading output styles\u2026')
        : bU.createElement(s6, {
            options: $,
            onChange: D,
            visibleOptionCount: 10,
            defaultValue: q,
          }),
    )),
      (_[6] = D),
      (_[7] = q),
      (_[8] = A),
      (_[9] = $),
      (_[10] = G)
  else G = _[10]
  let W
  if (_[11] !== O || _[12] !== f || _[13] !== X || _[14] !== G)
    (W = bU.createElement(
      b6,
      {
        title: 'Preferred output style',
        onCancel: O,
        hideInputGuide: f,
        hideBorder: X,
      },
      G,
    )),
      (_[11] = O),
      (_[12] = f),
      (_[13] = X),
      (_[14] = G),
      (_[15] = W)
  else W = _[15]
  return W
}
var AVK,
  bU,
  gV_,
  Nl3 = 'Default',
  vl3 =
    'Claude completes coding tasks efficiently and provides concise responses'
var jVK = R(() => {
  vo()
  iH()
  Dq()
  nK()
  g9()
  ;(AVK = p(q_(), 1)), (bU = p(PH(), 1)), (gV_ = p(PH(), 1))
})
function MVK(H) {
  let _ = JVK.c(13),
    { initialLanguage: q, onComplete: K, onCancel: O } = H,
    [T, z] = DqH.useState(q),
    [$, Y] = DqH.useState((q ?? '').length),
    A
  if (_[0] === Symbol.for('react.memo_cache_sentinel'))
    (A = { context: 'Settings' }), (_[0] = A)
  else A = _[0]
  _8('confirm:no', O, A)
  let w
  if (_[1] !== T || _[2] !== K)
    (w = function () {
      let W = T?.trim()
      K(W || void 0)
    }),
      (_[1] = T),
      (_[2] = K),
      (_[3] = w)
  else w = _[3]
  let j = w,
    J
  if (_[4] === Symbol.for('react.memo_cache_sentinel'))
    (J = DqH.default.createElement(
      V,
      null,
      'Enter your preferred response and voice language:',
    )),
      (_[4] = J)
  else J = _[4]
  let M
  if (_[5] === Symbol.for('react.memo_cache_sentinel'))
    (M = DqH.default.createElement(V, null, __.pointer)), (_[5] = M)
  else M = _[5]
  let D = T ?? '',
    f
  if (_[6] !== $ || _[7] !== j || _[8] !== D)
    (f = DqH.default.createElement(
      B,
      { flexDirection: 'row', gap: 1 },
      M,
      DqH.default.createElement(Q7, {
        value: D,
        onChange: z,
        onSubmit: j,
        focus: !0,
        showCursor: !0,
        placeholder: `e.g., Japanese, \u65E5\u672C\u8A9E, Espa\xF1ol${__.ellipsis}`,
        columns: 60,
        cursorOffset: $,
        onChangeCursorOffset: Y,
      }),
    )),
      (_[6] = $),
      (_[7] = j),
      (_[8] = D),
      (_[9] = f)
  else f = _[9]
  let X
  if (_[10] === Symbol.for('react.memo_cache_sentinel'))
    (X = DqH.default.createElement(
      V,
      { dimColor: !0 },
      'Leave empty for default (English)',
    )),
      (_[10] = X)
  else X = _[10]
  let P
  if (_[11] !== f)
    (P = DqH.default.createElement(
      B,
      { flexDirection: 'column', gap: 1 },
      J,
      f,
      X,
    )),
      (_[11] = f),
      (_[12] = P)
  else P = _[12]
  return P
}
var JVK, DqH
var DVK = R(() => {
  k9()
  iH()
  kq()
  Sz()
  ;(JVK = p(q_(), 1)), (DqH = p(PH(), 1))
})
function lv(H){let _=fVK.c(34),{query:q,placeholder:K,isFocused:O,isT
