# densable 2.1.216 — `sandbox.filesystem.disabled` (1:1)

> **id:** `fs-disabled` · Changelog #1  
> **Status:** **HAVE** (dual facade + Bou + uCg + first-class `sandbox.credentials` QTi/ZTi/oeh + merge pass-through + native `filesystem.disabled` on sandbox-runtime@0.0.70; Anu/vnu package-side)  
> SEA: `/tmp/official-216/plat/package/claude` · Deep dig: `DEEP-1TO1.md`  
> Runtime dumps: `runtime-Gvg.txt`, `runtime-Wvg.txt`, `runtime-Bou.txt`, `runtime-Hou.txt`, `sandbox-filesystem-disabled.*.txt`

---

## 1. Product intent (changelog)

> Added `sandbox.filesystem.disabled` setting to skip filesystem isolation while keeping network egress control.

---

## 2. densable binary proof

| Needle | Hit | Offset (approx) | Snippet |
|--------|-----|-----------------|---------|
| `skip filesystem isolation entirely` | true | 220090843 | describe: macOS/Linux/WSL only; Windows ignore; network retained |
| `filesystem.disabled` | true | 223405160 | `Gvg`/`Wvg`/`Bou` early returns |
| `allowOnly:["/"]` | true | 223405826 | write unrestricted when disabled |
| `denyOnly:[]` | true | 223405187 | read unrestricted when disabled |
| `credentials.files` | true | 220092044 | denials dropped when FS off; envVars unaffected; managed pin |
| `allowManagedReadPathsOnly` | true | 220090652 | sibling managed gate (independent of disabled) |

Literal one-token `sandbox.filesystem.disabled` may be **MISS**; nested schema field **HIT**.

---

## 3. Cleaned densable schema / strings

**Public key:** `sandbox.filesystem.disabled` (boolean optional; unset = isolation **on**).

**Zod (`neh` / SandboxFilesystemConfigSchema):**

```text
allowWrite?: string[]
denyWrite?: string[]
denyRead?: string[]
allowRead?: string[]
allowManagedReadPathsOnly?: boolean
disabled?: boolean  // NEW 2.1.216
```

**`disabled.describe` (verbatim reconstruct):**

```text
macOS and Linux/WSL only: skip filesystem isolation entirely while keeping network and seccomp isolation. Ignored on native Windows, where the sandboxed process runs as a separate user with no inherent rights, so skipping the filesystem rules would withhold every access grant rather than loosen them — filesystem isolation stays on there. Sandboxed commands get unrestricted read/write access to the host filesystem; network egress is still confined to network.allowedDomains. Intended for deployments whose goal is egress control rather than filesystem containment. Does not change Bash prompting: sandbox.autoAllowBashIfSandboxed is independent and still defaults to true, so set it to false to keep prompting for sandboxed commands. Drops the read protection from filesystem.denyRead and credentials.files for sandboxed commands, since both are enforced by the filesystem layer this turns off; credentials.envVars deny/mask is unaffected. Only honored from user, managed/policy, or CLI (`--settings`) settings — project settings (.claude/settings.json and .claude/settings.local.json) are ignored. If managed settings configure sandbox.filesystem at all, or list any sandbox.credentials.files entry, only managed settings can set this: an admin who deployed filesystem restrictions must not have them switched off by a user-writable file. (sandbox.credentials.envVars does not pin it — env scrubbing is independent of the filesystem layer and survives this setting.) When unset, filesystem isolation stays on.
```

---

## 4. Cleaned densable runtime

