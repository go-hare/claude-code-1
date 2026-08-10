# Upstream changelog slice — densable 2.1.220

Source: `docs/upstream-extraction/v2.1.212/CHANGELOG.upstream.md` (section `## 2.1.220`).
Official binary: `/tmp/official-220/plat/package/claude`  
(`npm pack @anthropic-ai/claude-code-darwin-arm64@2.1.220`, `// Version: 2.1.220` HIT ×6).

## 2.1.220

- Bug fixes and reliability improvements

## SEA note (extract, not invent)

Public release notes for **2.1.220** are a **single reliability line** — no multi-bullet product surface list (unlike 219/221/222).

Binary is **not** byte-identical to 2.1.219 (same size `256908272`, different sha256; minify renames dominate string-diff noise).

**Named product/telemetry delta confirmed in SEA (vs 219):**

| densable locus | SEA |
| --- | --- |
| `// Version: 2.1.220` | count 6 |
| `isEntitlementOverlayUnavailable` → export `zkt` | 219 **0** / 220 **2** |
| `function zkt(){return xn()==="firstParty"&&zv()&&!Sx()&&nZ()===null&&QXt().length===0}` | overlay-unavailable gate |
| telemetry field `entitlement_blind:zkt()` on `tengu_rotunda_pennant_applied` / refusal-fallback telemetry | 219 **0** / 220 **3** |

Do **not** invent a fake multi-row product checklist for 220. Reliability-only public notes + this overlay gate/telemetry is the honest pack surface.
