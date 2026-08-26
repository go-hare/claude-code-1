import re
from pathlib import Path

out_dir = Path(r"D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.214")
out_dir.mkdir(parents=True, exist_ok=True)
data = Path(
    r"C:/Users/Administrator/AppData/Local/Temp/official-214/package/claude.exe"
).read_bytes()
strings: list[tuple[int, str]] = []
for m in re.finditer(rb"[\x20-\x7e]{8,}", data):
    strings.append((m.start(), m.group().decode("ascii")))

by_exact: dict[str, int] = {}
for off, s in strings:
    by_exact.setdefault(s, off)


def dedupe(items: list[tuple[int, str]]) -> list[tuple[int, str]]:
    seen: set[str] = set()
    out: list[tuple[int, str]] = []
    for off, s in items:
        if s in seen:
            continue
        seen.add(s)
        out.append((off, s))
    return out


item33: list[tuple[int, str]] = []
for off, s in strings:
    if len(s) > 800:
        continue
    if re.search(r"(--settings|flagSettings|settings flag)", s, re.I) and re.search(
        r"plugin", s, re.I
    ):
        item33.append((off, s))
    elif re.search(
        r"(Skipping --settings-enabled|settings-enabled|Invalid JSON provided to --settings|"
        r"Error processing --settings|the --settings flag|applyFlagSettings|onApplyFlagSettings|"
        r"getSettingsAfterPluginLoad|checkEnabledPlugins|plugin-affecting settings|"
        r"Skipping plugin hooks - safe mode|Syncing installed_plugins\.json with enabledPlugins|"
        r"plugin_load_settings|Failed to parse settings\.json for plugin|"
        r"Loaded settings from settings\.json for plugin|enabled plugins with scopes|"
        r"Cannot materialize versioned cache for --settings-enabled|"
        r"setFlagSettingsPath|getFlagSettingsPath|flagSettingsPath|flagSettingsInline|"
        r"flagSettingsExpectedContent|getPluginAffectingSettingsSnapshot|cachePluginSettings|"
        r"reloadPlugins|Please fix the plugin configuration|"
        r"This appears to be a configuration issue\. Check your plugin settings)",
        s,
        re.I,
    ):
        item33.append((off, s))
item33u = dedupe(item33)

item40: list[tuple[int, str]] = []
for off, s in strings:
    if len(s) > 800:
        continue
    if "Exit code 2" in s or re.search(r"exit code 2 \(blocking", s, re.I):
        item40.append((off, s))
    elif re.search(
        r"Failed to parse hook output as JSON|getPreToolHookBlockingMessage|"
        r"getUserPromptSubmitHookBlockingMessage|getNonBlockableHookErrorMessage|"
        r"CLAUDE_CODE_STOP_HOOK_BLOCK_CAP|A hook blocked the turn from ending|"
        r"stop_hook_blocking|permissionDecision|hookSpecificOutput|"
        r"PreToolUse hook did not respond|PreToolUse hook failed|"
        r"Compaction blocked by PreCompact|HTTP hook blocked|ConfigChange hook blocked|"
        r"If true, hook runs in background and wakes the model on exit code 2",
        s,
        re.I,
    ):
        item40.append((off, s))
item40u = dedupe(item40)

item39: list[tuple[int, str]] = []
for off, s in strings:
    if len(s) > 500:
        continue
    if (
        re.search(r"check your network", s, re.I)
        or re.search(
            r"CLAUDE_CODE_(ENABLE_EXPERIMENTAL_ADVISOR_TOOL|DISABLE_ADVISOR_TOOL|"
            r"DISABLE_THINKING|DISABLE_ADAPTIVE_THINKING)",
            s,
        )
        or s
        in (
            "alwaysThinkingEnabled",
            "advisorModel",
            "showThinkingSummaries",
            "applyAdvisor",
            "# Advisor Tool",
        )
        or "Changing thinking mode mid-conversation" in s
        or "does not support advisor" in s
        or "Advisor tool result content could not be processed" in s
        or "Advisor model for the server-side advisor tool" in s
        or "Enable the server-side advisor tool" in s
        or "run /advisor to change or disable the advisor" in s
        or "change or unset the advisorModel setting" in s
    ):
        if "security advisories" in s.lower() or "Security advisory" in s:
            continue
        item39.append((off, s))
item39u = dedupe(item39)

syms33 = [
    "setFlagSettingsPath",
    "setFlagSettingsInline",
    "setFlagSettingsExpectedContent",
    "getFlagSettingsPath",
    "getFlagSettingsInline",
    "getFlagSettingsExpectedContent",
    "applyFlagSettings",
    "onApplyFlagSettings",
    "getSettingsAfterPluginLoad",
    "checkEnabledPlugins",
    "loadPluginHooks",
    "loadPluginWorkflows",
    "loadPluginManifest",
    "getPluginAffectingSettingsSnapshot",
    "cachePluginSettings",
    "reloadPlugins",
    "enabledPlugins",
    "flagSettings",
    "flagSettingsPath",
    "flagSettingsInline",
    "flagSettingsExpectedContent",
]
sym_hits = {k: hex(by_exact[k]) for k in syms33 if k in by_exact}

