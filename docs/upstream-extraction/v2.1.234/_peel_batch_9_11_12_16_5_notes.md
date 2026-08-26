# densable 2.1.234 peel notes — #9/#11/#12/#16/#5

## #9 KKn
- SEA `function KKn(e,t,r,n)` @303266385
- flatMap; text non-string → drop + tengu_content_block_healed; thinking heal empty strings
- call sites after nonstreaming success / 404 fallback / stream partial: `KKn(Nl.content,...,{requestId,messageId})`
- Local: `normalizeContentFromAPI(..., meta?)` + claude.ts three sites

## #11 Agf
- `lie=200`, `yVv=100`, `WWs=12`, `BWs=300`
- `_4a=lie+yVv`, `_Vv=2+WWs+1`, `Agf=Math.max(lie+_Vv,BWs)=300`
- `b4a=/^[^\n\r]*$/u`, `bVv=Tgf(Agf)` with `u` flag
- Local: SEND_MESSAGE_TO_MAX_CHARS=300 + schema regex on `to`

## #12 Aoe / x8t
- SSH `[^:/@]+`; URL userinfo `(?:[^@/?#]*@)?` host `[^/:?#@]+(?::\d+)?`
- `fTt` slug + `Fdu` hostname
- Local: parseGitRemote updated 1:1
- Residual closed: `parseGitHubRepository` plain `owner/repo` now also `fTt` (SEA `x8t`)

## #16 HR
- SEA `case"hr":return"---"+AY` with `AY=\n`
- Local: formatToken hr → `'---'+EOL`

## #5 UPb
- Gold: `Use it only to identify the user... unless the user explicitly asks.`
- Skip when `ANTHROPIC_UNIX_SOCKET`
- Local: getUserContext userEmail block + has_user_email diag
