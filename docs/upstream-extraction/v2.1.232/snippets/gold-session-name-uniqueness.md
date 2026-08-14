# densable 2.1.232 #4 — session name uniqueness gold

## Symbols
- `kp` — normalize compare key (NFKC, strip Cc/Cf, lower, spaces→`-`)
- `EFe` — short slug `adj-noun` (`generateShortWordSlug`)
- `JM_` — allocate `base-slug` / `base-slug-N` under aqt=200 (`hi` truncate)
- `YM_` / `XM_` / `Lid` — holders / occupied set / older-than
- `ZM_` — decide keep vs yield by moment (`rename`|`startup`|`recheck`)
- `mEn` — listLive + ZM_ + log `[session-name] "…" is held by live pid …`
- `kxr` — /rename path
- `Bid` / `G$o` — startup + recheck (3s)
- Gate: GrowthBook `tengu_session_name_uniqueness` default **true**

## User strings
- `Another live session on this machine goes by "{desired}", so this session is now "{new}". Use /rename to pick a different name.`
- `Session renamed to: {name} ("{desired}" is held by another live session on this machine)`
- System: `The user asked to name this session "…"; another live session…`

## Local land
- `src/utils/sessionNameUniqueness.ts` — pure core + `mEn`/`Bid`/`G$o`/`Nid`/`QM_`/`jid`
- `listLiveSessionRecords` + `updateSessionName(name, source)` in concurrentSessions
- `/rename` yield + G$o recheck + announceYield
- `runSessionStartupSideEffects` → Bid
- UDS in/out → `noteSessionNameCorrespondent`
- Tests: `sessionNameUniqueness.232.test.ts`
- Residual: strict `procStart` YM_ (see `gold-session-name-bid-gso.md`)
