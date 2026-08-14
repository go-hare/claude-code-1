# densable 2.1.232 #12 + #34 — Fable advisor + managed sandbox binaries

## #12 Fable 5 re-enters `/advisor`

```js
// catalog: claude-fable-5 advisor_rank:5
// aliases: fable:{default:"claude-fable-5"}
// _Nb=["fable","opus","sonnet"]  // /advisor argument options

// gJt notice when Fable advisor needs credits setup:
"Fable 5 as the advisor bills to usage credits, which need to be set up for your account."
// + " Run /model fable to review and enable."

// Xct/FBe/Zlp: fable family is valid advisor + base can call advisor
```

## Local

| densable | local |
| -------- | ----- |
| fable in advisor allowlist | `isFableAdvisorFamily` in `modelSupportsAdvisor` / `isValidAdvisorModel` |
| gJt string | `FABLE_ADVISOR_CREDITS_NOTICE` |

## #34 managed settings: sandbox binaries need approval

```js
// sJc=["bwrapPath","ripgrep","socatPath"]
// d7e: for (s of sJc) { a=Dwv(r[s]); if(a) t[`sandbox.${s}`]=a }
// Owv(e): e?.sandbox && (ripgrep||bwrapPath||socatPath)
// NDt: shellSettings keys length > 0 → dangerous (includes sandbox.* keys)
// Schema: bwrap/socat "Only honored from admin-controlled managed settings."
```

## Local

| densable | local |
| -------- | ----- |
| `sJc` | `DANGEROUS_SANDBOX_BINARY_KEYS` |
| `Dwv` | `coerceSandboxBinarySettingValue` |
| `Owv` | `hasDangerousSandboxBinarySettings` |
| `d7e` sandbox loop | `extractDangerousSettings` writes `sandbox.${key}` into shellSettings |

- Tests: `advisorApplied.test.ts`, `benignEnv.218.test.ts`
