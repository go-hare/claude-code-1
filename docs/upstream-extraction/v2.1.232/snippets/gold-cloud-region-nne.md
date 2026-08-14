# densable 2.1.232 #25 — malformed AWS/Vertex region → default

## Changelog

> Fixed malformed AWS or Vertex region values being used to build request URLs; they now fall back to the default region

## densable gold (SEA)

```js
// x5g / C5g / NNe
x5g = /^[a-z]{2,}(?:-[a-z0-9]+){0,4}$/i
function C5g(e){ return !!e && x5g.test(e) }
function NNe(e){ return C5g(e) ? e : void 0 }

// AWS HSs / A5t
function HSs(){ return NNe(X.AWS_REGION) || NNe(X.AWS_DEFAULT_REGION) }
function A5t(){ return HSs() || "us-east-1" }
// ISs source:"env-invalid" when raw env set but NNe rejects

// Vertex Vgo / oVe
function Vgo(){ return NNe(process.env.CLOUD_ML_REGION?.trim()) || "us-east5" }
function oVe(e){
  if (e) {
    let t = LVg().find(([r]) => e.startsWith(r))
    if (t) return NNe(process.env[t[1]]?.trim()) || Vgo()
  }
  return Vgo()
}
```

## Local

| densable | local |
| -------- | ----- |
| `C5g`/`NNe`/`x5g` | `isValidCloudRegion` / `sanitizeCloudRegion` |
| `HSs`/`A5t` | `getAWSRegion` |
| `Vgo` | `getDefaultVertexRegion` |
| `oVe` | `getVertexRegionForModel` |

- Module: `src/utils/envUtils.ts`
- Tests: `src/utils/__tests__/envUtils.test.ts`
