# densable 2.1.220 — 官方更新清单 × go-hare 对照

> 来源：官方 2.1.220 release notes（`changelog-2.1.220.md`，**1 条** public）。  
> densable 二进制：`/tmp/official-220/plat/package/claude`（darwin-arm64 SEA，VERSION **2.1.220** HIT）。  
> 基线：本地 tip **`3a1864b8`** / densable **2.1.219** remaining 已在 origin。  
> 状态：**GAP** · **PARTIAL** · **HAVE** · **N/A** · **INVENT-BAN**  
> 约定：**extract densable first → 1:1**。不自动 commit/push/bump。  
> 更新：2026-08-10 — residual 1:1 落地 `isEntitlementOverlayUnavailable` + `entitlement_blind`。

## densable 关键符号（SEA）

| 符号 / 字符串 | 含义 |
| --- | --- |
| `// Version: 2.1.220` | 版本锚 |
| `isEntitlementOverlayUnavailable` / export `zkt` | firstParty + 若干 gate 时 overlay 不可用（布尔） |
| `entitlement_blind:zkt()` | rotunda pennant / refusal-fallback 遥测字段 |
| `getModelEntitlementDenySet` 等 Entitlement* | **219 已有 cache**；220 命名导出 + overlay gate |

## 全量对照

| # | 官方条目（摘要） | 状态 | 本地备注 |
| --- | --- | --- | --- |
| 1 | Bug fixes and reliability improvements | **N/A product list** | 官方 **无** 可逐条对齐的 product bullet。SEA 非空（minify + 下列命名增量），但 **禁止** 把 minify 噪声编成假 HAVE 表。 |

## SEA-only named residual

| Residual | densable locus | Local | Verdict |
| --- | --- | --- | --- |
| **Entitlement overlay unavailable gate** | `zkt`：`xn()==="firstParty"&&zv()&&!Sx()&&nZ()===null&&QXt().length===0` | `src/utils/model/entitlementOverlay.ts` → `isEntitlementOverlayUnavailable`；deps 映射见 `snippets/hit-zkt-deps-mapped.txt` | **HAVE** |
| **getModelEntitlementDenySet / isModelDenied** | `fq` / `XW` / `zig(QXt)` | 同文件 `getModelEntitlementDenySet` / `isModelDenied` / `buildModelEntitlementDenySet` | **HAVE** |
| **entitlement_blind telemetry** | `entitlement_blind:zkt()` on `tengu_rotunda_pennant_applied` + refusal `bn` payload | `planRefusalFallbackPresentation.telemetry.entitlementBlind` + `query.ts` `logEvent('tengu_refusal_fallback_request', { entitlement_blind })` | **HAVE**（local event 名仍是 refusal_fallback_request；字段 1:1） |
| **_$c blind opus-5 substitute** | `g$c`/`_$c`：blind && target opus-5 → `claude-opus-4-8` | `applyEntitlementBlindFallbackTarget` wired into `query.ts` resolveArmedFallbackModel inject | **HAVE**（不重写完整 `y$c` EXl） |
| **Reliability bulk** | 官方 1 行 | 无公开逐条列表可对齐 | **N/A** 公开 product surface |

## Explicit non-claims

- **不要**把 221/222 changelog 条目塞进 220 pack。
- **不要** invent #15 MAX_WATCH / #9 gateway。
- **不要** invent full `y$c` EXl / full rotunda pennant pipeline rename。
- 220 **不是**「空包」：VERSION + entitlement overlay gate/telemetry 是真增量；但也 **不是** 24 行 product 大包。
- npm 上 densable 已推进到 **2.1.226+**；本 pack **只**看 220。

## 证据文件

- `snippets/hit-version-2.1.220.txt`
- `snippets/hit-isEntitlementOverlayUnavailable.txt`
- `snippets/hit-function-zkt-overlay.txt`
- `snippets/hit-entitlement_blind-telemetry.txt`
- `snippets/hit-EntitlementOverlayUnavailable-export.txt`
- `snippets/hit-zkt-deps-mapped.txt`
- `snippets/sea-sha256-219-vs-220.txt`

## Tests

- `src/utils/model/__tests__/entitlementOverlay.220.test.ts`
- `src/utils/__tests__/refusalFallback.test.ts`（entitlementBlind 字段）
