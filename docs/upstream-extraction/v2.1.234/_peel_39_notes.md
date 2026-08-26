# #39 claude-api on-demand ~25k — gold 1:1

SEA: `claude.exe` heap `registerClaudeApiSkill` @312214149 / `Dy0` @312214755 / `Oy0` @312216683 / `Hy0` @312214246 / `Kwd` @291806409.

## Gold

```js
function Hy0(e){let t={};for(let[r,n]of Object.entries(e.SKILL_FILES))t[r]=Ryo(n,e.SKILL_MODEL_VARS);return t}
function Dy0(e,t,r,n){
  let o=[Ryo(r.SKILL_PROMPT,r.SKILL_MODEL_VARS).trimEnd()];
  if(!n) o.push(`## Reference Files Unavailable\n\n...live-sources.md <doc>...`);
  if(e){ let i=`${e}/claude-api/README.md`, s=r.SKILL_FILES[i];
    if(s) o.push(`## Detected Language: ${e}\n\n\`${i}\` is included below...${n?" Read the other referenced files from the base directory on demand...":""}\n\n<doc path="${i}">...</doc>`);
  } else if(wRc(t)!=="prompt-audit") o.push(n ? "Ask...then Read `{lang}/claude-api/README.md`..." : "Ask...before writing code.");
  if(t) o.push(`## User Request\n\n${t}`);
  return o.join(`\n\n`);
}
function Oy0({disabled:e=!1}={}){
  ad({name:"claude-api", menuDescription:"Build and debug apps that use the Claude API",
      files:()=>jkg().then(Hy0),
      async getPromptForCommand(t,r,n){
        let[o,i]=await Promise.all([Py0(),jkg()]);
        L("tengu_claude_api_skill_loaded",{detected_lang:ge(o??"none"),subcommand:ge(wRc(t)),has_args:t.trim().length>0});
        return [{type:"text",text:Dy0(o,t,i,typeof n==="string")}];
      }});
}
```

SKILL.md Reading Guide: `none of those files' content is included above — Read each one on demand before relying on what it covers.`

`Kwd` accepts `files` object **or** async function; passes extract dir (or null) as 3rd arg to `getPromptForCommand`; prefixes `Base directory for this skill: ${u}`.

## Local

| Gold | Local |
|------|-------|
| `Ryo` | `processSkillMarkdown` |
| `Hy0` | `processSkillFiles` |
| `Dy0` | `buildClaudeApiPrompt` |
| `wRc` | `matchSubcommand` |
| `Py0` | `detectLanguage` |
| `Oy0` | `registerClaudeApiSkill` |
| `Kwd` 3-arg + files fn | `registerBundledSkill` |

Removed: `buildInlineReference` dump of all `SKILL_FILES` + `INLINE_READING_GUIDE` that sliced SKILL.md at `## Reading Guide`.

## Residuals (do not invent)

- Gold SKILL_FILES also has `typescript/managed-agents/README.md` and `shared/platform-availability.md`. Local map does not; SKILL.md still cites them. **Do not invent those files.**
- Gold `Kwd` clears the extract-promise after every invoke (`if(o===c)o=void 0`) and re-runs extract with cached file map. Local extract is `O_EXCL` — re-extract would fail — so we **keep the success memo** and only reset on throw.
- Gold `menuDescription` field: local `Command` has none; surfaced as `whenToUse` (same as doctor).
- Gold `ad()` `files:()=>jkg().then(Hy0)` vs local `files:()=>import(...).then(processSkillFiles)`.
- `logEvent` string metadata uses `as never` (LogEventMetadata is bool/number only).
- Gold `ge()` telemetry sanitize not ported (empty stub locally).
- Gold `zas` always `Oy0({disabled: env})`. Local `initBundledSkills` now always `registerClaudeApiSkill()` (env still gates `isEnabled`). `feature('BUILDING_CLAUDE_APPS')` no longer wraps registration.
