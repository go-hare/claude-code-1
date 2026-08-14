# densable 2.1.232 #48 — sandbox.ripgrep source restriction (`sJc`)

## SEA symbols

```js
// shell-settings / approval surface (helpers + binary overrides)
iJc = ["apiKeyHelper","awsAuthRefresh",...,"subagentStatusLine"]
sJc = ["bwrapPath","ripgrep","socatPath"]
```

`d7e` / shellSettings extraction walks `sJc` and serializes `sandbox.${key}` for approval hashes (`Dwv` stringifies object form `{command,args}`).

## Schema gold

```text
ripgrep: ...describe(
  "Custom ripgrep configuration for bundled ripgrep support. " +
  "Only honored from user, managed/policy, or CLI (`--settings`) settings — " +
  "project settings (.claude/settings.json and .claude/settings.local.json) are ignored."
)

bwrapPath: ...describe(
  "Linux/WSL only: Absolute path to the bwrap (bubblewrap) binary. " +
  "Overrides auto-detection via PATH. Only honored from admin-controlled managed settings."
)

socatPath: ...describe(
  "Linux/WSL only: Absolute path to the socat binary used for the sandbox network proxy. " +
  "Overrides auto-detection via PATH. Only honored from admin-controlled managed settings."
)
```

## Resolution gold

```js
// policy tiers only (managed) — densable iY()
function XEn(){ return iY().map(e => e.sandbox?.bwrapPath).find(e => e != null) }
function Mad(){ return iY().map(e => e.sandbox?.socatPath).find(e => e != null) }

// policy + flag + user — densable rkt()
function rkt(){
  return [
    ...iY(),
    fn("flagSettings"),
    zg("userSettings") ? fn("userSettings") : null,
  ]
}

// convertToSandboxRuntimeConfig
jr = rkt().map(Ue => Ue?.sandbox?.ripgrep).find(Ue => Ue !== void 0)
  ?? { command: sr, args: Qr, argv0: Ut }

// stamped on runtime config
ripgrep: jr,
bwrapPath: XEn(),
socatPath: Mad(),
```

Project/local never appear in `rkt` / `iY`, so they cannot override these binary paths even if present in merged settings.
