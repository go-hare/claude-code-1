# densable 2.1.232 #8 settings aliases (SEA)

```js
// BIy / sRe / rAs
BIy=[
  {alias:"additionalMarketplaces",canonical:"extraKnownMarketplaces"},
  {alias:"allowedMarketplaces",canonical:"strictKnownMarketplaces"},
]
function sRe(e,t){
  if(!isObject(e))return[];
  let r=[];
  for(let{alias:n,canonical:o}of BIy){
    if(!(n in e))continue;
    if(o in e&&e[o]!==null)
      r.push({file:t,path:n,message:`"${n}" is an alias for "${o}" and this file sets both; the "${n}" value was ignored. Use only "${o}".`,severity:"warning",alias:n,canonical:o});
    else e[o]=e[n];
    delete e[n];
  }
  return r;
}
```
