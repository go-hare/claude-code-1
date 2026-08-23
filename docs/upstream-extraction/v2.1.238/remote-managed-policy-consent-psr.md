# densable SEA 2.1.238 — remote managed policy consent (#2)

SEA: `/tmp/official-238/plat/package/claude`

## psr
```js
function psr(){return Z_e()!=="remote"||Qxn()}
```

## Xjo / Qxn (triple consent)
```js
function Xjo(){return dD.sessionCache!==null&&dD.sessionCache===dD.verifiedPayload}
function Qxn(){let{sessionCache:e,verifiedPayload:t,consentedPayload:r}=dD;return e!==null&&e===t&&e===r}
```

## Z_e / pD / sIn / DMr / aIn / OYe
```js
function Z_e(){let e=MN(),t=e.policy.origin;if(t!==void 0)return t.value;let r=sIn(pD());return e.policy.origin={value:r},r}
function pD(){let e={store:MN(),cwd:xn(),allowedSources:GYt(),onLegacyLocalSettingsRead:(t)=>eju.of(Tr().host).fire(t),parentManaged:CNs(),hostManagedProvider:V.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST,flagInline:ARt(),flagPath:f7e(),flagExpectedContent:m7e()??_En(),coworkPlugins:PEn(),canonicalGitRoot:Id,mdm:()=>T4e(),hkcu:()=>PIt(),helper:()=>CVs(),helperArmedFromRemote:()=>dIn(),helperWarnings:()=>VUu(),wslInherits:()=>w4e()};return e.file=()=>nIn(e),e}
function sIn(e){let{helper:t,remoteArmed:r}=aIn(e);if(t)return r?"remote":"helper";if(OYe(e).settings)return"remote";if(QBu(e).settings)return Wt()==="macos"?"plist":"hklm";if((e.file?.()??nIn(e)).settings)return"file";let n=OMr(e);if(n.parentSlice||n.hostModelOverlay)return"parent";let o=e.hkcu?.();return o&&Object.keys(o.settings).length>0?"hkcu":null}
function DMr(e){return e==="helper"||e==="plist"||e==="hklm"||e==="file"}
function aIn(e){return{helper:e.helper?.()??null,remoteArmed:e.helperArmedFromRemote?.()!==!1}}
function OYe(e){let t=e?.remote?e.remote():kIt();if(!t||Object.keys(t).length===0)return{settings:null,errors:[]};return RIt(t,"remote managed settings")}
```

## OBu sessionCache + G8s / RMr / W8s
```js
class OBu{sessionCache=null;eligible=void 0;eligibilityMemo=void 0;policySettingsNotified=!1;verifiedPayload=null;consentedPayload=null;resetEpoch=0;backendView=void 0;replaceSessionCache(e,t){if(this.sessionCache=e,t?.verified)this.verifiedPayload=e;if(e!==null)this.backendView?.standDown("cache loaded")}seedFromDisk(e){this.sessionCache=e;let t=q8s(e);if(t===void 0||t===MN_())this.consentedPayload??=e;this.backendView?.standDown("cache loaded")}markConsented(e){this.consentedPayload=e}markPolicySettingsNotified(){this.policySettingsNotified=!0}recordEligibility(e,t){if(this.eligible=e,t.memoize)this.eligibilityMemo=e;if(!e)this.backendView?.standDown("ineligible")}reset(){this.sessionCache=null,this.eligible=void 0,this.eligibilityMemo=void 0,this.policySettingsNotified=!1,this.verifiedPayload=null,this.consentedPayload=null,this.resetEpoch++,this.backendView?.standDown("account changed")}}
function G8s(){if(!Hpe()&&dD.eligible!==!0)return null;if(dD.sessionCache)return dD.sessionCache;let e=DN_();if(e)return dD.seedFromDisk(e),yE(),e;return null}
function RMr(e,t){dD.replaceSessionCache(e,t),yE()}
function W8s(e){dD.markConsented(e)}
```

## fgt
```js
function fgt(e,t){if(!q9())return null;if(e===void 0)return"lockdown";if(!psr())return"remote_policy_unconsented";let r=pn("policySettings")?.extraKnownMarketplaces??{};if(e.source==="settings"&&t!==void 0)return(Object.hasOwn(r,t)?r[t]:void 0)?.source.source!=="settings"?"lockdown":null;return Object.values(r).some((n)=>JLa(e,n.source))?null:"lockdown"}
```

## Callers
- psr(): fgt; headersHelper policySettings gates; autoupdate failureCode mapping
- Qxn(): psr; remote policyHelpers init; remote-armed helper deactivation (WUu/u4o)