```js
// densable 2.1.216 — sandbox.filesystem.disabled (~223405160)
// Config on session sandbox object `hl`. Schema: filesystem.disabled?: boolean

// --- policy resolve (adapter ~223587672) ---
// hre() = managed/policy tiers; FQt() = non-project user/flag/CLI sources
function resolveFilesystemDisabled() { // zRg
  const managed = hre();
  const fromManaged = managed.map(s => s.sandbox?.filesystem?.disabled).find(v => v !== undefined);
  if (fromManaged !== undefined) return fromManaged;
  // Pin: managed sandbox.filesystem OR any sandbox.credentials.files → only managed may set
  if (managed.some(s =>
    s.sandbox?.filesystem !== undefined ||
    (s.sandbox?.credentials?.files?.length ?? 0) > 0
  )) {
    return undefined; // isolation stays on
  }
  return FQt().map(s => s?.sandbox?.filesystem?.disabled).find(v => v !== undefined);
}

function filesystemPolicyMode() { // Xot
  if (zO()) return 'strict'; // UNCERTAIN: force-strict gate body
  if (platform() === 'windows') return 'strict';
  const d = resolveFilesystemDisabled();
  if (d !== undefined) return d ? 'relaxed' : 'strict';
  const t = Jot().filesystemPolicy ?? 'strict';
  if (t === 'relaxedIfForced') return KRg() ? 'strict' : 'relaxed'; // UNCERTAIN: KRg
  return t;
}

// --- sandbox-runtime core ---
function getFsReadConfig() { // Gvg
  if (!hl || hl.filesystem.disabled) return { denyOnly: [], allowWithinDeny: [] };
  // merge denyRead + credentials.files (Dou/Vzi); expand globs on linux…
}

function getFsWriteConfig() { // Wvg
  if (!hl) return { allowOnly: y5r() /* default write roots */, denyWithinAllow: [] };
  if (hl.filesystem.disabled) return { allowOnly: ['/'], denyWithinAllow: [] };
  // allowWrite/denyWrite + y5r defaults
}

function windowsFsPlan(e) { // Vvg
  if (e.filesystem?.disabled) return { grantRead: [], grantWrite: [], denyRead: [], denyWrite: [] };
  // else normalize allow/deny + cred deny files
}

function snapshotFs(e) { // Hou
  return {
    disabled: e.filesystem.disabled ?? false,
    denyRead: [...e.filesystem.denyRead],
    denyWrite: [...e.filesystem.denyWrite],
    allowRead: [...(e.filesystem.allowRead ?? [])],
    allowWrite: [...e.filesystem.allowWrite],
    credFiles: WZn(e.credentials),
  };
}

// wrapWithSandbox (Bou): disabled from override.filesystem if present else hl
// if disabled: readConfig/writeConfig stay undefined; network/seccomp still applied
// credentials.envVars unset/set still computed (Vzi)

function getLinuxGlobPatternWarnings() { // uCg
  if (platform() !== 'linux' || !hl || hl.filesystem.disabled) return [];
  // else collect globs from allowWrite+denyWrite
}

// OUTER facade (~223611065) — DIFFERENT when disabled:
// returns RAW configured path lists (not empty/root). Enforcement uses Gvg/Wvg unrestricted.
// Port both; do not collapse.

// Parent merge (~220384258): if (i.disabled === false) l.disabled = false; // parent can force ON
```

### Mangled symbols

`hl`, `XS`, `Gvg`, `Wvg`, `Vvg`, `Hou`, `Bou`, `rCg`, `uCg`, `Yvg`, `Vzi`, `WZn`, `Dou`, `kne`, `Pxt`, `y5r`, `zRg`, `Xot`, `hre`, `FQt`, `neh`, `fo`

---

## 5. go-hare current gap

| Path | Symbol | Status |
|------|--------|--------|
| `src/entrypoints/sandboxTypes.ts` | `SandboxFilesystemConfigSchema.disabled` | **HAVE** describe + field — keep verbatim |
| `src/utils/sandbox/sandbox-adapter.ts` | `resolveSandboxFilesystemDisabled` / managed pin | **HAVE** — credentials.files pin typed |
| same | `getDisabledSandboxFsReadConfig` / Write | **HAVE** densable shapes |
| same | `convertToSandboxRuntimeConfig` | **HAVE** dual: stash raw lists + return unrestricted enforcement FS; network kept |
| same | `getFsReadConfig` / `getFsWriteConfig` facade | **HAVE** OUTER raw diagnostic when disabled; `getEnforcementFs*` for unrestricted |
| same | `wrapWithSandbox` | **HAVE** Bou `override.filesystem !== undefined ? disabled??false : session` |
| same | `getLinuxGlobPatternWarnings` | **HAVE** disabled → `[]` (uCg) |
| `src/entrypoints/sandboxTypes.ts` | `sandbox.credentials` | **HAVE** — densable QTi/ZTi/oeh first-class |
| `@anthropic-ai/sandbox-runtime@^0.0.70` | `filesystem.disabled` + credentials mask (Anu/vnu/Vzi) | **HAVE** — upgraded 2026-08-07 |
| Bash prompt / SandboxConfigTab | getFs* consumers | **AUDIT** — need diagnostic raw lists vs enforcement unrestricted |

**Missing pieces:** tests; dual getFs*; per-exec override; Linux glob warnings; credentials.files/envVars model; Windows Vvg/Hou; parent force `disabled:false`; optional `filesystemPolicyMode`.

---

## 6. 1:1 implement steps (ordered)

