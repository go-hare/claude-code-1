# densable 2.1.232 #24 — mTLS certificate rotation auto-reload

## Changelog

> mTLS certificates are automatically reloaded on rotation

## densable gold (SEA)

```js
// XEt — async reload with mid-rotation safety
XEt = $le(async () => {
  let e = X.CLAUDE_CODE_CLIENT_CERT,
    t = X.CLAUDE_CODE_CLIENT_KEY
  let [r, n] = await Promise.all([
    e ? teu(e, 'client certificate from CLAUDE_CODE_CLIENT_CERT') : null,
    t ? teu(t, 'client key from CLAUDE_CODE_CLIENT_KEY') : null,
  ])
  let o = Boolean((e && !r) || (t && !n))
  let i = Boolean(!o && r && n && DDy(r.content, n.content))
  if (i)
    w('mTLS: Ignoring mismatched client cert/key pair — mid-rotation read', {
      level: 'error',
    })
  let s = o || i
  let a = e ? (s ? lqe : r) : null // keep prior on fail
  let l = t ? (s ? cqe : n) : null
  let c =
    lqe?.path !== a?.path ||
    lqe?.content !== a?.content ||
    cqe?.path !== l?.path ||
    cqe?.content !== l?.content
  if (((lqe = a), (cqe = l), c)) ahn() // clear mTLS agent cache
  return { changed: c, readFailed: s, mismatched: i }
})

// DDy — cert/key pair check (true = mismatched)
// oeu — isFile && size <= QQc(1MiB)
// neu — complete PEM BEGIN/END
// teu/eeu — load with oeu+neu

// g3b — TLS stale that may need cert reload
function g3b(e) {
  if (!(e instanceof Rx)) return !1
  let t = oj(e)
  if (t === null) return !1
  let { code: r } = t
  return (
    Goe.has(r) ||
    r === 'EPROTO' ||
    r === 'FailedToOpenSocket' ||
    r.startsWith('ERR_OSSL_') ||
    r.startsWith('ERR_SSL_')
  )
}

// y3b — on g3b, reload rotated material
async function y3b(e) {
  if (
    !X.CLAUDE_CODE_CLIENT_CERT ||
    X.CLAUDE_CODE_DISABLE_MTLS_RELOAD_ON_STALE_CONNECTION
  )
    return { reportedFailure: !1, attempted: !1 }
  try {
    let { changed: t, readFailed: r, mismatched: n } = await XEt()
    if (t) bqe(), ece() // drop proxy/keep-alive agents
    if (r) {
      if (e) xe('api_mtls_cert_reload', n ? 'material_mismatched' : 'material_read_failed')
      return { reportedFailure: e, attempted: !0 }
    }
    if (t) {
      w('Stale connection — reloaded rotated mTLS client material')
      Se('api_mtls_cert_reload')
    }
    return { reportedFailure: !1, attempted: !0 }
  } catch (t) {
    ...
  }
}
// withRetry: if(g3b(a)){ let x=await y3b(!h); k=x.attempted; if(x.reportedFailure)h=!0}
// client refresh when k (reload attempted)
```

## Local

| densable | local |
| -------- | ----- |
| `XEt` | `reloadMtlsClientMaterialFromEnvAsync` |
| `DDy`/`oeu`/`neu` | `isMtlsCertKeyMismatched` / `isValidMtlsCertFileStat` / `isCompletePemMaterial` |
| `teu`/`eeu` | `loadMtlsCertFileAsync` / `Sync` (stat+PEM gates) |
| `g3b` | `isMtlsStaleTlsConnectionError` in `withRetry.ts` |
| `y3b` | `tryReloadMtlsOnStaleTlsConnection` + withRetry wire |

- Tests: `src/utils/__tests__/mtls.test.ts`
