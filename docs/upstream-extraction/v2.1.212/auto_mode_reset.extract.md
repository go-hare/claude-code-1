# densable 2.1.212 — `claude auto-mode reset` (`PbS`)

## Full body (from densable binary)

```js
async function PbS(e){
  let t=Lh("userSettings");
  if(!t)return await nu("cli_auto_mode_reset","no_user_settings_path"),
    om("Could not resolve the user settings file path.");
  let r=null;
  try{r=(await ime(t,m4e)).content}
  catch(c){
    if(!ar(c))return await nu("cli_auto_mode_reset","settings_file_unreadable"),
      om(`Could not read ${t}: ${ue(c)}`);
  }
  let n=r!==null&&r.trim()!=="",
      o=n?kl(r,!1):null;
  if(n&&!w7a(o))return await nu("cli_auto_mode_reset","settings_file_invalid"),
    om(bbs(t,"reset"));
  let i=w7a(o)?o.autoMode:void 0;
  if(i===void 0){
    Rs(`Auto mode configuration is already at defaults — ${t} has no autoMode section. `),
    EYf(),
    await nb("cli_auto_mode_reset");
    return
  }
  let s=IU(t),
      a=s.settings===null?[]:s.errors.filter((c)=>c.severity==="warning").map((c)=>bYf(c.path)||"unknown entry");
  if(a.length>0&&e.yes)return await pP("cli_auto_mode_reset","lossy_write_unconfirmed"),
    om(`Not resetting: ${t} also contains ${SYf(a.length,"entry","entries")} this version of Claude Code cannot parse (${a.join(", ")}), and saving the file would delete ${a.length===1?"it":"them"} too. Fix or remove ${a.length===1?"that entry":"those entries"} first, or run the command without --yes to review and confirm.`);
  Rs(`This resets auto mode to the shipped defaults by removing the autoMode section from ${t}: `);
  for(let c of wYf(i))Rs(`  - ${bYf(c)} `);
  if(a.length>0){
    Rs(`Saving will ALSO delete ${SYf(a.length,"entry","entries")} this version of Claude Code cannot parse — the settings writer rewrites the file from its validated view: `);
    for(let c of a)Rs(`  - ${c} `)
  }
  if(!e.yes){
    if(!await Epr("Reset auto mode configuration to defaults?"))
      return await pP("cli_auto_mode_reset","declined"),om("Aborted.")
  }
  let{error:l}=await Yf("userSettings",(c)=>c!==null&&c.autoMode!==void 0?{autoMode:void 0}:null);
  if(l){
    T(`auto-mode reset write failed: ${l.message}`,{level:"error"});
    let c=Sbs(l,t,"reset");
    return await nu("cli_auto_mode_reset",c.code),om(c.message)
  }
  await nb("cli_auto_mode_reset"),
  Rs(`Auto mode configuration reset to defaults — autoMode section removed from ${t}. Run \`claude auto-mode config\` to see the effective rules. `),
  EYf()
}

function wYf(e){
  if(!w7a(e))return["autoMode (unrecognized value)"];
  return Object.entries(e).map(([t,r])=>Array.isArray(r)?`${t} (${r.length} ${It(r.length,"entry","entries")})`:t)
}
function w7a(e){return e!==null&&typeof e==="object"&&!Array.isArray(e)}
function EYf(){
  for(let e of ULr){
    if(e==="userSettings")continue;
    if(Tr(e)?.autoMode!==void 0){
      Rs(`Note: auto mode rules from managed or --settings flag sources still apply — reset only changes your user settings file. `);
      return
    }
  }
}
```

## Semantics

| Step | Behavior |
|------|----------|
| Path | `userSettings` only (`Lh`) |
| Read | Raw file; ENOENT ok; other I/O → `settings_file_unreadable` |
| JSON | Non-empty + not plain object → `settings_file_invalid` + bbs message |
| No autoMode | Already defaults + `EYf` note + telemetry |
| Lossy | `IU(path)`: if settings still parse, `errors` with `severity==="warning"`; with `--yes` → refuse (`lossy_write_unconfirmed`) without write |
| Confirm | Unless `--yes`, `Epr("Reset auto mode configuration to defaults?")` |
| Write | `Yf("userSettings", c => autoMode? {autoMode:undefined}: null)` |
| Success | Remove message + `EYf` |

## Strings

- Confirm: `Reset auto mode configuration to defaults?`
- Already default: `Auto mode configuration is already at defaults — … has no autoMode section.`
- Lossy refuse: `Not resetting: … also contains N entry/entries this version of Claude Code cannot parse (…), and saving the file would delete it/them too…`
- Lossy warn: `Saving will ALSO delete N entry/entries this version of Claude Code cannot parse — the settings writer rewrites the file from its validated view:`
- Success: `Auto mode configuration reset to defaults — autoMode section removed from … Run \`claude auto-mode config\` to see the effective rules.`
- Invalid JSON: `The settings file at ${path} contains invalid JSON — fix or remove it, then re-run reset.`
- Write fail log: `auto-mode reset write failed:`
- Note: `Note: auto mode rules from managed or --settings flag sources still apply — reset only changes your user settings file.`
- Telemetry: `cli_auto_mode_reset` reasons: `no_user_settings_path`, `settings_file_unreadable`, `settings_file_invalid`, `lossy_write_unconfirmed`, `declined`, (+ local `already_default` / `success` / `write_failed`)

## Registration

`auto-mode reset` under `claude auto-mode`, option `-y, --yes`.
