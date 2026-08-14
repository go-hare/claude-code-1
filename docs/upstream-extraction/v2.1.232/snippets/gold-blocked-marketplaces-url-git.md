# densable 2.1.232 #9 — blockedMarketplaces `url` vs bare git clone

## Changelog

> Enterprise `blockedMarketplaces` url entries still intercept bare repo git
> clones (after github/gitlab HTTPS → `source:'git'` classification)

## densable `Qob` cross-type branch (SEA ~289205800)

```js
if (e.source === "git" && t.source === "url") {
  if (!e.url.includes("://")) return !1
  let r = { stripDotGit: !0 }
  return CWo(e.url, r) === CWo(t.url, r)
}
```

### `CWo` normalize

- `://` URLs: `new URL`, fold hostname (`$Od`/`LWo` → github.com / strip www),
  clear user/pass/search/hash, decode pathname, collapse `.`/`..` (`qOd`),
  optionally strip trailing `/` + `.git` (`KOd`)
- SSH `user@host:path`: host fold only

Same-type `url` compare uses lighter `HWo` (hostname fold only).

## Local

- `normalizeMarketplaceUrlForBlocklist` ≈ `CWo`
- `areSourcesEquivalentForBlocklist` git↔url branch + url↔url `HWo`
- Tests: `blockedMarketplacesUrlGit.232.test.ts`