1. Freeze schema: keep `disabled` describe exact; keep `allowManagedReadPathsOnly` independent; optionally first-class `credentials.{files,envVars}`.
2. Resolver 1:1 (zRg): managed pin = filesystem object OR credentials.files length (**not** envVars). Windows → false. Locked → only policy. Else non-project sources only; project/local never read; unset → false.
3. Optional Xot export: windows/forceStrict → `strict`; disabled true → `relaxed`.
4. Enforcement convert: disabled → network full + filesystem unrestricted `{denyRead:[],allowRead:[],allowWrite:['/'],denyWrite:[]}` — never y5r-only for disabled.
5. Dual facade: (A) enforcement Gvg/Wvg unrestricted; (B) diagnostic/prompt raw configured lists when disabled. Update Bash prompt / SandboxConfigTab only if densable shows raw lists.
6. wrapWithSandbox (Bou): `disabled = override.filesystem !== undefined ? (override.filesystem.disabled ?? false) : session`; if disabled omit/force unrestricted FS; keep network + envVars scrub.
7. `getLinuxGlobPatternWarnings`: disabled → `[]`.
8. Windows: never loosen via disabled; empty plan if planner exists.
9. Parent merge: only port recovered `disabled === false` force-on fragment.
10. Independence: `autoAllowBashIfSandboxed` untouched; network still enforced.
11. Tests (section 7); `bun run precheck`.
12. Refresh pack/checklist status only after green.

---

## 7. Tests

- Schema accept/describe key phrases (Windows ignore, project ignored, credentials.files pin, envVars not pin).
- Resolver: user/flag/CLI honored; project ignored; unset false; Windows false; managed pin blocks user; envVars alone does not pin.
- convert: disabled ⇒ empty deny + allowWrite `['/']`; network domains still populated.
- getFs: enforcement empty deny + allowOnly `['/']`; dual facade raw lists if split.
- wrap: unrestricted FS + network still applied; override.filesystem.disabled when ported.
- Linux glob warnings `[]` when disabled.
- credentials.files contribute deny when FS on; dropped when disabled; envVars scrub remains.

Suggested paths:

- `src/entrypoints/__tests__/sandboxTypes.filesystem.disabled.216.test.ts`
- `src/utils/sandbox/__tests__/sandbox.filesystem.disabled.216.test.ts`
- `src/utils/sandbox/__tests__/convertToSandboxRuntimeConfig.filesystem.disabled.216.test.ts`
- `src/utils/sandbox/__tests__/getFsConfig.filesystem.disabled.216.test.ts`
- `src/utils/sandbox/__tests__/wrapWithSandbox.filesystem.disabled.216.test.ts`
- `src/utils/sandbox/__tests__/getLinuxGlobPatternWarnings.filesystem.disabled.216.test.ts`
- `src/utils/sandbox/__tests__/credentials.files.filesystem.disabled.216.test.ts`

---

## 8. Risks / do-not-simplify

- **Dual getFs*** — collapsing breaks enforcement or UI fidelity.
- **Windows inverted** — skipping rules withholds grants; disabled is no-op/strict, not allowOnly `['/']`.
- Managed pin via **credentials.files** easy to miss.
- **y5r() ≠ allowOnly:['/']** for disabled branch.
- UNCERTAIN: FQt/hre membership, zO/KRg, maskedFileBinds when configs omitted.
- Partial ports that advertise network-only sandbox without unrestricted write open mislead operators.

- **credentials + runtime upgrade (2026-08-07):** `@anthropic-ai/sandbox-runtime` **0.0.44 → ^0.0.70**. Host convert now:
  1. `mergeSandboxCredentialsForRuntime()` (densable multi-source: path-resolve files, skip project/local mask, sticky deny, trusted allowPlaintextInject)
  2. pass `credentials` on `SandboxRuntimeConfig` so package Vzi/Anu/vnu build `unsetEnvVars`/`setEnvVars`/`maskedFileBinds`
  3. native `filesystem.disabled: true` on config (package Gvg/Wvg/Bou) + OUTER dual-facade diagnostic stash retained
  Settings schema still densable QTi (files mode **deny only**); package-only file mask/extract/decode/awsPairs not invented on host settings surface.

- **review fix (2026-08-07):** host convert must **not** copy `credentials.files` into `filesystem.denyRead` (densable leaves that to package Gvg/Dou/WZn). OUTER getFs* when disabled reads raw `getConfig().filesystem` lists (or convert stash), without credential-file paths. Credentials pass-through alone is sufficient for 0.0.70 Vzi.

- **mask/tls residual land (2026-08-07):** densable `tuu`/`o0g`/`ruu` as `maskCredentialInjectionWarning` + `getMaskCredentialWarning`/`canMaskCredentialWarningFire`; settings `network.tlsTerminate` (QTi-adjacent experimental schema, FQt sources only) pass-through on convert; print/REPL surface warning when mask without tls/allowPlaintext. #2/#3 remain intentional densable semantics (disabled drops file deny; credentials.files not host-merged into denyRead).
