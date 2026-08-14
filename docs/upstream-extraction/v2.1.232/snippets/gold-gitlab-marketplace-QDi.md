# densable 2.1.232 #7 — GitLab marketplace nested subgroups

## Changelog

> Added GitLab support to plugin marketplaces: bare `gitlab.com` repo URLs (including nested subgroups) now clone like `github.com` URLs, and clone auth-failure hints name your actual git host

## `QDi` parse (SEA ~300200xxx)

After SSH and `.git`/`/_git/` early git:

```js
if (Em(c.hostname)) {
  // github.com — owner/repo only
  if (c.pathname.match(/^\/([^/]+\/[^/]+?)(\/|\.git|$)/)?.[1] && !WSr(a)) {
    let d = a.endsWith(".git") ? a : `${a}.git`
    return l ? { source: "git", url: d, ref: l } : { source: "git", url: d }
  }
}
if (I9S(c.hostname)) {
  // I9S = Sws(hostname, "gitlab.com")
  let u = c.pathname.split("/").filter(Boolean)
  let d = a.indexOf("/", a.indexOf("://") + 3)
  let p = d === -1 ? "" : a.slice(d).replace(/\/+$/, "")
  let f = u.map(h => { try { return decodeURIComponent(h) } catch { return null } })
  if (
    u.length >= 2 &&
    p === `/${u.join("/")}` &&
    !/[\t\n\r]/.test(a) &&
    !WSr(a) &&
    f.every(h => h !== null) &&
    f[0] !== "api" &&
    !f.includes("-")
  ) {
    let h = a.replace(/\/+$/, "")
    let g = h.endsWith(".git") ? h : `${h}.git`
    return l ? { source: "git", url: g, ref: l } : { source: "git", url: g }
  }
}
// else source:url
```

Shorthand bare `a/b/c` (not github owner/repo regex) → **error** (not silent null):

```
'…' is not a valid GitHub owner/repo shorthand. For a git repo, use the full https:// clone URL…
```

## Auth-failure host labels (`sTb` / `aTb` / `iTb`)

```js
function sTb(e) {
  let t = EIr({ source: "git", url: e })
  if (t === null) return "your git host"
  return Em(t) ? "GitHub" : t
}
function aTb(e) {
  let t = EIr({ source: "git", url: e })
  if (t !== null && Em(t))
    return "your credential helper is configured (e.g., gh auth login)"
  return `your git credential helper has valid credentials for ${t ?? "this host"} (e.g., a personal access token)`
}
// SSH fail: keys configured for ${sTb(url)}
// HTTPS fail: ensure ${aTb(url)}
```

## Local

- `parseMarketplaceInput.ts` — `isGitlabComHost` + nested path → `source:'git'`
- `marketplaceManager.ts` — `formatCloneGitHostLabel` / `formatHttpsCredentialHelperHint`
- Tests: `parseMarketplaceGitlab.232.test.ts`