extra33: list[tuple[int, str]] = []
regs = [
    re.compile(p, re.I)
    for p in [
        r"disables plugins",
        r"plugin-only",
        r"settings-enabled",
        r"flag settings",
        r"from the --settings",
        r"This rule comes from",
        r"source===\"flagSettings\"|source==\"flagSettings\"|source:\"flagSettings\"",
        r"flagSettings",
    ]
]
for off, s in strings:
    if len(s) > 450:
        continue
    if any(r.search(s) for r in regs):
        extra33.append((off, s))
extra33 = dedupe(extra33)

md: list[str] = []
md.append("# densable/official 2.1.214 binary string extract")
md.append("")
md.append(
    "Binary: `C:\\\\Users\\\\Administrator\\\\AppData\\\\Local\\\\Temp\\\\official-214\\\\package\\\\claude.exe` (256220832 bytes)"
)
md.append("Method: Python ASCII string scan (min len 8).")
md.append("")
md.append("## #33 plugins + `--settings` / flagSettings")
md.append("")
md.append("### Symbol/API names present")
for k, v in sorted(sym_hits.items()):
    md.append(f"- `{k}` @ {v}")
md.append("")
md.append("### Exact / high-signal strings")
for off, s in item33u:
    md.append(f"- `@0x{off:x}` {s}")
md.append("")
md.append("### Extra related")
seen33 = {x[1] for x in item33u}
for off, s in extra33:
    if s in seen33:
        continue
    md.append(f"- `@0x{off:x}` {s}")
md.append("")
md.append("### Interpretation notes (#33)")
md.append(
    "- Official retains first-class `flagSettings` settings source alongside policy/user/project/local."
)
md.append(
    "- CLI flag `--settings` maps into `flagSettings` / `applyFlagSettings` / `setFlagSettings{Path,Inline,ExpectedContent}`."
)
md.append(
    "- Plugin pipeline is settings-aware: `checkEnabledPlugins`, `enabledPlugins`, `getSettingsAfterPluginLoad`, `loadPluginHooks` reloads on plugin-affecting settings change."
)
md.append(
    "- Explicit `--settings-enabled` materialization paths exist: Skipping / Cannot materialize versioned cache."
)
md.append(
    "- Safe-mode: Skipping plugin hooks - safe mode disables plugins (managed settings-file hooks still run)."
)
md.append(
    "- UI attribution: rules from `flagSettings` described as coming from `the --settings flag`."
)
md.append(
    "- Error paths: `Error: Invalid JSON provided to --settings`, `Error processing --settings:`."
)
md.append(
    "- Plugin-local settings files: Loaded/Failed to parse settings.json for plugin + `plugin_load_settings`."
)
md.append("")
md.append("## #40 hooks exit code 2 / blocking / schema")
md.append("")
md.append("### Exit code 2 semantics")
for off, s in item40u:
    if "Exit code 2" in s or "exit code 2" in s:
        md.append(f"- `@0x{off:x}` {s}")
md.append("")
md.append("### Blocking / parse / PreToolUse-PostToolUse related")
for off, s in item40u:
    if not ("Exit code 2" in s or "exit code 2" in s):
        md.append(f"- `@0x{off:x}` {s}")
md.append("")
md.append("### Interpretation notes (#40)")
md.append(
    "- Exit code **2 is the first-class blocking signal** for hooks; docs enumerate per-event effects."
)
md.append(
    "- Async hook option: runs in background and wakes model on exit code 2 (blocking error)."
)
md.append(
    "- JSON control path coexists: decision block + PreToolUse permissionDecision allow/deny/ask."
)
md.append("- Parse failure string: `Failed to parse hook output as JSON:`.")
md.append(
    "- Helpers: getPreToolHookBlockingMessage / getUserPromptSubmitHookBlockingMessage / getNonBlockableHookErrorMessage; env CLAUDE_CODE_STOP_HOOK_BLOCK_CAP."
)
md.append("")
md.append("## #39 check your network / advisor / thinking")
md.append("")
for off, s in item39u:
    md.append(f"- `@0x{off:x}` {s}")
md.append("")
md.append("### Interpretation notes (#39)")
md.append(
    "- Network copy appears in managed-settings load / auth / voice / generic retry paths."
)
md.append(
    "- Advisor productized via advisorModel, --advisor, CLAUDE_CODE_*_ADVISOR_TOOL, applyAdvisor."
)
md.append(
    "- Thinking via alwaysThinkingEnabled / showThinkingSummaries / CLAUDE_CODE_DISABLE_*THINKING*."
)

path = out_dir / "items-33-39-40-strings.md"
path.write_text("\n".join(md), encoding="utf-8")
print("wrote", path)
print("counts", len(item33u), len(item40u), len(item39u), "extra33", len(extra33))
print("\n-- #33 --")
for o, s in item33u:
    print(f"@0x{o:x} {s[:240]}")
print("\n-- #40 --")
for o, s in item40u:
    print(f"@0x{o:x} {s[:240]}")
print("\n-- #39 --")
for o, s in item39u:
    print(f"@0x{o:x} {s[:240]}")
